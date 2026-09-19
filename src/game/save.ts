// Save and restore the whole game as JSON. Typed arrays become base64; everything else is plain
// data already. The rng state is stored too, so a restored game continues its own random sequence.
import { rng } from '../lib/engine/rng.ts';
import type { Game } from './state.ts';
import type { Level } from './types.ts';
import { MessageLog } from './messages.ts';
import { getNextItemId, setNextItemId, setArtifactsMade, artifactsMadeList } from './items.ts';
import { computeBonuses } from './player.ts';
import { refreshBonuses } from './effectsCore.ts';
import { createGame } from './game.ts';
import { normalizeOptions } from './options.ts';

function b64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
function unb64(s: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function packLevel(lv: Level): unknown {
  return { ...lv, tiles: b64(lv.tiles), flags: b64(lv.flags), aux: b64(lv.aux), monsters: lv.monsters.map(m => ({ ...m, vx: undefined, vy: undefined, hitFlash: undefined, attackAnim: undefined })) };
}
function unpackLevel(d: { tiles: string; flags: string; aux: string }): Level {
  return { ...(d as unknown as Level), tiles: unb64(d.tiles), flags: unb64(d.flags), aux: unb64(d.aux) };
}
export function serialize(g: Game): string {
  const savedLevels: Record<string, unknown> = {};
  for (const [k, lv] of Object.entries(g.savedLevels)) savedLevels[k] = packLevel(lv);
  const data = {
    v: 2, seed: g.seed, turn: g.turn, player: { ...g.player, vx: undefined, vy: undefined }, level: packLevel(g.level), stores: g.stores, flavors: g.flavors, msg: g.msg.toJSON(),
    nextMonsterId: g.nextMonsterId, uniquesDead: g.uniquesDead, totalWinner: g.totalWinner, stats: g.stats, nextItemId: getNextItemId(), artifacts: artifactsMadeList(), rng: rng.state,
    options: g.options, lore: g.lore, artifactsSeen: g.artifactsSeen, egosKnown: g.egosKnown, savedLevels,
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Game {
  const d = JSON.parse(json);
  if (d.v !== 1 && d.v !== 2) throw new Error('unsupported save version');
  // Build a skeleton game through createGame so every runtime hook exists, then overwrite it.
  const g = createGame(d.player.name, d.player.race, d.player.cls, d.player.sex, d.seed, { options: d.options });
  g.turn = d.turn;
  g.player = d.player;
  for (const t of Object.keys(g.bonuses ? {} : {})) void t;
  g.level = unpackLevel(d.level);
  g.options = normalizeOptions(d.options);
  g.lore = d.lore || {};
  g.artifactsSeen = d.artifactsSeen || [];
  g.egosKnown = d.egosKnown || [];
  g.savedLevels = {};
  for (const [k, v] of Object.entries(d.savedLevels || {})) g.savedLevels[Number(k)] = unpackLevel(v as { tiles: string; flags: string; aux: string });
  // Older saves lack the newer timed effects.
  for (const t of ['stoneskin', 'regen', 'bold', 'terror', 'bloodlust', 'oppose_conf'] as const) if (g.player.timed[t] === undefined) g.player.timed[t] = 0;
  g.stores = d.stores;
  g.flavors = d.flavors;
  g.msg = new MessageLog();
  g.msg.list = d.msg.list || [];
  g.nextMonsterId = d.nextMonsterId;
  g.uniquesDead = d.uniquesDead || [];
  g.totalWinner = !!d.totalWinner;
  g.stats = d.stats;
  g.flow = null; g.flowDirty = true; g.fx.length = 0; g.levelChange = null; g.inStore = -1;
  setNextItemId(d.nextItemId);
  setArtifactsMade(d.artifacts || []);
  rng.seed(d.rng);
  g.bonuses = computeBonuses(g.player);
  refreshBonuses(g);
  return g;
}
