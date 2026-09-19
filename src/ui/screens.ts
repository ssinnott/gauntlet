// Overlay screens: menus, prompts, the inventory, stores, spell books, the character sheet, the
// level map, help, the message log, look/target mode, and the title / birth / death screens.
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H, TILE } from '../constants.ts';
import { drawText, drawTextOutlined, measureText } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';
import type { Game } from '../game/state.ts';
import { type Item, type SlotName, type Pos, SLOTS, SLOT_LABEL, STATS, T, F, isWall, isShop, STORE_NAMES } from '../game/types.ts';
import { kindOf, itemName, itemFlags, isKnown, isAware, itemIcon, isWearable, isWeapon, isArmor, isAmmo, tvalLabel, inscriptionTags, inscriptionConfirms } from '../game/items.ts';
import { statText, title, expToLevel, totalAc, meleeSkill, bowSkill } from '../game/player.ts';
import { RACES, RACE_BY_ID } from '../game/data/races.ts';
import { CLASSES, CLASS_BY_ID } from '../game/data/classes.ts';
import { spellsAvailable, spellLevel, spellMana, spellFail, newSpellCount, describeGrid, classSpells, knownBooks } from '../game/commands.ts';
import { buyPrice, sellPrice, storeWants, storeBuy, storeSell, maintainStore } from '../game/stores.ts';
import { addToInventory, removeFromInventory, sortInventory } from '../game/commands.ts';
import { tileAt, flagAt, monsterAt, itemsAt, playerCanSee } from '../game/level.ts';
import { raceOf, hasMFlag } from '../game/monster.ts';
import { nearestVisibleMonster } from '../game/projection.ts';
import { score, foodState } from '../game/game.ts';
import { drawItemIcon, drawMonsterSprite } from './sprites.ts';
import type { KeyEvent } from './input.ts';
import { dirOfKey } from './input.ts';
import { refreshBonuses } from '../game/effectsCore.ts';
import { SPELL_BY_ID } from '../game/data/spells.ts';
import { distance } from '../game/util.ts';
import { createPlayer } from '../game/player.ts';
import { makeItem } from '../game/items.ts';
import { buildHero, drawHero, type HeroSprite } from './hero.ts';
import { BirthScreen2, HighScoresOverlay, RecallOverlay, SaveSlotsOverlay, type Ui2 } from './screens2.ts';
import { chestTrapName, realmWords } from '../game/commands.ts';
import { wrapText } from '../game/recall.ts';
import { characterDump } from '../game/dump.ts';

export interface Ui {
  g: Game;
  push(o: Overlay): void;
  pop(): void;
  afterAction(): void;
  newGame(name: string, race: string, cls: string, sex: 'male' | 'female'): void;
  loadGame(): boolean;
  hasSave(): boolean;
  quitToTitle(): void;
  cursor: Pos | null;
  frame: number;
  /** Persistent target for aimed commands. */
  target: Pos | null;
}
export interface Overlay {
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void;
  key(e: KeyEvent, ui: Ui): boolean;
  click?(x: number, y: number, ui: Ui): boolean;
  /** Draw the map beneath (default true). */
  opaque?: boolean;
}

const BG = '#14121c', EDGE = '#5a5470', TEXT = '#e8e4d8', DIM = '#8a869a', HI = '#ffe060', GOLD = '#ffd040';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, titleText?: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  rrect(ctx, x, y, w, h, 4, BG, EDGE, 2);
  if (titleText) { drawText(ctx, titleText, x + w / 2, y + 8, { size: 2, color: HI, align: 'center' }); }
}

// ---------------------------------------------------------------------------------------------
// Generic menu

export interface MenuLine { text: string; color?: string; value?: unknown; disabled?: boolean; right?: string; icon?: string; iconColor?: string; }
export class Menu implements Overlay {
  sel = 0; scroll = 0;
  constructor(public titleText: string, public lines: MenuLine[], public onPick: (line: MenuLine, index: number, ui: Ui) => void, public opts: { onCancel?: (ui: Ui) => void; letters?: boolean; width?: number; footer?: string; multiKey?: (e: KeyEvent, line: MenuLine, ui: Ui) => boolean } = {}) {
    while (this.sel < lines.length && lines[this.sel].disabled) this.sel++;
    if (this.sel >= lines.length) this.sel = 0;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const w = this.opts.width || 520, rows = Math.min(this.lines.length, 22);
    const h = 40 + rows * 12 + (this.opts.footer ? 16 : 0) + 12;
    const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
    box(ctx, x, y, w, h, this.titleText);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    for (let i = 0; i < rows; i++) {
      const li = i + this.scroll;
      if (li >= this.lines.length) break;
      const l = this.lines[li];
      const ly = y + 34 + i * 12;
      if (li === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 11); }
      const letter = this.opts.letters === false ? '' : LETTERS[li] + ') ';
      let tx = x + 12;
      if (l.icon) { drawItemIcon(ctx, l.icon, tx + 6, ly + 3, l.iconColor || TEXT, 0.6); tx += 14; }
      drawText(ctx, letter + l.text, tx, ly, { size: 1, color: l.disabled ? '#5a5666' : l.color || TEXT });
      if (l.right) drawText(ctx, l.right, x + w - 12, ly, { size: 1, color: l.disabled ? '#5a5666' : DIM, align: 'right' });
    }
    if (this.lines.length > rows) drawText(ctx, `${this.scroll + 1}-${Math.min(this.lines.length, this.scroll + rows)} OF ${this.lines.length}`, x + w - 12, y + 10, { size: 1, color: DIM, align: 'right' });
    if (this.opts.footer) drawText(ctx, this.opts.footer, x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'Escape' || (e.key === 'q' && this.opts.letters === false)) { ui.pop(); this.opts.onCancel?.(ui); return true; }
    if (e.key === 'ArrowDown' || e.key === 'j' && this.opts.letters === false) { this.move(1); return true; }
    if (e.key === 'ArrowUp' || e.key === 'k' && this.opts.letters === false) { this.move(-1); return true; }
    if (e.key === 'PageDown') { this.move(10); return true; }
    if (e.key === 'PageUp') { this.move(-10); return true; }
    if (e.key === 'Enter' || e.key === ' ') { const l = this.lines[this.sel]; if (l && !l.disabled) this.onPick(l, this.sel, ui); return true; }
    if (this.opts.multiKey && this.lines[this.sel] && this.opts.multiKey(e, this.lines[this.sel], ui)) return true;
    if (this.opts.letters !== false && e.key.length === 1) {
      const i = LETTERS.indexOf(e.key.toLowerCase());
      if (i >= 0 && i < this.lines.length && !this.lines[i].disabled) { this.sel = i; this.onPick(this.lines[i], i, ui); return true; }
    }
    return true;
  }
  move(d: number): void {
    if (!this.lines.length) return;
    let s = this.sel;
    for (let i = 0; i < this.lines.length; i++) { s = (s + d + this.lines.length) % this.lines.length; if (!this.lines[s].disabled) break; if (Math.abs(d) > 1) d = Math.sign(d); }
    this.sel = s;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const w = this.opts.width || 520, rows = Math.min(this.lines.length, 22);
    const h = 40 + rows * 12 + (this.opts.footer ? 16 : 0) + 12;
    const bx = Math.round((VIEW_W - w) / 2), by = Math.round((VIEW_H - h) / 2);
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); this.opts.onCancel?.(ui); return true; }
    const i = Math.floor((y - by - 32) / 12) + this.scroll;
    if (i >= 0 && i < this.lines.length && !this.lines[i].disabled) { this.sel = i; this.onPick(this.lines[i], i, ui); }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Item picking

export type ItemWhere = 'inven' | 'equip' | 'floor' | 'quiver';
export function itemLine(g: Game, it: Item, where: ItemWhere, slot?: SlotName): MenuLine {
  const k = kindOf(it);
  const known = isKnown(it, g.flavors);
  const col = it.cursed && known ? '#ff8080' : it.artifact ? '#ffd040' : it.ego && known ? '#a0ffa0' : k.tval === 'gold' ? GOLD : TEXT;
  const name = itemName(it, g.flavors);
  const w = kindOf(it).weight * it.number / 10;
  return { text: (slot ? SLOT_LABEL[slot].padEnd(14) + ' ' : '') + name, color: col, value: it, right: `${w.toFixed(1)} LB`, icon: itemIcon(k), iconColor: k.color };
}
/**
 * Pick an item from the pack, quiver, equipment or floor. `cmd` is the command letter for Angband's
 * command inscriptions: at the quaff prompt (`cmd` = 'q') pressing 1 takes the item inscribed `@q1`.
 */
export function pickItem(ui: Ui, prompt: string, filter: (it: Item) => boolean, wheres: ItemWhere[], onPick: (it: Item, where: ItemWhere) => void, onCancel?: () => void, cmd?: string): void {
  const g = ui.g, p = g.player;
  const lines: MenuLine[] = [];
  const meta: { it: Item; where: ItemWhere }[] = [];
  const add = (it: Item, where: ItemWhere, slot?: SlotName) => { if (!filter(it)) return; lines.push(itemLine(g, it, where, slot)); meta.push({ it, where }); };
  if (wheres.includes('inven')) for (const it of p.inven) add(it, 'inven');
  if (wheres.includes('quiver')) for (const it of p.quiver) add(it, 'quiver');
  if (wheres.includes('equip')) for (const s of SLOTS) { const it = p.equip[s]; if (it) add(it, 'equip', s); }
  if (wheres.includes('floor')) for (const fi of itemsAt(g.level, p.x, p.y)) add(fi.item, 'floor');
  if (!lines.length) { g.msg.add('You have nothing suitable.'); onCancel?.(); return; }
  const multiKey = cmd ? (e: KeyEvent, _l: MenuLine, u: Ui): boolean => {
    if (!/^[0-9]$/.test(e.key)) return false;
    const i = meta.findIndex(m => inscriptionTags(m.it, cmd).includes(e.key));
    if (i < 0) return false;
    u.pop(); onPick(meta[i].it, meta[i].where); return true;
  } : undefined;
  ui.push(new Menu(prompt, lines, (l, i, u) => { u.pop(); onPick(meta[i].it, meta[i].where); }, { onCancel: () => onCancel?.(), width: 560, multiKey }));
}

// ---------------------------------------------------------------------------------------------
// Direction / target prompt

export class DirPrompt implements Overlay {
  constructor(public prompt: string, public onDir: (dir: number, target: Pos | null) => void, public allowTarget = true) {}
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const t = ui.target;
    const txt = `${this.prompt}  DIRECTION? ${this.allowTarget ? (t ? '(T OR 5 = TARGET, * NEXT)' : '(\' OR T = NEAREST)') : ''}  ESC CANCELS`;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, 16);
    drawText(ctx, txt, MAP_X + 8, MAP_Y + 4, { size: 1, color: HI });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'Escape') { ui.pop(); return true; }
    const d = dirOfKey(e);
    if (d === 5 || e.key === 't' || e.key === "'" || e.key === '5' || e.key === 'Enter') {
      if (!this.allowTarget) return true;
      const m = nearestVisibleMonster(ui.g);
      const tgt = ui.target && validTarget(ui) ? ui.target : m ? { x: m.x, y: m.y } : null;
      if (!tgt) { ui.g.msg.add('No target.'); return true; }
      ui.target = tgt; ui.pop(); this.onDir(5, tgt); return true;
    }
    if (e.key === '*') { cycleTarget(ui); return true; }
    if (d) { ui.pop(); this.onDir(d, null); return true; }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const r = (ui as unknown as { renderer: { screenToTile(x: number, y: number): Pos } }).renderer;
    const t = r.screenToTile(x, y);
    if (x < MAP_X + MAP_W && y >= MAP_Y) { ui.target = t; ui.pop(); this.onDir(5, t); }
    return true;
  }
}
function validTarget(ui: Ui): boolean {
  const t = ui.target; if (!t) return false;
  const m = monsterAt(ui.g.level, t.x, t.y);
  return !!m && m.visible && playerCanSee(ui.g.level, t.x, t.y);
}
function cycleTarget(ui: Ui): void {
  const g = ui.g, p = g.player;
  const list = g.level.monsters.filter(m => m.visible && playerCanSee(g.level, m.x, m.y) && distance(p.x, p.y, m.x, m.y) <= 20).sort((a, b) => distance(p.x, p.y, a.x, a.y) - distance(p.x, p.y, b.x, b.y));
  if (!list.length) return;
  const cur = ui.target ? list.findIndex(m => m.x === ui.target!.x && m.y === ui.target!.y) : -1;
  const m = list[(cur + 1) % list.length];
  ui.target = { x: m.x, y: m.y };
}

export class QuantityPrompt implements Overlay {
  value: string;
  /** The initial value is replaced by the first typed digit. */
  fresh = true;
  constructor(public prompt: string, public max: number, public onQty: (n: number) => void, initial = 1) { this.value = String(Math.min(initial, max)); }
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, 16);
    drawText(ctx, `${this.prompt} (1-${this.max}): ${this.value}_`, MAP_X + 8, MAP_Y + 4, { size: 1, color: HI });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'Escape') { ui.pop(); return true; }
    if (e.key === 'Enter') { const n = Math.max(1, Math.min(this.max, Number(this.value) || 1)); ui.pop(); this.onQty(n); return true; }
    if (e.key === 'Backspace') { this.value = this.value.slice(0, -1); return true; }
    if (/^[0-9]$/.test(e.key) && this.value.length < 3) { this.value = this.fresh ? e.key : this.value + e.key; this.fresh = false; return true; }
    if (e.key === '*' || e.key === 'a') { this.value = String(this.max); return true; }
    return true;
  }
}
export class TextPrompt implements Overlay {
  constructor(public prompt: string, public value: string, public onDone: (s: string) => void, public maxLen = 16) {}
  draw(ctx: CanvasRenderingContext2D): void {
    box(ctx, VIEW_W / 2 - 200, VIEW_H / 2 - 30, 400, 60);
    drawText(ctx, this.prompt, VIEW_W / 2, VIEW_H / 2 - 20, { size: 1, color: DIM, align: 'center' });
    drawText(ctx, this.value + '_', VIEW_W / 2, VIEW_H / 2 - 2, { size: 2, color: HI, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'Escape') { ui.pop(); return true; }
    if (e.key === 'Enter') { ui.pop(); this.onDone(this.value.trim()); return true; }
    if (e.key === 'Backspace') { this.value = this.value.slice(0, -1); return true; }
    if (e.key.length === 1 && this.value.length < this.maxLen && /[a-zA-Z0-9 '\-]/.test(e.key)) this.value += e.key;
    return true;
  }
}
export class Confirm implements Overlay {
  constructor(public prompt: string, public onYes: () => void) {}
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, 16);
    drawText(ctx, `${this.prompt} [Y/N]`, MAP_X + 8, MAP_Y + 4, { size: 1, color: HI });
  }
  key(e: KeyEvent, ui: Ui): boolean { ui.pop(); if (e.key === 'y' || e.key === 'Y') this.onYes(); return true; }
}

// ---------------------------------------------------------------------------------------------
// Inventory and equipment

export class InventoryScreen implements Overlay {
  tab: 'inven' | 'equip' = 'inven';
  sel = 0;
  constructor(public onAction: (it: Item, where: ItemWhere, action: string) => void, tab: 'inven' | 'equip' = 'inven') { this.tab = tab; }
  private lines(g: Game): { it: Item; where: ItemWhere; slot?: SlotName }[] {
    const p = g.player;
    if (this.tab === 'equip') return SLOTS.filter(s => p.equip[s]).map(s => ({ it: p.equip[s]!, where: 'equip' as const, slot: s }));
    return [...p.inven.map(it => ({ it, where: 'inven' as const })), ...p.quiver.map(it => ({ it, where: 'quiver' as const }))];
  }
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, p = g.player, b = g.bonuses;
    const w = 640, h = 380, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h);
    drawText(ctx, 'INVENTORY', x + 90, y + 8, { size: 2, color: this.tab === 'inven' ? HI : DIM, align: 'center' });
    drawText(ctx, 'EQUIPMENT', x + 260, y + 8, { size: 2, color: this.tab === 'equip' ? HI : DIM, align: 'center' });
    drawText(ctx, `${(b.weight / 10).toFixed(1)}/${(b.weightLimit / 10).toFixed(0)} LB   ${p.inven.length}/23 SLOTS`, x + w - 12, y + 12, { size: 1, color: b.weight > b.weightLimit ? '#ff8080' : DIM, align: 'right' });
    const lines = this.lines(g);
    if (this.sel >= lines.length) this.sel = Math.max(0, lines.length - 1);
    for (let i = 0; i < lines.length && i < 26; i++) {
      const l = lines[i], ly = y + 34 + i * 12;
      const ml = itemLine(g, l.it, l.where, l.slot);
      if (i === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 11); }
      drawItemIcon(ctx, ml.icon || 'junk', x + 18, ly + 3, ml.iconColor || TEXT, 0.6);
      drawText(ctx, LETTERS[i] + ') ' + ml.text, x + 28, ly, { size: 1, color: ml.color });
      drawText(ctx, ml.right || '', x + w - 12, ly, { size: 1, color: DIM, align: 'right' });
    }
    if (!lines.length) drawText(ctx, this.tab === 'inven' ? 'YOUR PACK IS EMPTY' : 'YOU ARE WEARING NOTHING', x + w / 2, y + 60, { size: 1, color: DIM, align: 'center' });
    // Detail of the selected item.
    const cur = lines[this.sel];
    if (cur) {
      const dy = y + h - 60;
      ctx.fillStyle = EDGE; ctx.fillRect(x + 8, dy - 6, w - 16, 1);
      drawText(ctx, describeItem(g, cur.it), x + 12, dy, { size: 1, color: '#c0c0d0' });
    }
    drawText(ctx, 'TAB SWITCH   ENTER ACTIONS   W WIELD   T TAKE OFF   D DROP   Q QUAFF   R READ   E EAT   ESC CLOSE', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const g = ui.g;
    const lines = this.lines(g);
    if (e.key === 'Escape' || e.key === 'i' && this.tab === 'inven' || e.key === 'e' && this.tab === 'equip') { ui.pop(); return true; }
    if (e.key === 'Tab' || e.key === 'e' && this.tab === 'inven' || e.key === 'i' && this.tab === 'equip') { this.tab = this.tab === 'inven' ? 'equip' : 'inven'; this.sel = 0; return true; }
    if (e.key === 'ArrowDown') { if (lines.length) this.sel = (this.sel + 1) % lines.length; return true; }
    if (e.key === 'ArrowUp') { if (lines.length) this.sel = (this.sel - 1 + lines.length) % lines.length; return true; }
    const cur = lines[this.sel];
    if (e.key === 'Enter' || e.key === ' ') { if (cur) this.actions(ui, cur.it, cur.where); return true; }
    if (e.key.length === 1) {
      const li = LETTERS.indexOf(e.key.toLowerCase());
      if (li >= 0 && li < lines.length && !['w', 't', 'd', 'q', 'r', 'e', 'a', 'u', 'z', 'v', 'f', 'k', 'x', 'i'].includes(e.key)) { this.sel = li; this.actions(ui, lines[li].it, lines[li].where); return true; }
      if (cur) {
        const map: Record<string, string> = { w: 'wield', t: 'takeoff', d: 'drop', q: 'quaff', r: 'read', E: 'eat', a: 'aim', u: 'use', z: 'zap', v: 'throw', f: 'fire', k: 'destroy', x: 'inspect', A: 'activate', F: 'fuel', '{': 'inscribe' };
        const act = map[e.key];
        if (act) { ui.pop(); this.onAction(cur.it, cur.where, act); return true; }
      }
      const li2 = LETTERS.indexOf(e.key.toLowerCase());
      if (li2 >= 0 && li2 < lines.length) { this.sel = li2; this.actions(ui, lines[li2].it, lines[li2].where); return true; }
    }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const w = 640, h = 380, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); return true; }
    if (y < by + 30) { this.tab = x < bx + 175 ? 'inven' : 'equip'; this.sel = 0; return true; }
    const lines = this.lines(ui.g);
    const i = Math.floor((y - by - 32) / 12);
    if (i >= 0 && i < lines.length) { if (this.sel === i) this.actions(ui, lines[i].it, lines[i].where); else this.sel = i; }
    return true;
  }
  actions(ui: Ui, it: Item, where: ItemWhere): void {
    const k = kindOf(it);
    const acts: [string, string][] = [];
    if (where === 'equip') acts.push(['takeoff', 'Take off']);
    else if (isWearable(k) && !isAmmo(k)) acts.push(['wield', k.tval === 'ring' || k.tval === 'amulet' || isArmor(k) ? 'Put on / wear' : 'Wield']);
    if (k.tval === 'potion') acts.push(['quaff', 'Quaff']);
    if (k.tval === 'scroll') acts.push(['read', 'Read']);
    if (k.tval === 'food') acts.push(['eat', 'Eat']);
    if (k.tval === 'wand') acts.push(['aim', 'Aim']);
    if (k.tval === 'staff') acts.push(['use', 'Use']);
    if (k.tval === 'rod') acts.push(['zap', 'Zap']);
    if (isAmmo(k)) acts.push(['fire', 'Fire']);
    if (k.tval === 'magic_book' || k.tval === 'prayer_book') acts.push(['browse', 'Browse']);
    if ((k.flags || []).includes('ACTIVATE') || it.artifact) acts.push(['activate', 'Activate']);
    if (k.tval === 'flask' || k.tval === 'light' && ui.g.player.equip.light && kindOf(ui.g.player.equip.light).id === 'torch' && k.id === 'torch') acts.push(['fuel', 'Refuel light']);
    acts.push(['throw', 'Throw']);
    if (where !== 'equip') acts.push(['drop', 'Drop']);
    acts.push(['inspect', 'Inspect']);
    acts.push(['inscribe', 'Inscribe']);
    if (!it.artifact) acts.push(['ignore', ui.g.ignore.kinds.includes(it.kind) ? 'Stop ignoring these' : 'Ignore these from now on']);
    if (where !== 'equip') acts.push(['destroy', 'Destroy']);
    ui.push(new Menu(itemName(it, ui.g.flavors), acts.map(a => ({ text: a[1], value: a[0] })), (l, i, u) => { u.pop(); u.pop(); this.onAction(it, where, l.value as string); }, { width: 360, letters: true }));
  }
}

export function describeItem(g: Game, it: Item): string {
  const k = kindOf(it);
  const parts: string[] = [];
  if (k.desc && (isAware(g.flavors, it.kind))) parts.push(k.desc);
  if (k.tval === 'chest' && it.known) parts.push(it.toHit > 0 ? 'It is locked.' : it.toDam > 0 ? `It is trapped with ${chestTrapName(it)}.` : 'It is unlocked and safe.');
  if (isKnown(it, g.flavors)) {
    const f = [...itemFlags(it)].filter(x => !x.startsWith('IGNORE_') && x !== 'EASY_KNOW' && x !== 'SHOW_MODS');
    if (f.length) parts.push(f.map(x => x.replace(/_/g, ' ').toLowerCase()).join(', '));
    if (k.tval === 'light') parts.push(`Radius ${k.pval || 1} light.`);
    if (k.multiplier) parts.push(`Multiplier x${k.multiplier}.`);
  } else if (k.flavored && !isAware(g.flavors, it.kind)) parts.push('You do not know what this does.');
  else parts.push('Not fully identified.');
  parts.push(`${tvalLabel(k.tval).replace(/s$/, '')}, ${(k.weight * it.number / 10).toFixed(1)} lb, worth ${isKnown(it, g.flavors) ? k.cost : '?'} gold each.`);
  return parts.join('  ').slice(0, 140);
}

// ---------------------------------------------------------------------------------------------
// Store

export class StoreScreen implements Overlay {
  sel = 0; scroll = 0;
  constructor(public idx: number) {}
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, s = g.stores[this.idx], p = g.player;
    const w = 700, h = 420, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h);
    drawText(ctx, STORE_NAMES[s.type].toUpperCase(), x + w / 2, y + 8, { size: 2, color: HI, align: 'center' });
    drawText(ctx, s.type === 7 ? 'YOUR HOME' : `${s.owner.toUpperCase()}   (PURSE ${s.purse})`, x + w / 2, y + 26, { size: 1, color: DIM, align: 'center' });
    drawText(ctx, `GOLD ${p.gold}`, x + w - 12, y + 12, { size: 1, color: GOLD, align: 'right' });
    const rows = 24;
    if (this.sel >= s.stock.length) this.sel = Math.max(0, s.stock.length - 1);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    for (let i = 0; i < rows; i++) {
      const li = i + this.scroll; if (li >= s.stock.length) break;
      const it = s.stock[li], ly = y + 42 + i * 12;
      const ml = itemLine(g, it, 'inven');
      if (li === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 11); }
      drawItemIcon(ctx, ml.icon || 'junk', x + 18, ly + 3, ml.iconColor || TEXT, 0.6);
      drawText(ctx, LETTERS[li] + ') ' + ml.text, x + 28, ly, { size: 1, color: ml.color });
      const price = s.type === 7 ? '' : String(buyPrice(g, s, it));
      drawText(ctx, price, x + w - 12, ly, { size: 1, color: s.type !== 7 && buyPrice(g, s, it) > p.gold ? '#ff8080' : GOLD, align: 'right' });
      drawText(ctx, ml.right || '', x + w - 70, ly, { size: 1, color: DIM, align: 'right' });
    }
    if (!s.stock.length) drawText(ctx, 'NOTHING IN STOCK', x + w / 2, y + 80, { size: 1, color: DIM, align: 'center' });
    const cur = s.stock[this.sel];
    if (cur) drawText(ctx, describeItem(g, cur), x + 12, y + h - 40, { size: 1, color: '#c0c0d0' });
    drawText(ctx, s.type === 7 ? 'P/G GET   S/D DROP OFF   ESC LEAVE' : 'P/ENTER PURCHASE   S SELL   X EXAMINE   ESC LEAVE', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const g = ui.g, s = g.stores[this.idx], p = g.player;
    if (e.key === 'Escape') { ui.pop(); g.inStore = -1; return true; }
    if (e.key === 'ArrowDown') { if (s.stock.length) this.sel = (this.sel + 1) % s.stock.length; return true; }
    if (e.key === 'ArrowUp') { if (s.stock.length) this.sel = (this.sel - 1 + s.stock.length) % s.stock.length; return true; }
    if (e.key === 'p' || e.key === 'g' || e.key === 'Enter' || e.key === 'b') { const it = s.stock[this.sel]; if (it) this.buy(ui, it); return true; }
    if (e.key === 's' || e.key === 'd') {
      pickItem(ui, s.type === 7 ? 'Drop off which item?' : 'Sell which item?', it => storeWants(s, it) && kindOf(it).tval !== 'gold', ['inven', 'quiver'], (it) => {
        const price = sellPrice(g, s, it);
        if (s.type !== 7 && price <= 0) { g.msg.add(`${s.owner} has no interest in that.`); return; }
        const doSell = (n: number) => {
          const sold = removeFromInventory(g, it, n);
          const paid = storeSell(g, s, sold, n);
          g.msg.add(s.type === 7 ? `You leave ${itemName(sold, g.flavors)} at home.` : `You sold ${itemName(sold, g.flavors)} for ${paid} gold.`, GOLD);
          refreshBonuses(g);
        };
        const ask = () => { if (it.number > 1) ui.push(new QuantityPrompt(`${s.type === 7 ? 'Drop off' : 'Sell'} how many? (${price} each)`, it.number, doSell)); else doSell(1); };
        // An item inscribed {!s} or {!*} asks before it is sold.
        if (s.type !== 7 && inscriptionConfirms(it, 's')) ui.push(new Confirm(`Really sell ${itemName(it, g.flavors)}?`, ask)); else ask();
      }, undefined, s.type === 7 ? 'd' : 's');
      return true;
    }
    if (e.key === 'x') { const it = s.stock[this.sel]; if (it) g.msg.add(describeItem(g, it)); return true; }
    if (e.key.length === 1) { const i = LETTERS.indexOf(e.key); if (i >= 0 && i < s.stock.length) { this.sel = i; this.buy(ui, s.stock[i]); } }
    void p;
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const w = 700, h = 420, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); ui.g.inStore = -1; return true; }
    const i = Math.floor((y - by - 40) / 12) + this.scroll;
    const s = ui.g.stores[this.idx];
    if (i >= 0 && i < s.stock.length) { if (this.sel === i) this.buy(ui, s.stock[i]); else this.sel = i; }
    return true;
  }
  buy(ui: Ui, it: Item): void {
    const g = ui.g, s = g.stores[this.idx], p = g.player;
    const price = buyPrice(g, s, it);
    if (s.type !== 7 && price > p.gold) { g.msg.add('You do not have enough gold.', '#ff8080'); return; }
    const doBuy = (n: number) => {
      const bought = storeBuy(g, s, it, n);
      if (!bought) { g.msg.add('You cannot afford that.', '#ff8080'); return; }
      bought.id = Date.now() % 1000000 + Math.floor(Math.random() * 1000);
      if (!addToInventory(g, bought)) { g.msg.add('Your pack is full!', '#ff8080'); s.stock.unshift(bought); if (s.type !== 7) { p.gold += price * n; } return; }
      sortInventory(g);
      g.msg.add(s.type === 7 ? `You take ${itemName(bought, g.flavors)}.` : `You bought ${itemName(bought, g.flavors)} for ${price * n} gold.`, GOLD);
      refreshBonuses(g);
    };
    const maxN = s.type === 7 ? it.number : Math.min(it.number, Math.floor(p.gold / Math.max(1, price)));
    if (it.number > 1 && maxN > 1) ui.push(new QuantityPrompt(`Buy how many? (${price} each)`, maxN, doBuy)); else doBuy(1);
  }
}

// ---------------------------------------------------------------------------------------------
// Spells

export function spellMenu(ui: Ui, mode: 'cast' | 'browse' | 'study', onPick: (id: string) => void): void {
  const g = ui.g, p = g.player, c = CLASS_BY_ID[p.cls];
  if (!c.realm) { g.msg.add('You cannot cast spells!'); return; }
  const books = knownBooks(g);
  const [word, , bookWord] = realmWords(g);
  if (!books.length) { g.msg.add(`You have no ${bookWord}s.`); return; }
  const spells = mode === 'browse' ? classSpells(g).filter(s => books.some(b => b.kind === s.book)) : spellsAvailable(g);
  const lines: MenuLine[] = spells.map(s => {
    const lev = spellLevel(g, s), mana = spellMana(g, s), fail = spellFail(g, s);
    const learned = p.learned.includes(s.id);
    const canLearn = !learned && lev <= p.lev;
    const disabled = mode === 'cast' ? !learned || mana > p.csp : mode === 'study' ? !canLearn : false;
    const color = learned ? (p.cast.includes(s.id) ? TEXT : '#a0ffa0') : lev <= p.lev ? '#ffd040' : DIM;
    return { text: `${s.name.padEnd(24)} LV ${String(lev).padStart(2)}  MANA ${String(mana).padStart(2)}  FAIL ${String(fail).padStart(2)}%  ${learned ? '' : lev <= p.lev ? 'UNLEARNED' : ''}`, color, value: s.id, disabled, right: kindOf({ kind: s.book } as Item).name.replace(/[\[\]]/g, '').slice(0, 18) };
  });
  const titleText = mode === 'cast' ? (c.realm === 'prayer' ? 'RECITE WHICH PRAYER?' : `${realmWords(g)[1].toUpperCase()} WHICH ${word.toUpperCase()}?`) : mode === 'study' ? 'STUDY WHICH?' : 'YOUR BOOKS';
  ui.push(new Menu(titleText, lines, (l, i, u) => { u.pop(); if (mode !== 'browse') onPick(l.value as string); else g.msg.add(SPELL_BY_ID[l.value as string].desc); }, { width: 640, footer: mode === 'browse' ? 'ENTER DESCRIBES   ESC CLOSES' : `MANA ${p.csp}/${p.msp}   ${newSpellCount(g) ? 'YOU CAN LEARN ' + newSpellCount(g) + ' MORE' : ''}` }));
}

// ---------------------------------------------------------------------------------------------
// Character sheet

export class CharSheet implements Overlay {
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, p = g.player, b = g.bonuses, r = RACE_BY_ID[p.race], c = CLASS_BY_ID[p.cls];
    const w = 660, h = 400, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, `${p.name.toUpperCase()} THE ${title(p).toUpperCase()}`);
    const L = (tx: number, ty: number, label: string, val: string, col = TEXT) => { drawText(ctx, label, tx, ty, { size: 1, color: DIM }); drawText(ctx, val, tx + 90, ty, { size: 1, color: col }); };
    let ly = y + 36;
    L(x + 16, ly, 'RACE', r.name); L(x + 240, ly, 'AGE', `${p.turns} TURNS`); L(x + 440, ly, 'LEVEL', String(p.lev)); ly += 12;
    L(x + 16, ly, 'CLASS', c.name); L(x + 240, ly, 'HERO', c.hero); L(x + 440, ly, 'EXP', `${p.exp} (MAX ${p.maxExp})`); ly += 12;
    L(x + 16, ly, 'SEX', p.sex); L(x + 240, ly, 'GOLD', String(p.gold), GOLD); L(x + 440, ly, 'NEXT', p.lev < 50 ? String(expToLevel(p, p.lev + 1)) : 'MAX'); ly += 18;
    for (const s of STATS) {
      const drained = p.statCur[s] < p.statBase[s];
      L(x + 16, ly, s, statText(b.stat[s]), drained ? '#ffd040' : TEXT);
      drawText(ctx, `BASE ${statText(p.statBase[s])}${drained ? '  CUR ' + statText(p.statCur[s]) : ''}`, x + 140, ly, { size: 1, color: DIM }); ly += 11;
    }
    ly = y + 84;
    L(x + 300, ly, 'HIT POINTS', `${p.chp}/${p.mhp}`); ly += 11;
    L(x + 300, ly, 'MANA', `${p.csp}/${p.msp}`); ly += 11;
    L(x + 300, ly, 'ARMOUR', `[${b.ac},${b.toAc >= 0 ? '+' : ''}${b.toAc}]`); ly += 11;
    L(x + 300, ly, 'TO HIT/DAM', `${fmt(b.toHit)},${fmt(b.toDam)}`); ly += 11;
    L(x + 300, ly, 'BLOWS', `${b.blows}/TURN`); ly += 11;
    L(x + 300, ly, 'SHOTS', `${b.shots}/TURN X${b.might}`); ly += 11;
    L(x + 300, ly, 'SPEED', b.speed === 0 ? 'NORMAL' : fmt(b.speed)); ly += 11;
    L(x + 300, ly, 'INFRA', `${(r.infra + b.infra) * 10} FT`); ly += 11;
    L(x + 300, ly, 'FOOD', foodState(p.food)); ly += 11;
    L(x + 300, ly, 'MAX DEPTH', p.maxDepth ? `${p.maxDepth * 50} FT` : 'TOWN'); ly += 11;
    L(x + 300, ly, 'KILLS', String(p.kills)); ly += 11;
    L(x + 300, ly, 'SCORE', String(score(g)), GOLD); ly += 11;
    ly = y + 84;
    const sk = b.skills;
    const rate = (v: number, t: number[]) => v < t[0] ? 'BAD' : v < t[1] ? 'POOR' : v < t[2] ? 'FAIR' : v < t[3] ? 'GOOD' : v < t[4] ? 'VERY GOOD' : v < t[5] ? 'EXCELLENT' : v < t[6] ? 'SUPERB' : 'HEROIC';
    L(x + 480, ly, 'FIGHTING', rate(meleeSkill(p, b), [20, 40, 60, 80, 100, 130, 160])); ly += 11;
    L(x + 480, ly, 'SHOOTING', rate(bowSkill(p, b), [20, 40, 60, 80, 100, 130, 160])); ly += 11;
    L(x + 480, ly, 'SAVING', rate(sk.save, [10, 20, 30, 45, 60, 75, 90])); ly += 11;
    L(x + 480, ly, 'STEALTH', rate(sk.stealth, [1, 2, 3, 4, 6, 8, 10])); ly += 11;
    L(x + 480, ly, 'PERCEPTION', rate(sk.perception, [5, 10, 15, 20, 30, 40, 50])); ly += 11;
    L(x + 480, ly, 'SEARCHING', rate(sk.search, [5, 10, 20, 30, 40, 50, 60])); ly += 11;
    L(x + 480, ly, 'DISARMING', rate(sk.disarm, [10, 20, 35, 50, 65, 80, 100])); ly += 11;
    L(x + 480, ly, 'DEVICES', rate(sk.device, [10, 20, 35, 50, 65, 80, 100])); ly += 11;
    // Flags.
    const flags = [...b.flags].filter(f => !f.startsWith('IGNORE_') && !f.startsWith('SUST_') || true).map(f => f.replace(/_/g, ' ')).join('  ');
    drawText(ctx, flags.length > 150 ? flags.slice(0, 149) + '.' : flags, x + 16, y + h - 46, { size: 1, color: '#a0c0ff' });
    const hist = wrapText(p.history || c.desc, 110);
    for (let i = 0; i < Math.min(2, hist.length); i++) drawText(ctx, hist[i], x + 16, y + h - 34 + i * 10, { size: 1, color: DIM });
    drawText(ctx, 'F WRITES A CHARACTER DUMP   ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'f' || e.key === 'F') { (ui as Ui2).dumpCharacter(); return true; }
    if (e.key === 'Escape' || e.key === 'C' || e.key === 'c' || e.key === 'Enter') ui.pop(); return true;
  }
  click(_x: number, _y: number, ui: Ui): boolean { ui.pop(); return true; }
}
function fmt(v: number): string { return (v >= 0 ? '+' : '') + v; }

// ---------------------------------------------------------------------------------------------
// Level map

export class MapOverlay implements Overlay {
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, lv = g.level, p = g.player;
    const cell = Math.max(2, Math.floor(Math.min((VIEW_W - 40) / lv.w, (VIEW_H - 60) / lv.h)));
    const w = lv.w * cell + 24, h = lv.h * cell + 44, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, p.depth === 0 ? 'THE TOWN' : `DUNGEON LEVEL ${p.depth}  (${p.depth * 50} FT)`);
    const ox = x + 12, oy = y + 30;
    for (let ty = 0; ty < lv.h; ty++) for (let tx = 0; tx < lv.w; tx++) {
      const f = flagAt(lv, tx, ty);
      if (!(f & F.MARK)) continue;
      const t = tileAt(lv, tx, ty);
      let col = '#3a3d52';
      if (isWall(t) || t === T.PERM) col = t === T.PERM ? '#7a5a48' : t === T.MAGMA_K || t === T.QUARTZ_K ? '#ffd040' : '#6b6f8c';
      else if (t === T.DOOR_CLOSED || t === T.DOOR_OPEN || t === T.DOOR_BROKEN) col = '#c08040';
      else if (t === T.STAIRS_DOWN) col = '#ffffff'; else if (t === T.STAIRS_UP) col = '#c0c0ff';
      else if (t === T.TRAP) col = '#ff4060'; else if (t === T.RUBBLE) col = '#8a8a92'; else if (t === T.GRASS) col = '#3a6a34'; else if (t === T.ROAD) col = '#8a7a5a'; else if (t === T.TREE) col = '#2a5a2a';
      else if (isShop(t)) col = '#ffe060';
      if (f & F.GLYPH) col = '#ffff80';
      if (!(f & F.SEEN)) col = col + 'a0';
      ctx.fillStyle = col; ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
    }
    for (const fi of lv.items) if (flagAt(lv, fi.x, fi.y) & F.MARK) { ctx.fillStyle = kindOf(fi.item).tval === 'gold' ? '#ffd040' : '#80ff80'; ctx.fillRect(ox + fi.x * cell, oy + fi.y * cell, cell, cell); }
    for (const m of lv.monsters) if (m.visible) { ctx.fillStyle = hasMFlag(raceOf(m), 'UNIQUE') ? '#ff40ff' : '#ff4040'; ctx.fillRect(ox + m.x * cell, oy + m.y * cell, cell, cell); }
    ctx.fillStyle = (ui.frame >> 3) % 2 ? '#ffffff' : '#40e0ff'; ctx.fillRect(ox + p.x * cell - 1, oy + p.y * cell - 1, cell + 2, cell + 2);
    drawText(ctx, 'CLICK A SPOT TO TRAVEL THERE   ESC CLOSES', x + w / 2, y + h - 12, { size: 1, color: DIM, align: 'center' });
  }
  key(_e: KeyEvent, ui: Ui): boolean { ui.pop(); return true; }
  click(x: number, y: number, ui: Ui): boolean {
    const lv = ui.g.level;
    const cell = Math.max(2, Math.floor(Math.min((VIEW_W - 40) / lv.w, (VIEW_H - 60) / lv.h)));
    const w = lv.w * cell + 24, h = lv.h * cell + 44, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    const tx = Math.floor((x - bx - 12) / cell), ty = Math.floor((y - by - 30) / cell);
    ui.pop();
    if (tx >= 0 && ty >= 0 && tx < lv.w && ty < lv.h) (ui as unknown as { travel(x: number, y: number): void }).travel(tx, ty);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Help, messages

const HELP = [
  'MOVE     ARROWS / NUMPAD / H J K L Y U B N   (HOLD TO KEEP WALKING)     RUN  SHIFT + DIRECTION',
  'WALK INTO monsters to attack, doors to open, rubble and veins to dig, a shop door to trade',
  '<  >     take stairs      ,  g  pick up / hold    R  rest    s  search    o  open    c  close    ctrl+B  bash    ctrl+J  jam (spike)',
  'i  e     inventory / equipment    w  wield/wear    t  take off    d  drop    k  destroy    x  l  look (r recalls)    D  disarm',
  'q  quaff potion    r  read scroll    E  eat    a  aim wand    u  use staff    z  zap rod    A  activate    Enter  repeat last',
  'f  fire missile    v  throw          F  refuel light          m  p  cast / pray     b  browse     G  study     T  tunnel',
  'C  character (F dumps)   M  map   ctrl+L  locate   ~  knowledge   /  recall   =  options   O  ignore   V  hall of heroes   {  }  inscribe',
  'ctrl+P  messages   ctrl+S  save   ctrl+X  save and quit   ctrl+E  export save   ctrl+F  level feeling   ctrl+O  show ignored   Q  retire',
  'MOUSE   click the map to travel there; while aiming, click a monster to target it; * cycles targets',
  '',
  'KEYS open locked doors instantly (or pick the lock).  GENERATORS spawn monsters until smashed.',
  'FOOD keeps you alive; your light burns out.  Gold, keys and items are picked up as you walk.',
  'Unknown potions and scrolls are learned by use.  Word of Recall hops between town and your deepest level.',
  'INSCRIPTIONS: {@q1} answers 1 at the quaff prompt (@r @f @z ... likewise); {!q} asks before quaffing, {!*} before anything.',
  'IGNORE (O): set how choosy you are per kind of gear and stop picking up junk. Nothing unknown is ignored; {=g} always picks up.',
  'TOUCH: tap anywhere on a phone for a thumb pad and command buttons; menus get a navigation bar.',
  'Before you dive: a lantern, flasks of oil, Cure Light Wounds, Phase Door, and rations.',
];
export class HelpOverlay implements Overlay {
  draw(ctx: CanvasRenderingContext2D): void {
    const w = 900, h = 60 + HELP.length * 12 + 20, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, 'GAUNTLET OF ANGBAND');
    for (let i = 0; i < HELP.length; i++) drawText(ctx, HELP[i], x + 16, y + 34 + i * 12, { size: 1, color: i < 9 ? TEXT : '#c0c0ff' });
    drawText(ctx, 'ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(_e: KeyEvent, ui: Ui): boolean { ui.pop(); return true; }
  click(_x: number, _y: number, ui: Ui): boolean { ui.pop(); return true; }
}
export class MessagesOverlay implements Overlay {
  scroll = 0;
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const list = ui.g.msg.list;
    const rows = 34, w = 800, h = 50 + rows * 12, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, 'MESSAGES');
    const start = Math.max(0, list.length - rows - this.scroll);
    for (let i = 0; i < rows; i++) {
      const m = list[start + i]; if (!m) break;
      drawText(ctx, (m.count > 1 ? `${m.text} (X${m.count})` : m.text).slice(0, 120), x + 12, y + 32 + i * 12, { size: 1, color: m.color });
    }
    drawText(ctx, 'UP/DOWN SCROLL   ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'ArrowUp' || e.key === 'k') { this.scroll = Math.min(Math.max(0, ui.g.msg.list.length - 34), this.scroll + 5); return true; }
    if (e.key === 'ArrowDown' || e.key === 'j') { this.scroll = Math.max(0, this.scroll - 5); return true; }
    ui.pop(); return true;
  }
  click(_x: number, _y: number, ui: Ui): boolean { ui.pop(); return true; }
}

// ---------------------------------------------------------------------------------------------
// Look / target mode

export class LookMode implements Overlay {
  constructor(public onSelect?: (p: Pos) => void) {}
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const c = ui.cursor; if (!c) return;
    const txt = describeGrid(ui.g, c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, 16);
    drawText(ctx, `LOOK: ${txt.slice(0, 100)}   (DIRS, SPACE NEXT, R RECALL, ${this.onSelect ? 'ENTER TARGETS, ' : ''}ESC)`, MAP_X + 8, MAP_Y + 4, { size: 1, color: HI });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const c = ui.cursor!;
    if (e.key === 'Escape') { ui.cursor = null; ui.pop(); return true; }
    if (e.key === 'Enter' || e.key === 't') { const p = { ...c }; ui.cursor = null; ui.pop(); if (this.onSelect) this.onSelect(p); else ui.target = p; return true; }
    if (e.key === 'r' || e.key === '/') { const m = monsterAt(ui.g.level, c.x, c.y); if (m && m.visible) ui.push(new RecallOverlay(raceOf(m))); return true; }
    if (e.key === ' ' || e.key === '+' || e.key === '*') {
      const g = ui.g, p = g.player;
      const list = g.level.monsters.filter(m => m.visible).sort((a, b) => distance(p.x, p.y, a.x, a.y) - distance(p.x, p.y, b.x, b.y));
      if (list.length) { const i = list.findIndex(m => m.x === c.x && m.y === c.y); const m = list[(i + 1) % list.length]; ui.cursor = { x: m.x, y: m.y }; }
      return true;
    }
    const d = dirOfKey(e);
    if (d && d !== 5) { c.x += [0, -1, 0, 1, -1, 0, 1, -1, 0, 1][d]; c.y += [0, 1, 1, 1, 0, 0, 0, -1, -1, -1][d]; }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const r = (ui as unknown as { renderer: { screenToTile(x: number, y: number): Pos } }).renderer;
    const t = r.screenToTile(x, y);
    if (ui.cursor && t.x === ui.cursor.x && t.y === ui.cursor.y) { ui.cursor = null; ui.pop(); if (this.onSelect) this.onSelect(t); else ui.target = t; }
    else ui.cursor = t;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Title, birth and death

export class TitleScreen implements Overlay {
  opaque = true;
  sel = 0;
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // A parade of monsters along the bottom.
    const kinds = ['orc', 'ghost', 'dragon', 'demon', 'skeleton', 'troll', 'spider', 'generator', 'eye', 'wight', 'kobold', 'hydra'] as const;
    for (let i = 0; i < kinds.length; i++) {
      const px = 60 + i * 76 + Math.sin(ui.frame / 40 + i) * 4;
      drawMonsterSprite(ctx, kinds[i], px, VIEW_H - 70, { color: ['#7a9a3a', '#b0c0e0', '#e04040', '#c03060', '#e8e8e0', '#6a9a5a', '#5a4a4a', '#c0a080', '#e0e0ff', '#8080c0', '#c08040', '#40a060'][i], color2: '#ffd040', size: 1.6, phase: (ui.frame / 120 + i * 0.1) % 1, facing: i % 2 ? -1 : 1 });
    }
    drawTextOutlined(ctx, 'GAUNTLET', VIEW_W / 2, 70, { size: 7, color: '#ffd040', align: 'center', outline: '#3a1c00', thickness: 3 });
    drawTextOutlined(ctx, 'OF ANGBAND', VIEW_W / 2, 140, { size: 4, color: '#e04040', align: 'center', outline: '#2a0a10', thickness: 2 });
    drawText(ctx, 'A PROCEDURAL DUNGEON OF PITS, WYRMS AND GENERATORS', VIEW_W / 2, 190, { size: 1, color: '#8a869a', align: 'center' });
    const items = [['NEW GAME', true], ['CONTINUE', ui.hasSave()], ['HALL OF HEROES', true], ['IMPORT SAVE', true], ['HELP', true]] as [string, boolean][];
    for (let i = 0; i < items.length; i++) {
      const [t, ok] = items[i];
      drawText(ctx, (this.sel === i ? '> ' : '  ') + t, VIEW_W / 2, 232 + i * 22, { size: 2, color: !ok ? '#4a4656' : this.sel === i ? HI : TEXT, align: 'center' });
    }
    drawText(ctx, 'ARROWS + ENTER      WARRIOR NEEDS FOOD BADLY', VIEW_W / 2, 350, { size: 1, color: '#5a5666', align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.key === 'ArrowDown' || e.key === 'j') this.sel = (this.sel + 1) % 5;
    else if (e.key === 'ArrowUp' || e.key === 'k') this.sel = (this.sel + 4) % 5;
    else if (e.key === 'Enter' || e.key === ' ') this.choose(ui);
    else if (e.key === 'n' || e.key === 'N') { this.sel = 0; this.choose(ui); }
    else if (e.key === 'c' || e.key === 'C') { this.sel = 1; this.choose(ui); }
    else if (e.key === 'h' || e.key === 'H') { this.sel = 2; this.choose(ui); }
    else if (e.key === '?') ui.push(new HelpOverlay());
    return true;
  }
  choose(ui: Ui): void {
    if (this.sel === 0) ui.push(new BirthScreen2());
    else if (this.sel === 1) ui.push(new SaveSlotsOverlay());
    else if (this.sel === 2) ui.push(new HighScoresOverlay());
    else if (this.sel === 3) (ui as Ui2).importSave();
    else ui.push(new HelpOverlay());
  }
  click(x: number, y: number, ui: Ui): boolean {
    const i = Math.floor((y - 226) / 22);
    if (i >= 0 && i < 5 && Math.abs(x - VIEW_W / 2) < 140) { this.sel = i; this.choose(ui); }
    return true;
  }
}

export class BirthScreen implements Overlay {
  opaque = true;
  step = 0; race = 0; cls = 0; sex: 'male' | 'female' = 'male'; name = '';
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawTextOutlined(ctx, this.step === 0 ? 'CHOOSE YOUR RACE' : this.step === 1 ? 'CHOOSE YOUR CLASS' : 'NAME YOUR HERO', VIEW_W / 2, 24, { size: 3, color: HI, align: 'center' });
    const list = this.step === 0 ? RACES : CLASSES;
    if (this.step < 2) {
      const sel = this.step === 0 ? this.race : this.cls;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        drawText(ctx, (sel === i ? '> ' : '  ') + d.name.toUpperCase(), 80, 80 + i * 18, { size: 2, color: sel === i ? HI : TEXT });
      }
      const d = list[sel];
      const x = 360;
      drawText(ctx, d.name.toUpperCase(), x, 80, { size: 2, color: HI });
      const desc = wrap(d.desc, 60);
      for (let i = 0; i < desc.length; i++) drawText(ctx, desc[i], x, 104 + i * 11, { size: 1, color: TEXT });
      let ly = 104 + desc.length * 11 + 10;
      for (const s of STATS) { const v = d.stats[s]; drawText(ctx, `${s} ${v >= 0 ? '+' : ''}${v}`, x + STATS.indexOf(s) * 70, ly, { size: 1, color: v > 0 ? '#a0ffa0' : v < 0 ? '#ff8080' : DIM }); }
      ly += 14;
      drawText(ctx, `HIT DIE ${d.hitDie}   EXP ${d.expPct}%`, x, ly, { size: 1, color: DIM }); ly += 11;
      if (this.step === 0) { const r = d as typeof RACES[number]; drawText(ctx, `INFRAVISION ${r.infra * 10} FT   ${r.flags.join(' ').replace(/_/g, ' ')}`, x, ly, { size: 1, color: '#a0c0ff' }); }
      else {
        const c = d as typeof CLASSES[number];
        drawText(ctx, `PLAYS AS THE GAUNTLET ${c.hero.toUpperCase()}   ${c.realm ? c.realm.toUpperCase() + ' USER' : 'NO MAGIC'}   ${c.maxAttacks} MAX BLOWS`, x, ly, { size: 1, color: '#a0c0ff' }); ly += 11;
        const kit = wrap('STARTS WITH: ' + c.startItems.map(([k, n]) => (n > 1 ? n + ' ' : '') + (kindOf({ kind: k } as Item)?.name || k)).join(', '), 70);
        for (const line of kit) { drawText(ctx, line, x, ly, { size: 1, color: DIM }); ly += 11; }
        ly -= 11;
        // The hero as it will be drawn in the dungeon, big.
        this.preview(ctx, c.id, ui);
      }
      const skills = d.skills;
      ly += 22;
      drawText(ctx, `MELEE ${skills.melee}  BOWS ${skills.bows}  STEALTH ${skills.stealth}  SEARCH ${skills.search}  DISARM ${skills.disarm}  DEVICE ${skills.device}  SAVE ${skills.save}`, x, ly, { size: 1, color: DIM });
      drawText(ctx, 'ARROWS  ENTER CONFIRM  ESC BACK', VIEW_W / 2, VIEW_H - 24, { size: 1, color: DIM, align: 'center' });
    } else {
      drawText(ctx, `${RACES[this.race].name.toUpperCase()} ${CLASSES[this.cls].name.toUpperCase()}   (${this.sex.toUpperCase()}, TAB TO CHANGE)`, VIEW_W / 2, 90, { size: 1, color: DIM, align: 'center' });
      drawText(ctx, this.name + ((ui.frame >> 4) % 2 ? '_' : ' '), VIEW_W / 2, 130, { size: 3, color: HI, align: 'center' });
      drawText(ctx, 'TYPE A NAME AND PRESS ENTER (OR ENTER FOR A RANDOM ONE)', VIEW_W / 2, 180, { size: 1, color: DIM, align: 'center' });
    }
  }
  private previewFor: HeroSprite | null = null;
  private previewCls = '';
  private preview(ctx: CanvasRenderingContext2D, cls: string, ui: Ui): void {
    if (!this.previewFor || this.previewCls !== cls) {
      const p = createPlayer('Preview', RACES[this.race].id, cls, this.sex);
      const w = CLASS_BY_ID[cls].startItems.find(([k]) => isWeapon(kindOf({ kind: k } as Item)));
      if (w) p.equip.weapon = makeItem(w[0], 1);
      this.previewFor = buildHero(p);
      this.previewCls = cls;
    }
    ctx.save();
    ctx.translate(VIEW_W - 150, 330);
    ctx.scale(3, 3);
    drawHero(ctx, this.previewFor, 0, 0, (ui.frame >> 6) % 2 ? -1 : 1);
    ctx.restore();
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (this.step < 2) {
      const n = this.step === 0 ? RACES.length : CLASSES.length;
      const cur = this.step === 0 ? this.race : this.cls;
      let next = cur;
      if (e.key === 'ArrowDown' || e.key === 'j') next = (cur + 1) % n;
      if (e.key === 'ArrowUp' || e.key === 'k') next = (cur + n - 1) % n;
      if (this.step === 0) this.race = next; else this.cls = next;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') this.step++;
      if (e.key === 'Escape' || e.key === 'ArrowLeft') { if (this.step === 0) ui.pop(); else this.step--; }
      return true;
    }
    if (e.key === 'Escape') { this.step = 1; return true; }
    if (e.key === 'Tab') { this.sex = this.sex === 'male' ? 'female' : 'male'; return true; }
    if (e.key === 'Enter') { const name = this.name.trim() || randomName(); ui.pop(); ui.newGame(name, RACES[this.race].id, CLASSES[this.cls].id, this.sex); return true; }
    if (e.key === 'Backspace') { this.name = this.name.slice(0, -1); return true; }
    if (e.key.length === 1 && this.name.length < 14 && /[a-zA-Z0-9 '\-]/.test(e.key)) this.name += e.key;
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    if (this.step < 2) { const i = Math.floor((y - 76) / 18); const n = this.step === 0 ? RACES.length : CLASSES.length; if (x < 340 && i >= 0 && i < n) { if ((this.step === 0 ? this.race : this.cls) === i) this.step++; else if (this.step === 0) this.race = i; else this.cls = i; } else this.step++; }
    else this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui);
    return true;
  }
}
function randomName(): string {
  const a = ['Thor', 'Merlin', 'Thyra', 'Questor', 'Grim', 'Elenna', 'Bram', 'Sable', 'Vala', 'Orin', 'Tamsin', 'Dagny'];
  return a[Math.floor(Math.random() * a.length)];
}
function wrap(s: string, n: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; }
  if (line.trim()) out.push(line.trim());
  return out;
}

export class DeathScreen implements Overlay {
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, p = g.player;
    const w = 520, h = 300, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h);
    drawTextOutlined(ctx, g.totalWinner ? 'YOU ARE VICTORIOUS' : 'RIP', x + w / 2, y + 16, { size: 4, color: g.totalWinner ? GOLD : '#ff4040', align: 'center', outline: '#120c14', thickness: 2 });
    const lines = [
      `${p.name.toUpperCase()} THE ${title(p).toUpperCase()}`,
      `${RACE_BY_ID[p.race].name.toUpperCase()} ${CLASS_BY_ID[p.cls].name.toUpperCase()}, LEVEL ${p.lev}`,
      g.totalWinner ? 'BANISHED THE LORD OF DARKNESS AND RETIRED IN GLORY' : `KILLED BY ${p.deathCause.toUpperCase()}`,
      p.depth === 0 ? 'IN THE TOWN' : `ON DUNGEON LEVEL ${p.depth} (${p.depth * 50} FT)`,
      '',
      `${p.kills} KILLS    ${p.gold} GOLD    ${p.maxExp} EXP    DEEPEST ${p.maxDepth * 50} FT`,
      `TURN ${Math.floor(g.turn / 10)}    SCORE ${score(g)}`,
    ];
    for (let i = 0; i < lines.length; i++) drawText(ctx, lines[i], x + w / 2, y + 70 + i * 16, { size: i === 0 ? 2 : 1, color: i === 6 ? GOLD : TEXT, align: 'center' });
    drawText(ctx, 'ENTER TITLE SCREEN   F CHARACTER DUMP   H HALL OF HEROES   CTRL+P MESSAGES   ~ KNOWLEDGE', x + w / 2, y + h - 20, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    if (e.ctrl && (e.key === 'p' || e.key === 'P')) { ui.push(new MessagesOverlay()); return true; }
    if (e.key === 'f' || e.key === 'F') { (ui as Ui2).dumpCharacter(); return true; }
    if (e.key === 'h' || e.key === 'H') { ui.push(new HighScoresOverlay()); return true; }
    if (e.key === '~') { import('./screens2.ts').then(m => ui.push(new m.KnowledgeOverlay())); return true; }
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') ui.quitToTitle();
    return true;
  }
  click(_x: number, _y: number, ui: Ui): boolean { ui.quitToTitle(); return true; }
}
export const _keep = [measureText, isWeapon, tvalLabel, TILE, MAP_H, characterDump];
