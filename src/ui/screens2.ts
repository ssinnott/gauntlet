// More overlays: the knowledge browser (monster memory, objects, artifacts, egos, uniques), the
// options menu, the high score table, the locate (scroll the map) mode, monster recall, and the
// birth screen with stat rolling / point buy, birth options and a history.
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H, TILE } from '../constants.ts';
import { drawText, drawTextOutlined } from '../lib/engine/text.ts';
import { rrect } from '../lib/art/shapes.ts';
import type { Game } from '../game/state.ts';
import { type Item, type Pos, type Stat, STATS, type MonsterRace } from '../game/types.ts';
import { kindOf, isWeapon, makeItem, isAware, baseName } from '../game/items.ts';
import { RACES, RACE_BY_ID } from '../game/data/races.ts';
import { CLASSES, CLASS_BY_ID } from '../game/data/classes.ts';
import { MONSTERS, MONSTER_BY_ID } from '../game/data/monsters.ts';
import { OBJECTS, EGOS } from '../game/data/objects.ts';
import { artifactList, artifactById } from '../game/artifacts.ts';
import { drawMonsterSprite, drawItemIcon } from './sprites.ts';
import type { KeyEvent } from './input.ts';
import { dirOfKey } from './input.ts';
import { createPlayer, statText, rollStats, statCost, POINT_BUDGET, boughtStats, makeHistory } from '../game/player.ts';
import { buildHero, drawHero, type HeroSprite } from './hero.ts';
import { describeRace, wrapText } from '../game/recall.ts';
import { loreOf } from '../game/lore.ts';
import { type Options, DEFAULT_OPTIONS, BIRTH_OPTIONS, GAME_OPTIONS, OPTION_TEXT } from '../game/options.ts';
import { type IgnoreGroup, IGNORE_GROUPS, IGNORE_GROUP_LABEL, IGNORE_QUALITIES, IGNORE_QUALITY_TEXT, toggleIgnoreKind } from '../game/ignore.ts';
import type { ScoreEntry } from '../game/scores.ts';
import type { SaveMeta } from './storage.ts';
import type { Ui, Overlay } from './screens.ts';
import { rng } from '../lib/engine/rng.ts';

const BG = '#14121c', EDGE = '#5a5470', TEXT = '#e8e4d8', DIM = '#8a869a', HI = '#ffe060', GOLD = '#ffd040';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, titleText?: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  rrect(ctx, x, y, w, h, 4, BG, EDGE, 2);
  if (titleText) { drawText(ctx, titleText, x + w / 2, y + 8, { size: 2, color: HI, align: 'center' }); }
}

/** The extra things main.ts offers beyond the base Ui. */
export interface Ui2 extends Ui {
  scores: ScoreEntry[];
  /** Saved heroes, newest first (cached; refreshed whenever one is written or removed). */
  slots: SaveMeta[];
  /** A line for the saved-heroes screen when something went wrong. */
  notice: string;
  loadSlot(id: string): void;
  deleteSlot(id: string): void;
  dumpCharacter(): void;
  exportSave(): void;
  importSave(): void;
  newGame2(name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string }): void;
}

// ---------------------------------------------------------------------------------------------
// Monster recall

export class RecallOverlay implements Overlay {
  constructor(public race: MonsterRace) {}
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g, r = this.race;
    const lines = describeRace(g, r).flatMap(p => wrapText(p, 96));
    const w = 800, h = Math.min(VIEW_H - 40, 90 + lines.length * 12), x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, r.name.toUpperCase());
    drawMonsterSprite(ctx, r.sprite, x + 40, y + 60, { color: r.color, color2: r.color2, size: (r.size || 1) * 1.6, phase: (ui.frame / 120) % 1, facing: 1 });
    const l = loreOf(g, r.id);
    drawText(ctx, `SEEN ${l.sights}   KILLED ${l.kills}${l.deaths ? '   KILLED YOU ' + l.deaths : ''}`, x + w - 12, y + 12, { size: 1, color: DIM, align: 'right' });
    for (let i = 0; i < lines.length && y + 40 + i * 12 < y + h - 24; i++) drawText(ctx, lines[i], x + 80, y + 40 + i * 12, { size: 1, color: TEXT });
    drawText(ctx, 'ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(_e: KeyEvent, ui: Ui): boolean { ui.pop(); return true; }
  click(_x: number, _y: number, ui: Ui): boolean { ui.pop(); return true; }
}

// ---------------------------------------------------------------------------------------------
// Knowledge browser

type KTab = 'monsters' | 'objects' | 'artifacts' | 'egos' | 'uniques' | 'kills';
const KTABS: KTab[] = ['monsters', 'objects', 'artifacts', 'egos', 'uniques', 'kills'];
export class KnowledgeOverlay implements Overlay {
  tab: KTab = 'monsters'; sel = 0; scroll = 0;
  private rows(g: Game): { text: string; right?: string; color?: string; race?: MonsterRace }[] {
    switch (this.tab) {
      case 'monsters': {
        const list = MONSTERS.filter(r => { const l = g.lore[r.id]; return l && (l.sights > 0 || l.kills > 0 || l.deaths > 0); }).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
        return list.map(r => { const l = loreOf(g, r.id); return { text: `${r.flags.includes('UNIQUE') ? '* ' : ''}${r.name}`, right: `L${r.depth}   ${l.kills} KILLS`, color: r.flags.includes('UNIQUE') ? (g.uniquesDead.includes(r.id) ? DIM : '#ff80ff') : TEXT, race: r }; });
      }
      case 'objects': {
        const list = OBJECTS.filter(k => k.flavored && isAware(g.flavors, k.id)).sort((a, b) => a.tval.localeCompare(b.tval) || a.level - b.level);
        return list.map(k => ({ text: `${k.name}`, right: `${g.flavors.names[k.id] || ''}   L${k.level}`, color: TEXT }));
      }
      case 'artifacts': {
        const list = artifactList().filter(a => g.artifactsSeen.includes(a.id));
        return list.length ? list.map(a => ({ text: `${kindOf({ kind: a.kind } as Item).name} ${a.name}`, right: `L${a.level}`, color: GOLD })) : [{ text: 'You have not identified any artifacts.', color: DIM }];
      }
      case 'egos': {
        const list = EGOS.filter(e => g.egosKnown.includes(e.id));
        return list.length ? list.map(e => ({ text: `${e.name}`, right: `${e.tvals.join('/')}   L${e.level}`, color: e.cursed ? '#ff8080' : '#a0ffa0' })) : [{ text: 'You have not identified any ego items.', color: DIM }];
      }
      case 'uniques': {
        const list = MONSTERS.filter(r => r.flags.includes('UNIQUE') && (g.uniquesDead.includes(r.id) || (g.lore[r.id] && g.lore[r.id].sights > 0))).sort((a, b) => a.depth - b.depth);
        return list.length ? list.map(r => ({ text: r.name, right: `L${r.depth}   ${g.uniquesDead.includes(r.id) ? 'DEAD' : 'ALIVE'}`, color: g.uniquesDead.includes(r.id) ? DIM : '#ff80ff', race: r })) : [{ text: 'You have met no unique monsters.', color: DIM }];
      }
      case 'kills': {
        const total = Object.values(g.lore).reduce((a, l) => a + l.kills, 0);
        const list = Object.entries(g.lore).filter(([, l]) => l.kills > 0).sort((a, b) => b[1].kills - a[1].kills).slice(0, 60);
        return [{ text: `TOTAL KILLS ${total}   (THIS HERO: ${g.player.kills})`, color: HI }, ...list.map(([id, l]) => ({ text: MONSTER_BY_ID[id]?.name || id, right: String(l.kills), color: TEXT, race: MONSTER_BY_ID[id] }))];
      }
    }
  }
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g;
    const w = 760, h = 460, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h);
    let tx = x + 16;
    for (const t of KTABS) { drawText(ctx, t.toUpperCase(), tx, y + 10, { size: 1, color: t === this.tab ? HI : DIM }); tx += 110; }
    const rows = this.rows(g), maxRows = 32;
    if (this.sel >= rows.length) this.sel = Math.max(0, rows.length - 1);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + maxRows) this.scroll = this.sel - maxRows + 1;
    for (let i = 0; i < maxRows; i++) {
      const ri = i + this.scroll; if (ri >= rows.length) break;
      const r = rows[ri], ly = y + 30 + i * 12;
      if (ri === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 11); }
      if (r.race) drawMonsterSprite(ctx, r.race.sprite, x + 20, ly + 6, { color: r.race.color, color2: r.race.color2, size: 0.45 * (r.race.size || 1), phase: 0.25, facing: 1 });
      drawText(ctx, r.text, x + 34, ly, { size: 1, color: r.color || TEXT });
      if (r.right) drawText(ctx, r.right, x + w - 12, ly, { size: 1, color: DIM, align: 'right' });
    }
    if (!rows.length) drawText(ctx, 'NOTHING KNOWN YET', x + w / 2, y + 80, { size: 1, color: DIM, align: 'center' });
    if (rows.length > maxRows) drawText(ctx, `${this.scroll + 1}-${Math.min(rows.length, this.scroll + maxRows)} OF ${rows.length}`, x + w - 12, y + 10, { size: 1, color: DIM, align: 'right' });
    drawText(ctx, 'TAB / LEFT / RIGHT SWITCH LISTS   UP / DOWN SELECT   ENTER RECALL   ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const rows = this.rows(ui.g);
    if (e.key === 'Escape' || e.key === '~') { ui.pop(); return true; }
    if (e.key === 'Tab' || e.key === 'ArrowRight') { this.tab = KTABS[(KTABS.indexOf(this.tab) + 1) % KTABS.length]; this.sel = 0; this.scroll = 0; return true; }
    if (e.key === 'ArrowLeft') { this.tab = KTABS[(KTABS.indexOf(this.tab) + KTABS.length - 1) % KTABS.length]; this.sel = 0; this.scroll = 0; return true; }
    if (e.key === 'ArrowDown' || e.key === 'j') { if (rows.length) this.sel = (this.sel + 1) % rows.length; return true; }
    if (e.key === 'ArrowUp' || e.key === 'k') { if (rows.length) this.sel = (this.sel - 1 + rows.length) % rows.length; return true; }
    if (e.key === 'PageDown') { this.sel = Math.min(rows.length - 1, this.sel + 16); return true; }
    if (e.key === 'PageUp') { this.sel = Math.max(0, this.sel - 16); return true; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'r') { const r = rows[this.sel]; if (r && r.race) ui.push(new RecallOverlay(r.race)); return true; }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const w = 760, h = 460, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); return true; }
    if (y < by + 24) { const i = Math.floor((x - bx - 16) / 110); if (i >= 0 && i < KTABS.length) { this.tab = KTABS[i]; this.sel = 0; this.scroll = 0; } return true; }
    const i = Math.floor((y - by - 28) / 12) + this.scroll;
    const rows = this.rows(ui.g);
    if (i >= 0 && i < rows.length) { if (this.sel === i && rows[i].race) ui.push(new RecallOverlay(rows[i].race!)); else this.sel = i; }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Options

export class OptionsOverlay implements Overlay {
  wantsYesNo = true;
  sel = 0;
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g;
    const w = 620, h = 60 + (GAME_OPTIONS.length + BIRTH_OPTIONS.length) * 14 + 60, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, 'OPTIONS');
    let ly = y + 36;
    drawText(ctx, 'GAME OPTIONS', x + 16, ly, { size: 1, color: DIM }); ly += 14;
    GAME_OPTIONS.forEach((o, i) => {
      const [name, desc] = OPTION_TEXT[o];
      if (i === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 13); }
      drawText(ctx, `${LETTERS[i]}) ${name}`, x + 16, ly, { size: 1, color: TEXT });
      drawText(ctx, g.options[o] ? 'YES' : 'NO', x + 250, ly, { size: 1, color: g.options[o] ? '#a0ffa0' : '#ff8080' });
      drawText(ctx, desc, x + 290, ly, { size: 1, color: DIM }); ly += 14;
    });
    ly += 8;
    drawText(ctx, 'BIRTH OPTIONS (FIXED FOR THIS HERO)', x + 16, ly, { size: 1, color: DIM }); ly += 14;
    for (const o of BIRTH_OPTIONS) {
      const [name, desc] = OPTION_TEXT[o];
      drawText(ctx, `   ${name}`, x + 16, ly, { size: 1, color: '#a0a0b0' });
      drawText(ctx, g.options[o] ? 'YES' : 'NO', x + 250, ly, { size: 1, color: g.options[o] ? '#80c080' : '#a06060' });
      drawText(ctx, desc, x + 290, ly, { size: 1, color: DIM }); ly += 14;
    }
    drawText(ctx, 'UP / DOWN SELECT   ENTER / SPACE TOGGLE   ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const g = ui.g;
    if (e.key === 'Escape' || e.key === '=') { ui.pop(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'j') { this.sel = (this.sel + 1) % GAME_OPTIONS.length; return true; }
    if (e.key === 'ArrowUp' || e.key === 'k') { this.sel = (this.sel + GAME_OPTIONS.length - 1) % GAME_OPTIONS.length; return true; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'y' || e.key === 'n') { const o = GAME_OPTIONS[this.sel]; g.options[o] = e.key === 'y' ? true : e.key === 'n' ? false : !g.options[o]; return true; }
    const i = LETTERS.indexOf(e.key);
    if (i >= 0 && i < GAME_OPTIONS.length) { this.sel = i; const o = GAME_OPTIONS[i]; g.options[o] = !g.options[o]; }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const w = 620, h = 60 + (GAME_OPTIONS.length + BIRTH_OPTIONS.length) * 14 + 60, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); return true; }
    const i = Math.floor((y - by - 48) / 14);
    if (i >= 0 && i < GAME_OPTIONS.length) { const o = GAME_OPTIONS[i]; ui.g.options[o] = !ui.g.options[o]; this.sel = i; }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// High scores

export class HighScoresOverlay implements Overlay {
  opaque = false;
  constructor(public highlight = -1) {}
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const list = (ui as Ui2).scores;
    const w = 860, h = 80 + Math.max(1, Math.min(25, list.length)) * 14, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, 'HALL OF HEROES');
    if (!list.length) drawText(ctx, 'NO HEROES HAVE FALLEN YET', x + w / 2, y + 50, { size: 1, color: DIM, align: 'center' });
    drawText(ctx, 'RANK  SCORE   NAME            RACE / CLASS               LV   DEPTH   FATE', x + 16, y + 30, { size: 1, color: DIM });
    for (let i = 0; i < Math.min(25, list.length); i++) {
      const e = list[i], ly = y + 44 + i * 14;
      const col = i === this.highlight ? HI : e.winner ? GOLD : TEXT;
      drawText(ctx, `${String(i + 1).padStart(3)}.  ${String(e.score).padStart(6)}  ${e.name.padEnd(14).slice(0, 14)}  ${(e.race + ' ' + e.cls).padEnd(26).slice(0, 26)} ${String(e.lev).padStart(2)}   ${String(e.maxDepth * 50).padStart(5)}FT  ${e.winner ? 'WINNER: ' : 'KILLED BY '}${e.cause.toUpperCase().slice(0, 28)}`, x + 16, ly, { size: 1, color: col });
    }
    drawText(ctx, 'ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(_e: KeyEvent, ui: Ui): boolean { ui.pop(); return true; }
  click(_x: number, _y: number, ui: Ui): boolean { ui.pop(); return true; }
}

// ---------------------------------------------------------------------------------------------
// Locate: scroll the map around without moving

export class LocateMode implements Overlay {
  constructor(public cam: Pos) {}
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(MAP_X, MAP_Y, MAP_W, 16);
    drawText(ctx, `LOCATE: MAP SECTOR ${Math.floor(this.cam.x / (MAP_W / TILE / 2))},${Math.floor(this.cam.y / (MAP_H / TILE / 2))}   (DIRECTIONS SCROLL, ESC RETURNS)`, MAP_X + 8, MAP_Y + 4, { size: 1, color: HI });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const r = (ui as unknown as { renderer: { camLock: Pos | null } }).renderer;
    const d = dirOfKey(e);
    if (d && d !== 5) {
      const lv = ui.g.level;
      this.cam.x = Math.max(0, Math.min(lv.w - 1, this.cam.x + [0, -1, 0, 1, -1, 0, 1, -1, 0, 1][d] * Math.floor(MAP_W / TILE / 2)));
      this.cam.y = Math.max(0, Math.min(lv.h - 1, this.cam.y + [0, 1, 1, 1, 0, 0, 0, -1, -1, -1][d] * Math.floor(MAP_H / TILE / 2)));
      r.camLock = { ...this.cam };
      return true;
    }
    r.camLock = null; ui.pop(); return true;
  }
  click(_x: number, _y: number, ui: Ui): boolean { (ui as unknown as { renderer: { camLock: Pos | null } }).renderer.camLock = null; ui.pop(); return true; }
}

// ---------------------------------------------------------------------------------------------
// Birth

type BirthStep = 'race' | 'class' | 'stats' | 'options' | 'name';
const STEPS: BirthStep[] = ['race', 'class', 'stats', 'options', 'name'];
export class BirthScreen2 implements Overlay {
  wantsYesNo = true;
  opaque = true;
  step: BirthStep = 'race';
  race = 0; cls = 0; sex: 'male' | 'female' = 'male'; name = '';
  pointBuy = true;
  base: Record<Stat, number> = { STR: 10, INT: 10, WIS: 10, DEX: 10, CON: 10, CHR: 10 };
  rolled: Record<Stat, number> | null = null;
  statSel = 0;
  optSel = 0;
  options: Options = { ...DEFAULT_OPTIONS };
  history = '';
  private previewFor: HeroSprite | null = null;
  private previewKey = '';
  private stats(): Record<Stat, number> { return this.pointBuy ? boughtStats(this.base, RACES[this.race].id, CLASSES[this.cls].id) : (this.rolled || rollStats(RACES[this.race].id, CLASSES[this.cls].id, (a, b) => a + Math.floor(Math.random() * (b - a + 1)))); }
  private spent(): number { let t = 0; for (const s of STATS) for (let v = 10; v < this.base[s]; v++) t += statCost(v); return t; }
  private reroll(): void { this.rolled = rollStats(RACES[this.race].id, CLASSES[this.cls].id, (a, b) => a + Math.floor(Math.random() * (b - a + 1))); }

  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const titles: Record<BirthStep, string> = { race: 'CHOOSE YOUR RACE', class: 'CHOOSE YOUR CLASS', stats: 'YOUR STATS', options: 'BIRTH OPTIONS', name: 'NAME YOUR HERO' };
    drawTextOutlined(ctx, titles[this.step], VIEW_W / 2, 24, { size: 3, color: HI, align: 'center' });
    drawText(ctx, STEPS.map(s => s.toUpperCase()).join('  >  ').replace(this.step.toUpperCase(), `[${this.step.toUpperCase()}]`), VIEW_W / 2, 52, { size: 1, color: DIM, align: 'center' });
    if (this.step === 'race' || this.step === 'class') this.drawPick(ctx, ui);
    else if (this.step === 'stats') this.drawStats(ctx, ui);
    else if (this.step === 'options') this.drawOptions(ctx);
    else this.drawName(ctx, ui);
  }
  private drawPick(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const list = this.step === 'race' ? RACES : CLASSES;
    const sel = this.step === 'race' ? this.race : this.cls;
    for (let i = 0; i < list.length; i++) drawText(ctx, (sel === i ? '> ' : '  ') + list[i].name.toUpperCase(), 60, 76 + i * 16, { size: list.length > 12 ? 1 : 2, color: sel === i ? HI : TEXT });
    const d = list[sel];
    const x = 330;
    drawText(ctx, d.name.toUpperCase(), x, 76, { size: 2, color: HI });
    const desc = wrapText(d.desc, 62);
    for (let i = 0; i < desc.length; i++) drawText(ctx, desc[i], x, 100 + i * 11, { size: 1, color: TEXT });
    let ly = 100 + desc.length * 11 + 10;
    for (const s of STATS) { const v = d.stats[s]; drawText(ctx, `${s} ${v >= 0 ? '+' : ''}${v}`, x + STATS.indexOf(s) * 70, ly, { size: 1, color: v > 0 ? '#a0ffa0' : v < 0 ? '#ff8080' : DIM }); }
    ly += 14;
    drawText(ctx, `HIT DIE ${d.hitDie}   EXP ${d.expPct}%`, x, ly, { size: 1, color: DIM }); ly += 11;
    if (this.step === 'race') { const r = d as typeof RACES[number]; drawText(ctx, `INFRAVISION ${r.infra * 10} FT   ${r.flags.join(' ').replace(/_/g, ' ')}`, x, ly, { size: 1, color: '#a0c0ff' }); }
    else {
      const c = d as typeof CLASSES[number];
      drawText(ctx, `PLAYS AS THE GAUNTLET ${c.hero.toUpperCase()}   ${c.realm ? c.realm.toUpperCase() + ' REALM' : 'NO MAGIC'}   ${c.maxAttacks} MAX BLOWS`, x, ly, { size: 1, color: '#a0c0ff' }); ly += 11;
      const kit = wrapText('STARTS WITH: ' + c.startItems.map(([k, n]) => (n > 1 ? n + ' ' : '') + (kindOf({ kind: k } as Item)?.name || k)).join(', '), 70);
      for (const line of kit) { drawText(ctx, line, x, ly, { size: 1, color: DIM }); ly += 11; }
      ly -= 11;
    }
    this.preview(ctx, ui);
    const skills = d.skills;
    ly += 22;
    drawText(ctx, `MELEE ${skills.melee}  BOWS ${skills.bows}  STEALTH ${skills.stealth}  SEARCH ${skills.search}  DISARM ${skills.disarm}  DEVICE ${skills.device}  SAVE ${skills.save}`, x, ly, { size: 1, color: DIM });
    drawText(ctx, 'ARROWS  ENTER CONFIRM  ESC BACK', VIEW_W / 2, VIEW_H - 24, { size: 1, color: DIM, align: 'center' });
  }
  private drawStats(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const r = RACES[this.race], c = CLASSES[this.cls];
    const x = 120;
    drawText(ctx, `${r.name.toUpperCase()} ${c.name.toUpperCase()}   MODE: ${this.pointBuy ? 'POINT BUY' : 'ROLLED'}   (P SWITCHES)`, x, 80, { size: 1, color: DIM });
    const st = this.stats();
    drawText(ctx, 'STAT     BASE   RACE  CLASS   TOTAL' + (this.pointBuy ? '    COST OF NEXT' : ''), x, 104, { size: 1, color: DIM });
    STATS.forEach((s, i) => {
      const ly = 120 + i * 16;
      if (this.pointBuy && i === this.statSel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x - 6, ly - 3, 420, 14); }
      const base = this.pointBuy ? this.base[s] : st[s] - r.stats[s] - c.stats[s];
      drawText(ctx, `${s}      ${String(base).padStart(4)}   ${(r.stats[s] >= 0 ? '+' : '') + r.stats[s]}     ${(c.stats[s] >= 0 ? '+' : '') + c.stats[s]}     ${statText(st[s]).padStart(5)}${this.pointBuy ? '       ' + (this.base[s] < 18 ? statCost(this.base[s]) : '-') : ''}`, x, ly, { size: 1, color: TEXT });
    });
    if (this.pointBuy) {
      const left = POINT_BUDGET - this.spent();
      drawText(ctx, `POINTS LEFT ${left}   (UNSPENT POINTS BECOME ${left * 50} GOLD)`, x, 230, { size: 1, color: left ? HI : DIM });
      drawText(ctx, 'UP / DOWN PICK A STAT   RIGHT / +  RAISE   LEFT / -  LOWER   R RESET', x, 250, { size: 1, color: DIM });
    } else {
      drawText(ctx, 'R REROLLS   (THE TOTAL SHOWN IS WHAT YOU GET)', x, 230, { size: 1, color: DIM });
    }
    // Derived preview: hit points and mana at level 1.
    const p = createPlayer('Preview', r.id, c.id, this.sex, st);
    drawText(ctx, `AT LEVEL 1: ${p.mhp + r.hitDie + c.hitDie > 0 ? '' : ''}HIT DIE ${r.hitDie + c.hitDie}   STARTING GOLD ${p.gold + (this.pointBuy ? (POINT_BUDGET - this.spent()) * 50 : 0)}`, x, 280, { size: 1, color: '#a0c0ff' });
    this.preview(ctx, ui);
    drawText(ctx, 'ENTER CONFIRM  ESC BACK', VIEW_W / 2, VIEW_H - 24, { size: 1, color: DIM, align: 'center' });
  }
  private drawOptions(ctx: CanvasRenderingContext2D): void {
    const x = 120;
    BIRTH_OPTIONS.forEach((o, i) => {
      const ly = 90 + i * 22;
      const [name, desc] = OPTION_TEXT[o];
      if (i === this.optSel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x - 6, ly - 4, 720, 20); }
      drawText(ctx, name.toUpperCase(), x, ly, { size: 2, color: this.options[o] ? '#a0ffa0' : TEXT });
      drawText(ctx, this.options[o] ? 'YES' : 'NO', x + 300, ly, { size: 2, color: this.options[o] ? '#a0ffa0' : '#ff8080' });
      drawText(ctx, desc, x, ly + 12, { size: 1, color: DIM });
    });
    drawText(ctx, 'UP / DOWN SELECT   SPACE TOGGLE   ENTER CONFIRM   ESC BACK', VIEW_W / 2, VIEW_H - 24, { size: 1, color: DIM, align: 'center' });
  }
  private drawName(ctx: CanvasRenderingContext2D, ui: Ui): void {
    drawText(ctx, `${RACES[this.race].name.toUpperCase()} ${CLASSES[this.cls].name.toUpperCase()}   (${this.sex.toUpperCase()}, TAB TO CHANGE)`, VIEW_W / 2, 90, { size: 1, color: DIM, align: 'center' });
    drawText(ctx, this.name + ((ui.frame >> 4) % 2 ? '_' : ' '), VIEW_W / 2, 130, { size: 3, color: HI, align: 'center' });
    drawText(ctx, 'TYPE A NAME AND PRESS ENTER (OR ENTER FOR A RANDOM ONE)', VIEW_W / 2, 180, { size: 1, color: DIM, align: 'center' });
    if (!this.history) this.history = makeHistory(RACES[this.race].id, this.sex, n => Math.floor(Math.random() * n));
    const lines = wrapText(this.history, 80);
    for (let i = 0; i < lines.length; i++) drawText(ctx, lines[i], VIEW_W / 2, 220 + i * 12, { size: 1, color: TEXT, align: 'center' });
    drawText(ctx, 'H REWRITES YOUR HISTORY', VIEW_W / 2, 220 + lines.length * 12 + 10, { size: 1, color: DIM, align: 'center' });
    this.preview(ctx, ui);
  }
  private preview(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const cls = CLASSES[this.cls].id, race = RACES[this.race].id;
    const key = cls + '/' + race;
    if (!this.previewFor || this.previewKey !== key) {
      const p = createPlayer('Preview', race, cls, this.sex);
      const w = CLASS_BY_ID[cls].startItems.find(([k]) => isWeapon(kindOf({ kind: k } as Item)));
      if (w) p.equip.weapon = makeItem(w[0], 1);
      this.previewFor = buildHero(p);
      this.previewKey = key;
    }
    ctx.save();
    ctx.translate(VIEW_W - 150, 330);
    const sc = 3 * (RACE_BY_ID[race].size || 1);
    ctx.scale(sc, sc);
    drawHero(ctx, this.previewFor, 0, 0, (ui.frame >> 6) % 2 ? -1 : 1);
    ctx.restore();
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const u = ui as Ui2;
    const next = () => { this.step = STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(this.step) + 1)]; };
    const back = () => { if (this.step === 'race') ui.pop(); else this.step = STEPS[STEPS.indexOf(this.step) - 1]; };
    if (this.step === 'race' || this.step === 'class') {
      const n = this.step === 'race' ? RACES.length : CLASSES.length;
      const cur = this.step === 'race' ? this.race : this.cls;
      let nx = cur;
      if (e.key === 'ArrowDown' || e.key === 'j') nx = (cur + 1) % n;
      if (e.key === 'ArrowUp' || e.key === 'k') nx = (cur + n - 1) % n;
      if (this.step === 'race') this.race = nx; else this.cls = nx;
      if (nx !== cur) this.rolled = null;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { next(); if ((this.step as BirthStep) === 'stats' && !this.pointBuy && !this.rolled) this.reroll(); }
      if (e.key === 'Escape' || e.key === 'ArrowLeft') back();
      return true;
    }
    if (this.step === 'stats') {
      if (e.key === 'Escape') { back(); return true; }
      if (e.key === 'Enter') { next(); return true; }
      if (e.key === 'p' || e.key === 'P') { this.pointBuy = !this.pointBuy; if (!this.pointBuy && !this.rolled) this.reroll(); return true; }
      if (e.key === 'r' || e.key === 'R') { if (this.pointBuy) this.base = { STR: 10, INT: 10, WIS: 10, DEX: 10, CON: 10, CHR: 10 }; else this.reroll(); return true; }
      if (!this.pointBuy) return true;
      if (e.key === 'ArrowDown' || e.key === 'j') this.statSel = (this.statSel + 1) % 6;
      if (e.key === 'ArrowUp' || e.key === 'k') this.statSel = (this.statSel + 5) % 6;
      const s = STATS[this.statSel];
      if (e.key === 'ArrowRight' || e.key === '+' || e.key === '=' || e.key === 'l') { if (this.base[s] < 18 && this.spent() + statCost(this.base[s]) <= POINT_BUDGET) this.base[s]++; }
      if (e.key === 'ArrowLeft' || e.key === '-' || e.key === 'h') { if (this.base[s] > 8) this.base[s]--; }
      return true;
    }
    if (this.step === 'options') {
      if (e.key === 'Escape') { back(); return true; }
      if (e.key === 'Enter') { next(); return true; }
      if (e.key === 'ArrowDown' || e.key === 'j') this.optSel = (this.optSel + 1) % BIRTH_OPTIONS.length;
      if (e.key === 'ArrowUp' || e.key === 'k') this.optSel = (this.optSel + BIRTH_OPTIONS.length - 1) % BIRTH_OPTIONS.length;
      if (e.key === ' ' || e.key === 'y' || e.key === 'n' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const o = BIRTH_OPTIONS[this.optSel]; this.options[o] = e.key === 'y' ? true : e.key === 'n' ? false : !this.options[o]; }
      return true;
    }
    // name
    if (e.key === 'Escape') { back(); return true; }
    if (e.key === 'Tab') { this.sex = this.sex === 'male' ? 'female' : 'male'; this.history = ''; return true; }
    if (e.key === 'H' || (e.key === 'h' && !this.name)) { this.history = makeHistory(RACES[this.race].id, this.sex, n => Math.floor(Math.random() * n)); return true; }
    if (e.key === 'Enter') {
      const name = this.name.trim() || randomName();
      const stats = this.stats();
      const extra = { stats, options: this.options, history: this.history };
      ui.pop();
      if (u.newGame2) u.newGame2(name, RACES[this.race].id, CLASSES[this.cls].id, this.sex, extra); else ui.newGame(name, RACES[this.race].id, CLASSES[this.cls].id, this.sex);
      // Unspent points become gold.
      if (this.pointBuy) ui.g.player.gold += (POINT_BUDGET - this.spent()) * 50;
      return true;
    }
    if (e.key === 'Backspace') { this.name = this.name.slice(0, -1); return true; }
    if (e.key.length === 1 && this.name.length < 14 && /[a-zA-Z0-9 '\-]/.test(e.key)) this.name += e.key;
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    if (this.step === 'race' || this.step === 'class') {
      const list = this.step === 'race' ? RACES : CLASSES;
      const i = Math.floor((y - 72) / 16);
      if (x < 320 && i >= 0 && i < list.length) { if ((this.step === 'race' ? this.race : this.cls) === i) this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui); else { if (this.step === 'race') this.race = i; else this.cls = i; this.rolled = null; } }
      else this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui);
      return true;
    }
    if (this.step === 'options') { const i = Math.floor((y - 86) / 22); if (i >= 0 && i < BIRTH_OPTIONS.length) { this.optSel = i; const o = BIRTH_OPTIONS[i]; this.options[o] = !this.options[o]; } else this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui); return true; }
    if (this.step === 'stats') { const i = Math.floor((y - 117) / 16); if (this.pointBuy && i >= 0 && i < 6) { this.statSel = i; this.key({ key: x > 300 ? 'ArrowRight' : 'ArrowLeft', shift: false, ctrl: false, alt: false, code: '' }, ui); } else this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui); return true; }
    this.key({ key: 'Enter', shift: false, ctrl: false, alt: false, code: '' }, ui);
    return true;
  }
}
function randomName(): string {
  const a = ['Thor', 'Merlin', 'Thyra', 'Questor', 'Grim', 'Elenna', 'Bram', 'Sable', 'Vala', 'Orin', 'Tamsin', 'Dagny', 'Sumner', 'Falcon', 'Jester', 'Tygra'];
  return a[Math.floor(Math.random() * a.length)];
}
export const _keep2 = [drawItemIcon, artifactById, baseName, rng];

// ---------------------------------------------------------------------------------------------
// Ignore settings (Angband's squelch): what the hero cannot be bothered to pick up

export class IgnoreOverlay implements Overlay {
  sel = 0;
  private rows(g: Game): { group?: IgnoreGroup; kind?: string }[] {
    return [...IGNORE_GROUPS.map(gp => ({ group: gp })), ...g.ignore.kinds.map(k => ({ kind: k }))];
  }
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const g = ui.g;
    const rows = this.rows(g);
    const w = 640, h = 70 + rows.length * 13 + 44, x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    box(ctx, x, y, w, h, 'IGNORE');
    let ly = y + 34;
    drawText(ctx, g.options.ignoreItems ? 'IGNORING IS ON (= TOGGLES IT)' : 'IGNORING IS OFF (= TURNS IT ON)', x + 16, ly, { size: 1, color: g.options.ignoreItems ? '#a0ffa0' : '#ff8080' });
    ly += 16;
    rows.forEach((r, i) => {
      if (i === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(x + 6, ly - 2, w - 12, 12); }
      if (r.group) {
        const q = g.ignore.quality[r.group];
        drawText(ctx, IGNORE_GROUP_LABEL[r.group], x + 20, ly, { size: 1, color: TEXT });
        drawText(ctx, q.toUpperCase(), x + 190, ly, { size: 1, color: q === 'none' ? DIM : '#ffb060' });
        drawText(ctx, IGNORE_QUALITY_TEXT[q], x + 290, ly, { size: 1, color: DIM });
      } else if (r.kind) {
        const k = OBJECTS.find(o => o.id === r.kind);
        drawText(ctx, k ? baseName(k) : r.kind, x + 20, ly, { size: 1, color: '#ffb060' });
        drawText(ctx, 'IGNORED KIND   (ENTER KEEPS IT AGAIN)', x + 290, ly, { size: 1, color: DIM });
      }
      ly += 13;
    });
    drawText(ctx, 'UP / DOWN SELECT   LEFT / RIGHT SET   ESC CLOSES', x + w / 2, y + h - 14, { size: 1, color: DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const g = ui.g;
    const rows = this.rows(g);
    if (e.key === 'Escape' || e.key === 'O') { ui.pop(); return true; }
    if (e.key === '=') { g.options.ignoreItems = !g.options.ignoreItems; return true; }
    if (!rows.length) return true;
    if (e.key === 'ArrowDown' || e.key === 'j') { this.sel = (this.sel + 1) % rows.length; return true; }
    if (e.key === 'ArrowUp' || e.key === 'k') { this.sel = (this.sel - 1 + rows.length) % rows.length; return true; }
    const r = rows[Math.min(this.sel, rows.length - 1)];
    if (r.group) {
      const cur = IGNORE_QUALITIES.indexOf(g.ignore.quality[r.group]);
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'Enter' || e.key === ' ') { g.ignore.quality[r.group] = IGNORE_QUALITIES[Math.min(IGNORE_QUALITIES.length - 1, cur + 1)]; return true; }
      if (e.key === 'ArrowLeft' || e.key === 'h') { g.ignore.quality[r.group] = IGNORE_QUALITIES[Math.max(0, cur - 1)]; return true; }
    } else if (r.kind && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowLeft')) {
      toggleIgnoreKind(g, r.kind);
      this.sel = Math.max(0, this.sel - 1);
      return true;
    }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const g = ui.g;
    const rows = this.rows(g);
    const w = 640, h = 70 + rows.length * 13 + 44, bx = (VIEW_W - w) / 2, by = (VIEW_H - h) / 2;
    if (x < bx || x > bx + w || y < by || y > by + h) { ui.pop(); return true; }
    const i = Math.floor((y - by - 48) / 13);
    if (i >= 0 && i < rows.length) {
      this.sel = i;
      const r = rows[i];
      if (r.group) { const cur = IGNORE_QUALITIES.indexOf(g.ignore.quality[r.group]); g.ignore.quality[r.group] = IGNORE_QUALITIES[(cur + 1) % IGNORE_QUALITIES.length]; }
      else if (r.kind) { toggleIgnoreKind(g, r.kind); this.sel = Math.max(0, i - 1); }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Saved heroes

const CLASS_NAME = (id: string): string => CLASS_BY_ID[id]?.name || id;
const RACE_NAME = (id: string): string => RACE_BY_ID[id]?.name || id;

function agoText(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The list of saved heroes: continue one, or delete one. */
export class SaveSlotsOverlay implements Overlay {
  opaque = true;
  wantsYesNo = true;
  sel = 0;
  confirmDelete = false;
  draw(ctx: CanvasRenderingContext2D, ui: Ui): void {
    const u = ui as Ui2;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawTextOutlined(ctx, 'SAVED HEROES', VIEW_W / 2, 48, { size: 4, color: '#ffd040', align: 'center', outline: '#3a1c00', thickness: 2 });
    const slots = u.slots;
    if (!slots.length) {
      drawText(ctx, u.notice || 'NO SAVED HEROES YET.', VIEW_W / 2, 200, { size: 2, color: DIM, align: 'center' });
      drawText(ctx, 'ESC GOES BACK', VIEW_W / 2, VIEW_H - 40, { size: 1, color: DIM, align: 'center' });
      return;
    }
    if (this.sel >= slots.length) this.sel = slots.length - 1;
    const now = Date.now();
    for (let i = 0; i < slots.length && i < 12; i++) {
      const s = slots[i], y = 110 + i * 30;
      if (i === this.sel) { ctx.fillStyle = 'rgba(255,224,96,0.15)'; ctx.fillRect(120, y - 6, VIEW_W - 240, 26); }
      const col = s.dead ? '#a06060' : i === this.sel ? HI : TEXT;
      drawText(ctx, s.name.toUpperCase(), 140, y, { size: 2, color: col });
      drawText(ctx, `${RACE_NAME(s.race)} ${CLASS_NAME(s.cls)}   LEVEL ${s.lev}`, 340, y + 2, { size: 1, color: DIM });
      drawText(ctx, s.depth === 0 ? 'IN TOWN' : `DEPTH ${s.depth}`, 620, y + 2, { size: 1, color: '#a0a0ff' });
      drawText(ctx, s.dead ? 'DEAD' : agoText(s.savedAt, now), VIEW_W - 140, y + 2, { size: 1, color: DIM, align: 'right' });
    }
    if (u.notice) drawText(ctx, u.notice, VIEW_W / 2, VIEW_H - 62, { size: 1, color: '#ff8080', align: 'center' });
    drawText(ctx, this.confirmDelete ? 'DELETE THIS HERO? Y / N' : 'ENTER CONTINUES   D DELETES   ESC GOES BACK',
      VIEW_W / 2, VIEW_H - 40, { size: 1, color: this.confirmDelete ? '#ff8080' : DIM, align: 'center' });
  }
  key(e: KeyEvent, ui: Ui): boolean {
    const u = ui as Ui2;
    const slots = u.slots;
    if (this.confirmDelete) {
      if (e.key === 'y' || e.key === 'Y') { const s = slots[this.sel]; if (s) u.deleteSlot(s.id); }
      this.confirmDelete = false;
      return true;
    }
    if (e.key === 'Escape') { u.notice = ''; ui.pop(); return true; }
    if (!slots.length) return true;
    if (e.key === 'ArrowDown' || e.key === 'j') { this.sel = (this.sel + 1) % slots.length; return true; }
    if (e.key === 'ArrowUp' || e.key === 'k') { this.sel = (this.sel - 1 + slots.length) % slots.length; return true; }
    if (e.key === 'Enter' || e.key === ' ') { const s = slots[this.sel]; if (s) u.loadSlot(s.id); return true; }
    if (e.key === 'd' || e.key === 'D') { this.confirmDelete = true; return true; }
    return true;
  }
  click(x: number, y: number, ui: Ui): boolean {
    const u = ui as Ui2;
    const i = Math.floor((y - 104) / 30);
    if (i >= 0 && i < u.slots.length) {
      if (this.sel === i) { const s = u.slots[i]; if (s) u.loadSlot(s.id); }
      else this.sel = i;
      return true;
    }
    if (y > VIEW_H - 56) { u.notice = ''; ui.pop(); }
    return true;
  }
}
