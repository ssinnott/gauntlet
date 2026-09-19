// The Gauntlet-style side panel and message bar: big health number, gold, keys, level, depth,
// stats, status effects, and the shouted banner across the map.
import { VIEW_W, VIEW_H, PANEL_W, BAR_H, MAP_X, MAP_Y, MAP_W, MAP_H } from '../constants.ts';
import { drawText, drawTextOutlined, measureText } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';
import type { Game } from '../game/state.ts';
import { statText, title, expToLevel, totalAc } from '../game/player.ts';
import { foodState } from '../game/game.ts';
import { CLASS_BY_ID } from '../game/data/classes.ts';
import { RACE_BY_ID } from '../game/data/races.ts';
import { kindOf, itemName } from '../game/items.ts';
import { drawItemIcon } from './sprites.ts';
import { STATS } from '../game/types.ts';
import { newSpellCount } from '../game/commands.ts';

export const PANEL_X = VIEW_W - PANEL_W;
const PANEL_BG = '#14121c';
const PANEL_EDGE = '#3a3450';
const TEXT = '#e8e4d8';
const DIM = '#8a869a';
const GOLD = '#ffd040';

const TIMED_BADGES: [string, string, string][] = [
  ['fast', 'HASTE', '#a0ffa0'], ['slow', 'SLOW', '#ff8080'], ['blind', 'BLIND', '#ff8080'], ['paralyzed', 'PARALYSED', '#ff4040'], ['confused', 'CONFUSED', '#e0a0ff'],
  ['afraid', 'AFRAID', '#ffd040'], ['image', 'HALLUC', '#ff80ff'], ['poisoned', 'POISONED', '#60e060'], ['cut', 'BLEEDING', '#ff6060'], ['stun', 'STUNNED', '#c0c0ff'],
  ['protevil', 'PROT EVIL', '#a0ffa0'], ['invuln', 'INVULN', '#ffe080'], ['hero', 'HERO', '#a0ffa0'], ['shero', 'BERSERK', '#ff8080'], ['shield', 'SHIELD', '#a0c0ff'],
  ['blessed', 'BLESSED', '#fff0a0'], ['sinvis', 'SEE INV', '#c0c0ff'], ['telepathy', 'ESP', '#ff80ff'], ['oppose_fire', 'RFIRE', '#ff8040'], ['oppose_cold', 'RCOLD', '#a0e0ff'],
  ['oppose_acid', 'RACID', '#a0ff60'], ['oppose_elec', 'RELEC', '#80c0ff'], ['oppose_pois', 'RPOIS', '#60e060'], ['recall', 'RECALL', '#ffd040'], ['deep_descent', 'DESCENT', '#ffd040'],
  ['stoneskin', 'STONESKIN', '#c0c0a0'], ['regen', 'REGEN', '#a0ffa0'], ['bold', 'BOLD', '#ffe080'], ['terror', 'TERROR', '#ff8080'], ['bloodlust', 'BLOODLUST', '#ff4040'], ['oppose_conf', 'RCONF', '#e0a0ff'],
];

export function drawHud(ctx: CanvasRenderingContext2D, g: Game, frame: number): void {
  const p = g.player, b = g.bonuses;
  const c = CLASS_BY_ID[p.cls], r = RACE_BY_ID[p.race];
  // Panel background.
  ctx.fillStyle = PANEL_BG; ctx.fillRect(PANEL_X, 0, PANEL_W, VIEW_H);
  ctx.fillStyle = PANEL_EDGE; ctx.fillRect(PANEL_X, 0, 2, VIEW_H);
  let y = 10;
  const x = PANEL_X + 12;
  const w = PANEL_W - 24;
  // Name and class.
  drawText(ctx, p.name.toUpperCase(), x, y, { size: 2, color: c.palette.primary === '#3a3a48' ? '#c0c0d0' : c.palette.primary }); y += 20;
  drawText(ctx, `${r.name} ${c.name}`, x, y, { size: 1, color: TEXT }); y += 10;
  drawText(ctx, `${title(p)}  (${c.hero})`, x, y, { size: 1, color: DIM }); y += 16;
  // HEALTH, Gauntlet style.
  const pct = p.mhp ? p.chp / p.mhp : 0;
  const hpCol = pct > 0.6 ? '#40e060' : pct > 0.3 ? '#ffd040' : '#ff4040';
  drawText(ctx, 'HEALTH', x, y, { size: 1, color: DIM });
  const blink = pct <= 0.25 && (frame >> 4) % 2 === 0;
  drawText(ctx, String(Math.max(0, p.chp)), x + w, y - 4, { size: 3, color: blink ? '#ffffff' : hpCol, align: 'right' }); y += 20;
  bar(ctx, x, y, w, 6, pct, hpCol); y += 10;
  if (p.msp > 0) { drawText(ctx, 'MANA', x, y, { size: 1, color: DIM }); drawText(ctx, `${p.csp}/${p.msp}`, x + w, y, { size: 1, color: '#80a0ff', align: 'right' }); y += 10; bar(ctx, x, y, w, 4, p.csp / p.msp, '#5070ff'); y += 8; }
  y += 4;
  // Level / exp.
  drawText(ctx, `LEVEL ${p.lev}`, x, y, { size: 1, color: TEXT });
  const next = p.lev < 50 ? expToLevel(p, p.lev + 1) - p.exp : 0;
  drawText(ctx, p.lev < 50 ? `NEXT ${next}` : 'MAX', x + w, y, { size: 1, color: DIM, align: 'right' }); y += 10;
  const cur = expToLevel(p, p.lev), nxt = p.lev < 50 ? expToLevel(p, p.lev + 1) : cur + 1;
  bar(ctx, x, y, w, 3, Math.max(0, Math.min(1, (p.exp - cur) / Math.max(1, nxt - cur))), '#c080ff'); y += 8;
  if (p.exp < p.maxExp) { drawText(ctx, 'EXP DRAINED', x, y, { size: 1, color: '#ff8080' }); y += 10; }
  // Gold and keys.
  drawItemIcon(ctx, 'gold', x + 6, y + 5, GOLD, 0.8);
  drawText(ctx, String(p.gold), x + 16, y, { size: 2, color: GOLD }); y += 18;
  drawItemIcon(ctx, 'key', x + 6, y + 5, '#ffe080', 0.7);
  drawText(ctx, `KEYS ${p.keys}`, x + 16, y + 1, { size: 1, color: '#ffe080' });
  drawText(ctx, `AC ${totalAc(b)}`, x + w, y + 1, { size: 1, color: TEXT, align: 'right' }); y += 14;
  // Depth.
  const depthTxt = p.depth === 0 ? 'TOWN' : `DUNGEON ${p.depth}  ${p.depth * 50} FT`;
  drawText(ctx, depthTxt, x, y, { size: 1, color: '#a0a0ff' }); y += 10;
  const spd = b.speed;
  if (spd !== 0) { drawText(ctx, spd > 0 ? `FAST (+${spd})` : `SLOW (${spd})`, x, y, { size: 1, color: spd > 0 ? '#a0ffa0' : '#ff8080' }); y += 10; }
  y += 4;
  // Stats.
  for (const s of STATS) {
    const v = b.stat[s], base = p.statCur[s];
    const col = p.statCur[s] < p.statBase[s] ? '#ffd040' : v > base ? '#a0ffa0' : TEXT;
    drawText(ctx, s, x, y, { size: 1, color: DIM });
    drawText(ctx, statText(v), x + 60, y, { size: 1, color: col });
    y += 9;
  }
  y += 4;
  // Equipment summary.
  const wpn = p.equip.weapon, bow = p.equip.bow, light = p.equip.light;
  drawText(ctx, wpn ? shorten(itemName(wpn, g.flavors, { article: false, plainKind: true }), 30) : 'BARE HANDS', x, y, { size: 1, color: TEXT }); y += 9;
  if (wpn) { const d = kindOf(wpn).dice || [0, 0]; drawText(ctx, `${d[0]}D${d[1]} X${b.blows}  ${wpn.known ? fmt(wpn.toHit) + ',' + fmt(wpn.toDam) : '?'}`, x, y, { size: 1, color: DIM }); y += 9; }
  if (bow) { drawText(ctx, shorten(itemName(bow, g.flavors, { article: false, plainKind: true }), 30) + (p.quiver.length ? ` (${p.quiver.reduce((a, q) => a + q.number, 0)})` : ' (NO AMMO)'), x, y, { size: 1, color: TEXT }); y += 9; }
  if (light) { const lk = kindOf(light); drawText(ctx, `${lk.name.toUpperCase()}${light.timeout > 0 ? ' ' + light.timeout : lk.flags?.includes('NO_FUEL') ? '' : ' (OUT)'}`, x, y, { size: 1, color: light.timeout > 0 || lk.flags?.includes('NO_FUEL') ? '#ffc060' : '#ff6060' }); y += 9; }
  else { drawText(ctx, 'NO LIGHT', x, y, { size: 1, color: '#ff6060' }); y += 9; }
  y += 4;
  // Food and statuses.
  const fs = foodState(p.food);
  drawText(ctx, fs.toUpperCase(), x, y, { size: 1, color: fs === 'Weak' || fs === 'Faint' ? '#ff4040' : fs === 'Hungry' ? '#ffd040' : DIM }); y += 10;
  let bx = x, by = y;
  for (const [key, label, col] of TIMED_BADGES) {
    if (!p.timed[key as keyof typeof p.timed]) continue;
    const bw = measureText(label, 1) + 6;
    if (bx + bw > x + w) { bx = x; by += 11; }
    rrect(ctx, bx, by - 1, bw, 9, 2, col + '33', col, 1);
    drawText(ctx, label, bx + 3, by, { size: 1, color: col, shadow: false });
    bx += bw + 3;
  }
  y = by + 14;
  if (p.searching) { drawText(ctx, 'SEARCHING', x, y, { size: 1, color: '#c0c0ff' }); y += 10; }
  if (g.resting) { drawText(ctx, 'RESTING', x, y, { size: 1, color: '#c0c0ff' }); y += 10; }
  if (newSpellCount(g) > 0) { drawText(ctx, 'STUDY! (G)', x, y, { size: 1, color: '#a0ffa0' }); y += 10; }
  // Bottom hints.
  drawText(ctx, '? HELP   I INVEN   C SHEET', x, VIEW_H - 22, { size: 1, color: DIM });
  drawText(ctx, `TURN ${Math.floor(g.turn / 10)}`, x, VIEW_H - 12, { size: 1, color: DIM });
}
function fmt(v: number): string { return (v >= 0 ? '+' : '') + v; }
function shorten(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '.' : s; }
function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pct: number, col: string): void {
  ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#2a2838'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, pct))), h);
}

/** The message bar above the map: the freshest messages, newest last. */
export function drawMessageBar(ctx: CanvasRenderingContext2D, g: Game): void {
  ctx.fillStyle = '#0e0d14'; ctx.fillRect(MAP_X, 0, MAP_W, BAR_H);
  ctx.fillStyle = PANEL_EDGE; ctx.fillRect(MAP_X, BAR_H - 1, MAP_W, 1);
  const list = g.msg.list.slice(-3);
  let y = 3;
  for (const m of list) {
    const t = m.count > 1 ? `${m.text} (X${m.count})` : m.text;
    drawText(ctx, t.length > 118 ? t.slice(0, 117) + '.' : t, 8, y, { size: 1, color: m === list[list.length - 1] ? m.color : mixDim(m.color) });
    y += 11;
  }
}
function mixDim(c: string): string { return c === '#e8e4d8' ? '#9a968c' : c + 'aa'; }

/** The shouted banner: a big outlined line across the map that fades. */
export function drawBanner(ctx: CanvasRenderingContext2D, g: Game): void {
  const b = g.msg.banner;
  if (!b) return;
  b.ttl--;
  if (b.ttl <= 0) { g.msg.banner = null; return; }
  const alpha = Math.min(1, b.ttl / 30);
  ctx.save(); ctx.globalAlpha = alpha;
  const y = MAP_Y + 40;
  const w = measureText(b.text, 3) + 32;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(MAP_X + MAP_W / 2 - w / 2, y - 8, w, 38);
  drawTextOutlined(ctx, b.text, MAP_X + MAP_W / 2, y, { size: 3, color: b.color, align: 'center', outline: '#120c14', thickness: 2 });
  ctx.restore();
}
export const _keep = [MAP_H];
