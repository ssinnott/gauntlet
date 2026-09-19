// The entry point: the fixed-timestep loop from the engine, the render canvas, input, and the
// keymap that turns key presses into game commands. Overlays (menus, prompts, stores) sit on a
// stack above the map and take the keys while open.
import { createCanvas } from './lib/engine/canvas.ts';
import { createLoop } from './lib/engine/loop.ts';
import { setTextDefaults, drawText } from './lib/engine/text.ts';
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H } from './constants.ts';
import type { Game } from './game/state.ts';
import { createGame, enterLevel, setAutosaveHook } from './game/game.ts';
import { serialize, deserialize } from './game/save.ts';
import * as C from './game/commands.ts';
import { kindOf, itemName, isAmmo, isWearable, identify, inscriptionConfirms } from './game/items.ts';
import { toggleIgnoreKind } from './game/ignore.ts';
import { needsDir, needsItem, type EffectCtx } from './game/effects.ts';
import { type Item, type Pos, T, DIR_DX, DIR_DY, dirOf } from './game/types.ts';
import { tileAt, itemsAt, monsterAt, auxAt } from './game/level.ts';
import { SPELL_BY_ID } from './game/data/spells.ts';
import { CLASS_BY_ID } from './game/data/classes.ts';
import { refreshBonuses } from './game/effectsCore.ts';
import { autoplayStep, resetAutoplay } from './game/autoplay.ts';
import { Input, dirOfKey, type KeyEvent, type PointerEvent2 } from './ui/input.ts';
import { TouchPad } from './ui/touch.ts';
import { type SaveMeta, type SaveRecord, listSaves, readSave, writeSave, deleteSave, migrateLegacySave, newSlotId } from './ui/storage.ts';
import { MapRenderer } from './ui/render.ts';
import { drawHud, drawMessageBar, drawBanner } from './ui/hud.ts';
import { buildHero, syncHero } from './ui/hero.ts';
import { type Ui, type Overlay, Menu, pickItem, DirPrompt, QuantityPrompt, TextPrompt, Confirm, InventoryScreen, StoreScreen, spellMenu, CharSheet, MapOverlay, HelpOverlay, MessagesOverlay, LookMode, TitleScreen, DeathScreen, type ItemWhere } from './ui/screens.ts';
import { artifactById } from './game/artifacts.ts';
import { KnowledgeOverlay, OptionsOverlay, HighScoresOverlay, LocateMode, RecallOverlay, IgnoreOverlay, type Ui2 } from './ui/screens2.ts';
import { characterDump } from './game/dump.ts';
import { type ScoreEntry, SCORES_KEY, scoreEntry, addScore } from './game/scores.ts';
import { mergeLore, type LoreBook } from './game/lore.ts';
import type { Stat } from './game/types.ts';
import type { Options } from './game/options.ts';
import { MONSTER_BY_ID } from './game/data/monsters.ts';
import { raceOf } from './game/monster.ts';
import { playQueuedSounds, playEverySound, speak, unlockAudio, resetNarrator, stopSpeaking } from './ui/audio.ts';
const LORE_KEY = 'gauntlet-of-angband.lore.v1';

setTextDefaults({ shadowColor: '#0a0810', outline: '#0a0810' });

class App implements Ui2 {
  g!: Game;
  scores: ScoreEntry[] = [];
  /** The last repeatable action, for Enter. */
  lastAction: (() => void) | null = null;
  private scoreRecorded = false;
  overlays: Overlay[] = [];
  renderer = new MapRenderer();
  cursor: Pos | null = null;
  target: Pos | null = null;
  frame = 0;
  input: Input;
  touch = new TouchPad();
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

  constructor() {
    this.input = new Input(this.canvasApi.canvas, (x, y) => this.canvasApi.toInternal(x, y));
    setAutosaveHook(g => { if (this.started && g === this.g && !g.player.dead) this.save(); });
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
  newGame2(name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string }): void {
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
      id: this.currentSlot, name: p.name, race: p.race, cls: p.cls, lev: p.lev,
      depth: p.depth, maxDepth: p.maxDepth, turn: g.turn, savedAt: Date.now(), dead: p.dead,
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
    if (this.currentSlot) this.deletedSlots.delete(this.currentSlot);
    this.lastAction = null;
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
  /** Bookkeeping after any game action: level change, store entry, death, hero sync, autosave. */
  afterAction(): void {
    const g = this.g;
    if (g.levelChange) {
      const lc = g.levelChange;
      enterLevel(g, lc.depth, lc.by);
      this.renderer.active.length = 0;
      this.renderer.camX = g.player.x * 24 - MAP_W / 2; this.renderer.camY = g.player.y * 24 - MAP_H / 2;
      this.target = null;
    }
    if (g.inStore >= 0 && !g.options.autoplay && !this.overlays.some(o => o instanceof StoreScreen)) this.push(new StoreScreen(g.inStore));
    this.renderer.hero = syncHero(this.renderer.hero!, g.player);
    if (g.player.dead) g.options.autoplay = false;
    if (g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) {
      if (this.currentSlot) { const id = this.currentSlot; this.currentSlot = null; this.deleteSlot(id); }
      this.overlays.length = 0;
      const rank = this.recordScore();
      if (rank > 0) g.msg.add(`You rank ${rank} in the Hall of Heroes.`, '#ffd040');
      this.push(new DeathScreen());
    }
    if (g.totalWinner && !g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) { /* keep playing; the banner said it */ }
  }
  /** Are the on-screen controls showing? Either a touch happened, or the option forces them. */
  touchVisible(): boolean { return this.touch.detected || (this.started && this.g.options.touchControls); }
  /**
   * Turn taps that landed on the touch layer into the key presses they stand for, and hand back the
   * taps that did not. Buttons never duplicate command logic; they go through the ordinary keymap.
   */
  private consumeTouch(clicks: PointerEvent2[]): PointerEvent2[] {
    if (!this.touchVisible()) return clicks;
    const out: PointerEvent2[] = [];
    for (const c of clicks) {
      if (c.kind !== 'down') { out.push(c); continue; }
      const b = this.touch.hit(c.x, c.y, this.overlays.length > 0, this.topWantsYesNo());
      if (!b) { out.push(c); continue; }
      if (b.page) { this.touch.nextPage(); continue; }
      // A button press is an interruption like any other key. It does not pass through
      // Input.queue, so the "any key stops running, resting and travelling" rule below would
      // otherwise never see it, and a sidestep during a long walk would be silently undone.
      if (this.started) { const g = this.g; g.running = null; g.resting = 0; g.travel = null; g.repeating = null; }
      // code 'touch' marks the press as synthetic, so handleKey does not read a command letter as
      // a vi movement key. Without it the STAFF button ('u') walked the hero north-east.
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
  travel(x: number, y: number): void {
    if (!C.travelTo(this.g, x, y)) this.g.msg.add('No known path there.');
  }

  // -----------------------------------------------------------------------------------------
  // Per-frame

  update(): void {
    this.frame++;
    const now = performance.now();
    const keys = this.input.drain();
    const clicks = this.input.drainPointer();
    // Browsers keep audio silent until the player has touched something.
    if (keys.length || clicks.length) unlockAudio();
    // A real touch turns the on-screen controls on for good.
    if (!this.touch.detected && clicks.some(c => c.pointerType === 'touch')) this.touch.detected = true;
    // The touch layer gets first refusal on every tap; what it does not want falls through to the
    // map and to the overlays, so a mouse keeps behaving exactly as before.
    const taps = this.consumeTouch(clicks);
    // Overlays take everything.
    if (this.overlays.length) {
      const top = this.overlays[this.overlays.length - 1];
      for (const e of keys) top.key(e, this);
      for (const c of taps) if (c.kind === 'down' && top.click) top.click(c.x, c.y, this);
      if (this.started) { this.renderer.update(this.g); if (this.g.player.dead || this.g.levelChange) this.afterAction(); }
      this.pumpAudio();
      return;
    }
    if (!this.started) return;
    const g = this.g;
    if (g.player.dead) { this.afterAction(); return; }
    // Continuous actions run on a timer so the player can watch (and interrupt with any key).
    if (keys.length && (g.running || g.resting || g.travel || g.repeating)) { g.running = null; g.resting = 0; g.travel = null; g.repeating = null; }
    // Autoplay hands the hero back the moment the player touches anything (ctrl+A toggles instead).
    if (g.options.autoplay && (clicks.some(c => c.kind === 'down') || keys.some(e => !(e.ctrl && e.key.toLowerCase() === 'a')))) this.stopAutoplay();
    for (const e of keys) this.handleKey(e);
    for (const c of taps) if (c.kind === 'down') this.handleClick(c.x, c.y, c.button);
    if (g.options.autoplay) {
      if (!this.renderer.busy() && this.frame % 6 === 0) { autoplayStep(g, this.autoStep++); this.afterAction(); }
      this.renderer.hilite = g.travel ? g.travel.slice(0, 40) : [];
      this.renderer.update(g);
      this.pumpAudio();
      if (this.frame - this.lastSave > 60 * 60) this.save();
      return;
    }
    if (!keys.length && !this.renderer.busy()) {
      const rep = this.input.repeat(now, this.input.keys.has('Shift'));
      if (rep && !g.running && !g.travel && !g.resting) this.handleKey(rep);
    }
    // Paralysed or knocked out: time passes without input.
    if ((g.player.timed.paralyzed || g.player.timed.stun > 100) && this.frame % 6 === 0 && !g.player.dead) { C.passTurn(g); this.afterAction(); }
    if (!this.renderer.busy() && this.frame % 4 === 0) {
      if (g.running) { C.runStep(g); this.afterAction(); }
      else if (g.travel) { C.travelStep(g); this.afterAction(); }
      else if (g.repeating) { this.repeatStep(); }
    }
    if (g.resting && this.frame % 2 === 0) { for (let i = 0; i < 3 && g.resting; i++) C.restStep(g); this.afterAction(); }
    this.renderer.hilite = g.travel ? g.travel.slice(0, 40) : [];
    this.renderer.update(this.g);
    this.pumpAudio();
    if (this.frame - this.lastSave > 60 * 60) this.save();
  }
  stopAutoplay(): void {
    const g = this.g;
    if (!g.options.autoplay) return;
    g.options.autoplay = false;
    g.running = null; g.resting = 0; g.travel = null; g.repeating = null;
    g.msg.add('You take back control.', '#ffd040');
  }
  private repeatStep(): void {
    const g = this.g, r = g.repeating!;
    r.left--;
    if (r.left <= 0) { g.repeating = null; return; }
    const x = g.player.x + DIR_DX[r.dir], y = g.player.y + DIR_DY[r.dir];
    const t = tileAt(g.level, x, y);
    if (r.cmd === 'tunnel') { if (t === T.FLOOR) g.repeating = null; else C.tunnelInto(g, x, y); }
    else if (r.cmd === 'open') { if (t !== T.DOOR_CLOSED) g.repeating = null; else C.openDoor(g, x, y); }
    else if (r.cmd === 'disarm') { if (t !== T.TRAP) g.repeating = null; else C.disarm(g, r.dir); }
    else if (r.cmd === 'bash') { if (t !== T.DOOR_CLOSED) g.repeating = null; else C.bashDoor(g, r.dir); }
    this.afterAction();
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
    }
    for (const o of this.overlays) o.draw(ctx, this);
    if (this.touchVisible()) this.touch.draw(ctx, this.overlays.length > 0, this.topWantsYesNo());
    this.canvasApi.present();
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

  handleKey(e: KeyEvent): void {
    const g = this.g, p = g.player;
    // A press synthesised by an on-screen button always means the command on the button, never a
    // movement: the vi keys overlap the command letters (u, b, n, h, j, k, l, y).
    const fromButton = e.code === 'touch';
    if (this.renderer.busy() && dirOfKey(e, !fromButton)) return;
    const dir = dirOfKey(e, !fromButton);
    if (dir && dir !== 5 && !e.ctrl) {
      const running = e.shift || (e.key.length === 1 && e.key !== e.key.toLowerCase() && /[A-Z]/.test(e.key));
      const nx = p.x + DIR_DX[dir], ny = p.y + DIR_DY[dir];
      const t = tileAt(g.level, nx, ny);
      if (!running && t === T.TRAP && g.options.confirmTraps && !monsterAt(g.level, nx, ny)) { this.push(new Confirm('Really walk onto the trap?', () => { C.moveDir(g, dir); this.afterAction(); })); return; }
      if (!running && t === T.DOOR_CLOSED && auxAt(g.level, nx, ny) >= 100) { C.bashDoor(g, dir); this.afterAction(); return; }
      if (running) C.run(g, dir); else C.moveDir(g, dir);
      this.afterAction(); return;
    }
    if (e.ctrl) {
      switch (e.key.toLowerCase()) {
        case 's': this.save(); g.msg.add('Game saved.', '#a0ffa0'); return;
        case 'x': this.save(); g.msg.add('Game saved.', '#a0ffa0'); this.quitToTitle(); return;
        case 'p': this.push(new MessagesOverlay()); return;
        case 'f': g.msg.add(`Level feeling: ${g.level.feeling || 'none'}. Depth ${g.level.depth}.`); return;
        case 'j': this.dirThen('Jam which door', d => { C.jamDoor(g, d); this.afterAction(); }, false); return;
        case 'b': this.dirThen('Bash which door', d => { C.bashDoor(g, d); this.afterAction(); }, false); return;
        case 'l': this.push(new LocateMode({ x: p.x, y: p.y })); return;
        case 'e': this.exportSave(); return;
        case 'k': this.push(new KnowledgeOverlay()); return;
        case 'a': g.options.autoplay = !g.options.autoplay; this.autoStep = 0; g.msg.add(g.options.autoplay ? 'The hero takes over. (any key to stop)' : 'You take back control.', '#ffd040'); return;
        case 'o': g.showIgnored = !g.showIgnored; g.msg.add(g.showIgnored ? 'You take another look at what you have been ignoring.' : 'You go back to ignoring the junk.'); return;
      }
      return;
    }
    switch (e.key) {
      case '5': case '.': case 's': if (e.key === 's') C.searchAround(g); else C.rest(g, 1); break;
      case ',': case 'g': if (C.pickupHere(g, false)) C.passTurn(g); else if (e.key === ',') C.passTurn(g); break;
      case 'Enter': if (this.lastAction) this.lastAction(); else g.msg.add('Nothing to repeat.'); break;
      case '~': case '|': this.push(new KnowledgeOverlay()); break;
      case '=': this.push(new OptionsOverlay()); break;
      case 'V': this.push(new HighScoresOverlay()); break;
      case '{': pickItem(this, 'Inscribe which item?', () => true, ['inven', 'equip', 'quiver'], (it, w) => this.itemAction(it, w, 'inscribe'), undefined, '{'); break;
      case '}': pickItem(this, 'Uninscribe which item?', it => !!it.inscription, ['inven', 'equip', 'quiver'], (it) => { it.inscription = undefined; g.msg.add('Inscription removed.'); }); break;
      case '/': { const m = g.level.monsters.filter(mm => mm.visible).sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y))[0]; if (m) this.push(new RecallOverlay(raceOf(m))); else g.msg.add('No monster in view to recall.'); break; }
      case '>': C.goDown(g); break;
      case '<': C.goUp(g); break;
      case 'R': this.push(new Menu('REST', [{ text: 'As needed', value: -1 }, { text: '10 turns', value: 10 }, { text: '50 turns', value: 50 }, { text: '200 turns', value: 200 }], (l, i, ui) => { ui.pop(); C.rest(g, l.value as number); }, { width: 300 })); break;
      case 'i': this.push(new InventoryScreen((it, w, a) => this.itemAction(it, w, a), 'inven')); break;
      case 'e': this.push(new InventoryScreen((it, w, a) => this.itemAction(it, w, a), 'equip')); break;
      case 'w': pickItem(this, 'Wear or wield which item?', it => isWearable(kindOf(it)) && !isAmmo(kindOf(it)), ['inven', 'floor'], (it, w) => this.itemAction(it, w, 'wield'), undefined, 'w'); break;
      case 't': case 'T': if (e.key === 'T') { this.dirThen('Tunnel', (d) => { this.lastAction = () => { C.tunnelInto(g, p.x + DIR_DX[d], p.y + DIR_DY[d]); this.afterAction(); }; this.lastAction(); }, false); break; } pickItem(this, 'Take off which item?', () => true, ['equip'], (it) => this.itemAction(it, 'equip', 'takeoff'), undefined, 't'); break;
      case 'd': pickItem(this, 'Drop which item?', () => true, ['inven', 'quiver', 'equip'], (it, w) => this.itemAction(it, w, 'drop'), undefined, 'd'); break;
      case 'k': pickItem(this, 'Destroy which item?', () => true, ['inven', 'quiver', 'floor'], (it, w) => this.itemAction(it, w, 'destroy'), undefined, 'k'); break;
      case 'q': pickItem(this, 'Quaff which potion?', it => kindOf(it).tval === 'potion', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'quaff'), undefined, 'q'); break;
      case 'r': pickItem(this, 'Read which scroll?', it => kindOf(it).tval === 'scroll', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'read'), undefined, 'r'); break;
      case 'E': pickItem(this, 'Eat what?', it => kindOf(it).tval === 'food', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'eat'), undefined, 'E'); break;
      case 'a': pickItem(this, 'Aim which wand?', it => kindOf(it).tval === 'wand', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'aim'), undefined, 'a'); break;
      case 'u': pickItem(this, 'Use which staff?', it => kindOf(it).tval === 'staff', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'use'), undefined, 'u'); break;
      case 'z': pickItem(this, 'Zap which rod?', it => kindOf(it).tval === 'rod', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'zap'), undefined, 'z'); break;
      case 'A': pickItem(this, 'Activate which item?', it => !!it.artifact || (kindOf(it).flags || []).includes('ACTIVATE'), ['equip'], (it) => this.itemAction(it, 'equip', 'activate'), undefined, 'A'); break;
      case 'F': pickItem(this, 'Refuel with what?', it => kindOf(it).tval === 'flask' || kindOf(it).id === 'torch', ['inven'], (it) => this.itemAction(it, 'inven', 'fuel'), undefined, 'F'); break;
      case 'v': pickItem(this, 'Throw which item?', () => true, ['inven', 'quiver', 'floor'], (it, w) => this.itemAction(it, w, 'throw'), undefined, 'v'); break;
      case 'f': if (!p.equip.bow) { g.msg.add('You have nothing to fire with.'); break; } pickItem(this, 'Fire which ammunition?', it => isAmmo(kindOf(it)) && kindOf(it).tval === kindOf(p.equip.bow!).ammo, ['quiver', 'inven', 'floor'], (it, w) => this.itemAction(it, w, 'fire'), undefined, 'f'); break;
      case 'm': case 'p': spellMenu(this, 'cast', id => this.castSpell(id)); break;
      case 'b': spellMenu(this, 'browse', () => {}); break;
      case 'G': if (C.newSpellCount(g) <= 0) g.msg.add('You cannot learn any new spells right now.'); else if (CLASS_BY_ID[p.cls].realm === 'prayer') { C.study(g); this.afterAction(); } else spellMenu(this, 'study', id => { C.study(g, id); this.afterAction(); }); break;
      case 'C': this.push(new CharSheet()); break;
      case 'M': this.push(new MapOverlay()); break;
      case 'x': case 'l': this.cursor = { x: p.x, y: p.y }; this.push(new LookMode()); break;
      case '*': this.cursor = { x: p.x, y: p.y }; this.push(new LookMode(t => { this.target = t; g.msg.add('Target set.'); })); break;
      case 'o': this.openThing(); break;
      case 'c': this.dirThen('Close', d => { C.closeDoor(g, d); this.afterAction(); }, false); break;
      case 'D': { const chest = itemsAt(g.level, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest'); if (chest) { C.disarmChest(g, chest); break; } this.dirThen('Disarm', d => { C.disarm(g, d); this.afterAction(); }, false); break; }
      case 'O': this.push(new IgnoreOverlay()); break;
      case 'S': p.searching = !p.searching; g.msg.add(p.searching ? 'You begin searching carefully.' : 'You stop searching.'); refreshBonuses(g); break;
      case '?': this.push(new HelpOverlay()); break;
      case 'Q': this.push(new Confirm('Retire this character? (the save is deleted)', () => { p.dead = true; p.deathCause = 'retirement'; this.afterAction(); })); break;
      case 'Escape': break;
      default: return;
    }
    this.afterAction();
  }
  handleClick(x: number, y: number, button: number): void {
    const g = this.g;
    if (x >= MAP_X && x < MAP_X + MAP_W && y >= MAP_Y && y < MAP_Y + MAP_H) {
      const t = this.renderer.screenToTile(x, y);
      const p = g.player;
      if (button === 2) { this.cursor = t; this.push(new LookMode()); return; }
      const dx = t.x - p.x, dy = t.y - p.y;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) { C.moveDir(g, dirOf(dx, dy)); this.afterAction(); return; }
      if (dx === 0 && dy === 0) { const tile = tileAt(g.level, p.x, p.y); if (tile === T.STAIRS_DOWN) C.goDown(g); else if (tile === T.STAIRS_UP) C.goUp(g); else C.pickupHere(g, false); this.afterAction(); return; }
      const m = monsterAt(g.level, t.x, t.y);
      if (m && m.visible) { this.target = t; g.msg.add(`Target: ${t.x},${t.y}.`); }
      this.travel(t.x, t.y);
    } else if (x >= VIEW_W - 216) {
      this.push(new InventoryScreen((it, w, a) => this.itemAction(it, w, a), 'inven'));
    }
  }
  private openThing(): void {
    const g = this.g, p = g.player;
    const chest = itemsAt(g.level, p.x, p.y).find(fi => kindOf(fi.item).tval === 'chest');
    if (chest) { C.openChest(g, chest); this.afterAction(); return; }
    // A closed door next to us?
    const doors: number[] = [];
    for (let d = 1; d <= 9; d++) if (d !== 5 && tileAt(g.level, p.x + DIR_DX[d], p.y + DIR_DY[d]) === T.DOOR_CLOSED) doors.push(d);
    if (doors.length === 1) { C.openDoor(g, p.x + DIR_DX[doors[0]], p.y + DIR_DY[doors[0]]); this.afterAction(); return; }
    if (doors.length > 1) { this.dirThen('Open', d => { C.openDoor(g, p.x + DIR_DX[d], p.y + DIR_DY[d]); this.afterAction(); }, false); return; }
    g.msg.add('You see nothing here to open.');
  }
  private dirThen(prompt: string, f: (dir: number, target: Pos | null) => void, allowTarget = true): void {
    this.push(new DirPrompt(prompt, f, allowTarget));
  }
  private castSpell(id: string): void {
    const g = this.g;
    const s = SPELL_BY_ID[id];
    const run = (ctx: EffectCtx) => { this.lastAction = () => { if (g.player.learned.includes(s.id)) { C.cast(g, s, ctx); this.afterAction(); } }; C.cast(g, s, ctx); this.afterAction(); };
    this.withEffectPrompts(s.effect, s.name, run);
  }
  /** Prompts that some effects need beyond a direction or an item: Banishment's race, Recall's depth reset. */
  private specialPrompts(effect: import('./game/types.ts').Effect, ctx: EffectCtx, then: () => void): void {
    const g = this.g, p = g.player;
    const kinds = new Set<string>();
    const walk = (e: import('./game/types.ts').Effect) => { kinds.add(e.kind); if (e.kind === 'seq') e.effects.forEach(walk); };
    walk(effect);
    if (kinds.has('banish')) {
      const seen = new Map<string, number>();
      for (const m of g.level.monsters) if (m.visible && !raceOf(m).flags.includes('UNIQUE')) seen.set(m.race, (seen.get(m.race) || 0) + 1);
      const known = Object.keys(g.lore).filter(id => MONSTER_BY_ID[id] && !MONSTER_BY_ID[id].flags.includes('UNIQUE') && !seen.has(id) && (g.lore[id].kills > 0 || g.lore[id].sights > 0));
      const lines = [...[...seen.entries()].map(([id, n]) => ({ text: `${MONSTER_BY_ID[id].name} (${n} in view)`, value: id })), ...known.map(id => ({ text: MONSTER_BY_ID[id].name, value: id, color: '#8a869a' }))];
      if (!lines.length) { g.msg.add('You know of nothing to banish.'); return; }
      this.push(new Menu('BANISH WHICH KIND OF MONSTER?', lines, (l, i, ui) => { ui.pop(); ctx.race = l.value as string; then(); }, { width: 480 }));
      return;
    }
    if (kinds.has('recall') && g.level.depth > 0 && g.level.depth < p.maxDepth && !p.timed.recall && !g.options.ironman) {
      this.push(new Confirm(`Set the recall depth to ${g.level.depth * 50} ft (now ${p.maxDepth * 50} ft)?`, () => { ctx.resetRecall = true; then(); }));
      // The Confirm overlay pops itself; a 'no' answer must still cast.
      const top = this.overlays[this.overlays.length - 1] as Confirm;
      const orig = top.key.bind(top);
      top.key = (e, ui) => { const yes = e.key === 'y' || e.key === 'Y'; const r = orig(e, ui); if (!yes) then(); return r; };
      return;
    }
    then();
  }
  /** Ask for a direction and/or an item if the effect needs them, then run. */
  private withEffectPrompts(effect: import('./game/types.ts').Effect, label: string, run: (ctx: EffectCtx) => void): void {
    const g = this.g, p = g.player;
    const ctx: EffectCtx = {};
    const need = needsItem(effect);
    const afterItem = () => {
      if (needsDir(effect)) this.dirThen(label, (d, t) => { ctx.dir = d; ctx.target = t; this.specialPrompts(effect, ctx, () => run(ctx)); });
      else this.specialPrompts(effect, ctx, () => run(ctx));
    };
    if (need === 'identify') pickItem(this, 'Identify which item?', it => !it.known || !isWearable(kindOf(it)) && kindOf(it).flavored === true && !g.flavors.aware.includes(it.kind), ['inven', 'equip', 'quiver', 'floor'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'enchant_weapon') pickItem(this, 'Enchant which weapon?', it => ['sword', 'hafted', 'polearm', 'digger', 'bow', 'shot', 'arrow', 'bolt'].includes(kindOf(it).tval), ['equip', 'inven', 'quiver'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'enchant_armor') pickItem(this, 'Enchant which armour?', it => ['soft_armor', 'hard_armor', 'dragon_armor', 'shield', 'helm', 'crown', 'cloak', 'gloves', 'boots'].includes(kindOf(it).tval), ['equip', 'inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'recharge') pickItem(this, 'Recharge which item?', it => kindOf(it).tval === 'wand' || kindOf(it).tval === 'staff', ['inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'brand_ammo') pickItem(this, 'Brand which ammunition?', it => isAmmo(kindOf(it)), ['quiver', 'inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else afterItem();
    void p;
  }
  /** Perform an item action chosen from a picker or the inventory screen. An item inscribed {!q} (or {!*}) asks first. */
  itemAction(it: Item, where: ItemWhere, action: string, verified = false): void {
    const g = this.g, p = g.player, k = kindOf(it);
    const letter = ACTION_KEY[action];
    if (!verified && letter && inscriptionConfirms(it, letter)) { this.push(new Confirm(`Really ${ACTION_VERB[action]} ${itemName(it, g.flavors, { count: false })}?`, () => this.itemAction(it, where, action, true))); return; }
    const fromFloor = where === 'floor';
    const takeFirst = (): boolean => {
      if (!fromFloor) return true;
      const fi = itemsAt(g.level, p.x, p.y).find(f => f.item === it);
      if (fi && C.addToInventory(g, it)) { g.level.items.splice(g.level.items.indexOf(fi), 1); return true; }
      g.msg.add('You have no room for that.'); return false;
    };
    const done = () => this.afterAction();
    const remember = (f: () => void) => { this.lastAction = () => { const still = p.inven.includes(it) || p.quiver.includes(it) || Object.values(p.equip).includes(it); if (!still || it.number <= 0) { g.msg.add('You no longer have that.'); return; } f(); }; };
    switch (action) {
      case 'wield': if (takeFirst()) C.wield(g, it); done(); break;
      case 'takeoff': C.takeOff(g, it); done(); break;
      case 'drop': if (it.number > 1) this.push(new QuantityPrompt('Drop how many?', it.number, n => { C.dropItem(g, it, n); done(); }, it.number)); else { C.dropItem(g, it, 1); done(); } break;
      case 'quaff': if (!takeFirst()) break; if (g.options.confirmUnknown && !g.flavors.aware.includes(it.kind)) { this.push(new Confirm(`Really quaff ${itemName(it, g.flavors, { count: false })}?`, () => { C.quaff(g, it); done(); })); break; } C.quaff(g, it); done(); break;
      case 'eat': if (takeFirst()) C.eat(g, it); done(); break;
      case 'read': { if (!takeFirst()) break; const go = () => { if (k.effect) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { C.read(g, it, ctx); done(); }); else { C.read(g, it); done(); } }; if (g.options.confirmUnknown && !g.flavors.aware.includes(it.kind)) this.push(new Confirm(`Really read ${itemName(it, g.flavors, { count: false })}?`, go)); else go(); break; }
      case 'aim': if (!takeFirst()) break; this.dirThen(itemName(it, g.flavors, { count: false }), (d, t) => { remember(() => { C.aim(g, it, d, t); done(); }); C.aim(g, it, d, t); done(); }); break;
      case 'use': if (!takeFirst()) break; if (k.effect) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { C.useStaff(g, it, ctx); done(); }); else { C.useStaff(g, it); done(); } break;
      case 'zap': if (!takeFirst()) break; if (k.effect && (needsDir(k.effect) || needsItem(k.effect))) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { remember(() => { C.zap(g, it, ctx.dir ?? 5, ctx.target, ctx); done(); }); C.zap(g, it, ctx.dir ?? 5, ctx.target, ctx); done(); }); else { remember(() => { C.zap(g, it, 5, null); done(); }); C.zap(g, it, 5, null); done(); } break;
      case 'activate': { const eff = it.artifact ? artifactById(it.artifact)?.activation : k.effect; if (eff && needsDir(eff)) this.dirThen('Activate', (d, t) => { C.activate(g, it, d, t); done(); }); else { C.activate(g, it, 5, null); done(); } break; }
      case 'fuel': C.refuel(g, it); done(); break;
      case 'throw': if (!takeFirst()) break; this.dirThen('Throw', (d, t) => { C.throwItem(g, it, d, t); done(); }); break;
      case 'fire': if (!takeFirst()) break; this.dirThen('Fire', (d, t) => { remember(() => { C.fire(g, it, d, t); done(); }); C.fire(g, it, d, t); done(); }); break;
      case 'browse': spellMenu(this, 'browse', () => {}); break;
      case 'inspect': g.msg.add(`${itemName(it, g.flavors, { full: it.known })}: ${describe(g, it)}`); break;
      case 'inscribe': this.push(new TextPrompt('Inscribe with:', it.inscription || '', s => { it.inscription = s || undefined; })); break;
      case 'ignore': { const on = toggleIgnoreKind(g, it.kind); const what = itemName(it, g.flavors, { article: false, count: false, plainKind: true }); g.msg.add(on ? `You will leave ${what} where you find it.` : `You will pick up ${what} again.`); done(); break; }
      case 'destroy': this.push(new Confirm(`Really destroy ${itemName(it, g.flavors)}?`, () => { if (fromFloor) { const fi = itemsAt(g.level, p.x, p.y).find(f => f.item === it); if (fi) g.level.items.splice(g.level.items.indexOf(fi), 1); } else C.removeFromInventory(g, it); g.msg.add(`You destroy ${itemName(it, g.flavors)}.`); identify(it, g.flavors); refreshBonuses(g); done(); })); break;
    }
  }
}
/** The Angband command letter for each item action, for `!` inscriptions (destroy already confirms). */
const ACTION_KEY: Record<string, string> = { wield: 'w', takeoff: 't', drop: 'd', quaff: 'q', read: 'r', eat: 'E', aim: 'a', use: 'u', zap: 'z', activate: 'A', fuel: 'F', throw: 'v', fire: 'f' };
const ACTION_VERB: Record<string, string> = { wield: 'wield', takeoff: 'take off', drop: 'drop', quaff: 'quaff', read: 'read', eat: 'eat', aim: 'aim', use: 'use', zap: 'zap', activate: 'activate', fuel: 'refuel with', throw: 'throw', fire: 'fire' };
function describe(g: Game, it: Item): string {
  const k = kindOf(it);
  return (k.desc || '') + (it.known ? '' : ' (not fully known)');
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
  newGame2: (name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string }) => app.newGame2(name, race, cls, sex, extra),
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
  newGame2(name: string, race: string, cls: string, sex: 'male' | 'female', extra: { stats?: Record<Stat, number>; options?: Partial<Options>; history?: string }): void;
  dump(): string;
  key(key: string, shift?: boolean, ctrl?: boolean): void;
  step(): void;
  testAudio(): number;
};
