// Headless: play several random heroes with the same bot `ctrl+A` turns on, logging every action
// (as the message log records it) turn by turn, so a run can be read back afterwards to see what
// killed the hero or where it stalled. Prints a depth-reached summary across all runs.
// Usage: node tools/autoplayRuns.ts [runs] [turns] [seed]
import { createGame, enterLevel, score } from '../src/game/game.ts';
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

  let step = 0, lastDepth = -1;
  try {
    for (step = 0; step < TURNS && !g.player.dead; step++) {
      autoplayStep(g, step);
      if (g.levelChange) { enterLevel(g, g.levelChange.depth, g.levelChange.by); }
      const msgs = captured.splice(0, captured.length);
      if (g.level.depth !== lastDepth) {
        lines.push(`--- depth ${g.level.depth} (${g.level.depth * 50} ft), turn ${g.turn} ---`);
        lastDepth = g.level.depth;
      }
      if (msgs.length) {
        lines.push(`[step ${step}] turn ${g.turn} hp ${g.player.chp}/${g.player.mhp} lv ${g.player.lev} @ ${g.player.x},${g.player.y}: ${msgs.join(' ')}`);
      }
    }
  } catch (e) {
    lines.push(`CRASHED at step ${step}: ${(e as Error).stack}`);
  }
  if (g.player.dead) lines.push(`--- died at turn ${g.turn}, depth ${g.level.depth}: ${g.player.deathCause} ---`);
  else lines.push(`--- stopped after ${step} steps, still alive ---`);

  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  // A rough triage of the final fight: every distinct attacker named in the messages logged for
  // the last 400 turns before death, so a swarm (several names) reads differently from one killer.
  const ATTACK = /(The [^.!]+?) (?:hits|misses|crushes|bites|claws|stings|touches|kicks|punches|butts|engulfs|gazes at|casts[^.]*at|breathes[^.]*at|slashes|bashes) you/gi;
  const tailLines = lines.filter(l => l.startsWith('[step')).slice(-40);
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
    dead: g.player.dead, cause: g.player.deathCause || '', score: score(g), log: logPath,
    attackers: [...attackers], swarmed, maxAttacksInOneStep,
  };
  summaries.push(summary);
  const swarmNote = summary.swarmed ? ` [swarm: ${summary.attackers.join(', ') || '(same name, up to ' + summary.maxAttacksInOneStep + ' hits/step)'}]` : '';
  console.log(`run ${run}: ${summary.race} ${summary.cls} lv ${summary.lev}, depth ${summary.depth} (max ${summary.maxDepth}, ${summary.maxDepth * 50} ft), ${summary.kills} kills, ${summary.gold} gold, ${summary.steps} steps/${summary.turns} turns, ${summary.dead ? 'died: ' + summary.cause : 'alive'}${swarmNote}, score ${summary.score} -> ${summary.log}`);
}

console.log('\n' + '='.repeat(80));
console.log(`${RUNS} runs, seed base ${SEED0}, up to ${TURNS} steps each`);
const deaths = summaries.filter(s => s.dead).length;
const deepest = summaries.reduce((m, s) => Math.max(m, s.maxDepth), 0);
const highestLev = summaries.reduce((m, s) => Math.max(m, s.lev), 0);
console.log(`${deaths}/${RUNS} died, deepest reached: ${deepest} (${deepest * 50} ft), highest level: ${highestLev}`);
console.log('by depth reached:');
for (const s of [...summaries].sort((a, b) => b.maxDepth - a.maxDepth)) {
  const swarmNote = s.swarmed ? ` [swarm: ${s.attackers.join(', ') || '(same name)'}]` : s.attackers.length === 1 ? ` [solo: ${s.attackers[0]}]` : '';
  console.log(`  #${s.run} ${s.race} ${s.cls}: max depth ${s.maxDepth} (${s.maxDepth * 50} ft), lv ${s.lev}, ${s.dead ? 'died: ' + s.cause : 'alive'} after ${s.turns} turns${swarmNote}`);
}
const swarmed = summaries.filter(s => s.dead && s.swarmed).length;
const solo = summaries.filter(s => s.dead && !s.swarmed).length;
console.log(`\ndeath pattern: ${swarmed}/${deaths} deaths were a pack/pit swarm (several attackers landing hits in the same action), ${solo}/${deaths} look like a single steady attacker`);

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2));
