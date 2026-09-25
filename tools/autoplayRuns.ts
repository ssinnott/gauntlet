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

  const logPath = path.join(outDir, `run-${String(run).padStart(2, '0')}-${hero.race}-${hero.cls}-seed${seed}.log`);
  const lines: string[] = [];
  lines.push(`${raceName} ${clsName} (${hero.sex}), seed ${seed}, subrace ${hero.subrace || '-'}, subclass ${hero.subclass || '-'}`);
  lines.push(hero.history);
  lines.push('-'.repeat(80));

  let step = 0, lastDepth = -1;
  try {
    for (step = 0; step < TURNS && !g.player.dead; step++) {
      const depthBefore = g.level.depth;
      autoplayStep(g, step);
      if (g.levelChange) { enterLevel(g, g.levelChange.depth, g.levelChange.by); }
      // Every message the action produced, drained so nothing is double-logged or lost to the
      // 6-entry cap on `fresh` (safe here: one bot action rarely raises more than a handful).
      const msgs = g.msg.fresh.map(m => m.text);
      g.msg.fresh.length = 0;
      if (g.level.depth !== lastDepth) {
        lines.push(`--- depth ${g.level.depth} (${g.level.depth * 50} ft), turn ${g.turn} ---`);
        lastDepth = g.level.depth;
      }
      if (msgs.length) {
        lines.push(`[step ${step}] turn ${g.turn} hp ${g.player.chp}/${g.player.mhp} lv ${g.player.lev} @ ${g.player.x},${g.player.y}: ${msgs.join(' ')}`);
      }
      void depthBefore;
    }
  } catch (e) {
    lines.push(`CRASHED at step ${step}: ${(e as Error).stack}`);
  }
  if (g.player.dead) lines.push(`--- died at turn ${g.turn}, depth ${g.level.depth}: ${g.player.deathCause} ---`);
  else lines.push(`--- stopped after ${step} steps, still alive ---`);

  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  const summary: Summary = {
    run, seed, race: raceName, cls: clsName, sex: hero.sex,
    lev: g.player.lev, depth: g.level.depth, maxDepth: g.player.maxDepth,
    kills: g.player.kills, gold: g.player.gold, steps: step, turns: g.turn,
    dead: g.player.dead, cause: g.player.deathCause || '', score: score(g), log: logPath,
  };
  summaries.push(summary);
  console.log(`run ${run}: ${summary.race} ${summary.cls} lv ${summary.lev}, depth ${summary.depth} (max ${summary.maxDepth}, ${summary.maxDepth * 50} ft), ${summary.kills} kills, ${summary.gold} gold, ${summary.steps} steps/${summary.turns} turns, ${summary.dead ? 'died: ' + summary.cause : 'alive'}, score ${summary.score} -> ${summary.log}`);
}

console.log('\n' + '='.repeat(80));
console.log(`${RUNS} runs, seed base ${SEED0}, up to ${TURNS} steps each`);
const deaths = summaries.filter(s => s.dead).length;
const deepest = summaries.reduce((m, s) => Math.max(m, s.maxDepth), 0);
console.log(`${deaths}/${RUNS} died, deepest reached: ${deepest} (${deepest * 50} ft)`);
console.log('by depth reached:');
for (const s of [...summaries].sort((a, b) => b.maxDepth - a.maxDepth)) {
  console.log(`  #${s.run} ${s.race} ${s.cls}: max depth ${s.maxDepth} (${s.maxDepth * 50} ft), lv ${s.lev}, ${s.dead ? 'died: ' + s.cause : 'alive'} after ${s.turns} turns`);
}

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2));
