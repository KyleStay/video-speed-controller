import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

describe('Packaged UI document decoding', () => {
  it.each(['popup', 'options'])('decodes the %s page as UTF-8 without response headers', (page) => {
    // Passing bytes exercises browser-style encoding sniffing; a decoded string
    // would hide the mojibake caused by an absent charset declaration.
    const bytes = readFileSync(`src/ui/${page}/${page}.html`);
    const dom = new JSDOM(bytes);
    try {
      expect(dom.window.document.characterSet).toBe('UTF-8');
      if (page === 'popup') {
        expect(dom.window.document.querySelector('.speed-range').textContent).toBe('0.07×—16×');
      }
    } finally {
      dom.window.close();
    }
  });
});
