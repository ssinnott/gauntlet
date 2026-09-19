// Every action the player can take. Each command either does nothing (and costs no time) or
// finishes with endTurn(), which lets the world run until the player may act again.
import { type Item, type Pos, type SlotName, type SpellDef, type Effect, T, F, DIR_DX, DIR_DY, dirOf, isShop, isWall, isVein, isPassable, TRAP_KINDS, SLOTS, STATS, type Stat } from './types.ts';
import { type Game, playSound } from './state.ts';
import { isIgnored } from './ignore.ts';
import { endTurn, runWorld, foodState } from './game.ts';
import { tileAt, setTile, auxAt, setAux, monsterAt, itemsAt, hasFlag, addFlag, clearFlag, updateView, isCleanFloor, inBounds, playerCanSee, findPath, projectPath, isEmptyFloor, los } from './level.ts';
import { playerAttack, takeHit, elementDamage, monsterTakeHit, testHit, criticalMelee, slayMultiplier, gainExp } from './combat.ts';
import { raceOf, hasMFlag, monsterName, monsterNameVisible, updateMonsterVisibility, createMonster, pickRace, nearFloor, monsterTurn } from './monster.ts';
import { kindOf, itemName, itemFlags, isAmmo, isWeapon, isArmor, wieldSlot, canStack, absorb, splitStack, makeAware, markTried, isAware, identify, isKnown, itemDice, makeItem } from './items.ts';
import { runEffect, needsDir, needsItem, type EffectCtx } from './effects.ts';
import { setTimed, refreshBonuses, teleportPlayer, movePlayerTo, randomDir } from './effectsCore.ts';
import { adj, weaponPenalty, bowSkill, drainStat, meleeSkill } from './player.ts';
import { SPELL_BY_ID, SPELLS, spellsInBook } from './data/spells.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { disturb, dropNear } from './world.ts';
import { randint0, randint1, oneIn, damroll, distance } from './util.ts';
import { project, targetFromDir } from './projection.ts';
import { maintainStore } from './stores.ts';
import { INVEN_MAX, FOOD_MAX, QUIVER_SLOTS } from '../constants.ts';
import { deepestAllowed } from './game.ts';
import { REALM_BOOK, REALM_WORD, type Realm } from './types.ts';
import { noteItemKnown } from './effects.ts';

// ---------------------------------------------------------------------------------------------
// Movement

/** The player cannot act while paralysed or knocked out: time passes instead. Returns true if a turn was spent. */
export function cannotAct(g: Game): boolean {
  const p = g.player;
  if (p.dead) return true;
  if (p.timed.paralyzed || p.timed.stun > 100) { endTurn(g); return true; }
  return false;
}
/** Do nothing for a turn (hold, or the `,` on an empty grid). */
export function passTurn(g: Game): void { endTurn(g); }

export function moveDir(g: Game, dir: number, opts: { running?: boolean; travel?: boolean } = {}): void {
  const p = g.player, lv = g.level;
  if (cannotAct(g)) return;
  if (p.timed.confused && randint0(100) < 40) dir = randomDir();
  const nx = p.x + DIR_DX[dir], ny = p.y + DIR_DY[dir];
  if (DIR_DX[dir]) p.facing = DIR_DX[dir] > 0 ? 1 : -1;
  const m = monsterAt(lv, nx, ny);
  if (m) {
    if (!m.visible && !opts.running) g.msg.add('You feel something in the way.');
    playerAttack(g, m);
    endTurn(g);
    return;
  }
  const t = tileAt(lv, nx, ny);
  if (isShop(t)) {
    movePlayerTo(g, nx, ny);
    g.inStore = t - T.SHOP_0;
    maintainStore(g, g.stores[g.inStore]);
    disturb(g);
    endTurn(g);
    return;
  }
  if (t === T.DOOR_CLOSED) { if (auxAt(lv, nx, ny) >= 100) { if (!opts.running && !opts.travel) g.msg.add('The door appears to be stuck. (ctrl+B bashes it)'); disturb(g); return; } openDoor(g, nx, ny); return; }
  if (t === T.RUBBLE || isVein(t) || t === T.GRANITE || t === T.SECRET_DOOR) {
    if (opts.running || opts.travel) { disturb(g); return; }
    if (t === T.SECRET_DOOR || t === T.GRANITE) {
      g.msg.add('There is a wall in the way.');
      addFlag(lv, nx, ny, F.MARK);
      return;
    }
    tunnelInto(g, nx, ny);
    return;
  }
  if (t === T.PERM) { g.msg.add(lv.depth === 0 ? 'There is a wall in the way.' : 'There is a permanent wall in the way.'); return; }
  if (t === T.TREE) { g.msg.add('There is a tree in the way.'); return; }
  if (t === T.WATER) { g.msg.add('The water is too deep.'); return; }
  if (!isPassable(t)) { g.msg.add('Something blocks the way.'); return; }
  // Move.
  p.vx = p.x; p.vy = p.y;
  p.x = nx; p.y = ny;
  g.flowDirty = true;
  updateView(lv, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
  // Searching as you go.
  if (g.bonuses.skills.search > randint0(100) || p.searching) searchAround(g, false);
  // Traps.
  if (t === T.TRAP_HIDDEN || t === T.TRAP) {
    if (t === T.TRAP_HIDDEN) { setTile(lv, nx, ny, T.TRAP); g.msg.add('You found a trap!', '#ff8080'); }
    else if (!opts.running && g.bonuses.skills.disarm > randint0(200)) { g.msg.add('You step carefully around the trap.'); endTurn(g); return; }
    hitTrap(g, nx, ny);
    if (g.levelChange || p.dead) return;
  }
  // Pick up what is here (Gauntlet-style automatic pickup); gold and keys always.
  pickupHere(g, true, !g.options.autoPickup);
  if (t === T.STAIRS_DOWN && !opts.running) g.msg.add(lv.depth === 0 ? 'The dungeon entrance yawns below you. Press > to descend.' : 'There is a down staircase here. Press > to descend.', '#a0a0ff');
  if (t === T.STAIRS_UP && !opts.running) g.msg.add('There is an up staircase here. Press < to ascend.', '#a0a0ff');
  endTurn(g);
}

export function openDoor(g: Game, x: number, y: number): void {
  const p = g.player, lv = g.level;
  const lock = auxAt(lv, x, y);
  if (lock >= 100) { g.msg.add('The door appears to be stuck.'); return; }
  if (lock === 0) { setTile(lv, x, y, T.DOOR_OPEN); playSound(g, 'door'); g.flowDirty = true; endTurn(g); return; }
  // Locked: a Gauntlet key opens it instantly; otherwise pick it.
  if (p.keys > 0) { p.keys--; setAux(lv, x, y, 0); setTile(lv, x, y, T.DOOR_OPEN); g.msg.add('You unlock the door with a key.', '#ffd040'); g.flowDirty = true; endTurn(g); return; }
  const keyItem = p.inven.find(i => kindOf(i).tval === 'key');
  if (keyItem) { keyItem.number--; if (keyItem.number <= 0) p.inven.splice(p.inven.indexOf(keyItem), 1); setAux(lv, x, y, 0); setTile(lv, x, y, T.DOOR_OPEN); g.msg.add('You unlock the door with a key.', '#ffd040'); g.flowDirty = true; endTurn(g); return; }
  let j = g.bonuses.skills.disarm;
  if (p.timed.blind) j /= 10; if (p.timed.confused || p.timed.image) j /= 10;
  j -= lock * 4;
  if (j < 2) j = 2;
  if (randint0(100) < j) { g.msg.add('You have picked the lock.', '#a0ffa0'); setAux(lv, x, y, 0); setTile(lv, x, y, T.DOOR_OPEN); gainExp(g, 1); g.flowDirty = true; }
  else { g.msg.add('You failed to pick the lock.'); g.repeating = { cmd: 'open', dir: dirOf(x - p.x, y - p.y), left: 20 }; }
  endTurn(g);
}
export function closeDoor(g: Game, dir: number): void {
  const p = g.player, lv = g.level;
  const x = p.x + DIR_DX[dir], y = p.y + DIR_DY[dir];
  const t = tileAt(lv, x, y);
  if (t === T.DOOR_BROKEN) { g.msg.add('The door appears to be broken.'); return; }
  if (t !== T.DOOR_OPEN) { g.msg.add('You see nothing there to close.'); return; }
  if (monsterAt(lv, x, y)) { g.msg.add('There is a monster in the way!'); return; }
  setTile(lv, x, y, T.DOOR_CLOSED); g.flowDirty = true; endTurn(g);
}
/** Bash a door open (Angband's do_cmd_bash): strength against the lock, with a chance to stumble. */
export function bashDoor(g: Game, dir: number): void {
  const p = g.player, lv = g.level, b = g.bonuses;
  if (cannotAct(g)) return;
  const x = p.x + DIR_DX[dir], y = p.y + DIR_DY[dir];
  const t = tileAt(lv, x, y);
  if (t !== T.DOOR_CLOSED) { g.msg.add('You see nothing there to bash.'); return; }
  const lock = auxAt(lv, x, y);
  const power = lock >= 100 ? (lock - 100) * 10 + 20 : lock * 10;
  const bash = adj.strBlow(b.stat.STR) * 10 / 3 + b.weight / 10 / 5 + p.lev;
  const chance = Math.max(1, Math.floor(bash - power));
  g.msg.add('You smash into the door!');
  playSound(g, 'bash');
  if (randint0(100) < chance) {
    g.msg.add('The door crashes open!', '#a0ffa0');
    setAux(lv, x, y, 0);
    setTile(lv, x, y, oneIn(2) ? T.DOOR_BROKEN : T.DOOR_OPEN);
    g.flowDirty = true;
  } else if (randint0(100) < adj.dexTa(b.stat.DEX) * 5 + p.lev + 20) {
    g.msg.add('The door holds firm.');
    g.repeating = { cmd: 'bash', dir, left: 20 };
  } else {
    g.msg.add('You are off-balance.', '#ffd040');
    setTimed(g, 'paralyzed', 1 + randint0(2));
  }
  endTurn(g);
}
/** Jam a door shut with a spike (Angband's do_cmd_spike). Jammed doors carry aux = 100 + strength. */
export function jamDoor(g: Game, dir: number): void {
  const p = g.player, lv = g.level;
  if (cannotAct(g)) return;
  const x = p.x + DIR_DX[dir], y = p.y + DIR_DY[dir];
  const t = tileAt(lv, x, y);
  if (t !== T.DOOR_CLOSED) { g.msg.add('You see nothing there to spike.'); return; }
  if (monsterAt(lv, x, y)) { g.msg.add('There is a monster in the way!'); return; }
  const spike = p.inven.find(i => kindOf(i).tval === 'spike');
  if (!spike) { g.msg.add('You have no spikes!'); return; }
  const lock = auxAt(lv, x, y);
  setAux(lv, x, y, Math.min(107, lock >= 100 ? lock + 1 : 100));
  spike.number--; if (spike.number <= 0) removeFromInventory(g, spike);
  g.msg.add('You jam the door with a spike.');
  endTurn(g);
}

export function tunnelInto(g: Game, x: number, y: number): void {
  const p = g.player, lv = g.level;
  if (cannotAct(g)) return;
  const t = tileAt(lv, x, y);
  const skill = g.bonuses.skills.digging;
  const has = (need: number, name: string) => {
    if (skill > randint0(need)) { setTile(lv, x, y, T.FLOOR); g.msg.add(`You have removed the ${name}.`); g.flowDirty = true; return true; }
    g.msg.add(`You ${name === 'rubble' ? 'dig in' : 'tunnel into'} the ${name}.`);
    playSound(g, 'dig');
    return false;
  };
  let done = false;
  if (t === T.RUBBLE) { done = has(200, 'rubble'); if (done && oneIn(10)) { dropRandom(g, x, y); g.msg.add('You have found something!'); } }
  else if (t === T.MAGMA || t === T.MAGMA_K) { done = has(400, 'magma vein'); if (done && t === T.MAGMA_K) { placeGoldAt(g, x, y); g.msg.add('You have found something!', '#ffd040'); } }
  else if (t === T.QUARTZ || t === T.QUARTZ_K) { done = has(800, 'quartz vein'); if (done && t === T.QUARTZ_K) { placeGoldAt(g, x, y); g.msg.add('You have found something!', '#ffd040'); } }
  else if (t === T.GRANITE) { done = has(1600, 'granite wall'); }
  else if (t === T.SECRET_DOOR) { done = has(1600, 'granite wall'); }
  else { g.msg.add('You see nothing there to tunnel.'); return; }
  if (!done) g.repeating = { cmd: 'tunnel', dir: dirOf(x - p.x, y - p.y), left: 99 }; else disturb(g);
  endTurn(g);
}
function dropRandom(g: Game, x: number, y: number): void { g.hooks.placeObjectAt(x, y); }
export function placeGoldAt(g: Game, x: number, y: number): void { g.hooks.placeGoldAt(x, y); }

/** Running: keep going until something interesting happens; follows corridors around corners. */
export function run(g: Game, dir: number): void {
  const p = g.player;
  if (p.timed.confused) { g.msg.add('You are too confused!'); return; }
  g.running = { dir, steps: 0 };
  runStep(g);
}
export function runStep(g: Game): void {
  const p = g.player, lv = g.level;
  const r = g.running;
  if (!r) return;
  if (r.steps++ > 200) { g.running = null; return; }
  let dir = r.dir;
  const ahead = (d: number) => tileAt(lv, p.x + DIR_DX[d], p.y + DIR_DY[d]);
  const open = (d: number) => { const t = ahead(d); return isPassable(t) || t === T.DOOR_CLOSED; };
  if (!open(dir)) {
    // In a corridor, turn to the single open way that is not back the way we came.
    const back = 10 - dir;
    const opts = [1, 2, 3, 4, 6, 7, 8, 9].filter(d => d !== back && open(d) && !(DIR_DX[d] && DIR_DY[d] && !hasFlag(lv, p.x, p.y, F.ROOM) && false));
    const cardinal = opts.filter(d => !(DIR_DX[d] && DIR_DY[d]));
    const use = cardinal.length ? cardinal : opts;
    if (use.length === 1) { dir = use[0]; r.dir = dir; }
    else { g.running = null; return; }
  }
  // Stop at doors, stairs, items and junctions in rooms.
  const t = ahead(dir);
  if (t === T.DOOR_CLOSED) { g.running = null; return; }
  for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; if (itemsAt(lv, x, y).length && r.steps > 1) { g.running = null; return; } const tt = tileAt(lv, x, y); if ((tt === T.STAIRS_DOWN || tt === T.STAIRS_UP || isShop(tt)) && r.steps > 1) { g.running = null; return; } }
  moveDir(g, dir, { running: true });
  if (!g.running) return;
  // After moving: stop if a corridor opens into a room or a junction appears.
  const openCount = [1, 2, 3, 4, 6, 7, 8, 9].filter(d => open(d)).length;
  if (openCount > 3 && !hasFlag(lv, p.x, p.y, F.ROOM) && r.steps > 1) { g.running = null; }
  if (hasFlag(lv, p.x, p.y, F.ROOM) && !open(dir)) g.running = null;
}
/** Walk the travel path one step. */
export function travelStep(g: Game): void {
  const path = g.travel;
  if (!path || !path.length) { g.travel = null; return; }
  const next = path.shift()!;
  const d = dirOf(next.x - g.player.x, next.y - g.player.y);
  if (d === 5) { g.travel = null; return; }
  moveDir(g, d, { travel: true });
  if (!path.length) g.travel = null;
}
export function travelTo(g: Game, x: number, y: number): boolean {
  const path = findPath(g.level, g.player.x, g.player.y, x, y);
  if (!path) return false;
  g.travel = path;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Stairs, rest, search

export function goDown(g: Game): void {
  const p = g.player;
  if (tileAt(g.level, p.x, p.y) !== T.STAIRS_DOWN) { g.msg.add('I see no down staircase here.'); return; }
  if (g.level.depth + 1 > deepestAllowed(g)) { g.msg.add('A dread power bars the way below. Sauron must fall first.', '#ff8080'); return; }
  g.msg.add(g.level.depth === 0 ? 'You enter the dungeon.' : 'You enter a maze of down staircases.');
  playSound(g, 'stairs');
  g.levelChange = { depth: g.level.depth + 1, by: 'down' };
  endTurn(g);
}
export function goUp(g: Game): void {
  const p = g.player;
  if (tileAt(g.level, p.x, p.y) !== T.STAIRS_UP) { g.msg.add('I see no up staircase here.'); return; }
  if (g.options.ironman) { g.msg.add('Nothing happens: there is no way back up for you.'); return; }
  g.msg.add('You enter a maze of up staircases.');
  playSound(g, 'stairs');
  g.levelChange = { depth: g.level.depth - 1, by: 'up' };
  endTurn(g);
}
export function rest(g: Game, turns: number): void {
  const p = g.player;
  if (p.chp >= p.mhp && p.csp >= p.msp && turns < 0 && !Object.values(p.timed).some((v, i) => v > 0 && i < 10)) { g.msg.add('You have no need to rest.'); return; }
  g.resting = turns;
  g.msg.add('You start resting.');
}
export function restStep(g: Game): void {
  const p = g.player;
  if (!g.resting) return;
  const doneAsNeeded = p.chp >= p.mhp && p.csp >= p.msp && !p.timed.blind && !p.timed.confused && !p.timed.poisoned && !p.timed.afraid && !p.timed.stun && !p.timed.cut && !p.timed.slow && !p.timed.paralyzed && !p.timed.image;
  if (g.resting === -1 && doneAsNeeded) { g.resting = 0; return; }
  if (g.resting > 0) g.resting--;
  endTurn(g);
  if (p.food < 1000) { g.resting = 0; }
}
export function searchAround(g: Game, takeTurn = true): void {
  const p = g.player, lv = g.level;
  let found = false;
  for (let d = 1; d <= 9; d++) {
    if (d === 5) continue;
    const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d];
    const t = tileAt(lv, x, y);
    if (t === T.SECRET_DOOR && randint0(100) < g.bonuses.skills.search + 30) { setTile(lv, x, y, T.DOOR_CLOSED); addFlag(lv, x, y, F.MARK); g.msg.add('You have found a secret door.', '#a0ffa0'); found = true; g.flowDirty = true; }
    if (t === T.TRAP_HIDDEN && randint0(100) < g.bonuses.skills.search + 30) { setTile(lv, x, y, T.TRAP); addFlag(lv, x, y, F.MARK); g.msg.add('You have found a trap.', '#a0ffa0'); found = true; }
  }
  if (found) disturb(g);
  if (takeTurn) endTurn(g);
}
export function disarm(g: Game, dir: number): void {
  const p = g.player, lv = g.level;
  if (cannotAct(g)) return;
  const x = p.x + DIR_DX[dir], y = p.y + DIR_DY[dir];
  const t = tileAt(lv, x, y);
  const chest = itemsAt(lv, x, y).find(fi => kindOf(fi.item).tval === 'chest') || (dir === 5 ? itemsAt(lv, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest') : undefined);
  if (chest) { disarmChest(g, chest); return; }
  if (t === T.DOOR_CLOSED && auxAt(lv, x, y) > 0 && auxAt(lv, x, y) < 100) { openDoor(g, x, y); return; }
  if (t !== T.TRAP) { g.msg.add('You see nothing there to disarm.'); return; }
  const kind = auxAt(lv, x, y);
  let j = g.bonuses.skills.disarm - 5 - kind * 2;
  if (p.timed.blind || p.timed.confused) j = Math.floor(j / 10);
  if (j < 2) j = 2;
  if (randint0(100) < j) { g.msg.add(`You have disarmed the ${TRAP_KINDS[kind]}.`, '#a0ffa0'); gainExp(g, 5 + kind); setTile(lv, x, y, T.FLOOR); }
  else if (randint0(100) < j + 20) { g.msg.add(`You failed to disarm the ${TRAP_KINDS[kind]}.`); g.repeating = { cmd: 'disarm', dir, left: 20 }; }
  else { g.msg.add('You set off the trap!', '#ff8080'); if (!monsterAt(lv, x, y)) movePlayerTo(g, x, y); hitTrap(g, x, y); }
  endTurn(g);
}

export function hitTrap(g: Game, x: number, y: number): void {
  const p = g.player, b = g.bonuses, lv = g.level;
  const kind = auxAt(lv, x, y);
  disturb(g);
  const name = TRAP_KINDS[kind] || 'trap';
  playSound(g, 'trap');
  switch (kind) {
    case 0: if (b.flags.has('FEATHER')) { g.msg.add('You float gently down to the next level.'); } else { g.msg.add('You fall through a trap door!', '#ff8080'); takeHit(g, damroll(2, 8), 'a trap door'); } g.levelChange = { depth: lv.depth + 1, by: 'teleport' }; return;
    case 1: case 2: if (b.flags.has('FEATHER')) g.msg.add('You float gently to the bottom of the pit.'); else { g.msg.add(`You fall into a ${name}!`, '#ff8080'); takeHit(g, damroll(2, 6), 'a pit'); if (kind === 2 && oneIn(2)) { g.msg.add('You are impaled!', '#ff8080'); takeHit(g, damroll(2, 6), 'a spiked pit'); setTimed(g, 'cut', p.timed.cut + randint1(10)); } } break;
    case 3: case 4: case 5: { const s: Stat = kind === 3 ? 'STR' : kind === 4 ? 'DEX' : 'CON'; if (testHit(125, b.ac + b.toAc, true)) { g.msg.add('A small dart hits you!', '#ff8080'); takeHit(g, damroll(1, 4), 'a dart trap'); if (!b.flags.has(('SUST_' + s) as never) && drainStat(p, s)) { g.msg.add(`You feel ${s === 'STR' ? 'weaker' : s === 'DEX' ? 'clumsier' : 'sicklier'}.`, '#ff8080'); refreshBonuses(g); } } else g.msg.add('A small dart barely misses you.'); break; }
    case 6: g.msg.add('You hit a teleport trap!', '#ffd040'); teleportPlayer(g, 100); break;
    case 7: g.msg.add('You are enveloped in flames!', '#ff8080'); elementDamage(g, 'fire', damroll(4, 6), 'a fire trap'); break;
    case 8: g.msg.add('You are splashed with acid!', '#ff8080'); elementDamage(g, 'acid', damroll(4, 6), 'an acid trap'); break;
    case 9: g.msg.add('A pungent green gas surrounds you!', '#a0ffa0'); if (!b.flags.has('RES_POIS') && !p.timed.oppose_pois) setTimed(g, 'poisoned', p.timed.poisoned + randint1(20) + 10); break;
    case 10: g.msg.add('A strange white mist surrounds you!'); if (!b.flags.has('FREE_ACT')) setTimed(g, 'paralyzed', p.timed.paralyzed + randint1(5) + 2); break;
    case 11: { g.msg.add('You are enveloped in a cloud of smoke!', '#ff8080'); setTile(lv, x, y, T.FLOOR); for (let i = 0; i < 2 + randint1(3); i++) { const pos = nearFloor(lv, x, y, 3); const r = pickRace(g, lv.depth + 2); if (pos && r) createMonster(g, r.id, pos.x, pos.y, false); } break; }
    case 12: g.msg.add('An alarm sounds! Every monster on the level is awake.', '#ff8080'); for (const m of lv.monsters) m.sleep = 0; break;
    case 13: g.msg.add('A puff of confusing gas surrounds you!'); if (!b.flags.has('RES_CONF')) setTimed(g, 'confused', p.timed.confused + randint1(10) + 5); break;
    case 14: if (b.flags.has('FEATHER')) g.msg.add('You float gently to the bottom of the pit.'); else { g.msg.add('You fall into a spiked pit!', '#ff8080'); takeHit(g, damroll(2, 6), 'a poison pit'); if (oneIn(2)) { g.msg.add('You are impaled on poisonous spikes!', '#ff8080'); takeHit(g, damroll(2, 6), 'a poison pit'); setTimed(g, 'cut', p.timed.cut + randint1(10)); if (!b.flags.has('RES_POIS') && !p.timed.oppose_pois) setTimed(g, 'poisoned', p.timed.poisoned + randint1(20) + 10); } } break;
    case 15: if (testHit(125, b.ac + b.toAc, true)) { g.msg.add('A small dart hits you!', '#ff8080'); takeHit(g, damroll(1, 4), 'a dart trap'); if (!b.flags.has('FREE_ACT')) setTimed(g, 'slow', p.timed.slow + randint0(20) + 20); } else g.msg.add('A small dart barely misses you.'); break;
    case 16: g.msg.add('A black gas surrounds you!'); if (!b.flags.has('RES_BLIND')) setTimed(g, 'blind', p.timed.blind + randint0(50) + 25); break;
    default: g.msg.add('You set off a trap.'); break;
  }
}

// ---------------------------------------------------------------------------------------------
// Items: pickup, drop, wear

export function pickupHere(g: Game, auto: boolean, goldOnly = false): boolean {
  const p = g.player, lv = g.level;
  const here = itemsAt(lv, p.x, p.y);
  if (!here.length) { if (!auto) g.msg.add('There is nothing here to pick up.'); return false; }
  let took = false;
  let skipped = 0;
  for (const fi of here) {
    const k = kindOf(fi.item);
    // Junk the hero has decided not to care about is not picked up and not remarked on.
    if (isIgnored(g, fi.item)) { skipped++; continue; }
    if (goldOnly && k.tval !== 'gold' && k.tval !== 'key') { if (auto && !fi.item.known && !isAware(g.flavors, fi.item.kind)) { /* still see it */ } g.msg.add(`You see ${itemName(fi.item, g.flavors)}.`); continue; }
    if (k.tval === 'gold') {
      p.gold += fi.item.pval; g.stats.goldFound += fi.item.pval; playSound(g, 'gold');
      g.msg.add(`You have found ${fi.item.pval} gold pieces worth of ${k.name}.`, '#ffd040');
      g.fx.push({ type: 'hit', x: p.x, y: p.y, text: `+${fi.item.pval}`, color: '#ffd040' });
      lv.items.splice(lv.items.indexOf(fi), 1); took = true; continue;
    }
    if (k.tval === 'key') { p.keys += fi.item.number; g.msg.add(`You pick up ${itemName(fi.item, g.flavors)}.`, '#ffd040'); lv.items.splice(lv.items.indexOf(fi), 1); took = true; continue; }
    if (k.tval === 'chest') { if (!auto) g.msg.add('You see ' + itemName(fi.item, g.flavors) + '. Press o to open it.'); continue; }
    if (!addToInventory(g, fi.item)) { if (!auto || here.length <= 2) g.msg.add(`You have no room for ${itemName(fi.item, g.flavors)}.`); continue; }
    g.msg.add(`You have ${itemName(fi.item, g.flavors)}.`);
    playSound(g, 'pickup');
    lv.items.splice(lv.items.indexOf(fi), 1); took = true;
  }
  if (!auto && !took && skipped) g.msg.add(`You step over ${skipped === 1 ? 'something' : 'things'} you are ignoring. (ctrl+O shows it again.)`);
  return took;
}
/** Put an item in the pack (stacking), or the quiver for ammo. Returns false if there is no room. */
export function addToInventory(g: Game, it: Item): boolean {
  const p = g.player, k = kindOf(it);
  if (isAmmo(k)) {
    for (const q of p.quiver) if (canStack(q, it, g.flavors)) { absorb(q, it); return true; }
    if (p.quiver.length < QUIVER_SLOTS) { p.quiver.push(it); return true; }
    return false;
  }
  for (const o of p.inven) if (canStack(o, it, g.flavors)) { absorb(o, it); return true; }
  if (p.inven.length >= INVEN_MAX) return false;
  p.inven.push(it);
  sortInventory(g);
  return true;
}
export function sortInventory(g: Game): void {
  const order = ['magic_book', 'prayer_book', 'food', 'potion', 'scroll', 'wand', 'staff', 'rod', 'ring', 'amulet', 'light', 'flask', 'spike', 'key', 'sword', 'hafted', 'polearm', 'digger', 'bow', 'shot', 'arrow', 'bolt', 'soft_armor', 'hard_armor', 'dragon_armor', 'shield', 'helm', 'crown', 'cloak', 'gloves', 'boots', 'chest', 'junk', 'gold'];
  g.player.inven.sort((a, b) => order.indexOf(kindOf(a).tval) - order.indexOf(kindOf(b).tval) || kindOf(a).level - kindOf(b).level || kindOf(a).cost - kindOf(b).cost);
}
export function removeFromInventory(g: Game, it: Item, n = it.number): Item {
  const p = g.player;
  const list = p.inven.includes(it) ? p.inven : p.quiver.includes(it) ? p.quiver : null;
  if (n >= it.number) { if (list) list.splice(list.indexOf(it), 1); else for (const s of SLOTS) if (p.equip[s] === it) p.equip[s] = null; return it; }
  return splitStack(it, n);
}
export function dropItem(g: Game, it: Item, n: number): void {
  const p = g.player;
  if (SLOTS.some(s => p.equip[s] === it)) { if (it.cursed) { g.msg.add('Hmmm, it seems to be cursed.', '#ff8080'); return; } takeOff(g, it, true); }
  const dropped = removeFromInventory(g, it, n);
  dropNear(g, dropped, p.x, p.y);
  playSound(g, 'drop');
  g.msg.add(`You drop ${itemName(dropped, g.flavors)}.`);
  refreshBonuses(g);
  endTurn(g, 50);
}
export function wield(g: Game, it: Item): void {
  const p = g.player, k = kindOf(it);
  let slot = wieldSlot(k);
  if (!slot) { g.msg.add('You cannot wield or wear that item.'); return; }
  if (slot === 'ring1' && p.equip.ring1 && !p.equip.ring2) slot = 'ring2';
  if (slot === 'ring1' && p.equip.ring1 && p.equip.ring2) { if (p.equip.ring1.cursed && !p.equip.ring2.cursed) slot = 'ring2'; }
  const old = p.equip[slot];
  if (old && old.cursed) { g.msg.add(`The ${itemName(old, g.flavors, { article: false, plainKind: true })} you are ${slot === 'weapon' ? 'wielding' : 'wearing'} appears to be cursed.`, '#ff8080'); return; }
  const one = removeFromInventory(g, it, 1);
  playSound(g, 'wield');
  if (old) { p.equip[slot] = null; if (!addToInventory(g, old)) dropNear(g, old, p.x, p.y); }
  p.equip[slot] = one;
  one.sense = undefined;
  if (k.flavored) { makeAware(g.flavors, one.kind); }
  if (itemFlags(one).has('EASY_KNOW') || k.tval === 'light' || k.tval === 'bow') one.known = true;
  if (one.artifact && g.artifactsSeen.includes(one.artifact)) one.known = true;
  if (one.known) noteItemKnown(g, one);
  const verb = slot === 'weapon' ? 'You are wielding' : slot === 'bow' ? 'You are shooting with' : slot === 'light' ? 'Your light source is' : 'You are wearing';
  g.msg.add(`${verb} ${itemName(one, g.flavors)}.`);
  if (one.cursed) { g.msg.add('Oops! It feels deathly cold!', '#ff8080'); one.known = true; }
  if (slot === 'weapon' && weaponPenalty(p, one)) g.msg.add('You feel uncomfortable wielding an edged weapon.', '#ffd040');
  refreshBonuses(g);
  if (g.bonuses.heavyWeapon && slot === 'weapon') g.msg.add('You have trouble wielding such a heavy weapon.', '#ffd040');
  if (g.bonuses.heavyBow && slot === 'bow') g.msg.add('You have trouble wielding such a heavy bow.', '#ffd040');
  updateView(g.level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
  endTurn(g);
}
export function takeOff(g: Game, it: Item, silent = false): boolean {
  const p = g.player;
  const slot = SLOTS.find(s => p.equip[s] === it);
  if (!slot) return false;
  if (it.cursed) { g.msg.add('Hmmm, it seems to be cursed.', '#ff8080'); return false; }
  p.equip[slot] = null;
  if (!addToInventory(g, it)) { dropNear(g, it, p.x, p.y); g.msg.add('Your pack is full; it falls to the floor.'); }
  if (!silent) { g.msg.add(`You were ${slot === 'weapon' ? 'wielding' : 'wearing'} ${itemName(it, g.flavors)}.`); refreshBonuses(g); updateView(g.level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0); endTurn(g, 50); }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Consumables and devices

/** Common wrapper: run an item's effect, identify on notice, consume, take a turn. */
function useConsumable(g: Game, it: Item, ctx: EffectCtx, verb: string, consume: boolean): void {
  const p = g.player, k = kindOf(it);
  const wasAware = isAware(g.flavors, it.kind);
  if (!wasAware) g.msg.add(`You ${verb} ${itemName(it, g.flavors, { count: false })}.`);
  const noticed = k.effect ? runEffect(g, k.effect, { ...ctx, item: it }) : false;
  if (noticed) { makeAware(g.flavors, it.kind); noteItemKnown(g, it); if (!wasAware) { it.known = true; g.msg.add(`It was ${itemName({ ...it, number: 1 }, g.flavors)}.`, '#c0c0ff'); gainExp(g, Math.max(1, Math.floor((k.level + (p.lev >> 1)) / p.lev))); } }
  else markTried(g.flavors, it.kind);
  if (consume) { it.number--; if (it.number <= 0) removeFromInventory(g, it); }
}
export function quaff(g: Game, it: Item): void {
  const p = g.player;
  if (cannotAct(g)) return;
  playSound(g, 'quaff');
  useConsumable(g, it, {}, 'quaff', true);
  const k = kindOf(it);
  p.food = Math.min(FOOD_MAX - 1, p.food + (k.pval || 0) + 20);
  endTurn(g);
}
export function eat(g: Game, it: Item): void {
  const p = g.player, k = kindOf(it);
  if (cannotAct(g)) return;
  if (k.tval !== 'food') { g.msg.add('You cannot eat that!'); return; }
  const before = foodState(p.food);
  playSound(g, 'eat');
  g.msg.add(`You eat ${itemName(it, g.flavors, { count: false })}.`);
  p.food = Math.min(FOOD_MAX - 1, p.food + (k.pval || 0));
  if (k.effect) useConsumable(g, it, {}, 'eat', true); else { it.number--; if (it.number <= 0) removeFromInventory(g, it); }
  const after = foodState(p.food);
  if (before !== after) g.msg.add(`You are ${after.toLowerCase()}.`);
  if (p.food >= FOOD_MAX - 1) g.msg.add('You have gorged yourself!', '#ffd040');
  endTurn(g);
}
export function read(g: Game, it: Item, ctx: EffectCtx = {}): void {
  const p = g.player;
  if (cannotAct(g)) return;
  if (p.timed.blind) { g.msg.add('You can\'t see anything.'); return; }
  if (g.bonuses.lightRadius === 0 && !hasFlag(g.level, p.x, p.y, F.GLOW)) { g.msg.add('You have no light to read by.'); return; }
  if (p.timed.confused) { g.msg.add('You are too confused!'); return; }
  playSound(g, 'read');
  useConsumable(g, it, ctx, 'read', true);
  endTurn(g);
}
/** Device skill check (wands, staffs, rods). */
function deviceOk(g: Game, it: Item): boolean {
  const p = g.player, k = kindOf(it);
  let chance = g.bonuses.skills.device;
  if (p.timed.confused) chance = Math.floor(chance / 2);
  chance -= k.level > 50 ? 50 : k.level;
  if (chance < 3 && oneIn(2)) chance = 3;
  if (chance < 1 || randint0(chance) < 3) { g.msg.add('You failed to use the device properly.', '#ffd040'); return false; }
  return true;
}
export function aim(g: Game, it: Item, dir: number, target?: Pos | null): void {
  const k = kindOf(it);
  if (cannotAct(g)) return;
  if (!deviceOk(g, it)) { endTurn(g); return; }
  if (it.charges <= 0) { g.msg.add('The wand has no charges left.'); markTried(g.flavors, it.kind); endTurn(g); return; }
  it.charges--;
  playSound(g, 'zap');
  useConsumable(g, it, { dir, target }, 'aim', false);
  endTurn(g);
}
export function useStaff(g: Game, it: Item, ctx: EffectCtx = {}): void {
  if (cannotAct(g)) return;
  if (!deviceOk(g, it)) { endTurn(g); return; }
  if (it.charges <= 0) { g.msg.add('The staff has no charges left.'); markTried(g.flavors, it.kind); endTurn(g); return; }
  it.charges--;
  playSound(g, 'zap');
  useConsumable(g, it, ctx, 'use', false);
  endTurn(g);
}
export function zap(g: Game, it: Item, dir: number, target?: Pos | null, ctx: EffectCtx = {}): void {
  const k = kindOf(it);
  if (cannotAct(g)) return;
  if (it.timeout > 0) { g.msg.add('The rod is still charging.'); return; }
  if (!deviceOk(g, it)) { endTurn(g); return; }
  it.timeout = k.recharge || 20;
  useConsumable(g, it, { ...ctx, dir, target }, 'zap', false);
  endTurn(g);
}
export function activate(g: Game, it: Item, dir: number, target?: Pos | null): void {
  const k = kindOf(it);
  const art = it.artifact ? undefined : undefined;
  void art;
  const eff: Effect | undefined = it.artifact ? (await_artifact(it)) : k.effect;
  if (!eff) { g.msg.add('That item cannot be activated.'); return; }
  if (it.timeout > 0) { g.msg.add('It whines, glows and fades...'); return; }
  if (!deviceOk(g, it)) { endTurn(g); return; }
  g.msg.add(`You activate ${itemName(it, g.flavors)}.`, '#c0c0ff');
  runEffect(g, eff, { dir, target, item: it });
  it.timeout = it.artifact ? (artifactTimeout(it)) : (k.recharge || 100);
  endTurn(g);
}
import { artifactById } from './artifacts.ts';
function await_artifact(it: Item): Effect | undefined { return it.artifact ? artifactById(it.artifact)?.activation : undefined; }
function artifactTimeout(it: Item): number { return (it.artifact && artifactById(it.artifact)?.activationTimeout) || 100; }

export function refuel(g: Game, it: Item): void {
  const p = g.player, light = p.equip.light;
  if (!light) { g.msg.add('You are not wielding a light.'); return; }
  const lk = kindOf(light), k = kindOf(it);
  if (lk.id === 'lantern' && k.tval === 'flask') { light.timeout = Math.min(15000, light.timeout + 7500); g.msg.add('You fuel your lamp.'); }
  else if (lk.id === 'torch' && k.id === 'torch') { light.timeout = Math.min(5000, light.timeout + it.timeout); g.msg.add('You combine the torches.'); }
  else { g.msg.add('That cannot fuel your light.'); return; }
  it.number--; if (it.number <= 0) removeFromInventory(g, it);
  refreshBonuses(g); updateView(g.level, p.x, p.y, g.bonuses.lightRadius, p.timed.blind > 0);
  endTurn(g, 50);
}

// ---------------------------------------------------------------------------------------------
// Throwing and shooting

export function throwItem(g: Game, it: Item, dir: number, target?: Pos | null): void {
  const p = g.player, b = g.bonuses, lv = g.level, k = kindOf(it);
  if (cannotAct(g)) return;
  const one = removeFromInventory(g, it, 1);
  const tgt = targetFromDir(g, dir, target);
  const range = Math.max(1, Math.min(10, Math.floor(adj.strBlow(b.stat.STR) * 10 / Math.max(10, k.weight))));
  const path = projectPath(lv, p.x, p.y, tgt.x, tgt.y, range, true);
  const chance = b.skills.throw + (b.toHit + one.toHit) * 3;
  playSound(g, 'throw');
  g.fx.push({ type: 'missile', path: path.slice(), icon: k.tval, color: k.color });
  let landed: Pos = { x: p.x, y: p.y };
  let broke = false;
  for (const q of path) {
    if (isWall(tileAt(lv, q.x, q.y)) || tileAt(lv, q.x, q.y) === T.DOOR_CLOSED) break;
    landed = q;
    const m = monsterAt(lv, q.x, q.y);
    if (m) {
      if (testHit(chance, raceOf(m).ac, m.visible)) {
        const [dn, ds] = itemDice(one);
        let dam = damroll(dn || 1, ds || 2) + one.toDam;
        if (k.tval === 'flask') { dam = damroll(2, 6); g.msg.add(`The ${itemName(one, g.flavors, { article: false, plainKind: true })} shatters and burns ${monsterNameVisible(g, m, false)}!`); project(g, q.x, q.y, q.x, q.y, 'fire', { dam, radius: 1, source: 'player', range: 1 }); broke = true; break; }
        dam *= slayMultiplier(itemFlags(one), m);
        if (itemFlags(one).has('THROWING')) dam *= 2;
        g.msg.add(`The ${itemName(one, g.flavors, { article: false, plainKind: true })} hits ${monsterNameVisible(g, m, false)}.`);
        monsterTakeHit(g, m, Math.max(0, dam), '');
      } else g.msg.add(`The ${itemName(one, g.flavors, { article: false, plainKind: true })} misses.`);
      if (k.tval === 'potion' || k.tval === 'flask') { broke = true; if (k.tval === 'potion') g.msg.add('The potion shatters.'); }
      break;
    }
  }
  if (!broke) { if (k.tval === 'potion' && oneIn(2)) g.msg.add('The potion shatters.'); else dropNear(g, one, landed.x, landed.y); }
  refreshBonuses(g);
  endTurn(g);
}
export function fire(g: Game, ammo: Item, dir: number, target?: Pos | null): void {
  const p = g.player, b = g.bonuses, lv = g.level;
  if (cannotAct(g)) return;
  const bow = p.equip.bow;
  if (!bow) { g.msg.add('You have nothing to fire with.'); return; }
  const bk = kindOf(bow), ak = kindOf(ammo);
  if (bk.ammo !== ak.tval) { g.msg.add('That ammunition does not fit your launcher.'); return; }
  const one = removeFromInventory(g, ammo, 1);
  const tgt = targetFromDir(g, dir, target);
  const range = 6 + 2 * b.might;
  const path = projectPath(lv, p.x, p.y, tgt.x, tgt.y, range, true);
  const chance = bowSkill(p, b) + one.toHit * 3;
  playSound(g, 'shoot');
  g.fx.push({ type: 'missile', path: path.slice(), icon: 'ammo', color: ak.color });
  let landed: Pos = { x: p.x, y: p.y };
  let hit = false;
  for (const q of path) {
    if (isWall(tileAt(lv, q.x, q.y)) || tileAt(lv, q.x, q.y) === T.DOOR_CLOSED) break;
    landed = q;
    const m = monsterAt(lv, q.x, q.y);
    if (m) {
      const d = distance(p.x, p.y, q.x, q.y);
      if (testHit(chance - d, raceOf(m).ac, m.visible)) {
        const [dn, ds] = itemDice(one);
        let dam = (damroll(dn, ds) + one.toDam + bow.toDam) * b.might;
        dam *= slayMultiplier(new Set([...itemFlags(one), ...itemFlags(bow)]), m);
        const [cd, cm] = criticalShot(ak.weight, one.toHit + bow.toHit + b.toHit, dam, p.lev);
        dam = cd;
        g.msg.add(`The ${itemName(one, g.flavors, { article: false, plainKind: true })} hits ${monsterNameVisible(g, m, false)}.`);
        if (cm) g.msg.add(cm, '#ffd040');
        monsterTakeHit(g, m, Math.max(0, dam), '');
        hit = true;
      } else g.msg.add(`The ${itemName(one, g.flavors, { article: false, plainKind: true })} misses.`);
      break;
    }
  }
  // Ammo breaks sometimes (more often on a hit).
  if (randint0(100) >= (hit ? 35 : 20)) dropNear(g, one, landed.x, landed.y);
  refreshBonuses(g);
  endTurn(g, Math.floor(100 / Math.max(1, b.shots)));
}
function criticalShot(weight: number, plus: number, dam: number, lev: number): [number, string] {
  const i = weight + (plus + lev) * 4;
  if (randint1(5000) <= i) {
    const k = weight + randint1(500);
    if (k < 500) return [2 * dam + 5, 'It was a good hit!'];
    if (k < 1000) return [2 * dam + 10, 'It was a great hit!'];
    return [3 * dam + 15, 'It was a superb hit!'];
  }
  return [dam, ''];
}

// ---------------------------------------------------------------------------------------------
// Spells

const PRIMARY_CASTERS = ['mage', 'priest', 'druid', 'necromancer'];
export function classSpells(g: Game): SpellDef[] {
  const c = CLASS_BY_ID[g.player.cls];
  if (!c.realm) return [];
  return SPELLS.filter(s => s.realm === c.realm && spellLevel(g, s) <= 50);
}
/** The realm's words: [spell, cast, book]. */
export function realmWords(g: Game): [string, string, string] { const c = CLASS_BY_ID[g.player.cls]; return REALM_WORD[(c.realm || 'magic') as Realm]; }
/** Level and mana adjusted for non-primary casters (rogues, rangers, paladins learn late), or the class's own table when the spell has one. */
export function spellLevel(g: Game, s: SpellDef): number {
  const cls = g.player.cls;
  const t = s.classes?.[cls];
  if (t) return Math.max(1, t[0]);
  const mult = PRIMARY_CASTERS.includes(cls) ? 1 : cls === 'paladin' || cls === 'blackguard' ? 1.6 : 1.4;
  return Math.min(51, Math.max(1, Math.round(s.level * mult)));
}
export function spellMana(g: Game, s: SpellDef): number {
  const cls = g.player.cls;
  const t = s.classes?.[cls];
  if (t) return t[1];
  return PRIMARY_CASTERS.includes(cls) ? s.mana : Math.ceil(s.mana * 1.3);
}
export function spellExp(g: Game, s: SpellDef): number { const t = s.classes?.[g.player.cls]; return t ? t[3] : s.exp; }
export function spellFail(g: Game, s: SpellDef): number {
  const p = g.player, c = CLASS_BY_ID[p.cls];
  const t = s.classes?.[p.cls];
  let chance = t ? t[2] : s.fail;
  chance -= 3 * (p.lev - spellLevel(g, s));
  chance -= 3 * (adj.magStudy(g.bonuses.stat[c.spellStat]) - 1);
  const mana = spellMana(g, s);
  if (mana > p.csp) chance += 5 * (mana - p.csp);
  const min = adj.magFail(g.bonuses.stat[c.spellStat]);
  if (chance < min) chance = min;
  if (p.timed.stun > 50) chance += 20; else if (p.timed.stun) chance += 10;
  if ((c.realm === 'magic' || c.realm === 'necro') && p.equip.gloves && !itemFlags(p.equip.gloves).has('FREE_ACT')) chance += 10;
  return Math.max(0, Math.min(95, chance));
}
export function knownBooks(g: Game): Item[] {
  const c = CLASS_BY_ID[g.player.cls];
  if (!c.realm) return [];
  return g.player.inven.filter(i => kindOf(i).tval === REALM_BOOK[c.realm as Realm]);
}
export function spellsAvailable(g: Game): SpellDef[] {
  const books = knownBooks(g);
  return classSpells(g).filter(s => books.some(b => b.kind === s.book));
}
/** How many new spells the player may learn right now. */
export function newSpellCount(g: Game): number {
  const p = g.player, c = CLASS_BY_ID[p.cls];
  if (!c.realm || p.lev < c.firstSpellLevel) return 0;
  const levels = p.lev - c.firstSpellLevel + 1;
  const allowed = Math.floor(adj.magStudy(g.bonuses.stat[c.spellStat]) * levels / 2) + (levels > 0 ? 1 : 0);
  const learnable = classSpells(g).filter(s => spellLevel(g, s) <= p.lev).length;
  return Math.max(0, Math.min(allowed, learnable) - p.learned.length);
}
export function study(g: Game, spellId?: string): boolean {
  const p = g.player, c = CLASS_BY_ID[p.cls];
  if (newSpellCount(g) <= 0) { g.msg.add('You cannot learn any new spells right now.'); return false; }
  const cands = spellsAvailable(g).filter(s => !p.learned.includes(s.id) && spellLevel(g, s) <= p.lev);
  if (!cands.length) { g.msg.add(`You cannot learn any ${realmWords(g)[0]}s from the books you carry.`); return false; }
  const s = spellId ? cands.find(x => x.id === spellId) : c.realm === 'prayer' ? cands[randint0(cands.length)] : cands[0];
  if (!s) return false;
  p.learned.push(s.id);
  playSound(g, 'study');
  g.msg.add(`You have learned the ${realmWords(g)[0]} of ${s.name}.`, '#a0ffa0');
  endTurn(g);
  return true;
}
export function cast(g: Game, s: SpellDef, ctx: EffectCtx = {}): void {
  const p = g.player, c = CLASS_BY_ID[p.cls];
  if (cannotAct(g)) return;
  const [word, verb] = realmWords(g);
  if (p.timed.blind && c.realm !== 'prayer') { g.msg.add('You cannot see!'); return; }
  if (p.timed.confused) { g.msg.add('You are too confused!'); return; }
  if (!p.learned.includes(s.id)) { g.msg.add(`You do not know that ${word}.`); return; }
  const mana = spellMana(g, s);
  if (mana > p.csp) { g.msg.add(`You do not have enough mana to ${verb} this ${word}.`); return; }
  const fail = spellFail(g, s);
  p.csp -= mana;
  if (randint0(100) < fail) { g.msg.add(c.realm === 'prayer' ? 'You failed to concentrate hard enough!' : `You failed to get the ${word} off!`, '#ff8080'); playSound(g, 'fail'); endTurn(g); return; }
  g.msg.add(`You ${verb} ${s.name}.`, '#c0c0ff');
  playSound(g, 'cast');
  const power = s.id === 'magic_missile' || s.id === 'nether_bolt' ? Math.floor((p.lev - 1) / 5) : 0;
  runEffect(g, s.effect, { ...ctx, power });
  if (!p.cast.includes(s.id)) { p.cast.push(s.id); gainExp(g, spellExp(g, s) * spellLevel(g, s)); g.msg.add('You have learned something new.', '#a0ffa0'); }
  endTurn(g);
}

// ---------------------------------------------------------------------------------------------
// Chests

/** Chest traps (Angband's CHEST_* flags). A chest's trap kind lives in item.toDam; its lock in item.toHit (0 = unlocked). */
export const CHEST_TRAPS = ['', 'a poison needle', 'a needle that drains strength', 'a needle that drains constitution', 'a paralysing needle', 'poison gas', 'a summoning rune', 'an explosive charge', 'a paralysing needle and poison gas'];
export function chestTrapName(it: Item): string { return CHEST_TRAPS[it.toDam] || ''; }
export function openChest(g: Game, fi: { item: Item; x: number; y: number }): void {
  const p = g.player, lv = g.level, it = fi.item, b = g.bonuses;
  if (cannotAct(g)) return;
  const lvl = it.pval;
  if (it.toHit > 0) {
    // Locked: pick it with the disarm skill, as Angband's do_cmd_open does for chests.
    let j = b.skills.disarm;
    if (p.timed.blind) j = Math.floor(j / 10); if (p.timed.confused || p.timed.image) j = Math.floor(j / 10);
    j -= lvl;
    if (j < 2) j = 2;
    if (randint0(100) < j) { g.msg.add('You have picked the lock.', '#a0ffa0'); it.toHit = 0; gainExp(g, 1); }
    else { g.msg.add('You failed to pick the lock.'); endTurn(g); return; }
  }
  if (it.toDam > 0) {
    const trap = it.toDam;
    if (trap === 1 || trap === 4 || trap === 8) { g.msg.add('A small needle has pricked you!', '#ff8080'); takeHit(g, damroll(1, 4), 'a poison needle'); }
    if (trap === 1) { if (!b.flags.has('RES_POIS') && !p.timed.oppose_pois) setTimed(g, 'poisoned', p.timed.poisoned + 10 + randint1(20)); }
    if (trap === 2) { g.msg.add('A small needle has pricked you!', '#ff8080'); takeHit(g, damroll(1, 4), 'a poison needle'); if (!b.flags.has('SUST_STR') && drainStat(p, 'STR')) { g.msg.add('You feel weaker.', '#ff8080'); refreshBonuses(g); } }
    if (trap === 3) { g.msg.add('A small needle has pricked you!', '#ff8080'); takeHit(g, damroll(1, 4), 'a poison needle'); if (!b.flags.has('SUST_CON') && drainStat(p, 'CON')) { g.msg.add('You feel sicklier.', '#ff8080'); refreshBonuses(g); } }
    if (trap === 4 || trap === 8) { if (!b.flags.has('FREE_ACT')) setTimed(g, 'paralyzed', p.timed.paralyzed + 10 + randint1(20)); }
    if (trap === 5 || trap === 8) { g.msg.add('A puff of green gas surrounds you!', '#a0ffa0'); if (!b.flags.has('RES_POIS') && !p.timed.oppose_pois) setTimed(g, 'poisoned', p.timed.poisoned + 10 + randint1(20)); }
    if (trap === 6) { g.msg.add('You are enveloped in a cloud of smoke!'); for (let i = 0; i < 3; i++) { const pos = nearFloor(lv, fi.x, fi.y, 2, p); const race = pickRace(g, lv.depth + 1); if (pos && race) createMonster(g, race.id, pos.x, pos.y, false); } }
    if (trap === 7) { g.msg.add('There is a sudden explosion!', '#ff8080'); g.msg.add('Everything inside the chest is destroyed!'); takeHit(g, damroll(5, 8), 'an exploding chest'); lv.items.splice(lv.items.indexOf(fi), 1); endTurn(g); return; }
    it.toDam = 0;
    if (p.dead) return;
  }
  const n = kindOf(it).id.includes('large') ? 3 + randint1(3) : 1 + randint1(2);
  for (let i = 0; i < n; i++) g.hooks.placeObjectAt(fi.x, fi.y, Math.max(1, lvl));
  g.msg.add('You have opened the chest.', '#ffd040');
  lv.items.splice(lv.items.indexOf(fi), 1);
  endTurn(g);
}
/** Disarm a chest's trap (Angband's do_cmd_disarm_chest). */
export function disarmChest(g: Game, fi: { item: Item; x: number; y: number }): void {
  const p = g.player, it = fi.item, b = g.bonuses;
  if (!it.known) { g.msg.add('You cannot tell whether the chest is trapped.'); return; }
  if (it.toDam <= 0) { g.msg.add('The chest is not trapped.'); return; }
  let j = b.skills.disarm;
  if (p.timed.blind) j = Math.floor(j / 10); if (p.timed.confused || p.timed.image) j = Math.floor(j / 10);
  j -= it.pval;
  if (j < 2) j = 2;
  if (randint0(100) < j) { g.msg.add('You have disarmed the chest.', '#a0ffa0'); gainExp(g, it.pval); it.toDam = 0; }
  else if (randint0(100) < j + 20) { g.msg.add('You failed to disarm the chest.'); }
  else { g.msg.add('You set off a trap!', '#ff8080'); openChest(g, fi); return; }
  endTurn(g);
}

/** Text for the look command at a grid. */
export function describeGrid(g: Game, x: number, y: number): string {
  const lv = g.level;
  const parts: string[] = [];
  const m = monsterAt(lv, x, y);
  if (m && m.visible) { const r = raceOf(m); parts.push(`${monsterName(m)} (${m.sleep ? 'asleep' : m.afraid ? 'afraid' : m.hp < m.maxhp / 4 ? 'almost dead' : m.hp < m.maxhp / 2 ? 'wounded' : 'unhurt'})${r.desc ? ': ' + r.desc : ''}`); }
  for (const fi of itemsAt(lv, x, y)) if (hasFlag(lv, x, y, F.MARK)) parts.push(itemName(fi.item, g.flavors));
  const t = tileAt(lv, x, y);
  if (!hasFlag(lv, x, y, F.MARK)) return parts.join('; ') || 'unknown';
  const tn = t === T.FLOOR ? 'floor' : t === T.GRANITE || t === T.SECRET_DOOR ? 'granite wall' : t === T.PERM ? 'permanent wall' : t === T.MAGMA || t === T.MAGMA_K ? 'magma vein' : t === T.QUARTZ || t === T.QUARTZ_K ? 'quartz vein' :
    t === T.DOOR_CLOSED ? (auxAt(lv, x, y) ? 'locked door' : 'closed door') : t === T.DOOR_OPEN ? 'open door' : t === T.DOOR_BROKEN ? 'broken door' : t === T.RUBBLE ? 'pile of rubble' : t === T.STAIRS_UP ? 'up staircase' : t === T.STAIRS_DOWN ? 'down staircase' :
    t === T.TRAP ? TRAP_KINDS[auxAt(lv, x, y)] : t === T.GRASS ? 'grass' : t === T.ROAD ? 'road' : t === T.TREE ? 'tree' : isShop(t) ? ['General Store', 'Armoury', 'Weaponsmith', 'Temple', 'Alchemy Shop', 'Magic Shop', 'Black Market', 'Home'][t - T.SHOP_0] : 'something';
  parts.push(tn);
  if (hasFlag(lv, x, y, F.GLYPH)) parts.push('a glyph of warding');
  return parts.join('; ');
}

export const _keepCmds = [runWorld, clearFlag, isCleanFloor, inBounds, playerCanSee, isEmptyFloor, los, monsterTurn, criticalMelee, meleeSkill, updateMonsterVisibility, isKnown, identify, makeItem, needsDir, needsItem, SPELL_BY_ID, spellsInBook, STATS, isWeapon, isArmor];
