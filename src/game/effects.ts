// The effect executor: everything a potion, scroll, wand, staff, rod, spell, mushroom or
// activation can do. Returns whether the effect was noticeable (which identifies the item).
import { type Effect, type Pos, type Stat, type Item, type Timed, type Element, T, F, DIR_DX, DIR_DY, STATS, TRAP_KINDS, isWall } from './types.ts';
import { tileAt, setTile, addFlag, hasFlag, inBounds, isCleanFloor, monsterAt, updateView, playerCanSee, setAux, itemsAt } from './level.ts';
import { raceOf, hasMFlag, monsterName, removeMonster, createMonster, nearFloor, pickRace } from './monster.ts';
import { project, targetFromDir, nearestVisibleMonster } from './projection.ts';
import { monsterTakeHit, takeHit, gainExp, loseExp } from './combat.ts';
import { setTimed, refreshBonuses, teleportPlayer, movePlayerTo } from './effectsCore.ts';
import { restoreStat, gainStat, drainStat } from './player.ts';
import { kindOf, itemFlags, isWeapon, isArmor, isAmmo, identify, itemName, makeObject, isKnown, makeItem } from './items.ts';
import { damroll, randint0, randint1, oneIn, distance } from './util.ts';
import { lightArea, dropNear, disturb } from './world.ts';
import { FOOD_MAX, FOOD_FULL } from '../constants.ts';
import type { Game } from './state.ts';

export interface EffectCtx {
  dir?: number;
  target?: Pos | null;
  /** The item being used (for enchant/identify/recharge targets the UI resolves separately). */
  item?: Item;
  /** Item chosen for identify / enchant / recharge (the UI prompts before calling). */
  chosen?: Item;
  /** Damage multiplier for level-scaled bolts (player level / 5 for magic missile, etc). */
  power?: number;
}

/** Does this effect ask for a direction? */
export function needsDir(e: Effect): boolean {
  switch (e.kind) {
    case 'seq': return e.effects.some(needsDir);
    case 'bolt': case 'ball': case 'breath': case 'light_line': case 'stone_to_mud': case 'sleep_monster': case 'slow_monster': case 'confuse_monster': case 'scare_monster':
    case 'haste_monster': case 'heal_monster': case 'clone_monster': case 'polymorph': case 'teleport_other': case 'drain_life': case 'door_destruction': case 'trap_destruction': case 'wonder': return e.kind !== 'door_destruction' && e.kind !== 'trap_destruction';
    default: return false;
  }
}
/** Does this effect need the player to pick an item from the pack (identify, enchant, recharge)? */
export function needsItem(e: Effect): 'identify' | 'enchant_weapon' | 'enchant_armor' | 'recharge' | 'brand_ammo' | null {
  if (e.kind === 'seq') { for (const s of e.effects) { const r = needsItem(s); if (r) return r; } return null; }
  if (e.kind === 'identify') return 'identify';
  if (e.kind === 'enchant') return e.what === 'toac' ? 'enchant_armor' : 'enchant_weapon';
  if (e.kind === 'recharge') return 'recharge';
  if (e.kind === 'brand_ammo') return 'brand_ammo';
  return null;
}

export function runEffect(g: Game, e: Effect, ctx: EffectCtx = {}): boolean {
  const p = g.player, lv = g.level, b = g.bonuses;
  const dir = ctx.dir ?? 5;
  const tgt = () => targetFromDir(g, dir, ctx.target);
  switch (e.kind) {
    case 'seq': { let any = false; for (const s of e.effects) { if (runEffect(g, s, ctx)) any = true; if (p.dead) break; } return any; }
    case 'nothing': g.msg.add('You feel nothing special.'); return false;
    case 'heal': {
      let any = false;
      const amt = e.percent ? Math.max(e.amount, Math.floor(p.mhp * e.percent / 100)) : e.amount;
      if (p.chp < p.mhp) { p.chp = Math.min(p.mhp, p.chp + amt); g.msg.add(amt >= 300 ? 'You feel much better.' : amt >= 40 ? 'You feel better.' : 'You feel a little better.', '#a0ffa0'); any = true; }
      for (const c of e.cure || []) if (p.timed[c]) { setTimed(g, c, 0); any = true; }
      if (e.amount >= 20 && p.timed.cut) { setTimed(g, 'cut', 0); any = true; }
      return any;
    }
    case 'cure': { let any = false; for (const c of e.cure) if (p.timed[c]) { setTimed(g, c, 0); any = true; } return any; }
    case 'timed': {
      const dur = e.base + (e.dice ? damroll(e.dice[0], e.dice[1]) : 0);
      if (e.clear) return setTimed(g, e.effect, 0);
      // Beneficial effects extend; harmful ones add.
      return setTimed(g, e.effect, (['fast', 'hero', 'shero', 'shield', 'blessed', 'protevil', 'invuln', 'sinvis', 'sinfra', 'telepathy', 'oppose_acid', 'oppose_elec', 'oppose_fire', 'oppose_cold', 'oppose_pois'].includes(e.effect) ? Math.max(p.timed[e.effect], 0) + (p.timed[e.effect] ? Math.floor(dur / 2) : dur) : p.timed[e.effect] + dur));
    }
    case 'restore_stat': {
      let any = false;
      for (const s of (e.stat === 'all' ? STATS : [e.stat])) if (restoreStat(p, s)) { g.msg.add(`You feel less ${STAT_LOW[s]}.`, '#a0ffa0'); any = true; }
      if (any) refreshBonuses(g);
      return any;
    }
    case 'gain_stat': {
      const s = e.stat === 'random' ? STATS[randint0(6)] : e.stat;
      restoreStat(p, s);
      if (!gainStat(p, s)) { g.msg.add(`You feel very ${STAT_HIGH[s]}, but nothing changes.`); return true; }
      g.msg.add(`You feel very ${STAT_HIGH[s]}!`, '#a0ffa0'); refreshBonuses(g); return true;
    }
    case 'lose_stat': { if (b.flags.has(('SUST_' + e.stat) as never)) { g.msg.add('You feel a strange weakness, but it passes.'); return true; } if (drainStat(p, e.stat)) { g.msg.add(`You feel very ${STAT_LOW[e.stat]}.`, '#ff8080'); refreshBonuses(g); } return true; }
    case 'restore_exp': if (p.exp < p.maxExp) { p.exp = p.maxExp; g.msg.add('You feel your life energies returning.', '#a0ffa0'); refreshBonuses(g); return true; } return false;
    case 'gain_exp': { const amt = e.amount || Math.max(1, Math.floor(p.exp / 2)); gainExp(g, amt); return true; }
    case 'lose_exp': loseExp(g, Math.max(1, Math.floor(p.exp * e.amount / 100))); return true;
    case 'nourish': { const before = p.food; p.food = Math.max(0, Math.min(FOOD_MAX, p.food + e.amount)); if (e.amount < 0) g.msg.add('The saltiness makes you throw up!', '#ff8080'); return p.food !== before; }
    case 'satisfy_hunger': p.food = FOOD_FULL - 1; g.msg.add('You feel full.', '#a0ffa0'); return true;
    case 'mana': if (p.csp < p.msp) { p.csp = Math.min(p.msp, p.csp + e.amount); g.msg.add('Your feel your head clear.', '#a0ffa0'); return true; } return false;
    case 'teleport': teleportPlayer(g, e.range); return true;
    case 'teleport_level': {
      if (lv.depth === 0) { g.msg.add('You sink through the floor.'); g.levelChange = { depth: 1, by: 'teleport' }; }
      else if (oneIn(2) || lv.depth >= 99) { g.msg.add('You rise up through the ceiling.'); g.levelChange = { depth: lv.depth - 1, by: 'teleport' }; }
      else { g.msg.add('You sink through the floor.'); g.levelChange = { depth: lv.depth + 1, by: 'teleport' }; }
      return true;
    }
    case 'recall': {
      if (p.timed.recall) { setTimed(g, 'recall', 0); return true; }
      if (lv.depth === 0 && p.maxDepth === 0) { g.msg.add('Nothing happens: you have never been below the town.'); return false; }
      if (lv.depth > 0) p.recallDepth = 0; else p.recallDepth = Math.max(1, p.maxDepth);
      setTimed(g, 'recall', 15 + randint1(20)); return true;
    }
    case 'deep_descent': { if (lv.depth === 0) { g.msg.add('The floor here is solid.'); return false; } setTimed(g, 'deep_descent', 3 + randint1(3)); return true; }
    case 'detect': {
      let any = false;
      const R = 30, RY = 15;
      const inRange = (x: number, y: number) => Math.abs(x - p.x) <= R && Math.abs(y - p.y) <= RY;
      for (const w of e.what) {
        if (w === 'monsters' || w === 'invisible' || w === 'evil' || w === 'all') {
          for (const m of lv.monsters) {
            if (!inRange(m.x, m.y)) continue;
            const r = raceOf(m);
            if (w === 'evil' && !hasMFlag(r, 'EVIL')) continue;
            if (w === 'invisible' && !hasMFlag(r, 'INVISIBLE')) continue;
            if (w === 'monsters' && hasMFlag(r, 'INVISIBLE') && !b.flags.has('SEE_INVIS')) continue;
            m.detected = true; m.visible = true; any = true;
          }
          if (any) g.msg.add(w === 'evil' ? 'You sense the presence of evil creatures!' : w === 'invisible' ? 'You sense the presence of invisible creatures!' : 'You sense the presence of monsters!');
        }
        if (w === 'objects' || w === 'gold' || w === 'all') {
          let n = 0;
          for (const fi of lv.items) { if (!inRange(fi.x, fi.y)) continue; const isGold = kindOf(fi.item).tval === 'gold'; if (w === 'gold' && !isGold) continue; if (w === 'objects' && isGold) continue; addFlag(lv, fi.x, fi.y, F.MARK); (fi as { seen?: boolean }).seen = true; n++; }
          if (w === 'gold' || w === 'all') for (let y = p.y - RY; y <= p.y + RY; y++) for (let x = p.x - R; x <= p.x + R; x++) { const t = tileAt(lv, x, y); if (t === T.MAGMA_K || t === T.QUARTZ_K) { addFlag(lv, x, y, F.MARK); n++; } }
          if (n) { g.msg.add(w === 'gold' ? 'You sense the presence of buried treasure!' : 'You sense the presence of objects!'); any = true; }
        }
        if (w === 'traps' || w === 'doors' || w === 'stairs' || w === 'all') {
          let n = 0;
          for (let y = p.y - RY; y <= p.y + RY; y++) for (let x = p.x - R; x <= p.x + R; x++) {
            const t = tileAt(lv, x, y);
            if ((w === 'traps' || w === 'all') && (t === T.TRAP || t === T.TRAP_HIDDEN)) { setTile(lv, x, y, T.TRAP); addFlag(lv, x, y, F.MARK); n++; }
            if ((w === 'doors' || w === 'all') && (t === T.DOOR_CLOSED || t === T.DOOR_OPEN || t === T.DOOR_BROKEN || t === T.SECRET_DOOR)) { if (t === T.SECRET_DOOR) setTile(lv, x, y, T.DOOR_CLOSED); addFlag(lv, x, y, F.MARK); n++; }
            if ((w === 'stairs' || w === 'all') && (t === T.STAIRS_UP || t === T.STAIRS_DOWN)) { addFlag(lv, x, y, F.MARK); n++; }
          }
          if (n) { g.msg.add(w === 'traps' ? 'You sense the presence of traps!' : w === 'doors' ? 'You sense the presence of doors!' : w === 'stairs' ? 'You sense the presence of stairs!' : 'You sense your surroundings.'); any = true; }
        }
      }
      if (!any) g.msg.add('You sense nothing.');
      return true;
    }
    case 'map': case 'sense_surroundings': {
      const R = e.kind === 'map' ? 30 : 20;
      for (let y = p.y - R / 2; y <= p.y + R / 2; y++) for (let x = p.x - R; x <= p.x + R; x++) {
        if (!inBounds(lv, x, y)) continue;
        const t = tileAt(lv, x, y);
        if (t === T.FLOOR || t === T.GRASS || t === T.ROAD || t === T.TRAP_HIDDEN) {
          // Mark the floor and every wall around it (Angband maps walls next to floors).
          let open = false;
          for (let d = 1; d <= 9; d++) { if (d === 5) continue; const nt = tileAt(lv, x + DIR_DX[d], y + DIR_DY[d]); if (nt !== T.PERM && !isWall(nt)) open = true; }
          if (open || true) { addFlag(lv, x, y, F.MARK); for (let d = 1; d <= 9; d++) { if (d === 5) continue; const nx = x + DIR_DX[d], ny = y + DIR_DY[d]; if (isWall(tileAt(lv, nx, ny)) || tileAt(lv, nx, ny) === T.RUBBLE || tileAt(lv, nx, ny) >= T.DOOR_CLOSED && tileAt(lv, nx, ny) <= T.STAIRS_DOWN) addFlag(lv, nx, ny, F.MARK); } }
        } else if (t !== T.PERM && t !== T.TRAP_HIDDEN) addFlag(lv, x, y, F.MARK);
      }
      g.msg.add('You sense the layout of the area.');
      return true;
    }
    case 'light_room': lightArea(g, p.x, p.y, true); g.msg.add('You are surrounded by a white light.'); updateView(lv, p.x, p.y, b.lightRadius, p.timed.blind > 0); return true;
    case 'darkness': lightArea(g, p.x, p.y, false); if (!b.flags.has('RES_BLIND') && !b.flags.has('RES_DARK')) setTimed(g, 'blind', p.timed.blind + 3 + randint1(5)); g.msg.add('Darkness surrounds you.'); updateView(lv, p.x, p.y, b.lightRadius, p.timed.blind > 0); return true;
    case 'light_line': { const t = tgt(); g.msg.add('A line of light appears.'); project(g, p.x, p.y, t.x, t.y, 'lite', { dam: damroll(e.dice[0], e.dice[1]), beam: true, source: 'player', kind: 'light' }); updateView(lv, p.x, p.y, b.lightRadius, p.timed.blind > 0); return true; }
    case 'enchant': {
      const it = ctx.chosen;
      if (!it) return false;
      let any = false;
      for (let i = 0; i < e.amount; i++) {
        const cur = e.what === 'tohit' ? it.toHit : e.what === 'todam' ? it.toDam : it.toAc;
        const chance = cur < 0 ? 0 : cur > 15 ? 1000 : ENCHANT_TABLE[cur];
        if (randint1(1000) > chance || (it.artifact && !oneIn(2))) continue;
        if (e.what === 'tohit') it.toHit++; else if (e.what === 'todam') it.toDam++; else it.toAc++;
        any = true;
        if (it.cursed && !itemFlags(it).has('HEAVY_CURSE') && oneIn(4)) { it.cursed = false; it.flags = it.flags.filter(f => f !== 'CURSED'); g.msg.add('The curse is broken!', '#a0ffa0'); }
      }
      const nm = itemName(it, g.flavors, { article: false, count: false });
      g.msg.add(any ? `Your ${nm} glow${it.number > 1 ? '' : 's'} brightly!` : 'The enchantment failed.', any ? '#a0ffa0' : '#e8e4d8');
      refreshBonuses(g);
      return true;
    }
    case 'identify': { const it = ctx.chosen; if (!it) return false; identify(it, g.flavors); g.msg.add(`You have ${itemName(it, g.flavors)}.`); refreshBonuses(g); return true; }
    case 'remove_curse': {
      let any = false;
      for (const s of Object.keys(p.equip) as (keyof typeof p.equip)[]) { const it = p.equip[s]; if (!it || !it.cursed) continue; if (itemFlags(it).has('HEAVY_CURSE') && !e.heavy) continue; it.cursed = false; it.flags = it.flags.filter(f => f !== 'CURSED' && f !== 'HEAVY_CURSE'); any = true; }
      if (any) g.msg.add('You feel as if someone is watching over you.', '#a0ffa0');
      return any;
    }
    case 'recharge': {
      const it = ctx.chosen; if (!it) return false;
      const k = kindOf(it);
      const fail = Math.max(1, Math.floor((e.power + 100 - k.level - 10 * it.charges) / 15));
      if (oneIn(fail)) { g.msg.add('There is a bright flash of light.', '#ff8080'); const i = p.inven.indexOf(it); if (i >= 0) p.inven.splice(i, 1); return true; }
      it.charges += 2 + randint1(Math.max(1, Math.floor(e.power / 5)));
      g.msg.add(`Your ${itemName(it, g.flavors, { article: false, count: false })} glows.`, '#a0ffa0');
      return true;
    }
    case 'bolt': { const t = tgt(); const dam = damroll(e.dice[0], e.dice[1]) + (e.base || 0) + (ctx.power || 0); const beam = e.beam ? randint0(100) < e.beam + (p.cls === 'mage' ? p.lev : 0) : false; project(g, p.x, p.y, t.x, t.y, e.element, { dam, beam, source: 'player' }); return true; }
    case 'ball': { const t = tgt(); const dam = e.dam + (e.dice ? damroll(e.dice[0], e.dice[1]) : 0) + (ctx.power || 0); project(g, p.x, p.y, t.x, t.y, e.element, { dam, radius: e.radius, source: 'player' }); return true; }
    case 'breath': { const t = tgt(); project(g, p.x, p.y, t.x, t.y, e.element, { dam: e.dam, radius: 2, source: 'player' }); g.msg.add(`You breathe ${e.element}!`); return true; }
    case 'burst': { let any = false; for (const m of lv.monsters.slice()) if (distance(p.x, p.y, m.x, m.y) <= e.radius && playerCanSee(lv, m.x, m.y)) { g.fx.push({ type: 'ball', x: p.x, y: p.y, radius: e.radius, element: e.element, cells: [] }); project(g, p.x, p.y, m.x, m.y, e.element, { dam: e.dam, source: 'player', range: e.radius + 1 }); any = true; } return any; }
    case 'stone_to_mud': { const t = tgt(); return project(g, p.x, p.y, t.x, t.y, 'missile', { dam: 20 + randint1(30), source: 'player', kind: 'stone_to_mud', range: 20 }); }
    case 'door_destruction': case 'trap_destruction': { let any = false; for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; const t = tileAt(lv, x, y); if (t === T.TRAP || t === T.TRAP_HIDDEN || t === T.DOOR_CLOSED || t === T.DOOR_OPEN || t === T.DOOR_BROKEN || t === T.SECRET_DOOR) { setTile(lv, x, y, T.FLOOR); any = true; } } if (any) g.msg.add('There is a bright flash of light!'); return any; }
    case 'sleep_monsters': case 'slow_monsters': case 'scare_monsters': case 'confuse_monsters': {
      let any = false;
      const kind = e.kind === 'sleep_monsters' ? 'sleep' : e.kind === 'slow_monsters' ? 'slow' : e.kind === 'scare_monsters' ? 'scare' : 'confuse';
      for (const m of lv.monsters.slice()) if (m.visible && playerCanSee(lv, m.x, m.y)) { project(g, p.x, p.y, m.x, m.y, 'missile', { dam: p.lev * 2 + 10, source: 'player', kind, range: 30 }); any = true; }
      return any;
    }
    case 'sleep_monster': case 'slow_monster': case 'confuse_monster': case 'scare_monster': case 'haste_monster': case 'heal_monster': case 'clone_monster': case 'polymorph': case 'teleport_other': {
      const t = tgt();
      const kind = e.kind === 'sleep_monster' ? 'sleep' : e.kind === 'slow_monster' ? 'slow' : e.kind === 'confuse_monster' ? 'confuse' : e.kind === 'scare_monster' ? 'scare' : e.kind === 'haste_monster' ? 'haste' : e.kind === 'heal_monster' ? 'heal' : e.kind === 'clone_monster' ? 'clone' : e.kind === 'polymorph' ? 'polymorph' : 'teleport_other';
      return project(g, p.x, p.y, t.x, t.y, 'missile', { dam: kind === 'teleport_other' ? 100 : kind === 'heal' ? 40 : p.lev * 2 + 10, source: 'player', kind });
    }
    case 'drain_life': { const t = tgt(); return project(g, p.x, p.y, t.x, t.y, 'nether', { dam: e.dam, source: 'player', kind: 'drain' }); }
    case 'dispel': {
      let any = false;
      for (const m of lv.monsters.slice()) {
        if (!m.visible || !playerCanSee(lv, m.x, m.y)) continue;
        const r = raceOf(m);
        if (e.what === 'undead' && !hasMFlag(r, 'UNDEAD')) continue;
        if (e.what === 'evil' && !hasMFlag(r, 'EVIL')) continue;
        g.msg.add(`${monsterName(m)} shudders.`);
        monsterTakeHit(g, m, randint1(e.dam), 'dissolves');
        any = true;
      }
      return any;
    }
    case 'turn_undead': { let any = false; for (const m of lv.monsters) { if (!m.visible || !hasMFlag(raceOf(m), 'UNDEAD')) continue; if (raceOf(m).depth > randint1(p.lev * 3)) continue; m.afraid = 10 + randint1(20); g.msg.add(`${monsterName(m)} flees in terror!`); any = true; } return any; }
    case 'banish': {
      // Banish every monster of the race of the nearest visible one (a stand-in for the symbol prompt).
      const m = nearestVisibleMonster(g);
      if (!m) { g.msg.add('There is nothing to banish.'); return false; }
      const race = m.race;
      let n = 0;
      for (const o of lv.monsters.slice()) if (o.race === race && !hasMFlag(raceOf(o), 'UNIQUE')) { removeMonster(g, o); n++; takeHit(g, randint1(4), 'the strain of casting Banishment'); }
      g.msg.add(n ? `Every ${raceOf(m).name} on the level vanishes!` : 'Nothing happens.');
      return n > 0;
    }
    case 'mass_banish': { let n = 0; for (const o of lv.monsters.slice()) if (distance(p.x, p.y, o.x, o.y) <= 20 && !hasMFlag(raceOf(o), 'UNIQUE')) { removeMonster(g, o); n++; takeHit(g, randint1(3), 'the strain of casting Mass Banishment'); } g.msg.add(n ? 'The monsters around you vanish!' : 'Nothing happens.'); return n > 0; }
    case 'destruction': case 'earthquake': {
      const R = e.kind === 'destruction' ? 15 : 8;
      for (let y = p.y - R; y <= p.y + R; y++) for (let x = p.x - R; x <= p.x + R; x++) {
        if (!inBounds(lv, x, y) || (x === p.x && y === p.y) || distance(p.x, p.y, x, y) > R) continue;
        if (hasFlag(lv, x, y, F.VAULT) || tileAt(lv, x, y) === T.PERM || lv.depth === 0) continue;
        if (e.kind === 'earthquake' && !oneIn(3)) continue;
        const m = monsterAt(lv, x, y);
        if (m) { if (e.kind === 'destruction' && !hasMFlag(raceOf(m), 'UNIQUE')) removeMonster(g, m); else if (e.kind === 'earthquake') { monsterTakeHit(g, m, damroll(4, 8), 'is crushed', true); continue; } else continue; }
        for (const fi of itemsAt(lv, x, y)) lv.items.splice(lv.items.indexOf(fi), 1);
        const r = randint0(100);
        setTile(lv, x, y, r < 20 ? T.GRANITE : r < 50 ? T.QUARTZ : r < 70 ? T.MAGMA : T.FLOOR);
        lv.flags[y * lv.w + x] &= ~(F.MARK | F.GLOW | F.ROOM);
      }
      g.msg.add(e.kind === 'destruction' ? 'There is a searing blast of light!' : 'The ground shakes violently!', '#ffd040');
      g.fx.push({ type: 'shake', amount: 10 });
      if (e.kind === 'destruction' && !b.flags.has('RES_BLIND') && !b.flags.has('RES_LITE')) setTimed(g, 'blind', p.timed.blind + 10 + randint1(10));
      g.flowDirty = true;
      updateView(lv, p.x, p.y, b.lightRadius, p.timed.blind > 0);
      return true;
    }
    case 'summon': {
      let n = 0;
      for (let i = 0; i < e.count; i++) {
        const pos = nearFloor(lv, p.x, p.y, 3); if (!pos) continue;
        const race = pickRace(g, lv.depth + 1, r => e.what === 'undead' ? hasMFlag(r, 'UNDEAD') : e.what === 'animal' ? hasMFlag(r, 'ANIMAL') : !hasMFlag(r, 'UNIQUE'));
        if (race) { createMonster(g, race.id, pos.x, pos.y, false); n++; }
      }
      if (n) g.msg.add('You hear something appear nearby!', '#ff8080');
      return n > 0;
    }
    case 'aggravate': { for (const m of lv.monsters) { m.sleep = 0; if (distance(p.x, p.y, m.x, m.y) < 20 && !hasMFlag(raceOf(m), 'UNIQUE')) m.hasted = Math.max(m.hasted, 10); } g.msg.add('There is a high pitched humming noise.', '#ff8080'); return true; }
    case 'curse': {
      const it = oneIn(2) ? p.equip.weapon : p.equip.body;
      if (!it) { g.msg.add('You feel a malevolent aura, but nothing happens.'); return false; }
      if (it.artifact && !oneIn(2)) { g.msg.add(`Your ${itemName(it, g.flavors, { article: false, plainKind: true })} resists the curse!`); return true; }
      it.cursed = true; if (!it.flags.includes('CURSED')) it.flags.push('CURSED'); it.toHit -= randint1(5); it.toDam -= randint1(5); it.toAc -= randint1(5); it.ego = undefined;
      g.msg.add(`A terrible black aura surrounds your ${itemName(it, g.flavors, { article: false, plainKind: true })}!`, '#ff8080'); refreshBonuses(g); return true;
    }
    case 'create_food': { const it = makeItem('ration', 1); dropNear(g, it, p.x, p.y); g.msg.add('Food appears at your feet.'); return true; }
    case 'create_traps': { let n = 0; for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; if (isCleanFloor(lv, x, y)) { setTile(lv, x, y, T.TRAP_HIDDEN); setAux(lv, x, y, randint0(TRAP_KINDS.length)); n++; } } g.msg.add('You hear a low-pitched whistling sound.', '#ff8080'); return n > 0; }
    case 'create_doors': { let n = 0; for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; if (isCleanFloor(lv, x, y)) { setTile(lv, x, y, T.DOOR_CLOSED); addFlag(lv, x, y, F.MARK); n++; } } g.flowDirty = true; return n > 0; }
    case 'create_stairs': { if (lv.depth === 0 || hasFlag(lv, p.x, p.y, F.VAULT) || tileAt(lv, p.x, p.y) !== T.FLOOR) { g.msg.add('The floor here is unsuitable.'); return false; } setTile(lv, p.x, p.y, oneIn(2) ? T.STAIRS_DOWN : T.STAIRS_UP); g.msg.add('A staircase appears under you!'); return true; }
    case 'acquirement': { for (let i = 0; i < e.count; i++) { const it = makeObject(lv.depth + 10, true, true); if (it) dropNear(g, it, p.x, p.y); } g.msg.add('Something wonderful appears at your feet!', '#ffd040'); return true; }
    case 'glyph': { if (tileAt(lv, p.x, p.y) !== T.FLOOR) { g.msg.add('The floor here cannot hold a glyph.'); return false; } addFlag(lv, p.x, p.y, F.TEMP); g.msg.add('You inscribe a glyph of warding.'); return true; }
    case 'brand_weapon': { const it = p.equip.weapon; if (!it || it.artifact || it.ego) { g.msg.add('The branding failed.'); return false; } it.flags.push(e.brand); it.ego = undefined; g.msg.add(`Your ${itemName(it, g.flavors, { article: false, plainKind: true })} gleams with ${e.brand === 'BRAND_FIRE' ? 'fire' : e.brand === 'BRAND_COLD' ? 'frost' : e.brand === 'BRAND_POIS' ? 'venom' : e.brand === 'BRAND_ELEC' ? 'lightning' : 'acid'}!`, '#a0ffa0'); return true; }
    case 'brand_ammo': { const it = ctx.chosen; if (!it || !isAmmo(kindOf(it)) || it.ego) { g.msg.add('The branding failed.'); return false; } it.flags.push(e.brand); it.known = true; g.msg.add(`Your ${itemName(it, g.flavors, { article: false, count: false })} are branded!`, '#a0ffa0'); return true; }
    case 'wonder': { const r = randint0(5); const effs: Effect[] = [{ kind: 'bolt', element: 'fire', dice: [9, 8] }, { kind: 'ball', element: 'cold', dam: 60, radius: 2 }, { kind: 'teleport_other' }, { kind: 'light_line', dice: [6, 8] }, { kind: 'summon', count: 1 }]; return runEffect(g, effs[r], ctx); }
    case 'poison_self': if (!b.flags.has('RES_POIS') && !p.timed.oppose_pois) { setTimed(g, 'poisoned', p.timed.poisoned + damroll(e.dice[0], e.dice[1])); return true; } return false;
    case 'damage_self': takeHit(g, damroll(e.dice[0], e.dice[1]), e.text); g.msg.add(e.text, '#ff8080'); return true;
    case 'probe': { let any = false; for (const m of lv.monsters) if (m.visible) { const r = raceOf(m); g.msg.add(`${monsterName(m)}: ${m.hp}/${m.maxhp} hp, AC ${r.ac}, speed ${r.speed >= 0 ? '+' : ''}${r.speed}, ${r.flags.filter(f => f.startsWith('IM_')).map(f => f.slice(3).toLowerCase()).join(' ') || 'no'} immunities.`); any = true; } return any; }
  }
}
const ENCHANT_TABLE = [0, 10, 50, 100, 200, 300, 400, 500, 650, 800, 950, 987, 993, 995, 998, 1000];
const STAT_LOW: Record<Stat, string> = { STR: 'weak', INT: 'stupid', WIS: 'naive', DEX: 'clumsy', CON: 'sickly', CHR: 'ugly' };
const STAT_HIGH: Record<Stat, string> = { STR: 'strong', INT: 'smart', WIS: 'wise', DEX: 'dextrous', CON: 'healthy', CHR: 'cute' };
export const _keep = [isWeapon, isArmor, isKnown, movePlayerTo, disturb];
export type { Element, Timed };
