// A character dump: the plain-text sheet Angband writes with the `C` then `f` command. Pure text;
// the UI decides how to hand it to the player (download in the browser).
import type { Game } from './state.ts';
import { statText, title, expToLevel, totalAc, meleeSkill, bowSkill } from './player.ts';
import { RACE_BY_ID } from './data/races.ts';
import { CLASS_BY_ID } from './data/classes.ts';
import { MONSTER_BY_ID } from './data/monsters.ts';
import { kindOf, itemName } from './items.ts';
import { SLOTS, SLOT_LABEL, STATS } from './types.ts';
import { score, foodState } from './game.ts';
import { SPELL_BY_ID } from './data/spells.ts';
import { BIRTH_OPTIONS, OPTION_TEXT } from './options.ts';

export function characterDump(g: Game): string {
  const p = g.player, b = g.bonuses, r = RACE_BY_ID[p.race], c = CLASS_BY_ID[p.cls];
  const L: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);
  L.push(`  [Gauntlet of Angband character dump]`, '');
  L.push(` Name   ${pad(p.name, 14)} Age    ${pad(String(Math.floor(p.turns / 1000)) + ' days', 10)} Self   RB  CB  EB   Best`);
  for (const s of STATS) L.push(` ${s === STATS[0] ? pad('Sex ' + p.sex, 21) : s === STATS[1] ? pad('Race ' + r.name, 21) : s === STATS[2] ? pad('Class ' + c.name, 21) : s === STATS[3] ? pad('Title ' + title(p), 21) : s === STATS[4] ? pad('HP ' + p.chp + '/' + p.mhp, 21) : pad('SP ' + p.csp + '/' + p.msp, 21)} ${pad(statText(p.statBase[s]), 7)}${s}  ${String(r.stats[s]).padStart(3)} ${String(c.stats[s]).padStart(3)} ${String(b.stat[s] - p.statCur[s]).padStart(3)}  ${statText(b.stat[s])}${p.statCur[s] < p.statBase[s] ? ' (drained ' + statText(p.statCur[s]) + ')' : ''}`);
  L.push('');
  L.push(` Level ${pad(String(p.lev), 10)} Exp ${pad(String(p.exp), 12)} Max Exp ${pad(String(p.maxExp), 10)} Next ${p.lev < 50 ? expToLevel(p, p.lev + 1) : 'MAX'}`);
  L.push(` Gold ${pad(String(p.gold), 11)} Turns ${pad(String(Math.floor(g.turn / 10)), 10)} Max Depth ${pad(p.maxDepth ? p.maxDepth * 50 + ' ft (L' + p.maxDepth + ')' : 'Town', 16)} Cur Depth ${p.depth ? p.depth * 50 + ' ft' : 'Town'}`);
  L.push(` Armour [${b.ac},${b.toAc >= 0 ? '+' : ''}${b.toAc}] (${totalAc(b)})  To-hit ${b.toHit >= 0 ? '+' : ''}${b.toHit}  To-dam ${b.toDam >= 0 ? '+' : ''}${b.toDam}  Blows ${b.blows}/turn  Shots ${b.shots}/turn x${b.might}  Speed ${b.speed >= 0 ? '+' : ''}${b.speed}`);
  L.push(` Fighting ${meleeSkill(p, b)}  Shooting ${bowSkill(p, b)}  Saving ${b.skills.save}  Stealth ${b.skills.stealth}  Perception ${b.skills.perception}  Searching ${b.skills.search}  Disarming ${b.skills.disarm}  Devices ${b.skills.device}  Infravision ${(r.infra + b.infra) * 10} ft  Food ${foodState(p.food)}`);
  L.push(` Kills ${p.kills}  Score ${score(g)}${g.totalWinner ? '  *** WINNER ***' : ''}${p.dead ? '  Killed by ' + p.deathCause : ''}`);
  L.push('');
  if (p.history) L.push(' ' + p.history, '');
  L.push('  [Character Equipment]', '');
  for (const s of SLOTS) { const it = p.equip[s]; if (it) L.push(` ${pad(SLOT_LABEL[s], 16)} ${itemName(it, g.flavors, { full: it.known })}`); }
  L.push('', '  [Character Inventory]', '');
  for (const it of p.inven) L.push(` ${itemName(it, g.flavors)}`);
  for (const it of p.quiver) L.push(` (quiver) ${itemName(it, g.flavors)}`);
  const home = g.stores[7];
  if (home && home.stock.length) { L.push('', '  [Home Inventory]', ''); for (const it of home.stock) L.push(` ${itemName(it, g.flavors)}`); }
  if (p.learned.length) { L.push('', `  [${c.realm === 'prayer' ? 'Prayers' : 'Spells'} Learned]`, ''); for (const id of p.learned) { const s = SPELL_BY_ID[id]; if (s) L.push(` ${pad(s.name, 26)} ${kindOf({ kind: s.book } as never).name}`); } }
  const flags = [...b.flags].filter(f => !f.startsWith('IGNORE_')).map(f => f.replace(/_/g, ' ').toLowerCase());
  if (flags.length) L.push('', '  [Abilities and Resistances]', '', ' ' + flags.join(', '));
  const uniques = g.uniquesDead.map(id => MONSTER_BY_ID[id]?.name || id);
  if (uniques.length) { L.push('', `  [Uniques Slain: ${uniques.length}]`, ''); for (const u of uniques) L.push(` ${u}`); }
  const kills = Object.entries(g.lore).filter(([, l]) => l.kills > 0).sort((a, b2) => (MONSTER_BY_ID[b2[0]]?.depth || 0) - (MONSTER_BY_ID[a[0]]?.depth || 0)).slice(0, 40);
  if (kills.length) { L.push('', '  [Kills by Race]', ''); for (const [id, l] of kills) L.push(` ${String(l.kills).padStart(5)}  ${MONSTER_BY_ID[id]?.name || id}`); }
  L.push('', '  [Options]', '');
  for (const o of BIRTH_OPTIONS) L.push(` ${pad(OPTION_TEXT[o][0], 22)} ${g.options[o] ? 'yes' : 'no'}`);
  L.push('', `  [Seed ${g.seed}]`, '');
  return L.join('\n');
}
