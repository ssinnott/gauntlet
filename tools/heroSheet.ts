// The hero contact sheet, drawn inside the game page: every race down the side, every class across
// the top, each with its starting weapon. Shared by tools/sheet.ts (which writes it out for review)
// and tools/smoke.ts (which asserts every race/class combination draws differently).

/** What `drawHeroSheet` returns from the page. */
export interface HeroSheet {
  /** The sheet as a PNG data URL. */
  png: string;
  /** A hash of each sprite's pixels on a plain background, keyed race/class. */
  hashes: Record<string, number>;
  races: number;
  classes: number;
}
export interface HeroSheetOpts {
  scale: number;
  sex: 'male' | 'female';
  /** Narrow the sheet to these race ids (default: all). */
  onlyRaces?: string[] | null;
  /** Narrow the sheet to these class ids (default: all). */
  onlyClasses?: string[] | null;
}

/** Draws the sheet in the page and returns it as a PNG data URL plus a hash per cell. */
const SHEET_SCRIPT = `async ({ scale, sex, onlyRaces, onlyClasses }) => {
  const [{ buildHero, drawHero }, { createPlayer }, races, classes, { makeItem, kindOf, isWeapon }, { drawText }] = await Promise.all([
    import('/src/ui/hero.ts'), import('/src/game/player.ts'), import('/src/game/data/races.ts'), import('/src/game/data/classes.ts'), import('/src/game/items.ts'), import('/src/lib/engine/text.ts'),
  ]);
  const RACES = races.RACES.filter(r => !onlyRaces || onlyRaces.includes(r.id));
  const CLASSES = classes.CLASSES.filter(c => !onlyClasses || onlyClasses.includes(c.id));
  const cw = Math.round(40 * scale), ch = Math.round(60 * scale), left = 70, top = 24;
  const c = document.createElement('canvas');
  c.width = left + cw * CLASSES.length; c.height = top + ch * RACES.length;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1c1a26'; ctx.fillRect(0, 0, c.width, c.height);
  const hashes = {};
  for (let ci = 0; ci < CLASSES.length; ci++) drawText(ctx, CLASSES[ci].name.toUpperCase().slice(0, 7), left + ci * cw + cw / 2, 8, { size: 1, color: '#e8e4d8', align: 'center' });
  for (let ri = 0; ri < RACES.length; ri++) {
    const race = RACES[ri];
    drawText(ctx, race.name.toUpperCase(), 4, top + ri * ch + ch / 2 - 4, { size: 1, color: '#e8e4d8' });
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const cls = CLASSES[ci];
      const p = createPlayer('Sheet', race.id, cls.id, sex);
      const w = cls.startItems.find(([k]) => isWeapon(kindOf({ kind: k })));
      if (w) p.equip.weapon = makeItem(w[0], 1);
      const h = buildHero(p);
      const x0 = left + ci * cw, y0 = top + ri * ch;
      ctx.fillStyle = (ri + ci) % 2 ? '#24222e' : '#1c1a26'; ctx.fillRect(x0, y0, cw, ch);
      ctx.save(); ctx.translate(x0 + cw / 2, y0 + ch - 4 * scale); ctx.scale(scale, scale);
      drawHero(ctx, h, 0, 0, 1);
      ctx.restore();
      // Hash the sprite on a plain background so the checkerboard cannot tell two identical heroes apart.
      const s = document.createElement('canvas'); s.width = cw; s.height = ch;
      const sc = s.getContext('2d'); sc.imageSmoothingEnabled = false;
      sc.fillStyle = '#000000'; sc.fillRect(0, 0, cw, ch);
      sc.translate(cw / 2, ch - 4 * scale); sc.scale(scale, scale);
      drawHero(sc, buildHero(p), 0, 0, 1);
      const d = sc.getImageData(0, 0, cw, ch).data;
      let hsh = 2166136261;
      for (let i = 0; i < d.length; i += 4) { hsh ^= d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16); hsh = Math.imul(hsh, 16777619) >>> 0; }
      hashes[race.id + '/' + cls.id] = hsh;
    }
  }
  return { png: c.toDataURL('image/png'), hashes, races: RACES.length, classes: CLASSES.length };
}`;

/** Draw the sheet in a Playwright page that has the game loaded (the dev server transforms the imports). */
export function drawHeroSheet(page: any, opts: HeroSheetOpts): Promise<HeroSheet> {
  return page.evaluate(`(${SHEET_SCRIPT})(${JSON.stringify({ scale: opts.scale, sex: opts.sex, onlyRaces: opts.onlyRaces || null, onlyClasses: opts.onlyClasses || null })})`);
}

/** The combinations whose sprite is pixel-identical to an earlier one, as "race/class == race/class". */
export function duplicateHeroes(hashes: Record<string, number>): string[] {
  const seen = new Map<number, string>();
  const out: string[] = [];
  for (const [k, h] of Object.entries(hashes)) {
    const prev = seen.get(h);
    if (prev) out.push(`${k} == ${prev}`); else seen.set(h, k);
  }
  return out;
}
