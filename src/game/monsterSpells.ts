// What monsters cast: bolts, balls, breath, curses, summons, teleports and the annoyances, with
// Angband 3.0's damage formulas and a spell picker that weighs the situation (Angband's
// remove_bad_spells / choose_attack_spell) for SMART monsters or when the smart-monsters birth
// option is on.
import { type Monster, type MonsterSpell, type Element, type Stat, type MonsterRace, type ObjectFlag, type Timed } from './types.ts';
import { raceOf, hasMFlag, monsterName, monsterNameVisible, createMonster, nearFloor, pickRace } from './monster.ts';
import { takeHit, loseExp } from './combat.ts';
import { project, breathe } from './projection.ts';
import { setTimed, playerSavingThrow, teleportPlayer, teleportMonster, teleportPlayerTo, refreshBonuses } from './effectsCore.ts';
import { damroll, randint0, randint1, oneIn, distance, weightedPick } from './util.ts';
import { lightArea } from './world.ts';
import { drainStat } from './player.ts';
import { setTile, tileAt, isCleanFloor, setAux, hasFlag } from './level.ts';
import { T, F, TRAP_KINDS, DIR_DX, DIR_DY } from './types.ts';
import type { Game } from './state.ts';
import { noteSpell } from './lore.ts';

const BOLT_ELEM: Partial<Record<MonsterSpell, Element>> = { BOLT_ACID: 'acid', BOLT_ELEC: 'elec', BOLT_FIRE: 'fire', BOLT_COLD: 'cold', BOLT_POIS: 'pois', BOLT_NETHER: 'nether', BOLT_MANA: 'mana', MISSILE: 'missile', ARROW: 'missile', BOLT_WATER: 'water', BOLT_PLASMA: 'plasma', BOLT_ICE: 'ice' };
const BALL_ELEM: Partial<Record<MonsterSpell, Element>> = { BALL_ACID: 'acid', BALL_ELEC: 'elec', BALL_FIRE: 'fire', BALL_COLD: 'cold', BALL_POIS: 'pois', BALL_NETHER: 'nether', BALL_DARK: 'dark', BALL_MANA: 'mana', BALL_CHAOS: 'chaos', BALL_WATER: 'water' };
const BR_ELEM: Partial<Record<MonsterSpell, Element>> = { BR_ACID: 'acid', BR_ELEC: 'elec', BR_FIRE: 'fire', BR_COLD: 'cold', BR_POIS: 'pois', BR_NETHER: 'nether', BR_DARK: 'dark', BR_LITE: 'lite', BR_SOUND: 'sound', BR_CHAOS: 'chaos', BR_CONF: 'conf', BR_NEXUS: 'nexus', BR_TIME: 'time', BR_INERTIA: 'inertia', BR_GRAVITY: 'gravity', BR_SHARDS: 'shards', BR_PLASMA: 'plasma', BR_FORCE: 'force', BR_DISEN: 'disen', BR_DISINT: 'disint', BR_MANA: 'mana' };
/** Breath damage: hp divided by this, capped. Angband 3.0's monster_spell breaths. */
const BR_DIV: Partial<Record<Element, [number, number]>> = { acid: [3, 1600], elec: [3, 1600], fire: [3, 1600], cold: [3, 1600], pois: [3, 800], nether: [6, 550], lite: [6, 400], dark: [6, 400], sound: [6, 500], chaos: [6, 500], conf: [6, 400], nexus: [3, 250], time: [3, 150], inertia: [6, 200], gravity: [3, 200], shards: [6, 500], plasma: [6, 150], force: [6, 200], disen: [6, 500], disint: [3, 300], mana: [3, 250] };
export const ELEMENT_NAME: Record<Element, string> = { acid: 'acid', elec: 'lightning', fire: 'fire', cold: 'frost', pois: 'gas', lite: 'light', dark: 'darkness', nether: 'nether', sound: 'sound', chaos: 'chaos', conf: 'confusion', mana: 'mana', missile: 'magic', holy: 'holy fire', water: 'water', nexus: 'nexus', disen: 'disenchantment', shards: 'shards', time: 'time', inertia: 'inertia', gravity: 'gravity', plasma: 'plasma', force: 'force', ice: 'ice', disint: 'disintegration' };

const SUMMONS: MonsterSpell[] = ['S_MONSTER', 'S_MONSTERS', 'S_KIN', 'S_UNDEAD', 'S_DRAGON', 'S_DEMON', 'S_ANIMAL', 'S_HYDRA', 'S_ANGEL', 'S_SPIDER', 'S_HOUND', 'S_HI_UNDEAD', 'S_HI_DRAGON', 'S_HI_DEMON', 'S_WRAITH', 'S_UNIQUE'];
const ESCAPES: MonsterSpell[] = ['BLINK', 'TPORT', 'TELE_AWAY', 'TELE_LEVEL'];
const ANNOY: MonsterSpell[] = ['SHRIEK', 'SCARE', 'CONF', 'BLIND', 'SLOW', 'HOLD', 'DARKNESS', 'TRAPS', 'FORGET', 'TELE_TO', 'DRAIN_MANA', 'MIND_BLAST', 'BRAIN_SMASH'];
const TACTIC: MonsterSpell[] = ['HEAL', 'HASTE'];

/** Which player flag makes a spell's element pointless (Angband's smart_learn logic, without the learning). */
function resistedBy(elem: Element, flags: Set<ObjectFlag>, timed: Record<Timed, number>): boolean {
  switch (elem) {
    case 'acid': return flags.has('IM_ACID') || (flags.has('RES_ACID') && timed.oppose_acid > 0);
    case 'elec': return flags.has('IM_ELEC') || (flags.has('RES_ELEC') && timed.oppose_elec > 0);
    case 'fire': return flags.has('IM_FIRE') || (flags.has('RES_FIRE') && timed.oppose_fire > 0);
    case 'cold': case 'ice': return flags.has('IM_COLD') || (flags.has('RES_COLD') && timed.oppose_cold > 0);
    case 'pois': return flags.has('RES_POIS') && timed.oppose_pois > 0;
    case 'nether': return flags.has('RES_NETHER'); case 'lite': return flags.has('RES_LITE'); case 'dark': return flags.has('RES_DARK');
    case 'sound': return flags.has('RES_SOUND'); case 'chaos': return flags.has('RES_CHAOS'); case 'conf': return flags.has('RES_CONF');
    case 'nexus': return flags.has('RES_NEXUS'); case 'disen': return flags.has('RES_DISEN'); case 'shards': return flags.has('RES_SHARDS');
    default: return false;
  }
}

/** Pick a spell for the monster. Dumb monsters pick at random; smart ones weigh the situation. */
export function chooseSpell(g: Game, m: Monster): MonsterSpell | null {
  const r = raceOf(m), p = g.player;
  let spells = r.spells!.slice();
  if (!spells.length) return null;
  const smart = hasMFlag(r, 'SMART') || g.options.smartMonsters;
  const dist = distance(p.x, p.y, m.x, m.y);
  if (smart) {
    // Drop attacks the player is known to shrug off, and pointless utility.
    const f = g.bonuses.flags, t = p.timed;
    spells = spells.filter(s => {
      const el = BOLT_ELEM[s] || BALL_ELEM[s] || BR_ELEM[s];
      if (el && resistedBy(el, f, t) && !oneIn(4)) return false;
      if (s === 'HOLD' && f.has('FREE_ACT')) return false;
      if (s === 'SLOW' && f.has('FREE_ACT') && !oneIn(3)) return false;
      if (s === 'BLIND' && f.has('RES_BLIND')) return false;
      if (s === 'CONF' && f.has('RES_CONF')) return false;
      if (s === 'SCARE' && (f.has('RES_FEAR') || t.hero || t.shero)) return false;
      if (s === 'HEAL' && m.hp >= m.maxhp) return false;
      if (s === 'HASTE' && m.hasted) return false;
      if (s === 'DRAIN_MANA' && p.csp === 0) return false;
      if (s === 'TELE_TO' && dist <= 1) return false;
      if ((s === 'BLINK' || s === 'TPORT') && !m.afraid && m.hp > m.maxhp / 3) return oneIn(4);
      return true;
    });
    if (!spells.length) return null;
  }
  // Situation weights: fleeing or badly hurt -> heal / escape; adjacent -> less summoning; far -> summons and tele_to.
  const hurt = m.hp < m.maxhp / 3;
  return weightedPick(spells, s => {
    let w = 10;
    if (!smart && !hasMFlag(r, 'STUPID')) {
      if (hurt && s === 'HEAL') w += 20;
      if (m.afraid && ESCAPES.includes(s)) w += 20;
      return w;
    }
    if (smart) {
      if (hurt && (s === 'HEAL')) w += 40;
      if ((hurt || m.afraid) && ESCAPES.includes(s)) w += 30;
      if (SUMMONS.includes(s)) w += dist > 3 ? 10 : -4;
      if (BR_ELEM[s]) w += 10;
      if (BALL_ELEM[s] || BOLT_ELEM[s]) w += 5;
      if (ANNOY.includes(s) && !hurt) w += 2;
      if (TACTIC.includes(s) && !hurt) w -= 5;
    }
    return Math.max(1, w);
  }) || null;
}

/** Cast one spell from the race's list. Returns false if nothing was cast (so the monster moves instead). */
export function monsterCastSpell(g: Game, m: Monster): boolean {
  const r = raceOf(m), p = g.player;
  const choice = chooseSpell(g, m);
  if (!choice) return false;
  const name = monsterNameVisible(g, m);
  const level = Math.max(1, r.depth);
  const powerful = hasMFlag(r, 'POWERFUL');
  const seen = m.visible;
  const cause = monsterName(m, false).replace(/^the /, '');
  const save = () => playerSavingThrow(g);
  m.attackAnim = 8;
  if (seen) noteSpell(g, m, choice);
  const bolt = BOLT_ELEM[choice], ball = BALL_ELEM[choice], br = BR_ELEM[choice];
  if (bolt) {
    let dam: number;
    switch (choice) {
      case 'MISSILE': dam = damroll(2, 4) + Math.floor(level / 3); break;
      case 'ARROW': dam = level < 20 ? damroll(1, 6) : level < 40 ? damroll(5, 6) : damroll(7, 6); break;
      case 'BOLT_ACID': dam = damroll(7, 8) + Math.floor(level / 3); break;
      case 'BOLT_ELEC': dam = damroll(4, 8) + Math.floor(level / 3); break;
      case 'BOLT_FIRE': dam = damroll(9, 8) + Math.floor(level / 3); break;
      case 'BOLT_COLD': dam = damroll(6, 8) + Math.floor(level / 3); break;
      case 'BOLT_POIS': dam = damroll(5, 8) + Math.floor(level / 3); break;
      case 'BOLT_NETHER': dam = 30 + damroll(5, 5) + level * (powerful ? 2 : 1); break;
      case 'BOLT_WATER': dam = damroll(10, 10) + level; break;
      case 'BOLT_MANA': dam = randint1(Math.floor(level * 7 / 2)) + 50; break;
      case 'BOLT_PLASMA': dam = 10 + damroll(8, 7) + level; break;
      case 'BOLT_ICE': dam = damroll(6, 6) + level; break;
      default: dam = damroll(Math.max(1, Math.floor(level / 2) + 1), 8);
    }
    const verb = choice === 'ARROW' ? 'fires an arrow' : choice === 'MISSILE' ? 'casts a magic missile' : choice === 'BOLT_WATER' ? 'casts a water bolt' : choice === 'BOLT_PLASMA' ? 'casts a plasma bolt' : choice === 'BOLT_ICE' ? 'casts an ice bolt' : `casts a ${ELEMENT_NAME[bolt]} bolt`;
    g.msg.add(seen ? `${name} ${verb}.` : 'You hear something fire.', '#ffb0b0');
    project(g, m.x, m.y, p.x, p.y, bolt, { dam, source: m });
    return true;
  }
  if (ball) {
    let dam: number, radius = 2;
    switch (choice) {
      case 'BALL_POIS': dam = 12; break;
      case 'BALL_NETHER': dam = 50 + damroll(10, 10) + level * (powerful ? 2 : 1); break;
      case 'BALL_DARK': dam = randint1(level * 3) + 20; radius = 4; break;
      case 'BALL_MANA': dam = level * 5 + damroll(10, 10); radius = 4; break;
      case 'BALL_CHAOS': dam = level * 2 + damroll(10, 10); radius = 4; break;
      case 'BALL_WATER': dam = randint1(Math.floor(level * 5 / 2)) + 50; radius = 4; break;
      default: dam = randint1(level * (powerful ? 3 : 2)) + 15 + (ball === 'fire' || ball === 'cold' ? 10 : 0);
    }
    const what = choice === 'BALL_POIS' ? 'stinking cloud' : choice === 'BALL_MANA' ? 'mana storm' : choice === 'BALL_CHAOS' ? 'raw Logrus' : choice === 'BALL_DARK' ? 'darkness storm' : choice === 'BALL_WATER' ? 'whirlpool' : `${ELEMENT_NAME[ball]} ball`;
    g.msg.add(seen ? `${name} casts a ${what}.` : 'You hear a mumbling.', '#ffb0b0');
    project(g, m.x, m.y, p.x, p.y, ball, { dam, radius, source: m });
    return true;
  }
  if (br) {
    const [div, cap] = BR_DIV[br] || [3, 600];
    const dam = Math.max(1, Math.min(cap, Math.floor(m.hp / div)));
    g.msg.add(seen ? `${name} breathes ${ELEMENT_NAME[br]}!` : 'You hear a roar.', '#ffb0b0');
    breathe(g, m, br, dam);
    return true;
  }
  switch (choice) {
    case 'SHRIEK': g.msg.add(seen ? `${name} makes a high pitched shriek.` : 'You hear a shriek.'); for (const o of g.level.monsters) { if (o !== m) o.sleep = 0; if (o.race === m.race && oneIn(3)) o.hasted = 10; } return true;
    case 'CAUSE_1': case 'CAUSE_2': case 'CAUSE_3': case 'CAUSE_4': {
      const d = choice === 'CAUSE_1' ? damroll(3, 8) : choice === 'CAUSE_2' ? damroll(8, 8) : choice === 'CAUSE_3' ? damroll(10, 15) : damroll(15, 15);
      g.msg.add(seen ? `${name} points at you${choice === 'CAUSE_4' ? ', screaming the word DIE!' : ' and curses' + (choice === 'CAUSE_3' ? ' horribly' : '')}.` : 'You hear a curse.', '#ffb0b0');
      if (save()) g.msg.add('You resist the effects!'); else { takeHit(g, d, cause); if (choice === 'CAUSE_4') setTimed(g, 'cut', p.timed.cut + damroll(10, 10)); }
      return true;
    }
    case 'MIND_BLAST': case 'BRAIN_SMASH': { g.msg.add(seen ? `${name} gazes at you with psionic energy.` : 'You feel something focusing on your mind.', '#ffb0b0'); if (save()) { g.msg.add('You resist the effects!'); return true; } takeHit(g, choice === 'MIND_BLAST' ? damroll(7, 8) : damroll(12, 15), cause); if (choice === 'BRAIN_SMASH') { setTimed(g, 'confused', p.timed.confused + randint1(4) + 4); setTimed(g, 'slow', p.timed.slow + randint1(4) + 4); if (!g.bonuses.flags.has('FREE_ACT')) setTimed(g, 'paralyzed', randint1(4) + 4); setTimed(g, 'stun', p.timed.stun + randint1(8) + 8); } else setTimed(g, 'confused', p.timed.confused + randint1(4) + 4); return true; }
    case 'DRAIN_MANA': { if (p.csp > 0) { const d = Math.min(p.csp, randint1(level) + 1); p.csp -= d; m.hp = Math.min(m.maxhp, m.hp + d * 6); g.msg.add(seen ? `${name} draws psychic energy from you!` : 'Something drains your mana!', '#ffb0b0'); } return true; }
    case 'SCARE': g.msg.add(seen ? `${name} casts a fearful illusion.` : 'You hear scary noises.'); if (g.bonuses.flags.has('RES_FEAR') || save()) g.msg.add('You refuse to be frightened.'); else setTimed(g, 'afraid', p.timed.afraid + randint1(4) + 4); return true;
    case 'CONF': g.msg.add(seen ? `${name} creates a mesmerising illusion.` : 'You hear puzzling noises.'); if (g.bonuses.flags.has('RES_CONF') || save()) g.msg.add('You disbelieve the feeble spell.'); else setTimed(g, 'confused', p.timed.confused + randint1(4) + 4); return true;
    case 'BLIND': g.msg.add(seen ? `${name} casts a spell, burning your eyes!` : 'You hear a mumbling.'); if (g.bonuses.flags.has('RES_BLIND') || save()) g.msg.add('You resist the effects!'); else setTimed(g, 'blind', 12 + randint1(4)); return true;
    case 'SLOW': g.msg.add(seen ? `${name} drains power from your muscles!` : 'Something drains power from your muscles!'); if (g.bonuses.flags.has('FREE_ACT') || save()) g.msg.add('You resist the effects!'); else setTimed(g, 'slow', p.timed.slow + randint1(4) + 4); return true;
    case 'HOLD': g.msg.add(seen ? `${name} stares deep into your eyes!` : 'You hear a mumbling.'); if (g.bonuses.flags.has('FREE_ACT')) g.msg.add('You are unaffected!'); else if (save()) g.msg.add('You resist the effects!'); else setTimed(g, 'paralyzed', randint1(4) + 4); return true;
    case 'HASTE': g.msg.add(seen ? `${name} concentrates on its body.` : 'You hear a mumbling.'); m.hasted = 20 + randint1(20); return true;
    case 'HEAL': { g.msg.add(seen ? `${name} concentrates on its wounds.` : 'You hear a mumbling.'); m.hp = Math.min(m.maxhp, m.hp + level * 6); m.afraid = 0; if (seen) g.msg.add(m.hp >= m.maxhp ? `${name} looks completely healed!` : `${name} looks healthier.`); return true; }
    case 'BLINK': g.msg.add(seen ? `${name} blinks away.` : 'You hear something blink.'); teleportMonster(g, m, 10); return true;
    case 'TPORT': g.msg.add(seen ? `${name} teleports away.` : 'You hear something teleport.'); teleportMonster(g, m, 60); return true;
    case 'TELE_TO': g.msg.add(seen ? `${name} commands you to return.` : 'You hear a mumbling.'); if (g.bonuses.flags.has('NO_TELEPORT')) g.msg.add('You resist the pull.'); else teleportPlayerTo(g, m.x, m.y); return true;
    case 'TELE_AWAY': g.msg.add(seen ? `${name} teleports you away.` : 'You hear a mumbling.'); if (g.bonuses.flags.has('NO_TELEPORT')) g.msg.add('You are unaffected!'); else teleportPlayer(g, 100); return true;
    case 'TELE_LEVEL': g.msg.add(seen ? `${name} gestures at your feet.` : 'You hear a mumbling.'); if (g.bonuses.flags.has('RES_NEXUS') || save()) g.msg.add('You resist the effects!'); else { const up = oneIn(2) && g.level.depth > 1; g.msg.add(up ? 'You rise up through the ceiling.' : 'You sink through the floor.', '#ffd040'); g.levelChange = { depth: g.level.depth + (up ? -1 : 1), by: 'teleport' }; } return true;
    case 'DARKNESS': g.msg.add(seen ? `${name} gestures in shadow.` : 'You hear a mumbling.'); lightArea(g, p.x, p.y, false); return true;
    case 'TRAPS': g.msg.add(seen ? `${name} casts a spell and cackles evilly.` : 'You hear something cackle evilly.'); for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; if (isCleanFloor(g.level, x, y) && !hasFlag(g.level, x, y, F.GLYPH) && oneIn(2)) { setTile(g.level, x, y, T.TRAP_HIDDEN); setAux(g.level, x, y, randint0(TRAP_KINDS.length)); } } return true;
    case 'FORGET': g.msg.add(seen ? `${name} tries to blank your mind.` : 'You hear a mumbling.'); if (save()) g.msg.add('You resist the effects!'); else { g.msg.add('Your memories fade away.', '#ff8080'); for (let i = 0; i < g.level.flags.length; i++) if (tileAt(g.level, i % g.level.w, Math.floor(i / g.level.w)) !== T.PERM) g.level.flags[i] &= ~1; } return true;
    case 'S_MONSTER': case 'S_MONSTERS': case 'S_KIN': case 'S_UNDEAD': case 'S_DRAGON': case 'S_DEMON': case 'S_ANIMAL':
    case 'S_HYDRA': case 'S_ANGEL': case 'S_SPIDER': case 'S_HOUND': case 'S_HI_UNDEAD': case 'S_HI_DRAGON': case 'S_HI_DEMON': case 'S_WRAITH': case 'S_UNIQUE': {
      const n = choice === 'S_MONSTERS' ? 2 + randint1(3) : choice === 'S_MONSTER' || choice === 'S_UNIQUE' ? 1 : choice === 'S_HOUND' || choice === 'S_SPIDER' ? 2 + randint1(4) : choice.startsWith('S_HI') || choice === 'S_WRAITH' ? 1 + randint1(3) : 1 + randint1(2);
      const what: Record<string, string> = { S_KIN: 'its kin', S_UNDEAD: 'undead', S_DRAGON: 'a dragon', S_DEMON: 'a demon', S_ANIMAL: 'animals', S_HYDRA: 'hydras', S_ANGEL: 'an angel', S_SPIDER: 'spiders', S_HOUND: 'hounds', S_HI_UNDEAD: 'greater undead', S_HI_DRAGON: 'ancient dragons', S_HI_DEMON: 'greater demons', S_WRAITH: 'the Ringwraiths', S_UNIQUE: 'special opponents' };
      g.msg.add(seen ? `${name} magically summons ${what[choice] || 'help'}!` : 'You hear something appear nearby.', '#ffb0b0');
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const pos = nearFloor(g.level, p.x, p.y, 3, p);
        if (!pos || hasFlag(g.level, pos.x, pos.y, F.GLYPH)) continue;
        const race = choice === 'S_KIN' ? raceOf(m) : pickRace(g, g.level.depth + 2, rr => summonFilter(choice, rr, r));
        if (race) { const s = createMonster(g, race.id, pos.x, pos.y, false); if (s) { s.energy = 0; placed++; } }
      }
      if (!placed && choice === 'S_UNIQUE') { const race = pickRace(g, g.level.depth + 5, rr => rr.flags.includes('UNDEAD') && rr.depth >= 30); const pos = nearFloor(g.level, p.x, p.y, 3, p); if (race && pos) { const s = createMonster(g, race.id, pos.x, pos.y, false); if (s) s.energy = 0; } }
      return true;
    }
    default: return false;
  }
}

function summonFilter(choice: MonsterSpell, rr: MonsterRace, caster: MonsterRace): boolean {
  const f = rr.flags;
  if (f.includes('GENERATOR') || f.includes('QUESTOR')) return false;
  switch (choice) {
    case 'S_UNDEAD': return f.includes('UNDEAD');
    case 'S_DRAGON': return f.includes('DRAGON');
    case 'S_DEMON': return f.includes('DEMON');
    case 'S_ANIMAL': return f.includes('ANIMAL');
    case 'S_HYDRA': return f.includes('HYDRA') || rr.sprite === 'hydra';
    case 'S_ANGEL': return f.includes('ANGEL') || rr.sprite === 'angel';
    case 'S_SPIDER': return f.includes('SPIDER') || rr.sprite === 'spider';
    case 'S_HOUND': return f.includes('HOUND');
    case 'S_HI_UNDEAD': return f.includes('UNDEAD') && rr.depth >= 30;
    case 'S_HI_DRAGON': return f.includes('DRAGON') && rr.depth >= 35;
    case 'S_HI_DEMON': return f.includes('DEMON') && rr.depth >= 35;
    case 'S_WRAITH': return f.includes('WRAITH') && f.includes('UNIQUE');
    case 'S_UNIQUE': return f.includes('UNIQUE') && rr.id !== caster.id;
    default: return !f.includes('UNIQUE');
  }
}

/** Angband's stat-drain touch used by a few spells; exported for effects.ts symmetry. */
export function drainRandomStat(g: Game): void {
  const stats: Stat[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'];
  const s = stats[randint0(6)];
  if (drainStat(g.player, s)) { g.msg.add('You feel drained.', '#ff8080'); refreshBonuses(g); }
}
export const _keep = [loseExp];
