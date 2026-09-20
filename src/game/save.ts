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
import { normalizeIgnore } from './ignore.ts';

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
    v: 3, seed: g.seed, turn: g.turn, player: { ...g.player, vx: undefined, vy: undefined }, level: packLevel(g.level), stores: g.stores, flavors: g.flavors, msg: g.msg.toJSON(),
    nextMonsterId: g.nextMonsterId, uniquesDead: g.uniquesDead, totalWinner: g.totalWinner, stats: g.stats, nextItemId: getNextItemId(), artifacts: artifactsMadeList(), rng: rng.state,
    options: g.options, lore: g.lore, monsterKnows: g.monsterKnows, artifactsSeen: g.artifactsSeen, egosKnown: g.egosKnown, savedLevels, ignore: g.ignore,
    // The scent trail is history the level does not otherwise record. Flow and noise are rebuilt
    // from the hero's position, but a trail can only be remembered, and a tracker that finds a cold
    // floor after a restore where the live game had a trail takes a different step. That broke the
    // promise that a save changes nothing, so the trail rides along.
    scent: g.scent && g.scent.length === g.level.w * g.level.h ? b64(new Uint8Array(g.scent.buffer, g.scent.byteOffset, g.scent.byteLength)) : null, scentStamp: g.scentStamp,
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Game {
  const d = JSON.parse(json);
  if (d.v !== 1 && d.v !== 2 && d.v !== 3) throw new Error('unsupported save version');
  // Build a skeleton game through createGame so every runtime hook exists, then overwrite it.
  const g = createGame(d.player.name, d.player.race, d.player.cls, d.player.sex, d.seed, { options: d.options });
  g.turn = d.turn;
  g.player = d.player;
  for (const t of Object.keys(g.bonuses ? {} : {})) void t;
  g.level = unpackLevel(d.level);
  g.options = normalizeOptions(d.options);
  g.lore = d.lore || {};
  g.monsterKnows = d.monsterKnows || {};
  g.attacker = null;
  g.artifactsSeen = d.artifactsSeen || [];
  g.egosKnown = d.egosKnown || [];
  g.ignore = normalizeIgnore(d.ignore);
  g.showIgnored = false;
  g.savedLevels = {};
  for (const [k, v] of Object.entries(d.savedLevels || {})) g.savedLevels[Number(k)] = unpackLevel(v as { tiles: string; flags: string; aux: string });
  // Older saves lack the newer timed effects.
  for (const t of ['stoneskin', 'regen', 'bold', 'terror', 'bloodlust', 'oppose_conf'] as const) if (g.player.timed[t] === undefined) g.player.timed[t] = 0;
  g.stores = d.stores;
  g.flavors = d.flavors;
  g.msg = new MessageLog();
  g.msg.list = d.msg.list || [];
  g.msg.turn = d.msg.turn ?? g.turn;
  g.nextMonsterId = d.nextMonsterId;
  g.uniquesDead = d.uniquesDead || [];
  g.totalWinner = !!d.totalWinner;
  g.stats = d.stats;
  g.flow = null; g.flowDirty = true; g.noise = null; g.scent = null; g.scentStamp = 0; g.fx.length = 0; g.sounds.length = 0; g.levelChange = null; g.inStore = -1;
  // Older saves carry no trail; ensureScent starts a fresh one on the first turn.
  if (typeof d.scent === 'string') {
    const u8 = unb64(d.scent);
    if (u8.byteLength === g.level.w * g.level.h * 2) { g.scent = new Uint16Array(u8.buffer, u8.byteOffset, g.level.w * g.level.h); g.scentStamp = d.scentStamp | 0; }
  }
  setNextItemId(d.nextItemId);
  setArtifactsMade(d.artifacts || []);
  rng.seed(d.rng);
  g.bonuses = computeBonuses(g.player);
  refreshBonuses(g);
  return g;
}
