// Melee and damage: the player's blows, monster blows with their side effects, elemental damage
// with resistances, and what happens when either side runs out of hit points.
import { type Monster, type Item, type Element, type Stat, type ObjectFlag, type BlowEffect, type Timed } from './types.ts';
import { raceOf, hasMFlag, monsterName, monsterNameVisible, removeMonster, monsterDrops } from './monster.ts';
import { kindOf, itemFlags, itemDice, itemName, isWeapon, makeGold } from './items.ts';
import { drainStat, checkLevel, adj, meleeSkill } from './player.ts';
import { damroll, randint0, randint1, oneIn, capitalize } from './util.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { RACE_BY_ID } from './data/races.ts';
import { disturb, dropNear } from './world.ts';
import { randomEmptyFloor } from './level.ts';
import type { Game } from './state.ts';
import { setTimed, refreshBonuses, teleportPlayer, playerSavingThrow, teleportMonster } from './effectsCore.ts';

/** Angband's test_hit: to-hit `chance` against armour class `ac`. */
export function testHit(chance: number, ac: number, visible: boolean): boolean {
  const k = randint0(100);
  if (k < 10) return k < 5;
  if (!visible) chance = Math.floor(chance / 2);
  if (chance <= 0) return false;
  return randint0(chance) >= Math.floor(ac * 3 / 4);
}

/** Melee critical hits (Angband's critical_norm). Returns [damage, message]. */
export function criticalMelee(weight: number, plus: number, dam: number, lev: number): [number, string] {
  const i = weight + (plus + lev * 3) * 5 + randint0(60) * 0 + 0;
  if (randint1(5000) <= i + 400 * 0 + plus * 5 + lev * 3) {
    const k = weight + randint1(650);
    if (k < 400) return [2 * dam + 5, 'It was a good hit!'];
    if (k < 700) return [2 * dam + 10, 'It was a great hit!'];
    if (k < 900) return [3 * dam + 15, 'It was a superb hit!'];
    if (k < 1300) return [3 * dam + 20, 'It was a *GREAT* hit!'];
    return [Math.floor(7 * dam / 2) + 25, 'It was a *SUPERB* hit!'];
  }
  return [dam, ''];
}

/** Slay / brand multiplier of a weapon against a monster (Angband's tot_dam_aux). */
export function slayMultiplier(flags: Set<ObjectFlag>, m: Monster): number {
  const r = raceOf(m);
  let mult = 1;
  const up = (n: number) => { if (mult < n) mult = n; };
  if (flags.has('SLAY_ANIMAL') && hasMFlag(r, 'ANIMAL')) up(2);
  if (flags.has('SLAY_EVIL') && hasMFlag(r, 'EVIL')) up(2);
  if (flags.has('SLAY_UNDEAD') && hasMFlag(r, 'UNDEAD')) up(3);
  if (flags.has('SLAY_DEMON') && hasMFlag(r, 'DEMON')) up(3);
  if (flags.has('SLAY_ORC') && hasMFlag(r, 'ORC')) up(3);
  if (flags.has('SLAY_TROLL') && hasMFlag(r, 'TROLL')) up(3);
  if (flags.has('SLAY_GIANT') && hasMFlag(r, 'GIANT')) up(3);
  if (flags.has('SLAY_DRAGON') && hasMFlag(r, 'DRAGON')) up(3);
  if (flags.has('KILL_DRAGON') && hasMFlag(r, 'DRAGON')) up(5);
  if (flags.has('BRAND_ACID') && !hasMFlag(r, 'IM_ACID')) up(3);
  if (flags.has('BRAND_ELEC') && !hasMFlag(r, 'IM_ELEC')) up(3);
  if (flags.has('BRAND_FIRE') && !hasMFlag(r, 'IM_FIRE')) up(hasMFlag(r, 'HURT_FIRE') ? 4 : 3);
  if (flags.has('BRAND_COLD') && !hasMFlag(r, 'IM_COLD')) up(hasMFlag(r, 'HURT_COLD') ? 4 : 3);
  if (flags.has('BRAND_POIS') && !hasMFlag(r, 'IM_POIS')) up(3);
  return mult;
}

/** The player attacks the monster at its grid with every blow. */
export function playerAttack(g: Game, m: Monster): void {
  const p = g.player, b = g.bonuses;
  const r = raceOf(m);
  if (p.timed.afraid) { g.msg.add(`You are too afraid to attack ${monsterNameVisible(g, m, false)}!`, '#ff8080'); return; }
  p.facing = m.x > p.x ? 1 : m.x < p.x ? -1 : p.facing;
  g.fx.push({ type: 'melee', x: p.x, y: p.y, dx: Math.sign(m.x - p.x), dy: Math.sign(m.y - p.y) });
  m.sleep = 0;
  const weapon = p.equip.weapon;
  const chance = meleeSkill(p, b);
  const flags = weapon ? itemFlags(weapon) : new Set<ObjectFlag>();
  const name = monsterNameVisible(g, m, false);
  for (let blow = 0; blow < b.blows; blow++) {
    if (!testHit(chance, r.ac, m.visible)) { g.msg.add(`You miss ${name}.`, '#a0a0a0'); continue; }
    let dam: number;
    let crit = '';
    if (weapon) {
      const [n, s] = itemDice(weapon);
      dam = damroll(n, s) * slayMultiplier(flags, m);
      if (flags.has('IMPACT') && dam > 50 && oneIn(2)) g.fx.push({ type: 'shake', amount: 4 });
      [dam, crit] = criticalMelee(kindOf(weapon).weight, weapon.toHit + b.toHit, dam, p.lev);
      dam += weapon.toDam + b.toDam;
    } else {
      dam = damroll(1, 1) + b.toDam;
    }
    if (p.timed.shero) dam += 2;
    dam = Math.max(0, dam);
    const verb = weapon ? 'hit' : 'punch';
    g.msg.add(`You ${verb} ${name}.`);
    if (crit) g.msg.add(crit, '#ffd040');
    if (monsterTakeHit(g, m, dam, '')) break;
    // Confusing touch / vorpal chatter could go here.
  }
  if (weapon && flags.has('CURSED') && !weapon.known) { weapon.known = true; g.msg.add('Your weapon feels cursed!', '#ff8080'); }
  if (weapon && !weapon.known && oneIn(20)) senseWielded(g, weapon);
}

function senseWielded(g: Game, it: Item): void {
  // Handled in game.ts's periodic pseudo-id; here only the cheap "you feel" on hit.
  void g; void it;
}

/**
 * Damage a monster. Returns true if it died. `note` is appended to the death message for ranged
 * kills (e.g. "is destroyed"); exp goes to the player when `byPlayer`.
 */
export function monsterTakeHit(g: Game, m: Monster, dam: number, note: string, byPlayer = true): boolean {
  const r = raceOf(m), p = g.player;
  m.sleep = 0;
  m.hp -= dam;
  m.hitFlash = 6;
  if (dam > 0 && m.visible) g.fx.push({ type: 'hit', x: m.x, y: m.y, text: String(dam), color: '#ffe080' });
  if (m.hp <= 0) {
    const name = monsterNameVisible(g, m);
    const undead = hasMFlag(r, 'UNDEAD') || hasMFlag(r, 'DEMON') || r.sprite === 'golem' || r.sprite === 'vortex' || r.sprite === 'elemental' || hasMFlag(r, 'GENERATOR');
    const verb = hasMFlag(r, 'GENERATOR') ? 'is destroyed' : note || (undead ? 'is destroyed' : m.visible ? 'dies' : 'dies');
    if (m.visible) g.msg.add(`${name} ${verb}.`, hasMFlag(r, 'UNIQUE') ? '#ffd040' : '#e8e4d8');
    else g.msg.add('You hear a scream of pain.', '#a0a0a0');
    if (byPlayer) {
      const exp = Math.floor(r.exp * r.depth / Math.max(1, p.lev));
      const frac = (r.exp * r.depth) % Math.max(1, p.lev);
      gainExp(g, exp + (randint0(p.lev) < frac ? 1 : 0));
      p.kills++;
      g.stats.monstersKilled++;
      if (hasMFlag(r, 'UNIQUE')) { g.uniquesDead.push(r.id); g.msg.shout(`${r.name.toUpperCase()} IS SLAIN!`, '#ffd040'); }
      if (r.id === 'ancalagon_the_black' || r.id === 'ancalagon') { g.totalWinner = true; g.msg.shout('YOU HAVE WON THE GAME!', '#ffd040'); }
    }
    monsterDrops(g, m);
    removeMonster(g, m);
    disturb(g);
    return true;
  }
  // Fear.
  if (!hasMFlag(r, 'NO_FEAR') && !m.afraid) {
    const pct = Math.floor(100 * m.hp / m.maxhp);
    if ((pct <= 10 && randint0(10) < pct) || (dam >= m.hp && randint0(100) < 80)) {
      m.afraid = randint1(10) + (dam >= m.hp ? 20 : Math.floor((11 - pct) * 5));
      if (m.visible) g.msg.add(`${monsterName(m)} flees in terror!`, '#a0ffa0');
    }
  }
  return false;
}

export function gainExp(g: Game, amount: number): void {
  const p = g.player;
  if (amount <= 0) return;
  p.exp += amount;
  if (p.exp > p.maxExp) p.maxExp = p.exp;
  const gained = checkLevel(p);
  if (gained > 0) {
    refreshBonuses(g);
    g.msg.add(`Welcome to level ${p.lev}.`, '#a0ffa0');
    g.msg.shout(`${CLASS_BY_ID[p.cls].hero.toUpperCase()} REACHES LEVEL ${p.lev}!`, '#a0ffa0');
  } else if (gained < 0) { refreshBonuses(g); g.msg.add(`You have dropped to level ${p.lev}.`, '#ff8080'); }
}

/** Damage the player. Kills at 0 hp. */
export function takeHit(g: Game, dam: number, cause: string): void {
  const p = g.player;
  if (p.dead) return;
  if (p.timed.invuln && dam < 9000) return;
  disturb(g);
  p.chp -= dam;
  if (dam > 0) { g.fx.push({ type: 'hit', x: p.x, y: p.y, text: String(dam), color: '#ff6060' }); if (dam >= p.mhp / 4) g.fx.push({ type: 'shake', amount: Math.min(8, 2 + dam / 10) }); }
  if (p.chp < 0) {
    p.dead = true;
    p.deathCause = cause;
    p.chp = 0;
    g.msg.add(`You die.`, '#ff4040');
    g.msg.shout('YOU HAVE DIED', '#ff4040');
    return;
  }
  const warn = Math.floor(p.mhp * 0.25);
  if (p.chp < warn && p.chp + dam >= warn) g.msg.shout(`${CLASS_BY_ID[p.cls].hero.toUpperCase()} IS ABOUT TO DIE!`, '#ff6060');
  else if (p.chp < warn && oneIn(4)) g.msg.add('*** LOW HITPOINT WARNING! ***', '#ff6060');
}

/** Elemental damage to the player with resistances and side effects. */
export function elementDamage(g: Game, elem: Element, dam: number, cause: string): void {
  const p = g.player, f = g.bonuses.flags, t = p.timed;
  let d = dam;
  const res = (r: ObjectFlag, im: ObjectFlag | null, opp: Timed | null) => {
    if (im && f.has(im)) return 0;
    let v = dam;
    if (f.has(r)) v = Math.floor(v * (elem === 'pois' ? 1 : 1) / 3);
    if (opp && t[opp]) v = Math.floor(v / 3);
    return v;
  };
  switch (elem) {
    case 'acid': d = res('RES_ACID', 'IM_ACID', 'oppose_acid'); if (d && !f.has('IM_ACID') && oneIn(3)) damageArmor(g); break;
    case 'elec': d = res('RES_ELEC', 'IM_ELEC', 'oppose_elec'); if (d) inventoryDamage(g, 'elec', dam); break;
    case 'fire': d = res('RES_FIRE', 'IM_FIRE', 'oppose_fire'); if (d) inventoryDamage(g, 'fire', dam); break;
    case 'cold': d = res('RES_COLD', 'IM_COLD', 'oppose_cold'); if (d) inventoryDamage(g, 'cold', dam); break;
    case 'pois': d = res('RES_POIS', null, 'oppose_pois'); if (d && !f.has('RES_POIS') && !t.oppose_pois) setTimed(g, 'poisoned', t.poisoned + randint1(dam) + 10); break;
    case 'lite': if (f.has('RES_LITE')) d = Math.floor(dam * 4 / 9); else if (!f.has('RES_BLIND')) setTimed(g, 'blind', t.blind + randint1(5) + 2); break;
    case 'dark': if (f.has('RES_DARK')) d = Math.floor(dam * 4 / 9); else if (!f.has('RES_BLIND')) setTimed(g, 'blind', t.blind + randint1(5) + 2); break;
    case 'sound': if (f.has('RES_SOUND')) d = Math.floor(dam * 5 / 9); else setTimed(g, 'stun', Math.min(35, t.stun + randint1(dam > 60 ? 25 : dam / 3 + 5))); break;
    case 'conf': if (f.has('RES_CONF')) d = Math.floor(dam * 5 / 9); else setTimed(g, 'confused', t.confused + randint1(20) + 10); break;
    case 'chaos': if (f.has('RES_CHAOS')) d = Math.floor(dam * 6 / 9); else { if (!f.has('RES_CONF')) setTimed(g, 'confused', t.confused + randint1(20) + 10); setTimed(g, 'image', t.image + randint1(10)); if (!f.has('HOLD_LIFE')) loseExp(g, Math.floor(p.exp / 20)); } break;
    case 'nether': if (f.has('RES_NETHER')) d = Math.floor(dam * 6 / 9); else if (!f.has('HOLD_LIFE') || !oneIn(4)) loseExp(g, 200 + Math.floor(p.exp / 100)); break;
    case 'nexus': d = f.has('RES_NEXUS') ? Math.floor(dam * 6 / 9) : dam; if (!f.has('RES_NEXUS') && oneIn(3)) teleportPlayer(g, 30); break;
    case 'disen': d = f.has('RES_DISEN') ? Math.floor(dam * 6 / 9) : dam; if (!f.has('RES_DISEN')) disenchant(g); break;
    case 'holy': d = Math.floor(dam / 2); break;
    case 'water': if (!f.has('RES_SOUND')) setTimed(g, 'stun', Math.min(35, t.stun + randint1(10))); if (!f.has('RES_CONF')) setTimed(g, 'confused', t.confused + randint1(5)); break;
    case 'mana': case 'missile': break;
  }
  takeHit(g, d, cause);
}

function damageArmor(g: Game): void {
  const p = g.player;
  const slots = (['body', 'cloak', 'shield', 'helm', 'gloves', 'boots'] as const).filter(s => p.equip[s]);
  if (!slots.length) return;
  const it = p.equip[slots[randint0(slots.length)]]!;
  if (itemFlags(it).has('IGNORE_ACID') || it.toAc + kindOf(it).ac! <= 0) return;
  it.toAc--;
  g.msg.add(`Your ${itemName(it, g.flavors, { article: false, plainKind: true })} is damaged!`, '#ff8080');
  refreshBonuses(g);
}
/** Elemental attacks ruin fragile inventory: fire burns scrolls and books, cold shatters potions... */
export function inventoryDamage(g: Game, elem: 'fire' | 'cold' | 'elec' | 'acid', dam: number): void {
  const p = g.player;
  const chance = dam <= 30 ? 1 : dam <= 60 ? 2 : 3;
  for (let i = p.inven.length - 1; i >= 0; i--) {
    const it = p.inven[i], k = kindOf(it);
    const fragile = elem === 'fire' ? (k.tval === 'scroll' || k.tval === 'magic_book' || k.tval === 'prayer_book' || k.tval === 'staff' || k.tval === 'arrow' || k.tval === 'bow')
      : elem === 'cold' ? (k.tval === 'potion' || k.tval === 'flask')
      : elem === 'elec' ? (k.tval === 'wand' || k.tval === 'rod' || k.tval === 'ring')
      : (k.tval === 'staff' || k.tval === 'scroll' || k.tval === 'soft_armor' || k.tval === 'shot' || k.tval === 'bolt');
    if (!fragile || it.artifact) continue;
    const ignore: ObjectFlag = elem === 'fire' ? 'IGNORE_FIRE' : elem === 'cold' ? 'IGNORE_COLD' : elem === 'elec' ? 'IGNORE_ELEC' : 'IGNORE_ACID';
    if (itemFlags(it).has(ignore)) continue;
    let lost = 0;
    for (let n = 0; n < it.number; n++) if (randint0(100) < chance * 5) lost++;
    if (!lost) continue;
    const verb = elem === 'fire' ? 'burn' : elem === 'cold' ? 'shatter' : elem === 'elec' ? 'are destroyed' : 'are damaged';
    g.msg.add(`${lost === it.number ? (it.number === 1 ? 'Your ' + itemName(it, g.flavors, { article: false }) : 'All of your ' + itemName(it, g.flavors, { count: false })) : lost + ' of your ' + itemName(it, g.flavors, { count: false })} ${lost === 1 && verb.endsWith('e') ? verb + 's' : verb}!`, '#ff8080');
    it.number -= lost;
    if (it.number <= 0) p.inven.splice(i, 1);
  }
}
function disenchant(g: Game): void {
  const p = g.player;
  const slots = (['weapon', 'bow', 'body', 'cloak', 'shield', 'helm', 'gloves', 'boots'] as const).filter(s => p.equip[s]);
  if (!slots.length) return;
  const it = p.equip[slots[randint0(slots.length)]]!;
  if (it.toHit <= 0 && it.toDam <= 0 && it.toAc <= 0) return;
  if (it.artifact && !oneIn(3)) { g.msg.add('Your equipment resists disenchantment!'); return; }
  if (it.toHit > 0) it.toHit--; if (it.toDam > 0) it.toDam--; if (it.toAc > 0) it.toAc--;
  g.msg.add(`Your ${itemName(it, g.flavors, { article: false, plainKind: true })} was disenchanted!`, '#ff8080');
  refreshBonuses(g);
}
export function loseExp(g: Game, amount: number): void {
  const p = g.player;
  if (amount <= 0) return;
  p.exp = Math.max(0, p.exp - amount);
  g.msg.add('You feel your life draining away!', '#ff8080');
  const d = checkLevel(p);
  if (d < 0) { refreshBonuses(g); g.msg.add(`You have dropped to level ${p.lev}.`, '#ff8080'); }
}

// ---------------------------------------------------------------------------------------------
// Monster melee

const METHOD_TEXT: Record<string, string> = { HIT: 'hits you', TOUCH: 'touches you', PUNCH: 'punches you', KICK: 'kicks you', CLAW: 'claws you', BITE: 'bites you', STING: 'stings you', BUTT: 'butts you', CRUSH: 'crushes you', ENGULF: 'engulfs you', CRAWL: 'crawls on you', DROOL: 'drools on you', SPIT: 'spits on you', GAZE: 'gazes at you', WAIL: 'wails at you', SPORE: 'releases spores at you', BEG: 'begs you for money', INSULT: 'insults you', MOAN: 'moans at you', KISS: 'kisses you' };

export function monsterMelee(g: Game, m: Monster): void {
  const r = raceOf(m), p = g.player, b = g.bonuses;
  if (hasMFlag(r, 'NEVER_BLOW')) return;
  const name = monsterNameVisible(g, m);
  const ac = b.ac + b.toAc;
  m.attackAnim = 8;
  m.facing = p.x > m.x ? 1 : p.x < m.x ? -1 : m.facing;
  if (p.timed.protevil && hasMFlag(r, 'EVIL') && p.lev >= r.depth && randint0(100) + p.lev > 50) {
    if (m.visible) g.msg.add(`${name} is repelled.`);
    return;
  }
  for (const blow of r.blows) {
    if (p.dead) return;
    // Angband's check_hit: power + 3 * level against three quarters of the armour class, with a
    // flat 5% to hit or miss whatever the numbers say.
    const power = BLOW_POWER[blow.effect] ?? 60;
    const chance = power + r.depth * 3;
    const k = randint0(100);
    const hit = k < 10 ? k < 5 : chance > 0 && randint0(chance) >= Math.floor(ac * 3 / 4);
    if (!hit) {
      if (['HIT', 'TOUCH', 'PUNCH', 'KICK', 'CLAW', 'BITE', 'STING', 'BUTT', 'CRUSH', 'ENGULF'].includes(blow.method)) g.msg.add(`${name} misses you.`, '#a0a0a0');
      continue;
    }
    let dam = blow.dice ? damroll(blow.dice[0], blow.dice[1]) : 0;
    g.msg.add(`${name} ${METHOD_TEXT[blow.method] || 'hits you'}.`, dam ? '#ffb0b0' : '#e8e4d8');
    applyBlowEffect(g, m, blow.effect, dam);
    // Critical stuns from heavy hits.
    if (dam > 20 && (blow.method === 'HIT' || blow.method === 'CRUSH' || blow.method === 'BUTT' || blow.method === 'KICK') && !b.flags.has('RES_SOUND') && oneIn(4)) setTimed(g, 'stun', Math.min(35, p.timed.stun + randint1(5)));
    if (dam > 30 && blow.method === 'CLAW' && oneIn(4)) setTimed(g, 'cut', p.timed.cut + randint1(10));
  }
}
const BLOW_POWER: Partial<Record<BlowEffect, number>> = { HURT: 60, POISON: 5, UN_BONUS: 20, UN_POWER: 15, EAT_GOLD: 5, EAT_ITEM: 5, EAT_FOOD: 5, EAT_LITE: 5, ACID: 0, ELEC: 10, FIRE: 10, COLD: 10, BLIND: 2, CONFUSE: 10, TERRIFY: 10, PARALYZE: 2, LOSE_STR: 0, LOSE_DEX: 0, LOSE_CON: 0, LOSE_INT: 0, LOSE_WIS: 0, LOSE_CHR: 0, LOSE_ALL: 2, SHATTER: 60, EXP_10: 5, EXP_20: 5, EXP_40: 5, EXP_80: 5, HALLU: 10, DISENCHANT: 20 };

function applyBlowEffect(g: Game, m: Monster, effect: BlowEffect, dam: number): void {
  const p = g.player, b = g.bonuses, f = b.flags, t = p.timed;
  const cause = monsterName(m, false).replace(/^the /, '');
  const ac = b.ac + b.toAc;
  const save = () => playerSavingThrow(g);
  const drain = (s: Stat) => { takeHit(g, dam, cause); if (f.has(('SUST_' + s) as ObjectFlag)) g.msg.add(`You feel weakened for a moment, but it passes.`); else if (drainStat(p, s)) { g.msg.add(`You feel very ${STAT_DRAIN_WORD[s]}.`, '#ff8080'); refreshBonuses(g); } };
  switch (effect) {
    case 'HURT': dam -= Math.floor(dam * Math.min(ac, 150) / 250); takeHit(g, dam, cause); break;
    case 'POISON': takeHit(g, dam, cause); if (!f.has('RES_POIS') && !t.oppose_pois) { setTimed(g, 'poisoned', t.poisoned + randint1(dam) + 5); g.msg.add('You are poisoned!', '#a0ffa0'); } break;
    case 'UN_BONUS': takeHit(g, dam, cause); if (!f.has('RES_DISEN')) disenchant(g); break;
    case 'UN_POWER': { takeHit(g, dam, cause); const devs = p.inven.filter(i => (kindOf(i).tval === 'wand' || kindOf(i).tval === 'staff') && i.charges > 0); if (devs.length) { const it = devs[randint0(devs.length)]; g.msg.add('Energy drains from your pack!', '#ff8080'); m.hp = Math.min(m.maxhp, m.hp + it.charges * 5); it.charges = 0; } break; }
    case 'EAT_GOLD': { takeHit(g, dam, cause); if (randint0(100) < adj.dexTa(b.stat.DEX) * 3 + p.lev && !t.paralyzed) { g.msg.add('You quickly protect your money pouch!'); break; } let gold = Math.floor(p.gold / 10 + randint1(25)); if (gold < 2) gold = 2; if (gold > 5000) gold = 2000 + randint1(1000); if (gold > p.gold) gold = p.gold; p.gold -= gold; if (gold > 0) { g.msg.add(`Your purse feels lighter. ${gold} coins were stolen!`, '#ff8080'); const it = makeGold(g.level.depth); it.pval = gold; m.held.push(it); } else g.msg.add('Nothing was stolen.'); teleportMonster(g, m, 10 + randint1(10)); g.msg.add(`${monsterName(m)} flees laughing!`); break; }
    case 'EAT_ITEM': { takeHit(g, dam, cause); if (randint0(100) < adj.dexTa(b.stat.DEX) * 3 + p.lev && !t.paralyzed) { g.msg.add('You grab hold of your backpack!'); break; } const cands = p.inven.filter(i => !i.artifact); if (!cands.length) break; const it = cands[randint0(cands.length)]; const one = { ...it, number: 1, flags: [...it.flags] }; g.msg.add(`Your ${itemName(one, g.flavors, { article: false })} was stolen!`, '#ff8080'); it.number--; if (it.number <= 0) p.inven.splice(p.inven.indexOf(it), 1); m.held.push(one); teleportMonster(g, m, 10 + randint1(10)); g.msg.add(`${monsterName(m)} flees laughing!`); break; }
    case 'EAT_FOOD': { takeHit(g, dam, cause); const foods = p.inven.filter(i => kindOf(i).tval === 'food'); if (!foods.length) break; const it = foods[randint0(foods.length)]; g.msg.add(`Your ${itemName(it, g.flavors, { article: false, count: false })} was eaten!`, '#ff8080'); it.number--; if (it.number <= 0) p.inven.splice(p.inven.indexOf(it), 1); break; }
    case 'EAT_LITE': { takeHit(g, dam, cause); const l = p.equip.light; if (l && l.timeout > 0 && !itemFlags(l).has('NO_FUEL')) { l.timeout = Math.max(1, l.timeout - 250 - randint1(250)); g.msg.add('Your light dims.', '#ff8080'); refreshBonuses(g); } break; }
    case 'ACID': g.msg.add('You are covered in acid!'); elementDamage(g, 'acid', dam, cause); break;
    case 'ELEC': g.msg.add('You are struck by electricity!'); elementDamage(g, 'elec', dam, cause); break;
    case 'FIRE': g.msg.add('You are enveloped in flames!'); elementDamage(g, 'fire', dam, cause); break;
    case 'COLD': g.msg.add('You are covered with frost!'); elementDamage(g, 'cold', dam, cause); break;
    case 'BLIND': takeHit(g, dam, cause); if (!f.has('RES_BLIND')) { setTimed(g, 'blind', t.blind + 10 + randint1(raceOf(m).depth)); } break;
    case 'CONFUSE': takeHit(g, dam, cause); if (!f.has('RES_CONF')) setTimed(g, 'confused', t.confused + 3 + randint1(raceOf(m).depth)); break;
    case 'TERRIFY': takeHit(g, dam, cause); if (f.has('RES_FEAR') || t.hero || t.shero) g.msg.add('You stand your ground!'); else if (save()) g.msg.add('You stand your ground!'); else setTimed(g, 'afraid', t.afraid + 3 + randint1(raceOf(m).depth)); break;
    case 'PARALYZE': takeHit(g, dam, cause); if (f.has('FREE_ACT')) g.msg.add('You are unaffected!'); else if (save()) g.msg.add('You resist the effects!'); else if (!t.paralyzed) { setTimed(g, 'paralyzed', 3 + randint1(raceOf(m).depth)); g.msg.add('You are paralysed!', '#ff8080'); } break;
    case 'LOSE_STR': drain('STR'); break; case 'LOSE_INT': drain('INT'); break; case 'LOSE_WIS': drain('WIS'); break;
    case 'LOSE_DEX': drain('DEX'); break; case 'LOSE_CON': drain('CON'); break; case 'LOSE_CHR': drain('CHR'); break;
    case 'LOSE_ALL': takeHit(g, dam, cause); for (const s of ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'] as Stat[]) if (!f.has(('SUST_' + s) as ObjectFlag)) drainStat(p, s); g.msg.add('You feel your whole body weaken!', '#ff8080'); refreshBonuses(g); break;
    case 'SHATTER': dam -= Math.floor(dam * Math.min(ac, 150) / 250); takeHit(g, dam, cause); g.fx.push({ type: 'shake', amount: 6 }); break;
    case 'EXP_10': case 'EXP_20': case 'EXP_40': case 'EXP_80': { takeHit(g, dam, cause); const mult = effect === 'EXP_10' ? 10 : effect === 'EXP_20' ? 20 : effect === 'EXP_40' ? 40 : 80; if (f.has('HOLD_LIFE') && randint0(100) < 95) g.msg.add('You keep hold of your life force!'); else { const d = damroll(mult / 10, 6) + Math.floor(p.exp / 100) * 5; loseExp(g, f.has('HOLD_LIFE') ? Math.floor(d / 10) : d); } break; }
    case 'HALLU': takeHit(g, dam, cause); if (!f.has('RES_CHAOS')) setTimed(g, 'image', t.image + 3 + randint1(raceOf(m).depth)); break;
    case 'DISENCHANT': takeHit(g, dam, cause); if (!f.has('RES_DISEN')) disenchant(g); break;
  }
}
const STAT_DRAIN_WORD: Record<Stat, string> = { STR: 'weak', INT: 'stupid', WIS: 'naive', DEX: 'clumsy', CON: 'sickly', CHR: 'ugly' };
