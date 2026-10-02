// Headless: play several random heroes with the same bot the game runs, logging every action
// (as the message log records it) turn by turn, so a run can be read back afterwards to see what
// killed the hero or where it stalled. A hero who dies wakes in the town, as in the game, and plays
// on; the summary counts the deaths and reports how deep and how far each hero got regardless.
// Usage: node tools/autoplayRuns.ts [runs] [turns] [seed]
import { createGame, enterLevel, score, respawnInTown } from '../src/game/game.ts';
import { randomHero } from '../src/game/player.ts';
import { autoplayStep, resetAutoplay } from '../src/game/autoplay.ts';
import { makeRng, freshSeed } from '../src/lib/engine/rng.ts';
import { tileAt } from '../src/game/level.ts';
import { T } from '../src/game/types.ts';
import { RACES } from '../src/game/data/races.ts';
import { CLASSES } from '../src/game/data/classes.ts';
import type { Game } from '../src/game/state.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RUNS = Number(process.argv[2] || 10);
const TURNS = Number(process.argv[3] || 15000);
const SEED0 = Number(process.argv[4] || freshSeed());

const outDir = path.join('dist', 'autoplay-logs');
fs.mkdirSync(outDir, { recursive: true });

interface Summary {
  run: number; seed: number; race: string; cls: string; sex: string;
  lev: number; depth: number; maxDepth: number; kills: number; gold: number;
  steps: number; turns: number; dead: boolean; cause: string; score: number; log: string;
  attackers: string[]; swarmed: boolean; maxAttacksInOneStep: number;
  /** Deaths the hero woke up from, and what caused each. */
  deaths: number; causes: string[];
  /** Steps it took to die the first time, or the whole run if it never did. */
  firstDeathStep: number;
}
const summaries: Summary[] = [];

for (let run = 1; run <= RUNS; run++) {
  const seed = SEED0 + run;
  // A fresh hero, chosen the way the birth screen's RANDOM HERO does; the game itself is seeded
  // separately (as birth always seeds it), so the run is reproducible from the printed seed alone.
  const heroRng = makeRng(seed);
  const hero = randomHero((a, b) => heroRng.int(a, b));
  const raceName = RACES.find(r => r.id === hero.race)?.name || hero.race;
  const clsName = CLASSES.find(c => c.id === hero.cls)?.name || hero.cls;

  const g: Game = createGame(`Run${run}`, hero.race, hero.cls, hero.sex, seed, {
    stats: hero.stats, history: hero.history, subrace: hero.subrace, subclass: hero.subclass,
  });
  resetAutoplay();

  // `msg.fresh` is drained by the game itself (msg.newTurn) before autoplayStep ever returns to
  // us, and `msg.list` is capped at 300 entries -- both lose messages over a run this long. A
  // wrapper on `add` is the only way to see every message exactly as it happened.
  const captured: string[] = [];
  const origAdd = g.msg.add.bind(g.msg);
  g.msg.add = (text: string, color?: string) => { captured.push(text); origAdd(text, color); };

  const logPath = path.join(outDir, `run-${String(run).padStart(2, '0')}-${hero.race}-${hero.cls}-seed${seed}.log`);
  const lines: string[] = [];
  lines.push(`${raceName} ${clsName} (${hero.sex}), seed ${seed}, subrace ${hero.subrace || '-'}, subclass ${hero.subclass || '-'}`);
  lines.push(hero.history);
  lines.push('-'.repeat(80));

  let step = 0, lastDepth = -1, firstDeathStep = -1, firstDeathLine = -1;
  const causes: string[] = [];
  try {
    for (step = 0; step < TURNS; step++) {
      autoplayStep(g, step);
      if (g.levelChange && !g.player.dead) { enterLevel(g, g.levelChange.depth, g.levelChange.by); }
      const msgs = captured.splice(0, captured.length);
      if (g.level.depth !== lastDepth) {
        lines.push(`--- depth ${g.level.depth} (${g.level.depth * 50} ft), turn ${g.turn} ---`);
        lastDepth = g.level.depth;
      }
      if (msgs.length) {
        lines.push(`[step ${step}] turn ${g.turn} hp ${g.player.chp}/${g.player.mhp} lv ${g.player.lev} @ ${g.player.x},${g.player.y}: ${msgs.join(' ')}`);
      }
      // The hero wakes in the town, naked, as the game has them do, and the bot plays on.
      if (g.player.dead) {
        causes.push(`${g.player.deathCause} (depth ${g.level.depth}, lv ${g.player.lev})`);
        lines.push(`--- died at turn ${g.turn}, depth ${g.level.depth}: ${g.player.deathCause} ---`);
        if (firstDeathStep < 0) { firstDeathStep = step; firstDeathLine = lines.length; }
        respawnInTown(g);
        lines.push(...captured.splice(0, captured.length).map(t => `[respawn] ${t}`));
      }
    }
  } catch (e) {
    lines.push(`CRASHED at step ${step}: ${(e as Error).stack}`);
  }
  lines.push(`--- stopped after ${step} steps, ${causes.length} death${causes.length === 1 ? '' : 's'} ---`);

  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  // A rough triage of the first fatal fight: every distinct attacker named in the messages logged
  // for the last 40 actions before the first death, so a swarm (several names) reads differently
  // from one killer.
  const ATTACK = /(The [^.!]+?) (?:hits|misses|crushes|bites|claws|stings|touches|kicks|punches|butts|engulfs|gazes at|casts[^.]*at|breathes[^.]*at|slashes|bashes) you/gi;
  const tailLines = firstDeathLine < 0 ? [] : lines.slice(0, firstDeathLine).filter(l => l.startsWith('[step')).slice(-40);
  const attackers = new Set<string>();
  let maxAttacksInOneStep = 0;
  for (const l of tailLines) {
    let n = 0;
    for (const m of l.matchAll(ATTACK)) { attackers.add(m[1]); n++; }
    maxAttacksInOneStep = Math.max(maxAttacksInOneStep, n);
  }
  // A pit of monsters all sharing one name (e.g. six Novice warriors) never grows `attackers`, so a
  // burst of many attack-verbs landing in a single bot action catches that case too.
  const swarmed = attackers.size > 1 || maxAttacksInOneStep >= 4;

  const summary: Summary = {
    run, seed, race: raceName, cls: clsName, sex: hero.sex,
    lev: g.player.lev, depth: g.level.depth, maxDepth: g.player.maxDepth,
    kills: g.player.kills, gold: g.player.gold, steps: step, turns: g.turn,
    dead: causes.length > 0, cause: causes[0] || '', score: score(g), log: logPath,
    attackers: [...attackers], swarmed, maxAttacksInOneStep,
    deaths: causes.length, causes, firstDeathStep: firstDeathStep < 0 ? step : firstDeathStep,
  };
  summaries.push(summary);
  const swarmNote = summary.swarmed ? ` [swarm: ${summary.attackers.join(', ') || '(same name, up to ' + summary.maxAttacksInOneStep + ' hits/step)'}]` : '';
  console.log(`run ${run}: ${summary.race} ${summary.cls} lv ${summary.lev}, depth ${summary.depth} (max ${summary.maxDepth}, ${summary.maxDepth * 50} ft), ${summary.kills} kills, ${summary.gold} gold, ${summary.steps} steps/${summary.turns} turns, ${summary.deaths} death${summary.deaths === 1 ? '' : 's'}${summary.deaths ? ' (first: ' + summary.cause + ' at step ' + summary.firstDeathStep + ')' : ''}${swarmNote}, score ${summary.score} -> ${summary.log}`);
}

console.log('\n' + '='.repeat(80));
console.log(`${RUNS} runs, seed base ${SEED0}, ${TURNS} steps each`);
const died = summaries.filter(s => s.dead).length;
const deaths = summaries.reduce((n, s) => n + s.deaths, 0);
const deepest = summaries.reduce((m, s) => Math.max(m, s.maxDepth), 0);
const highestLev = summaries.reduce((m, s) => Math.max(m, s.lev), 0);
const mean = (f: (s: Summary) => number) => (summaries.reduce((n, s) => n + f(s), 0) / Math.max(1, summaries.length)).toFixed(1);
console.log(`${died}/${RUNS} ever died, ${deaths} deaths in all; deepest reached: ${deepest} (${deepest * 50} ft), highest level: ${highestLev}`);
console.log(`means: level ${mean(s => s.lev)}, max depth ${mean(s => s.maxDepth)}, deaths ${mean(s => s.deaths)}, steps to first death ${mean(s => s.firstDeathStep)}, kills ${mean(s => s.kills)}`);
console.log('by depth reached:');
for (const s of [...summaries].sort((a, b) => b.maxDepth - a.maxDepth)) {
  const swarmNote = s.swarmed ? ` [swarm: ${s.attackers.join(', ') || '(same name)'}]` : s.attackers.length === 1 ? ` [solo: ${s.attackers[0]}]` : '';
  console.log(`  #${s.run} ${s.race} ${s.cls}: max depth ${s.maxDepth} (${s.maxDepth * 50} ft), lv ${s.lev}, ${s.deaths} death${s.deaths === 1 ? '' : 's'}${s.deaths ? ': ' + s.causes.join('; ') : ''}${swarmNote}`);
}
const swarmed = summaries.filter(s => s.dead && s.swarmed).length;
const solo = summaries.filter(s => s.dead && !s.swarmed).length;
console.log(`\nfirst-death pattern: ${swarmed}/${died} were a pack/pit swarm (several attackers landing hits in the same action), ${solo}/${died} look like a single steady attacker`);

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2));
