// The entry point: the fixed-timestep loop from the engine, the render canvas, input, and the
// keymap. The hero plays itself: the autoplay bot takes every turn from the moment a hero is made
// or loaded, and nothing the player presses takes it over, so the keymap only looks -- it opens
// screens (the bot plays on behind them), saves, quits and retires. Overlays (menus, the inventory,
// the map) sit on a stack above the map and take the keys while open.
import { createCanvas } from './lib/engine/canvas.ts';
import { createLoop } from './lib/engine/loop.ts';
import { setTextDefaults, drawText } from './lib/engine/text.ts';
import { rrect } from './lib/art/shapes.ts';
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H } from './constants.ts';
import type { Game } from './game/state.ts';
import { createGame, enterLevel, setAutosaveHook, respawnInTown } from './game/game.ts';
import { serialize, deserialize } from './game/save.ts';
import { type Pos, T, DIR_DX, DIR_DY } from './game/types.ts';
import { tileAt } from './game/level.ts';
import { autoplayStep, resetAutoplay } from './game/autoplay.ts';
import { Input, type KeyEvent, type PointerEvent2 } from './ui/input.ts';
import { TouchBar } from './ui/touch.ts';
import { type SaveMeta, type SaveRecord, listSaves, readSave, writeSave, deleteSave, migrateLegacySave, newSlotId, keepSavesSafe } from './ui/storage.ts';
import { MapRenderer } from './ui/render.ts';
import { drawHud, drawMessageBar, drawBanner } from './ui/hud.ts';
import { buildHero, syncHero } from './ui/hero.ts';
import { type Overlay, Menu, touchMode, Confirm, InventoryScreen, spellMenu, CharSheet, MapOverlay, HelpOverlay, MessagesOverlay, LookMode, TitleScreen, DeathScreen } from './ui/screens.ts';
import { KnowledgeOverlay, OptionsOverlay, HighScoresOverlay, LocateMode, RecallOverlay, IgnoreOverlay, type Ui2 } from './ui/screens2.ts';
import { characterDump } from './game/dump.ts';
import { type ScoreEntry, SCORES_KEY, scoreEntry, addScore } from './game/scores.ts';
import { mergeLore, type LoreBook } from './game/lore.ts';
import type { Stat } from './game/types.ts';
import type { Options } from './game/options.ts';
import { raceOf } from './game/monster.ts';
import { playQueuedSounds, playEverySound, speak, unlockAudio, resetNarrator, stopSpeaking } from './ui/audio.ts';
const LORE_KEY = 'gauntlet-of-angband.lore.v1';
/** Frames the hero lies fallen before waking in the town: long enough to see what happened. */
const RESPAWN_DELAY = 100;

setTextDefaults({ shadowColor: '#0a0810', outline: '#0a0810' });

class App implements Ui2 {
  g!: Game;
  scores: ScoreEntry[] = [];
  private scoreRecorded = false;
  overlays: Overlay[] = [];
  renderer = new MapRenderer();
  cursor: Pos | null = null;
  target: Pos | null = null;
  frame = 0;
  input: Input;
  touch = new TouchBar();
  canvasApi = createCanvas('stage', { width: VIEW_W, height: VIEW_H });
  ctx = this.canvasApi.ctx;
  started = false;
  lastSave = 0;
  /** Paces the autoplay bot and gives it its housekeeping counter. */
  autoStep = 0;
  /** Saved heroes, newest first. Cached so hasSave() can stay synchronous for the title screen. */
  slots: SaveMeta[] = [];
  notice = '';
  /** Which slot this hero is being written to. */
  currentSlot: string | null = null;
  private saveInFlight = false;
  private pendingSave: SaveRecord | null = null;
  private saveErrorShown = false;
  /** Slots removed this session. A write already in flight for one must not bring it back. */
  private deletedSlots = new Set<string>();
  /** The frame the hero fell on, while the fall is on screen before they wake in the town; -1 otherwise. */
  private fallenAt = -1;

  constructor() {
    this.input = new Input(this.canvasApi.canvas, (x, y) => this.canvasApi.toInternal(x, y));
    setAutosaveHook(g => { if (this.started && g === this.g && !g.player.dead) this.save(); });
    // A phone closes a game it has sent to the background without a word, so save as it leaves the
    // screen rather than trust the minute's autosave to have caught the last of it.
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.started && !this.g.player.dead) this.save(); });
    keepSavesSafe();
    try { this.scores = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); } catch { this.scores = []; }
    // A save from the single-key version becomes the first slot, once.
    migrateLegacySave(json => {
      try {
        const d = JSON.parse(json) as { player: { name: string; race: string; cls: string; lev: number; depth: number; maxDepth: number; dead?: boolean }; turn: number };
        return { name: d.player.name, race: d.player.race, cls: d.player.cls, lev: d.player.lev, depth: d.player.depth, maxDepth: d.player.maxDepth, turn: d.turn, dead: !!d.player.dead };
      } catch { return null; }
    }).then(() => this.refreshSlots());
    this.push(new TitleScreen());
  }
  // -----------------------------------------------------------------------------------------
  // Persistence beyond the save: monster memory, high scores, dumps, export and import.
  private loadLore(): LoreBook { try { return JSON.parse(localStorage.getItem(LORE_KEY) || '{}'); } catch { return {}; } }
  private saveLore(): void { try { localStorage.setItem(LORE_KEY, JSON.stringify(mergeLore(this.loadLore(), this.g.lore))); } catch { /* ignore */ } }
  private recordScore(): number {
    if (this.scoreRecorded) return -1;
    this.scoreRecorded = true;
    const rank = addScore(this.scores, scoreEntry(this.g, new Date().toISOString().slice(0, 10)));
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(this.scores)); } catch { /* ignore */ }
    this.saveLore();
    return rank;
  }
  private download(name: string, text: string, type = 'text/plain'): void {
    try {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { console.warn('download failed', e); }
  }
  dumpCharacter(): void {
    const text = characterDump(this.g);
    this.download(`${this.g.player.name.replace(/[^a-z0-9]/gi, '_') || 'hero'}.txt`, text);
    this.g.msg.add('Character dump written.', '#a0ffa0');
  }
  exportSave(): void {
    if (!this.started) return;
    this.download(`${this.g.player.name.replace(/[^a-z0-9]/gi, '_') || 'hero'}.gauntlet.json`, serialize(this.g), 'application/json');
    this.g.msg.add('Save exported.', '#a0ffa0');
  }
  importSave(): void {
    try {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = () => {
        const f = input.files && input.files[0]; if (!f) return;
        f.text().then(json => {
          try { this.g = deserialize(json); this.currentSlot = newSlotId(); this.begin(); this.save(); this.g.msg.add('Save imported.', '#a0ffa0'); }
          catch (e) { console.error(e); alert('That file is not a Gauntlet of Angband save.'); }
        });
      };
      input.click();
    } catch (e) { console.warn('import failed', e); }
  }
  newGame2(name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string; subrace?: string; subclass?: string }): void {
    this.g = createGame(name, race, cls, sex, undefined, { ...extra, lore: this.loadLore() });
    this.currentSlot = newSlotId();
    this.begin();
  }
  push(o: Overlay): void { this.overlays.push(o); }
  pop(): void { this.overlays.pop(); }
  hasSave(): boolean { return this.slots.length > 0; }
  refreshSlots(): void { listSaves().then(s => { this.slots = s; }).catch(() => { /* the list stays as it was */ }); }

  /**
   * Snapshot the game now and write it in the background. serialize() is synchronous, so the record
   * is always a consistent picture of this instant even though the write lands later.
   */
  save(): void {
    if (!this.started || !this.g) return;
    const g = this.g, p = g.player;
    if (!this.currentSlot) this.currentSlot = newSlotId();
    this.lastSave = this.frame;
    this.queueSave({
      id: this.currentSlot, name: p.name, race: p.race, cls: p.cls, subrace: p.subrace, subclass: p.subclass, lev: p.lev,
      depth: p.depth, maxDepth: p.maxDepth, turn: g.turn, savedAt: Date.now(), dead: p.dead,
      sex: p.sex, gold: p.gold, kills: p.kills, deaths: p.deaths || 0,
      data: serialize(g),
    });
    this.saveLore();
  }
  /** One write at a time; a newer snapshot replaces a waiting one, so the last state always lands. */
  private queueSave(rec: SaveRecord): void {
    this.pendingSave = rec;
    if (this.saveInFlight) return;
    this.saveInFlight = true;
    const flush = (): void => {
      const next = this.pendingSave;
      this.pendingSave = null;
      if (!next) { this.saveInFlight = false; this.refreshSlots(); return; }
      // The hero died (or the slot was deleted) while this snapshot was waiting: drop it, or the
      // write would resurrect a slot the player has already seen disappear.
      if (this.deletedSlots.has(next.id)) { flush(); return; }
      writeSave(next).then(err => {
        if (err && !this.saveErrorShown) {
          this.saveErrorShown = true;
          this.notice = `Saving failed: ${err}.`;
          if (this.started) this.g.msg.add(`This game cannot be saved: ${err}. Export the save (ctrl+E) to keep it.`, '#ff4040');
        }
        flush();
      }).catch(() => {
        // writeSave resolves rather than rejecting, but never strand the queue if that changes.
        this.saveInFlight = false;
        const held = this.pendingSave;
        if (held) { this.pendingSave = null; this.queueSave(held); }
      });
    };
    flush();
  }
  loadGame(): boolean {
    const s = this.slots[0];
    if (!s) return false;
    this.loadSlot(s.id);
    return true;
  }
  /** Load a saved hero; the bot picks it up where it left off. */
  loadSlot(id: string): void {
    readSave(id).then(json => {
      if (!json) { this.notice = 'That hero could not be read back.'; return; }
      try {
        this.g = deserialize(json);
        this.currentSlot = id;
        this.notice = '';
        this.begin();
        this.g.msg.add('Welcome back.', '#ffd040');
      } catch (e) { console.warn('load failed', e); this.notice = 'That hero could not be read back.'; }
    });
  }
  deleteSlot(id: string): void {
    this.deletedSlots.add(id);
    if (this.pendingSave && this.pendingSave.id === id) this.pendingSave = null;
    deleteSave(id).then(() => { if (this.currentSlot === id) this.currentSlot = null; this.refreshSlots(); });
    this.slots = this.slots.filter(s => s.id !== id);
  }
  newGame(name: string, race: string, cls: string, sex: 'male' | 'female'): void {
    this.g = createGame(name, race, cls, sex, undefined, { lore: this.loadLore() });
    this.currentSlot = newSlotId();
    this.begin();
  }
  private begin(): void {
    this.overlays.length = 0;
    this.started = true;
    this.autoStep = 0;
    resetAutoplay();
    this.scoreRecorded = false;
    this.saveErrorShown = false;
    this.fallenAt = -1;
    if (this.currentSlot) this.deletedSlots.delete(this.currentSlot);
    this.renderer.camLock = null;
    this.renderer.hero = buildHero(this.g.player);
    this.renderer.active.length = 0;
    this.renderer.camX = this.g.player.x * 24; this.renderer.camY = this.g.player.y * 24;
    this.target = null;
    this.afterAction();
  }
  quitToTitle(): void {
    this.started = false;
    this.overlays.length = 0;
    this.push(new TitleScreen());
  }
  /** Bookkeeping after any game action: level change, death, hero sync. The bot does its own shopping. */
  afterAction(): void {
    const g = this.g;
    // Death is not the end unless the hero retired: the fall stays on screen for a moment (the
    // narrator has something to say about it), then they wake in the town with nothing but their
    // purse, and the bot carries on from there.
    if (g.player.dead && g.player.deathCause !== 'retirement') {
      g.levelChange = null;
      if (this.fallenAt < 0) { this.fallenAt = this.frame; g.running = null; g.resting = 0; g.travel = null; g.repeating = null; return; }
      if (this.frame - this.fallenAt < RESPAWN_DELAY) return;
      this.fallenAt = -1;
      respawnInTown(g);
      this.arrived();
    }
    if (g.levelChange) {
      const lc = g.levelChange;
      enterLevel(g, lc.depth, lc.by);
      this.arrived();
    }
    this.renderer.hero = syncHero(this.renderer.hero!, g.player);
    // Only retirement reaches here dead: the hero's story is over, the slot goes and the score is kept.
    if (g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) {
      if (this.currentSlot) { const id = this.currentSlot; this.currentSlot = null; this.deleteSlot(id); }
      this.overlays.length = 0;
      const rank = this.recordScore();
      if (rank > 0) g.msg.add(`You rank ${rank} in the Hall of Heroes.`, '#ffd040');
      this.push(new DeathScreen());
    }
    if (g.totalWinner && !g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) { /* keep playing; the banner said it */ }
  }
  /**
   * The hero is somewhere new: down (or up) the stairs, or awake in the town after a fall. The
   * camera goes with it, and a look or locate cursor -- which pointed into the level the bot just
   * left, since it plays on behind every screen -- closes.
   */
  private arrived(): void {
    const p = this.g.player;
    this.renderer.active.length = 0;
    this.renderer.camX = p.x * 24 - this.renderer.viewW / 2; this.renderer.camY = p.y * 24 - this.renderer.viewH / 2;
    this.renderer.camLock = null;
    this.overlays = this.overlays.filter(o => !(o instanceof LookMode || o instanceof LocateMode));
    this.cursor = null;
    this.target = null;
  }
  /**
   * Is the touch bar showing? Only under an open screen -- the hero plays itself, so the map has
   * nothing to press -- and only once a touch has happened, or the option forces it.
   */
  /** Is the player on touch (or has asked for the touch controls)? Bigger targets and a closer map. */
  private touchActive(): boolean { return this.touch.detected || (this.started && this.g.options.touchControls); }
  touchVisible(): boolean { return this.overlays.length > 0 && (this.touch.detected || (this.started && this.g.options.touchControls)); }
  /**
   * Turn taps that landed on the touch bar into the key presses they stand for, and hand back the
   * taps that did not. Buttons never duplicate command logic; they go through the ordinary keymap.
   */
  private consumeTouch(clicks: PointerEvent2[]): PointerEvent2[] {
    if (!this.touchVisible()) return clicks;
    const out: PointerEvent2[] = [];
    for (const c of clicks) {
      if (c.kind !== 'down') { out.push(c); continue; }
      const b = this.touch.hit(c.x, c.y, this.topWantsYesNo());
      if (!b) { out.push(c); continue; }
      // code 'touch' marks the press as synthetic.
      this.handleKeyPublic({ key: b.key, shift: !!b.shift, ctrl: !!b.ctrl, alt: false, code: 'touch' });
    }
    return out;
  }
  /** Does the screen on top actually ask a yes/no question? */
  private topWantsYesNo(): boolean {
    const top = this.overlays[this.overlays.length - 1];
    return !!(top && top.wantsYesNo);
  }

  /**
   * Play whatever the game asked for this frame, and let the narrator shout the banners. The game
   * logic only ever queues string ids; everything that touches WebAudio lives in ui/audio.ts.
   */
  private lastBanner = '';
  private pumpAudio(): void {
    if (!this.started) return;
    const g = this.g;
    playQueuedSounds(g);
    const b = g.msg.banner;
    if (!b) { if (this.lastBanner) { this.lastBanner = ''; resetNarrator(); } return; }
    if (b.text === this.lastBanner) return;
    this.lastBanner = b.text;
    if (g.options.voice) speak(b.text); else stopSpeaking();
  }

  /** Test hook: deliver a key exactly as the loop would. */
  handleKeyPublic(e: KeyEvent): void {
    if (this.overlays.length) { this.overlays[this.overlays.length - 1].key(e, this); if (this.started) { if (this.g.player.dead || this.g.levelChange) this.afterAction(); } return; }
    if (!this.started) return;
    this.handleKey(e);
  }

  // -----------------------------------------------------------------------------------------
  // Per-frame

  update(): void {
    this.frame++;
    const keys = this.input.drain();
    const clicks = this.input.drainPointer();
    // Browsers keep audio silent until the player has touched something.
    if (keys.length || clicks.length) unlockAudio();
    // A real touch turns the touch bar on for good.
    if (!this.touch.detected && clicks.some(c => c.pointerType === 'touch')) this.touch.detected = true;
    touchMode.on = this.touchActive();
    this.renderer.zoom = touchMode.on ? 2 : 1;
    // The touch bar gets first refusal on every tap; what it does not want falls through to the map
    // and to the overlays, so a mouse keeps behaving exactly as before.
    const taps = this.consumeTouch(clicks);
    // An overlay takes the keys and the clicks while it is open; otherwise they go to the keymap.
    const top = this.overlays[this.overlays.length - 1];
    if (top) {
      for (const e of keys) top.key(e, this);
      for (const c of taps) if (c.kind === 'down' && top.click) top.click(c.x, c.y, this);
    }
    if (!this.started) return;
    const g = this.g;
    if (g.player.dead) { this.afterAction(); this.renderer.update(g); this.pumpAudio(); return; }
    if (!top) {
      for (const e of keys) this.handleKey(e);
      for (const c of taps) if (c.kind === 'down') this.handleClick(c.x, c.y, c.button);
      // ctrl+X went back to the title screen.
      if (!this.started) return;
    }
    // The bot takes the hero's turn whatever is open: nothing the player presses stops it, and the
    // inventory, the map or the character sheet can be watched while it plays.
    if (!this.renderer.busy() && this.frame % 6 === 0) { autoplayStep(g, this.autoStep++); this.afterAction(); }
    this.renderer.hilite = g.travel ? g.travel.slice(0, 40) : [];
    this.renderer.update(g);
    this.pumpAudio();
    if (this.frame - this.lastSave > 60 * 60) this.save();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const top = this.overlays[this.overlays.length - 1];
    if (this.started && !(top && top.opaque)) {
      this.renderer.cursor = this.cursor;
      this.renderer.draw(ctx, this.g);
      drawMessageBar(ctx, this.g);
      drawHud(ctx, this.g, this.frame);
      drawBanner(ctx, this.g);
      // Store name when standing next to a door.
      if (this.g.level.depth === 0) this.drawShopLabels(ctx);
      if (!top && touchMode.on) this.drawMenuButton(ctx);
    }
    for (const o of this.overlays) o.draw(ctx, this);
    if (this.touchVisible()) this.touch.draw(ctx, this.topWantsYesNo());
    this.canvasApi.present();
  }
  /** The way back out, for a phone: the map has no buttons, so one small MENU sits in its corner. */
  private menuButton(): { x: number; y: number; w: number; h: number } { return { x: MAP_X + MAP_W - 112, y: MAP_Y + 8, w: 104, h: 44 }; }
  private drawMenuButton(ctx: CanvasRenderingContext2D): void {
    const b = this.menuButton();
    ctx.save(); ctx.globalAlpha = 0.85;
    rrect(ctx, b.x, b.y, b.w, b.h, 6, 'rgba(24,20,36,0.9)', '#7a7490', 2);
    drawText(ctx, 'MENU', b.x + b.w / 2, b.y + b.h / 2 - 7, { size: 2, color: '#ffe060', align: 'center' });
    ctx.restore();
  }
  /** Resume, the screens worth reaching by touch, and the way back to the title (saving first). */
  openGameMenu(): void {
    const items: [string, () => void][] = [
      ['RESUME', () => {}],
      ['INVENTORY', () => this.push(new InventoryScreen('inven'))],
      ['EQUIPMENT', () => this.push(new InventoryScreen('equip'))],
      ['CHARACTER', () => this.push(new CharSheet())],
      ['MAP', () => this.push(new MapOverlay())],
      ['MESSAGES', () => this.push(new MessagesOverlay())],
      ['OPTIONS', () => this.push(new OptionsOverlay())],
      ['HELP', () => this.push(new HelpOverlay())],
      ['SAVE AND MAIN MENU', () => { this.save(); this.quitToTitle(); }],
    ];
    this.push(new Menu('MENU', items.map(([text]) => ({ text })), (_l, i, u) => { u.pop(); items[i][1](); }, { letters: false, width: 360 }));
  }
  private drawShopLabels(ctx: CanvasRenderingContext2D): void {
    const g = this.g, p = g.player;
    for (let d = 1; d <= 9; d++) {
      const x = p.x + DIR_DX[d], y = p.y + DIR_DY[d];
      const t = tileAt(g.level, x, y);
      if (t >= T.SHOP_0 && t < T.SHOP_0 + 8) {
        const s = this.renderer.tileToScreen(x, y);
        const name = ['GENERAL STORE', 'ARMOURY', 'WEAPONSMITH', 'TEMPLE', 'ALCHEMY SHOP', 'MAGIC SHOP', 'BLACK MARKET', 'HOME'][t - T.SHOP_0];
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x - 30, s.y - 34, 84, 12);
        ctx.fillStyle = '#ffe060';
        drawLabel(ctx, name, s.x + 12, s.y - 32);
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  // Keymap

  /**
   * What a key does on the map. The hero plays itself and no key takes it over, so the keymap only
   * looks: it opens screens (the bot plays on behind them), saves, quits and retires. A key that
   * would play -- a step, a potion, a spell, the stairs -- does nothing.
   */
  handleKey(e: KeyEvent): void {
    const g = this.g, p = g.player;
    if (e.ctrl) {
      switch (e.key.toLowerCase()) {
        case 's': this.save(); g.msg.add('Game saved.', '#a0ffa0'); return;
        case 'x': this.save(); g.msg.add('Game saved.', '#a0ffa0'); this.quitToTitle(); return;
        case 'p': this.push(new MessagesOverlay()); return;
        case 'f': g.msg.add(`Level feeling: ${g.level.feeling || 'none'}. Depth ${g.level.depth}.`); return;
        case 'l': this.push(new LocateMode({ x: p.x, y: p.y })); return;
        case 'e': this.exportSave(); return;
        case 'k': this.push(new KnowledgeOverlay()); return;
        case 'o': g.showIgnored = !g.showIgnored; g.msg.add(g.showIgnored ? 'You take another look at what you have been ignoring.' : 'You go back to ignoring the junk.'); return;
      }
      return;
    }
    switch (e.key) {
      case 'Escape': this.openGameMenu(); break;
      case '~': case '|': this.push(new KnowledgeOverlay()); break;
      case '=': this.push(new OptionsOverlay()); break;
      case 'V': this.push(new HighScoresOverlay()); break;
      case '/': { const m = g.level.monsters.filter(mm => mm.visible).sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y))[0]; if (m) this.push(new RecallOverlay(raceOf(m))); else g.msg.add('No monster in view to recall.'); break; }
      case 'i': this.push(new InventoryScreen('inven')); break;
      case 'e': this.push(new InventoryScreen('equip')); break;
      case 'b': spellMenu(this, 'browse', () => {}); break;
      case 'C': this.push(new CharSheet()); break;
      case 'M': this.push(new MapOverlay()); break;
      case 'x': case 'l': this.cursor = { x: p.x, y: p.y }; this.push(new LookMode()); break;
      case 'O': this.push(new IgnoreOverlay()); break;
      case '?': this.push(new HelpOverlay()); break;
      case 'Q': this.push(new Confirm('Retire this character? (the save is deleted)', () => { p.dead = true; p.deathCause = 'retirement'; this.afterAction(); })); break;
    }
  }
  /** The mouse only looks too: right-click the map to look there, or click the side panel for the pack. */
  handleClick(x: number, y: number, button: number): void {
    const mb = this.menuButton();
    if (touchMode.on && x >= mb.x - 4 && x <= mb.x + mb.w + 4 && y >= mb.y - 4 && y <= mb.y + mb.h + 8) { this.openGameMenu(); return; }
    if (x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H) {
      if (button === 2) { this.cursor = this.renderer.screenToTile(x, y); this.push(new LookMode()); }
    } else if (x >= VIEW_W - 216) {
      this.push(new InventoryScreen('inven'));
    }
  }
}
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  drawText(ctx, text, x, y, { size: 1, color: '#ffe060', align: 'center' });
}

const app = new App();
const loop = createLoop({ update: () => app.update(), render: () => app.render() });
loop.start();
window.__game = window.__game || { ready: false, errors: [] };
window.__game.ready = true;
window.__game.api = {
  get game() { return app.g; },
  app,
  newGame: (name: string, race: string, cls: string, sex: 'male' | 'female') => app.newGame(name, race, cls, sex),
  newGame2: (name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string; subrace?: string; subclass?: string }) => app.newGame2(name, race, cls, sex, extra),
  dump: () => characterDump(app.g),
  key: (key: string, shift = false, ctrl = false) => { app.handleKeyPublic({ key, shift, ctrl, alt: false, code: '' }); },
  step: () => { app.update(); app.render(); },
  /** Self-test hook: synthesise every sound once. Used by tools/smoke.ts. */
  testAudio: () => playEverySound(),
};
export type GameApi = {
  readonly game: Game;
  app: unknown;
  newGame(name: string, race: string, cls: string, sex: 'male' | 'female'): void;
  newGame2(name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string; subrace?: string; subclass?: string }): void;
  dump(): string;
  key(key: string, shift?: boolean, ctrl?: boolean): void;
  step(): void;
  testAudio(): number;
};
