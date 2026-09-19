// What monsters cast: bolts, balls, breath, curses, summons, teleports and the annoyances.
import { type Monster, type MonsterSpell, type Element, type Stat } from './types.ts';
import { raceOf, hasMFlag, monsterName, monsterNameVisible, createMonster, nearFloor, pickRace } from './monster.ts';
import { takeHit, loseExp } from './combat.ts';
import { project, breathe } from './projection.ts';
import { setTimed, playerSavingThrow, teleportPlayer, teleportMonster, teleportPlayerTo, refreshBonuses } from './effectsCore.ts';
import { damroll, randint0, randint1, oneIn } from './util.ts';
import { lightArea } from './world.ts';
import { drainStat } from './player.ts';
import { setTile, tileAt, isCleanFloor, setAux } from './level.ts';
import { T, TRAP_KINDS, DIR_DX, DIR_DY } from './types.ts';
import type { Game } from './state.ts';

const BOLT_ELEM: Partial<Record<MonsterSpell, Element>> = { BOLT_ACID: 'acid', BOLT_ELEC: 'elec', BOLT_FIRE: 'fire', BOLT_COLD: 'cold', BOLT_POIS: 'pois', BOLT_NETHER: 'nether', BOLT_MANA: 'mana', MISSILE: 'missile', ARROW: 'missile' };
const BALL_ELEM: Partial<Record<MonsterSpell, Element>> = { BALL_ACID: 'acid', BALL_ELEC: 'elec', BALL_FIRE: 'fire', BALL_COLD: 'cold', BALL_POIS: 'pois', BALL_NETHER: 'nether', BALL_DARK: 'dark' };
const BR_ELEM: Partial<Record<MonsterSpell, Element>> = { BR_ACID: 'acid', BR_ELEC: 'elec', BR_FIRE: 'fire', BR_COLD: 'cold', BR_POIS: 'pois', BR_NETHER: 'nether', BR_DARK: 'dark', BR_LITE: 'lite', BR_SOUND: 'sound', BR_CHAOS: 'chaos', BR_CONF: 'conf' };

/** Cast one spell from the race's list. Returns false if nothing was cast (so the monster moves instead). */
export function monsterCastSpell(g: Game, m: Monster): boolean {
  const r = raceOf(m), p = g.player;
  const spells = r.spells!;
  // Smart-ish selection: heal when hurt, blink when adjacent and weak, else random.
  let choice: MonsterSpell = spells[randint0(spells.length)];
  if (m.hp < m.maxhp / 3 && spells.includes('HEAL') && oneIn(2)) choice = 'HEAL';
  if (m.afraid && spells.includes('TPORT') && oneIn(2)) choice = 'TPORT';
  if (m.afraid && spells.includes('BLINK') && oneIn(2)) choice = 'BLINK';
  const name = monsterNameVisible(g, m);
  const level = Math.max(1, r.depth);
  const powerful = hasMFlag(r, 'POWERFUL');
  const seen = m.visible;
  const cause = monsterName(m, false).replace(/^the /, '');
  const save = () => playerSavingThrow(g);
  m.attackAnim = 8;
  // Blindness: describe by sound.
  const bolt = BOLT_ELEM[choice], ball = BALL_ELEM[choice], br = BR_ELEM[choice];
  if (bolt) {
    const dice: [number, number] = choice === 'MISSILE' ? [2, 4] : choice === 'ARROW' ? [level < 20 ? 1 : 3, level < 20 ? 6 : 6] : choice === 'BOLT_MANA' ? [1, level * 7 / 2] : [Math.max(1, Math.floor(level / 2) + 1), 8];
    let dam = damroll(Math.floor(dice[0]), Math.max(1, Math.floor(dice[1])));
    if (choice === 'BOLT_NETHER') dam = 30 + damroll(5, 5) + level * (powerful ? 2 : 1);
    if (choice === 'BOLT_MANA') dam = randint1(level * 7 / 2) + 50;
    g.msg.add(seen ? `${name} ${choice === 'ARROW' ? 'fires an arrow' : choice === 'MISSILE' ? 'casts a magic missile' : 'casts a ' + bolt + ' bolt'}.` : 'You hear something fire.', '#ffb0b0');
    project(g, m.x, m.y, p.x, p.y, bolt, { dam, source: m });
    return true;
  }
  if (ball) {
    const dam = ball === 'pois' ? 12 : ball === 'nether' ? 50 + damroll(10, 10) + level : ball === 'dark' ? randint1(level * 3) + 20 : randint1(level * (powerful ? 3 : 2)) + 15 + (ball === 'fire' || ball === 'cold' ? 10 : 0);
    g.msg.add(seen ? `${name} casts a ${ball === 'pois' ? 'stinking cloud' : ball + ' ball'}.` : 'You hear a mumbling.', '#ffb0b0');
    project(g, m.x, m.y, p.x, p.y, ball, { dam, radius: 2, source: m });
    return true;
  }
  if (br) {
    const cap = br === 'acid' || br === 'elec' || br === 'fire' || br === 'cold' ? 1600 : br === 'pois' ? 800 : br === 'nether' ? 550 : br === 'lite' || br === 'dark' ? 400 : br === 'sound' || br === 'conf' ? 500 : 600;
    const dam = Math.min(cap, Math.floor(m.hp / (br === 'nether' ? 6 : br === 'sound' || br === 'conf' || br === 'lite' || br === 'dark' ? 6 : 3)));
    g.msg.add(seen ? `${name} breathes ${br === 'elec' ? 'lightning' : br === 'pois' ? 'gas' : br === 'lite' ? 'light' : br === 'dark' ? 'darkness' : br === 'conf' ? 'confusion' : br}!` : 'You hear a roar.', '#ffb0b0');
    breathe(g, m, br, Math.max(1, dam));
    return true;
  }
  switch (choice) {
    case 'SHRIEK': g.msg.add(seen ? `${name} makes a high pitched shriek.` : 'You hear a shriek.'); for (const o of g.level.monsters) { if (o !== m) o.sleep = 0; if (o.race === m.race && oneIn(3)) o.hasted = 10; } return true;
    case 'CAUSE_1': case 'CAUSE_2': case 'CAUSE_3': { const d = choice === 'CAUSE_1' ? damroll(3, 8) : choice === 'CAUSE_2' ? damroll(8, 8) : damroll(10, 15); g.msg.add(seen ? `${name} points at you and curses.` : 'You hear a curse.', '#ffb0b0'); if (save()) g.msg.add('You resist the effects!'); else takeHit(g, d, cause); return true; }
    case 'MIND_BLAST': case 'BRAIN_SMASH': { g.msg.add(seen ? `${name} gazes at you with psionic energy.` : 'You feel something focusing on your mind.', '#ffb0b0'); if (save()) { g.msg.add('You resist the effects!'); return true; } takeHit(g, choice === 'MIND_BLAST' ? damroll(7, 8) : damroll(12, 15), cause); if (choice === 'BRAIN_SMASH') { setTimed(g, 'confused', p.timed.confused + randint1(4) + 4); setTimed(g, 'slow', p.timed.slow + randint1(4) + 4); if (!g.bonuses.flags.has('FREE_ACT')) setTimed(g, 'paralyzed', randint1(4) + 4); } else setTimed(g, 'confused', p.timed.confused + randint1(4) + 4); return true; }
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
    case 'TELE_TO': g.msg.add(seen ? `${name} commands you to return.` : 'You hear a mumbling.'); teleportPlayerTo(g, m.x, m.y); return true;
    case 'TELE_AWAY': g.msg.add(seen ? `${name} teleports you away.` : 'You hear a mumbling.'); teleportPlayer(g, 100); return true;
    case 'DARKNESS': g.msg.add(seen ? `${name} gestures in shadow.` : 'You hear a mumbling.'); lightArea(g, p.x, p.y, false); return true;
    case 'TRAPS': g.msg.add(seen ? `${name} casts a spell and cackles evilly.` : 'You hear something cackle evilly.'); for (let d = 1; d <= 9; d++) { if (d === 5) continue; const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d]; if (isCleanFloor(g.level, x, y) && oneIn(2)) { setTile(g.level, x, y, T.TRAP_HIDDEN); setAux(g.level, x, y, randint0(TRAP_KINDS.length)); } } return true;
    case 'FORGET': g.msg.add(seen ? `${name} tries to blank your mind.` : 'You hear a mumbling.'); if (save()) g.msg.add('You resist the effects!'); else { g.msg.add('Your memories fade away.', '#ff8080'); for (let i = 0; i < g.level.flags.length; i++) if (tileAt(g.level, i % g.level.w, Math.floor(i / g.level.w)) !== T.PERM) g.level.flags[i] &= ~1; } return true;
    case 'S_MONSTER': case 'S_MONSTERS': case 'S_KIN': case 'S_UNDEAD': case 'S_DRAGON': case 'S_DEMON': case 'S_ANIMAL': {
      const n = choice === 'S_MONSTERS' ? 2 + randint1(3) : choice === 'S_MONSTER' ? 1 : 1 + randint1(2);
      g.msg.add(seen ? `${name} magically summons ${choice === 'S_KIN' ? 'its kin' : choice === 'S_UNDEAD' ? 'undead' : choice === 'S_DRAGON' ? 'a dragon' : choice === 'S_DEMON' ? 'a demon' : choice === 'S_ANIMAL' ? 'animals' : 'help'}!` : 'You hear something appear nearby.', '#ffb0b0');
      for (let i = 0; i < n; i++) {
        const pos = nearFloor(g.level, p.x, p.y, 3);
        if (!pos) continue;
        const race = choice === 'S_KIN' ? raceOf(m) : pickRace(g, g.level.depth + 2, rr => choice === 'S_UNDEAD' ? rr.flags.includes('UNDEAD') : choice === 'S_DRAGON' ? rr.flags.includes('DRAGON') : choice === 'S_DEMON' ? rr.flags.includes('DEMON') : choice === 'S_ANIMAL' ? rr.flags.includes('ANIMAL') : !rr.flags.includes('UNIQUE'));
        if (race) { const s = createMonster(g, race.id, pos.x, pos.y, false); s.energy = 0; }
      }
      return true;
    }
    default: return false;
  }
}
/** Angband's stat-drain touch used by a few spells; exported for effects.ts symmetry. */
export function drainRandomStat(g: Game): void {
  const stats: Stat[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHR'];
  const s = stats[randint0(6)];
  if (drainStat(g.player, s)) { g.msg.add('You feel drained.', '#ff8080'); refreshBonuses(g); }
}
export const _keep = [loseExp];
