// Monster recall: the paragraph the knowledge screen and the look command show about a race, built
// from the race's data filtered through what the player has actually observed (Angband's
// describe_monster). Pure text; no DOM.
import type { Game } from './state.ts';
import type { MonsterRace, MonsterSpell, BlowMethod, BlowEffect } from './types.ts';
import { loreOf, knowsDetails, type MonsterLore } from './lore.ts';
import { ELEMENT_NAME } from './monsterSpells.ts';

const METHOD: Record<BlowMethod, string> = { HIT: 'hit', TOUCH: 'touch', PUNCH: 'punch', KICK: 'kick', CLAW: 'claw', BITE: 'bite', STING: 'sting', BUTT: 'butt', CRUSH: 'crush', ENGULF: 'engulf', CRAWL: 'crawl on you', DROOL: 'drool on you', SPIT: 'spit', GAZE: 'gaze', WAIL: 'wail', SPORE: 'release spores', BEG: 'beg', INSULT: 'insult', MOAN: 'moan', KISS: 'kiss' };
const EFFECT: Partial<Record<BlowEffect, string>> = { POISON: 'to poison', UN_BONUS: 'to disenchant', UN_POWER: 'to drain charges', EAT_GOLD: 'to steal gold', EAT_ITEM: 'to steal items', EAT_FOOD: 'to eat your food', EAT_LITE: 'to absorb light', ACID: 'to shoot acid', ELEC: 'to electrocute', FIRE: 'to burn', COLD: 'to freeze', BLIND: 'to blind', CONFUSE: 'to confuse', TERRIFY: 'to terrify', PARALYZE: 'to paralyse', LOSE_STR: 'to reduce strength', LOSE_INT: 'to reduce intelligence', LOSE_WIS: 'to reduce wisdom', LOSE_DEX: 'to reduce dexterity', LOSE_CON: 'to reduce constitution', LOSE_CHR: 'to reduce charisma', LOSE_ALL: 'to reduce all stats', SHATTER: 'to shatter', EXP_10: 'to lower experience (by 10d6+)', EXP_20: 'to lower experience (by 20d6+)', EXP_40: 'to lower experience (by 40d6+)', EXP_80: 'to lower experience (by 80d6+)', HALLU: 'to cause hallucinations', DISENCHANT: 'to disenchant' };

export function spellName(s: MonsterSpell): string {
  if (s.startsWith('BR_')) return 'breathe ' + ELEMENT_NAME[({ BR_ACID: 'acid', BR_ELEC: 'elec', BR_FIRE: 'fire', BR_COLD: 'cold', BR_POIS: 'pois', BR_NETHER: 'nether', BR_DARK: 'dark', BR_LITE: 'lite', BR_SOUND: 'sound', BR_CHAOS: 'chaos', BR_CONF: 'conf', BR_NEXUS: 'nexus', BR_TIME: 'time', BR_INERTIA: 'inertia', BR_GRAVITY: 'gravity', BR_SHARDS: 'shards', BR_PLASMA: 'plasma', BR_FORCE: 'force', BR_DISEN: 'disen', BR_DISINT: 'disint', BR_MANA: 'mana' } as const)[s as 'BR_ACID'] || 'mana'];
  const names: Partial<Record<MonsterSpell, string>> = {
    SHRIEK: 'shriek for help', ARROW: 'fire arrows', MISSILE: 'cast magic missiles', BOLT_ACID: 'cast acid bolts', BOLT_ELEC: 'cast lightning bolts', BOLT_FIRE: 'cast fire bolts', BOLT_COLD: 'cast frost bolts', BOLT_POIS: 'cast poison bolts', BOLT_NETHER: 'cast nether bolts', BOLT_MANA: 'cast mana bolts', BOLT_WATER: 'cast water bolts', BOLT_PLASMA: 'cast plasma bolts', BOLT_ICE: 'cast ice bolts',
    BALL_ACID: 'cast acid balls', BALL_ELEC: 'cast lightning balls', BALL_FIRE: 'cast fire balls', BALL_COLD: 'cast frost balls', BALL_POIS: 'cast stinking clouds', BALL_NETHER: 'cast nether balls', BALL_DARK: 'cast darkness storms', BALL_MANA: 'invoke mana storms', BALL_CHAOS: 'invoke raw Logrus', BALL_WATER: 'cast whirlpools',
    CAUSE_1: 'cause light wounds', CAUSE_2: 'cause serious wounds', CAUSE_3: 'cause critical wounds', CAUSE_4: 'cause mortal wounds', MIND_BLAST: 'cause mind blasting', BRAIN_SMASH: 'cause brain smashing', DRAIN_MANA: 'drain mana',
    SCARE: 'terrify', CONF: 'confuse', BLIND: 'blind', SLOW: 'slow', HOLD: 'paralyse', HASTE: 'haste-self', HEAL: 'heal-self', BLINK: 'blink-self', TPORT: 'teleport-self', TELE_TO: 'teleport to', TELE_AWAY: 'teleport away', TELE_LEVEL: 'teleport level', DARKNESS: 'create darkness', TRAPS: 'create traps', FORGET: 'cause amnesia',
    S_MONSTER: 'summon a monster', S_MONSTERS: 'summon monsters', S_KIN: 'summon its kin', S_UNDEAD: 'summon undead', S_DRAGON: 'summon a dragon', S_DEMON: 'summon a demon', S_ANIMAL: 'summon animals', S_HYDRA: 'summon hydras', S_ANGEL: 'summon an angel', S_SPIDER: 'summon spiders', S_HOUND: 'summon hounds', S_HI_UNDEAD: 'summon greater undead', S_HI_DRAGON: 'summon ancient dragons', S_HI_DEMON: 'summon greater demons', S_WRAITH: 'summon the Ringwraiths', S_UNIQUE: 'summon unique monsters',
  };
  return names[s] || s.toLowerCase().replace(/_/g, ' ');
}

function join(list: string[], last = 'and'): string {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' ' + last + ' ' + list[list.length - 1];
}

/** Full recall text for a race, honouring what the player knows. `cheat` shows everything. */
export function describeRace(g: Game, r: MonsterRace, cheat = false): string[] {
  const l: MonsterLore = loreOf(g, r.id);
  const details = cheat || knowsDetails(l, r);
  const f = r.flags;
  const unique = f.includes('UNIQUE');
  const pro = unique ? (f.includes('FEMALE') ? 'she' : f.includes('MALE') ? 'he' : 'it') : 'it';
  const Pro = pro[0].toUpperCase() + pro.slice(1);
  const name = unique ? r.name : 'the ' + r.name.toLowerCase();
  const out: string[] = [];
  if (r.desc) out.push(r.desc);
  // Kills and deaths.
  if (unique) {
    if (l.deaths) out.push(`${r.name} has slain ${l.deaths === 1 ? 'one of your ancestors' : l.deaths + ' of your ancestors'}${l.kills ? ', but you have taken revenge' : ', who remain unavenged'}.`);
    else if (l.kills) out.push(`You have slain this foe.`);
  } else {
    if (l.deaths) out.push(`${l.deaths === 1 ? 'One of your ancestors has' : l.deaths + ' of your ancestors have'} been killed by this creature${l.kills ? `, and you have exterminated at least ${l.kills} of the creatures` : ', and it is not ever known to have been defeated'}.`);
    else if (l.kills) out.push(`You have killed at least ${l.kills} of these creatures.`);
    else if (l.sights) out.push('No battles to the death are recalled.');
  }
  // Depth, speed, rarity.
  if (details || l.kills) {
    let s = r.depth === 0 ? `${Pro} lives in the town` : `${Pro} is ${f.includes('FORCE_DEPTH') ? 'only ' : 'normally '}found at depths of ${r.depth * 50} feet`;
    s += r.rarity >= 4 ? ', and is rarely seen' : r.rarity >= 2 ? ', and is seldom seen' : '';
    s += r.speed === 0 ? ', and moves at normal speed' : `, and moves ${r.speed > 0 ? 'quickly' : 'slowly'} (${r.speed > 0 ? '+' : ''}${r.speed})`;
    if (f.includes('NEVER_MOVE')) s += ', but does not deign to chase intruders';
    else if (f.includes('RAND_50') && f.includes('RAND_25')) s += ', extremely erratically';
    else if (f.includes('RAND_50')) s += ', somewhat erratically';
    else if (f.includes('RAND_25')) s += ', a bit erratically';
    out.push(s + '.');
  }
  if (details) {
    const exp = Math.floor(r.exp * r.depth / Math.max(1, g.player.lev));
    out.push(`${Pro} has ${unique ? '' : 'about '}${r.hp} hit points and an armour rating of ${r.ac}. Killing ${pro === 'it' ? 'this creature' : pro === 'he' ? 'him' : 'her'} is worth about ${exp} point${exp === 1 ? '' : 's'} for a ${g.player.lev}${ordinal(g.player.lev)} level character.`);
  }
  // Nature.
  const kinds: string[] = [];
  for (const [flag, word] of [['ANIMAL', 'natural'], ['EVIL', 'evil'], ['UNDEAD', 'undead'], ['DEMON', 'demonic'], ['ORC', 'orcish'], ['TROLL', 'trollish'], ['GIANT', 'gigantic'], ['DRAGON', 'draconic'], ['HOUND', 'houndlike'], ['SPIDER', 'arachnid'], ['HYDRA', 'hydra-like'], ['ANGEL', 'angelic'], ['WRAITH', 'wraithlike']] as const) if (f.includes(flag)) kinds.push(word);
  if (f.includes('GENERATOR')) kinds.push('a Gauntlet generator');
  if (kinds.length) out.push(`${Pro} is ${join(kinds)}.`);
  const abil: string[] = [];
  if (f.includes('INVISIBLE')) abil.push('is invisible'); if (f.includes('COLD_BLOOD')) abil.push('is cold blooded'); if (f.includes('EMPTY_MIND')) abil.push('is not detected by telepathy'); if (f.includes('WEIRD_MIND')) abil.push('is rarely detected by telepathy');
  if (f.includes('MULTIPLY')) abil.push('breeds explosively'); if (f.includes('REGENERATE')) abil.push('regenerates quickly'); if (f.includes('PASS_WALL')) abil.push('can pass through walls'); if (f.includes('KILL_WALL')) abil.push('can bore through walls');
  if (f.includes('OPEN_DOOR')) abil.push('can open doors'); if (f.includes('BASH_DOOR')) abil.push('can bash down doors'); if (f.includes('TAKE_ITEM')) abil.push('picks up objects'); if (f.includes('KILL_ITEM')) abil.push('destroys objects'); if (f.includes('KILL_BODY')) abil.push('tramples lesser monsters');
  if (abil.length && (details || l.sights >= 3)) out.push(`${Pro} ${join(abil)}.`);
  // Spells.
  const spells = cheat ? (r.spells || []) : l.spells.filter(s => (r.spells || []).includes(s));
  if (spells.length) {
    const breaths = spells.filter(s => s.startsWith('BR_')).map(spellName);
    const others = spells.filter(s => !s.startsWith('BR_')).map(spellName);
    let s = '';
    if (breaths.length) s += `${Pro} may ${join(breaths.map(b => b), 'or')}`;
    if (others.length) s += (s ? ', and is also' : `${Pro} is`) + ` magical, casting spells${f.includes('SMART') ? ' intelligently' : ''} which ${join(others, 'or')}`;
    const known = cheat || details || (r.spells && l.spells.length >= r.spells.length);
    if (known && r.spellFreq) s += `; 1 time in ${r.spellFreq}`;
    out.push(s + '.');
  }
  // Resistances and vulnerabilities.
  if (details || cheat) {
    const im: string[] = [];
    for (const [flag, word] of [['IM_ACID', 'acid'], ['IM_ELEC', 'lightning'], ['IM_FIRE', 'fire'], ['IM_COLD', 'cold'], ['IM_POIS', 'poison'], ['IM_NETHER', 'nether'], ['RES_NEXUS', 'nexus'], ['RES_DISEN', 'disenchantment'], ['RES_PLASMA', 'plasma'], ['RES_TELE', 'teleportation']] as const) if (f.includes(flag)) im.push(word);
    if (im.length) out.push(`${Pro} resists ${join(im)}.`);
    const hurt: string[] = [];
    for (const [flag, word] of [['HURT_LITE', 'bright light'], ['HURT_ROCK', 'rock remover'], ['HURT_FIRE', 'fire'], ['HURT_COLD', 'cold']] as const) if (f.includes(flag)) hurt.push(word);
    if (hurt.length) out.push(`${Pro} is hurt by ${join(hurt)}.`);
    const no: string[] = [];
    for (const [flag, word] of [['NO_FEAR', 'frightened'], ['NO_CONF', 'confused'], ['NO_SLEEP', 'slept'], ['NO_STUN', 'stunned']] as const) if (f.includes(flag)) no.push(word);
    if (no.length) out.push(`${Pro} cannot be ${join(no, 'or')}.`);
    out.push(f.includes('NEVER_MOVE') || r.sleep === 0 ? `${Pro} is ever vigilant for intruders, which ${pro} may notice from ${r.vision * 10} feet.` : `${Pro} ${r.sleep > 100 ? 'is nearly oblivious of' : r.sleep > 50 ? 'is fairly inattentive to' : r.sleep > 10 ? 'takes a while to see' : 'is wary of'} intruders, which ${pro} may notice from ${r.vision * 10} feet.`);
  }
  // Drops.
  if (l.drops > 0 || cheat) {
    const good = f.includes('DROP_GOOD'), great = f.includes('DROP_GREAT');
    const n = cheat ? (f.includes('DROP_4D2') ? 8 : f.includes('DROP_2D2') ? 4 : f.includes('DROP_1D2') ? 2 : 1) : l.drops;
    if (n) out.push(`${Pro} may carry ${n === 1 ? 'a' : n <= 2 ? 'one or two' : 'up to ' + n} ${great ? 'exceptional ' : good ? 'good ' : ''}${f.includes('ONLY_GOLD') ? 'treasure' : f.includes('ONLY_ITEM') ? 'object' : 'object or treasure'}${n > 1 ? 's' : ''}.`);
  }
  // Blows.
  const blows = r.blows.map((b, i) => ({ b, i })).filter(x => cheat || l.blows.includes(x.i));
  if (blows.length) {
    const parts = blows.map(({ b }) => `${METHOD[b.method]}${EFFECT[b.effect] ? ' ' + EFFECT[b.effect] : ''}${b.dice && (details || cheat) ? ` with damage ${b.dice[0]}d${b.dice[1]}` : ''}`);
    out.push(`${Pro} can ${join(parts)}.`);
  } else if (f.includes('NEVER_BLOW')) out.push(`${Pro} has no physical attacks.`);
  else if (r.blows.length) out.push('Nothing is known about its attack.');
  return out;
}
function ordinal(n: number): string { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

/** Word-wrap helper for the UI (n columns). */
export function wrapText(s: string, n: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; }
  if (line.trim()) out.push(line.trim());
  return out;
}
