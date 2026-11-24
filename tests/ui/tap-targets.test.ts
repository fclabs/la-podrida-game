// NFR-902 (static part of VC-953): the classes of every bid button, clickable card, `Saltar`,
// `Reintentar`, `Planilla` and `Cerrar` declare min-width and min-height of at least 44px.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT = path.resolve(__dirname, '../../app/_client');

/** The declaration block of the first rule whose selector list contains `selector`. */
function block(css: string, selector: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selectors = (m[1] as string).split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2] as string;
  }
  throw new Error(`no rule for ${selector}`);
}

function px(decls: string, prop: string): number {
  const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(decls);
  return m === null ? 0 : Number(m[1]);
}

const TARGETS: [label: string, file: string, selector: string][] = [
  ['bid button', 'bid-bar.module.css', '.bid'],
  ['clickable card', 'card-view.module.css', '.card'],
  ['Saltar, Reintentar, Planilla', 'game-page.module.css', '.button'],
  ['Cerrar', 'score-sheet.module.css', '.close'],
  ['Nueva partida link (game over)', 'game-over.module.css', '.link'],
  ['new-game submit', 'new-game-page.module.css', '.submit'],
];

describe('tap targets (NFR-902)', () => {
  it.each(TARGETS)('%s is at least 44 x 44px', (_label, file, selector) => {
    const decls = block(fs.readFileSync(path.join(CLIENT, file), 'utf8'), selector);
    expect(px(decls, 'min-height')).toBeGreaterThanOrEqual(44);
    // The submit button is full width in a column, so only the clickable ones need min-width.
    if (selector !== '.submit') expect(px(decls, 'min-width')).toBeGreaterThanOrEqual(44);
  });
});

describe('phone layout CSS (NFR-901)', () => {
  it('the score sheet scrolls inside itself and its table scrolls inside its wrapper', () => {
    const css = fs.readFileSync(path.join(CLIENT, 'score-sheet.module.css'), 'utf8');
    expect(block(css, '.panel')).toMatch(/overflow:\s*auto/);
    expect(block(css, '.scroll')).toMatch(/overflow-x:\s*auto/);
    expect(block(css, '.scroll')).toMatch(/max-width:\s*100%/);
  });

  it('hand, bid buttons and seats wrap', () => {
    for (const [file, sel] of [
      ['hand.module.css', '.cards'],
      ['bid-bar.module.css', '.bar'],
      ['table.module.css', '.seats'],
    ] as const) {
      const css = fs.readFileSync(path.join(CLIENT, file), 'utf8');
      expect(block(css, sel), `${file} ${sel}`).toMatch(/flex-wrap:\s*wrap/);
    }
  });

  it('uses at most the one min-width: 768px breakpoint', () => {
    for (const f of fs.readdirSync(CLIENT).filter((n) => n.endsWith('.css'))) {
      const media = fs.readFileSync(path.join(CLIENT, f), 'utf8').match(/@media[^{]+/g) ?? [];
      for (const m of media) expect(m.trim()).toBe('@media (min-width: 768px)');
    }
  });
});
