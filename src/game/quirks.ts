// What a subclass quirk actually does.
//
// Most of what a sub-race or a subclass grants is declarative: a flag, a stat, a skill, a bonus to
// something player.ts already computes. A handful of the paths want something that vocabulary
// cannot say -- a blow that stuns, a shot that is worth double after a turn spent still, a mage
// who pays for spells with blood. Those are quirks, and this is the only file that knows what one
// means. Everywhere else calls a named hook from here.
//
// Each hook is written to be cheap and side-effect free unless its name says otherwise, because
// several of them sit inside the melee loop and run once per blow.
import { type Monster, type Element, type Player, type QuirkId } from './types.ts';
import type { Game } from './state.ts';
import { hasQuirk } from './player.ts';
import { raceOf, hasMFlag, monsterNameVisible } from './monster.ts';
import { randint1, oneIn } from './util.ts';

/** True when the hero spent its last turn neither moving nor striking. */
export function stoodStill(p: Player): boolean { return p.turns - (p.movedAt ?? -99) >= 1; }
/** Called wherever the hero moves or attacks, so the two quirks above can tell. */
export function noteMoved(p: Player): void { p.movedAt = p.turns; }

// ---------------------------------------------------------------------------------------------
// Melee

/** Flat melee bonuses that depend on the state of the fight rather than on gear. */
export function quirkMeleeBonus(p: Player): { toHit: number; toDam: number } {
  // A blackguard fights better hurt than whole.
  if (hasQuirk(p, 'blood_rage') && p.chp * 2 <= p.mhp) return { toHit: 10, toDam: 15 };
  return { toHit: 0, toDam: 0 };
}

/**
 * Damage multipliers that depend on what the monster was doing when the blow landed. `asleep` and
 * `unaware` are read before the attack wakes it, which is why playerAttack captures them first.
 */
export function quirkMeleeDamage(p: Player, dam: number, asleep: boolean, unaware: boolean): number {
  // Only the cutthroat's version works in melee. The scout's is deliberately ranged-only, so the
  // two are different builds rather than the same one with different words.
  if (hasQuirk(p, 'sneak_attack') && (asleep || unaware)) return dam * 3;
  return dam;
}

/** Side effects of a blow that connected, applied after the damage. The monster may already be dead. */
export function quirkMeleeHit(g: Game, m: Monster, dam: number, died: boolean): void {
  const p = g.player;
  if (hasQuirk(p, 'stun_on_big_hit') && !died && dam > 15 && !hasMFlag(raceOf(m), 'NO_STUN')) {
    m.stunned = Math.max(m.stunned, 3 + randint1(6));
    g.msg.add(`${monsterNameVisible(g, m, true)} is dazed by the blow.`, '#ffd040');
  }
  if (hasQuirk(p, 'life_leech') && dam > 0) {
    const r = raceOf(m);
    // The undead give nothing back, and neither does anything without a mind to bleed.
    const living = !hasMFlag(r, 'UNDEAD') && !hasMFlag(r, 'EMPTY_MIND');
    if (living && p.chp < p.mhp) p.chp = Math.min(p.mhp, p.chp + 2);
  }
  if (hasQuirk(p, 'dread_blow') && !died && dam > 0 && !hasMFlag(raceOf(m), 'NO_FEAR') && oneIn(4)) {
    m.afraid = Math.max(m.afraid, 10 + randint1(10));
    g.msg.add(`${monsterNameVisible(g, m, true)} flinches away from you.`, '#ffd040');
  }
}

/** A monster died. `how` decides which paths care. */
export function quirkOnKill(g: Game, m: Monster, how: 'melee' | 'spell' | 'other'): void {
  const p = g.player;
  if (how === 'melee' && hasQuirk(p, 'slay_heal') && p.chp < p.mhp) {
    p.chp = Math.min(p.mhp, p.chp + p.lev);
    g.msg.add('The kill puts strength back into you.', '#a0ffa0');
  }
  if (how === 'spell' && hasQuirk(p, 'soul_harvest') && p.csp < p.msp) {
    const gain = Math.max(1, Math.floor(raceOf(m).depth / 10));
    p.csp = Math.min(p.msp, p.csp + gain);
  }
}

// 'hold_the_line' is implemented in monster.ts, which this file imports: putting it here would
// close a cycle. It is the one quirk that does not live in this file.

// ---------------------------------------------------------------------------------------------
// Missiles and throwing

/** Multipliers on a shot, by how it was taken. */
export function quirkShotDamage(p: Player, dam: number, dist: number, asleep: boolean): number {
  if (hasQuirk(p, 'hunter_mark') && asleep) dam *= 3;
  if (hasQuirk(p, 'steady_aim') && stoodStill(p)) dam *= 2;
  if (hasQuirk(p, 'point_blank') && dist <= 2) dam = Math.floor(dam * 3 / 2);
  return dam;
}
/** A fletcher's arrows are always worth picking up again. */
export function quirkAmmoSurvives(p: Player): boolean { return hasQuirk(p, 'fletcher'); }
/** An axe-thrower's throwing weapons and flasks hit far harder than anyone else's. */
export function quirkThrowMultiplier(p: Player): number { return hasQuirk(p, 'mighty_throw') ? 2 : 1; }

// ---------------------------------------------------------------------------------------------
// Spells

/** Extra damage on the kinds of magic a path has made its own. */
export function quirkSpellDamage(p: Player, dam: number, shape: 'bolt' | 'ball' | 'breath', element: Element): number {
  if (hasQuirk(p, 'focused_bolts') && (shape === 'bolt' || shape === 'ball')) dam = Math.floor(dam * 5 / 4);
  if (hasQuirk(p, 'storm_lord') && (element === 'elec' || element === 'sound')) dam = Math.floor(dam * 5 / 4);
  return dam;
}
/** A thaumaturge's precision is bought with mana. */
export function quirkSpellCost(p: Player, mana: number, shape: 'bolt' | 'ball' | 'other'): number {
  return hasQuirk(p, 'focused_bolts') && shape !== 'other' ? mana + 1 : mana;
}
/** How hard a mind-affecting spell pushes against a monster's resistance. */
export function quirkSpellPower(p: Player, power: number): number {
  return hasQuirk(p, 'strong_enchantment') ? Math.floor(power * 5 / 4) : power;
}
export function quirkDispelMultiplier(p: Player): number { return hasQuirk(p, 'holy_dispel') ? 1.5 : 1; }

/**
 * A blood mage holds no mana at all and pays for spells with hit points. Everything that asks "can
 * this be cast" goes through here, so the answer is the same for the player, the menus and the bot.
 */
export function castsFromHealth(p: Player): boolean { return hasQuirk(p, 'blood_magic'); }
export function castingPool(p: Player): number { return castsFromHealth(p) ? p.chp - 1 : p.csp; }
export function payForSpell(g: Game, cost: number): void {
  const p = g.player;
  if (castsFromHealth(p)) p.chp = Math.max(1, p.chp - cost);
  else p.csp -= cost;
}

// ---------------------------------------------------------------------------------------------
// Defence and everything else

/** Damage on its way into the hero. */
export function quirkDamageTaken(g: Game, dam: number): number {
  const p = g.player;
  if (hasQuirk(p, 'shield_wall') && p.equip.shield) dam -= Math.floor(dam / 4);
  return Math.max(0, dam);
}
/** Gold on its way into the purse. */
export function quirkGold(p: Player, amount: number): number {
  return hasQuirk(p, 'pickpocket') ? Math.floor(amount * 3 / 2) : amount;
}

/** Used by the character sheet and the birth screen to explain a quirk in one line. */
export const QUIRK_TEXT: Record<QuirkId, string> = {
  stun_on_big_hit: 'A melee blow over 15 damage dazes what it lands on.',
  hold_the_line: 'From level 25, a monster beside you cannot slip to another grid beside you.',
  sneak_attack: 'Triple damage against a monster that has not noticed you.',
  hunter_mark: 'Triple damage from a bow shot against a monster that is still asleep.',
  life_leech: 'Every blow that draws blood from the living returns 2 hit points.',
  blood_rage: 'Below half health: +10 to hit and +15 damage in melee.',
  slay_heal: 'A kill in melee heals you for your character level.',
  dread_blow: 'One blow in four routs what it strikes.',
  steady_aim: 'Double damage on a shot taken after a turn spent still.',
  point_blank: 'Half again as much damage on a shot at two squares or less.',
  fletcher: 'Your ammunition never breaks.',
  no_extra_shots: 'You forgo the extra shots your class would otherwise gain with level.',
  mighty_throw: 'Thrown weapons and flasks do double damage, and your ammunition breaks as usual.',
  focused_bolts: 'Bolts and balls do a quarter more damage and cost one more mana.',
  strong_enchantment: 'Your sleep, slow, confuse, scare and polymorph push a quarter harder.',
  blood_magic: 'You hold no mana. Spells are paid for with hit points.',
  storm_lord: 'Your lightning and sound do a quarter more damage.',
  holy_dispel: 'Your dispel does half again as much damage.',
  soul_harvest: 'A spell kill returns mana.',
  shield_wall: 'A shield in hand turns a quarter of all damage.',
  rooted: 'Standing still gives 30 armour until you move.',
  unlight: 'Stealth improves in the dark and suffers under a bright light.',
  bear_hands: 'You fight unarmed as well as most fight armed.',
  pickpocket: 'You find half again as much gold.',
  no_spells: 'You never learn magic.',
  blunt_only: 'Edged weapons you have not blessed hamper you.',
  edged_ok: 'You may use edged weapons freely.',
  fast_metabolism: 'You burn food twice as fast.',
  slow_metabolism: 'You burn food half as fast.',
  deep_pockets: 'You begin with half again as much gold.',
  song_weaving: 'You may sustain two songs at once.',
};
