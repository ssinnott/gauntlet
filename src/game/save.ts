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

export function serialize(g: Game): string {
  const lv = g.level;
  const level = { ...lv, tiles: b64(lv.tiles), flags: b64(lv.flags), aux: b64(lv.aux), monsters: lv.monsters.map(m => ({ ...m, vx: undefined, vy: undefined, hitFlash: undefined, attackAnim: undefined })) };
  const data = {
    v: 1, seed: g.seed, turn: g.turn, player: { ...g.player, vx: undefined, vy: undefined }, level, stores: g.stores, flavors: g.flavors, msg: g.msg.toJSON(),
    nextMonsterId: g.nextMonsterId, uniquesDead: g.uniquesDead, totalWinner: g.totalWinner, stats: g.stats, nextItemId: getNextItemId(), artifacts: artifactsMadeList(), rng: rng.state,
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Game {
  const d = JSON.parse(json);
  if (d.v !== 1) throw new Error('unsupported save version');
  // Build a skeleton game through createGame so every runtime hook exists, then overwrite it.
  const g = createGame(d.player.name, d.player.race, d.player.cls, d.player.sex, d.seed);
  g.turn = d.turn;
  g.player = d.player;
  const lv: Level = { ...d.level, tiles: unb64(d.level.tiles), flags: unb64(d.level.flags), aux: unb64(d.level.aux) };
  g.level = lv;
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
