// The entry point: the fixed-timestep loop from the engine, the render canvas, input, and the
// keymap that turns key presses into game commands. Overlays (menus, prompts, stores) sit on a
// stack above the map and take the keys while open.
import { createCanvas } from './lib/engine/canvas.ts';
import { createLoop } from './lib/engine/loop.ts';
import { setTextDefaults, drawText } from './lib/engine/text.ts';
import { VIEW_W, VIEW_H, MAP_X, MAP_Y, MAP_W, MAP_H, SAVE_KEY } from './constants.ts';
import type { Game } from './game/state.ts';
import { createGame, enterLevel, setAutosaveHook } from './game/game.ts';
import { serialize, deserialize } from './game/save.ts';
import * as C from './game/commands.ts';
import { kindOf, itemName, isAmmo, isWearable, identify } from './game/items.ts';
import { needsDir, needsItem, type EffectCtx } from './game/effects.ts';
import { type Item, type Pos, T, DIR_DX, DIR_DY, dirOf } from './game/types.ts';
import { tileAt, itemsAt, monsterAt } from './game/level.ts';
import { SPELL_BY_ID } from './game/data/spells.ts';
import { CLASS_BY_ID } from './game/data/classes.ts';
import { refreshBonuses } from './game/effectsCore.ts';
import { Input, dirOfKey, type KeyEvent } from './ui/input.ts';
import { MapRenderer } from './ui/render.ts';
import { drawHud, drawMessageBar, drawBanner } from './ui/hud.ts';
import { buildHero, syncHero } from './ui/hero.ts';
import { type Ui, type Overlay, Menu, pickItem, DirPrompt, QuantityPrompt, TextPrompt, Confirm, InventoryScreen, StoreScreen, spellMenu, CharSheet, MapOverlay, HelpOverlay, MessagesOverlay, LookMode, TitleScreen, DeathScreen, type ItemWhere } from './ui/screens.ts';
import { ARTIFACT_BY_ID } from './game/data/objects.ts';

setTextDefaults({ shadowColor: '#0a0810', outline: '#0a0810' });

class App implements Ui {
  g!: Game;
  overlays: Overlay[] = [];
  renderer = new MapRenderer();
  cursor: Pos | null = null;
  target: Pos | null = null;
  frame = 0;
  input: Input;
  canvasApi = createCanvas('stage', { width: VIEW_W, height: VIEW_H });
  ctx = this.canvasApi.ctx;
  started = false;
  lastSave = 0;

  constructor() {
    this.input = new Input(this.canvasApi.canvas, (x, y) => this.canvasApi.toInternal(x, y));
    setAutosaveHook(g => { if (this.started && g === this.g && !g.player.dead) this.save(); });
    this.push(new TitleScreen());
  }
  push(o: Overlay): void { this.overlays.push(o); }
  pop(): void { this.overlays.pop(); }
  hasSave(): boolean { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  save(): void { try { localStorage.setItem(SAVE_KEY, serialize(this.g)); this.lastSave = this.frame; } catch (e) { console.warn('save failed', e); } }
  loadGame(): boolean {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return false;
      this.g = deserialize(json);
      this.begin();
      this.g.msg.add('Welcome back.', '#ffd040');
      return true;
    } catch (e) { console.error(e); return false; }
  }
  newGame(name: string, race: string, cls: string, sex: 'male' | 'female'): void {
    this.g = createGame(name, race, cls, sex);
    this.begin();
  }
  private begin(): void {
    this.overlays.length = 0;
    this.started = true;
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
    if (g.inStore >= 0 && !this.overlays.some(o => o instanceof StoreScreen)) this.push(new StoreScreen(g.inStore));
    this.renderer.hero = syncHero(this.renderer.hero!, g.player);
    if (g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) {
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
      this.overlays.length = 0;
      this.push(new DeathScreen());
    }
    if (g.totalWinner && !g.player.dead && !this.overlays.some(o => o instanceof DeathScreen)) { /* keep playing; the banner said it */ }
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
    // Overlays take everything.
    if (this.overlays.length) {
      const top = this.overlays[this.overlays.length - 1];
      for (const e of keys) top.key(e, this);
      for (const c of clicks) if (c.kind === 'down' && top.click) top.click(c.x, c.y, this);
      if (this.started) { this.renderer.update(this.g); if (this.g.player.dead || this.g.levelChange) this.afterAction(); }
      return;
    }
    if (!this.started) return;
    const g = this.g;
    if (g.player.dead) { this.afterAction(); return; }
    // Continuous actions run on a timer so the player can watch (and interrupt with any key).
    if (keys.length && (g.running || g.resting || g.travel || g.repeating)) { g.running = null; g.resting = 0; g.travel = null; g.repeating = null; }
    for (const e of keys) this.handleKey(e);
    for (const c of clicks) if (c.kind === 'down') this.handleClick(c.x, c.y, c.button);
    if (!keys.length && !this.renderer.busy()) {
      const rep = this.input.repeat(now, this.input.keys.has('Shift'));
      if (rep && !g.running && !g.travel && !g.resting) this.handleKey(rep);
    }
    if (!this.renderer.busy() && this.frame % 4 === 0) {
      if (g.running) { C.runStep(g); this.afterAction(); }
      else if (g.travel) { C.travelStep(g); this.afterAction(); }
      else if (g.repeating) { this.repeatStep(); }
    }
    if (g.resting && this.frame % 2 === 0) { for (let i = 0; i < 3 && g.resting; i++) C.restStep(g); this.afterAction(); }
    this.renderer.hilite = g.travel ? g.travel.slice(0, 40) : [];
    this.renderer.update(this.g);
    if (this.frame - this.lastSave > 60 * 60) this.save();
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
    if (this.renderer.busy() && dirOfKey(e)) return;
    const dir = dirOfKey(e);
    if (dir && dir !== 5) {
      if (e.shift || (e.key.length === 1 && e.key !== e.key.toLowerCase() && /[A-Z]/.test(e.key))) C.run(g, dir); else C.moveDir(g, dir);
      this.afterAction(); return;
    }
    if (e.ctrl) {
      switch (e.key.toLowerCase()) {
        case 's': this.save(); g.msg.add('Game saved.', '#a0ffa0'); return;
        case 'x': this.save(); g.msg.add('Game saved.', '#a0ffa0'); this.quitToTitle(); return;
        case 'p': this.push(new MessagesOverlay()); return;
        case 'f': g.msg.add(`Level feeling: ${g.level.feeling || 'none'}. Depth ${g.level.depth}.`); return;
      }
      return;
    }
    switch (e.key) {
      case '5': case '.': case 's': if (e.key === 's') C.searchAround(g); else C.rest(g, 1); break;
      case ',': case 'g': if (!C.pickupHere(g, false)) { /* nothing */ } else C.rest(g, 0); break;
      case '>': C.goDown(g); break;
      case '<': C.goUp(g); break;
      case 'R': this.push(new Menu('REST', [{ text: 'As needed', value: -1 }, { text: '10 turns', value: 10 }, { text: '50 turns', value: 50 }, { text: '200 turns', value: 200 }], (l, i, ui) => { ui.pop(); C.rest(g, l.value as number); }, { width: 300 })); break;
      case 'i': this.push(new InventoryScreen((it, w, a) => this.itemAction(it, w, a), 'inven')); break;
      case 'e': this.push(new InventoryScreen((it, w, a) => this.itemAction(it, w, a), 'equip')); break;
      case 'w': pickItem(this, 'Wear or wield which item?', it => isWearable(kindOf(it)) && !isAmmo(kindOf(it)), ['inven', 'floor'], (it, w) => this.itemAction(it, w, 'wield')); break;
      case 't': case 'T': if (e.key === 'T') { this.dirThen('Tunnel', (d) => { C.tunnelInto(g, p.x + DIR_DX[d], p.y + DIR_DY[d]); this.afterAction(); }, false); break; } pickItem(this, 'Take off which item?', () => true, ['equip'], (it) => this.itemAction(it, 'equip', 'takeoff')); break;
      case 'd': pickItem(this, 'Drop which item?', () => true, ['inven', 'quiver', 'equip'], (it, w) => this.itemAction(it, w, 'drop')); break;
      case 'k': pickItem(this, 'Destroy which item?', () => true, ['inven', 'quiver', 'floor'], (it, w) => this.itemAction(it, w, 'destroy')); break;
      case 'q': pickItem(this, 'Quaff which potion?', it => kindOf(it).tval === 'potion', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'quaff')); break;
      case 'r': pickItem(this, 'Read which scroll?', it => kindOf(it).tval === 'scroll', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'read')); break;
      case 'E': pickItem(this, 'Eat what?', it => kindOf(it).tval === 'food', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'eat')); break;
      case 'a': pickItem(this, 'Aim which wand?', it => kindOf(it).tval === 'wand', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'aim')); break;
      case 'u': pickItem(this, 'Use which staff?', it => kindOf(it).tval === 'staff', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'use')); break;
      case 'z': pickItem(this, 'Zap which rod?', it => kindOf(it).tval === 'rod', ['inven', 'floor'], (it) => this.itemAction(it, 'inven', 'zap')); break;
      case 'A': pickItem(this, 'Activate which item?', it => !!it.artifact || (kindOf(it).flags || []).includes('ACTIVATE'), ['equip'], (it) => this.itemAction(it, 'equip', 'activate')); break;
      case 'F': pickItem(this, 'Refuel with what?', it => kindOf(it).tval === 'flask' || kindOf(it).id === 'torch', ['inven'], (it) => this.itemAction(it, 'inven', 'fuel')); break;
      case 'v': pickItem(this, 'Throw which item?', () => true, ['inven', 'quiver', 'floor'], (it, w) => this.itemAction(it, w, 'throw')); break;
      case 'f': if (!p.equip.bow) { g.msg.add('You have nothing to fire with.'); break; } pickItem(this, 'Fire which ammunition?', it => isAmmo(kindOf(it)) && kindOf(it).tval === kindOf(p.equip.bow!).ammo, ['quiver', 'inven', 'floor'], (it, w) => this.itemAction(it, w, 'fire')); break;
      case 'm': case 'p': spellMenu(this, 'cast', id => this.castSpell(id)); break;
      case 'b': spellMenu(this, 'browse', () => {}); break;
      case 'G': if (C.newSpellCount(g) <= 0) g.msg.add('You cannot learn any new spells right now.'); else if (CLASS_BY_ID[p.cls].realm === 'prayer') { C.study(g); this.afterAction(); } else spellMenu(this, 'study', id => { C.study(g, id); this.afterAction(); }); break;
      case 'C': this.push(new CharSheet()); break;
      case 'M': this.push(new MapOverlay()); break;
      case 'x': case 'l': this.cursor = { x: p.x, y: p.y }; this.push(new LookMode()); break;
      case '*': this.cursor = { x: p.x, y: p.y }; this.push(new LookMode(t => { this.target = t; g.msg.add('Target set.'); })); break;
      case 'o': this.openThing(); break;
      case 'c': this.dirThen('Close', d => { C.closeDoor(g, d); this.afterAction(); }, false); break;
      case 'D': this.dirThen('Disarm', d => { C.disarm(g, d); this.afterAction(); }, false); break;
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
    const run = (ctx: EffectCtx) => { C.cast(g, s, ctx); this.afterAction(); };
    this.withEffectPrompts(s.effect, s.name, run);
  }
  /** Ask for a direction and/or an item if the effect needs them, then run. */
  private withEffectPrompts(effect: import('./game/types.ts').Effect, label: string, run: (ctx: EffectCtx) => void): void {
    const g = this.g, p = g.player;
    const ctx: EffectCtx = {};
    const need = needsItem(effect);
    const afterItem = () => {
      if (needsDir(effect)) this.dirThen(label, (d, t) => { ctx.dir = d; ctx.target = t; run(ctx); });
      else run(ctx);
    };
    if (need === 'identify') pickItem(this, 'Identify which item?', it => !it.known || !isWearable(kindOf(it)) && kindOf(it).flavored === true && !g.flavors.aware.includes(it.kind), ['inven', 'equip', 'quiver', 'floor'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'enchant_weapon') pickItem(this, 'Enchant which weapon?', it => ['sword', 'hafted', 'polearm', 'digger', 'bow', 'shot', 'arrow', 'bolt'].includes(kindOf(it).tval), ['equip', 'inven', 'quiver'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'enchant_armor') pickItem(this, 'Enchant which armour?', it => ['soft_armor', 'hard_armor', 'dragon_armor', 'shield', 'helm', 'crown', 'cloak', 'gloves', 'boots'].includes(kindOf(it).tval), ['equip', 'inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'recharge') pickItem(this, 'Recharge which item?', it => kindOf(it).tval === 'wand' || kindOf(it).tval === 'staff', ['inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else if (need === 'brand_ammo') pickItem(this, 'Brand which ammunition?', it => isAmmo(kindOf(it)), ['quiver', 'inven'], it => { ctx.chosen = it; afterItem(); }, () => run(ctx));
    else afterItem();
    void p;
  }
  /** Perform an item action chosen from a picker or the inventory screen. */
  itemAction(it: Item, where: ItemWhere, action: string): void {
    const g = this.g, p = g.player, k = kindOf(it);
    const fromFloor = where === 'floor';
    const takeFirst = (): boolean => {
      if (!fromFloor) return true;
      const fi = itemsAt(g.level, p.x, p.y).find(f => f.item === it);
      if (fi && C.addToInventory(g, it)) { g.level.items.splice(g.level.items.indexOf(fi), 1); return true; }
      g.msg.add('You have no room for that.'); return false;
    };
    const done = () => this.afterAction();
    switch (action) {
      case 'wield': if (takeFirst()) C.wield(g, it); done(); break;
      case 'takeoff': C.takeOff(g, it); done(); break;
      case 'drop': if (it.number > 1) this.push(new QuantityPrompt('Drop how many?', it.number, n => { C.dropItem(g, it, n); done(); }, it.number)); else { C.dropItem(g, it, 1); done(); } break;
      case 'quaff': if (takeFirst()) C.quaff(g, it); done(); break;
      case 'eat': if (takeFirst()) C.eat(g, it); done(); break;
      case 'read': if (!takeFirst()) break; if (k.effect) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { C.read(g, it, ctx); done(); }); else { C.read(g, it); done(); } break;
      case 'aim': if (!takeFirst()) break; this.dirThen(itemName(it, g.flavors, { count: false }), (d, t) => { C.aim(g, it, d, t); done(); }); break;
      case 'use': if (!takeFirst()) break; if (k.effect) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { C.useStaff(g, it, ctx); done(); }); else { C.useStaff(g, it); done(); } break;
      case 'zap': if (!takeFirst()) break; if (k.effect && (needsDir(k.effect) || needsItem(k.effect))) this.withEffectPrompts(k.effect, itemName(it, g.flavors, { count: false }), ctx => { C.zap(g, it, ctx.dir ?? 5, ctx.target, ctx); done(); }); else { C.zap(g, it, 5, null); done(); } break;
      case 'activate': { const eff = it.artifact ? ARTIFACT_BY_ID[it.artifact]?.activation : k.effect; if (eff && needsDir(eff)) this.dirThen('Activate', (d, t) => { C.activate(g, it, d, t); done(); }); else { C.activate(g, it, 5, null); done(); } break; }
      case 'fuel': C.refuel(g, it); done(); break;
      case 'throw': if (!takeFirst()) break; this.dirThen('Throw', (d, t) => { C.throwItem(g, it, d, t); done(); }); break;
      case 'fire': if (!takeFirst()) break; this.dirThen('Fire', (d, t) => { C.fire(g, it, d, t); done(); }); break;
      case 'browse': spellMenu(this, 'browse', () => {}); break;
      case 'inspect': g.msg.add(`${itemName(it, g.flavors, { full: it.known })}: ${describe(g, it)}`); break;
      case 'inscribe': this.push(new TextPrompt('Inscribe with:', it.inscription || '', s => { it.inscription = s || undefined; })); break;
      case 'destroy': this.push(new Confirm(`Really destroy ${itemName(it, g.flavors)}?`, () => { if (fromFloor) { const fi = itemsAt(g.level, p.x, p.y).find(f => f.item === it); if (fi) g.level.items.splice(g.level.items.indexOf(fi), 1); } else C.removeFromInventory(g, it); g.msg.add(`You destroy ${itemName(it, g.flavors)}.`); identify(it, g.flavors); refreshBonuses(g); done(); })); break;
    }
  }
}
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
  key: (key: string, shift = false, ctrl = false) => { app.handleKeyPublic({ key, shift, ctrl, alt: false, code: '' }); },
  step: () => { app.update(); app.render(); },
};
export type GameApi = {
  readonly game: Game;
  app: unknown;
  newGame(name: string, race: string, cls: string, sex: 'male' | 'female'): void;
  key(key: string, shift?: boolean, ctrl?: boolean): void;
  step(): void;
};
