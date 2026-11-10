// Contract test for the "Open lab" cards.
//
// Each card links to WORKSPACE_URL#/lab/<id>. The workspace looks the id up
// in its EXAMPLES list (src/model/examples.ts) and sends an unknown id to the
// Learn page. So a typo here would not crash anything: it would just quietly
// open the wrong page. This test catches that before a deploy.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const cards = [...html.matchAll(/<a class="lab-link" href="([^"]*)" data-lab="([^"]*)"/g)].map((m) => ({ href: m[1], id: m[2] }));

// Same rule as the workspace router: what it will accept as a lab id.
const ID = /^[A-Za-z0-9_-]{1,64}$/;

describe('lab cards', () => {
  it('has the ten labs, each once', () => {
    expect(cards).toHaveLength(10);
    expect(new Set(cards.map((c) => c.id)).size).toBe(10);
  });

  it('links each card to the workspace deep link for its own id', () => {
    for (const { href, id } of cards) {
      expect(id).toMatch(ID);
      expect(href).toBe(`__WORKSPACE_URL__#/lab/${id}`);
    }
  });

  // The landing app is deployed on its own, so the workspace source may not be
  // next to it (for example in a landing-only checkout). Check when it is.
  const examples = resolve(__dirname, '../../src/model/examples.ts');
  const source = existsSync(examples) ? readFileSync(examples, 'utf8') : '';
  const known = [...source.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]);
  it.skipIf(known.length === 0)('uses only ids the workspace knows', () => {
    for (const { id } of cards) expect(known).toContain(id);
  });
});
