import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createRow } from '../../../src/ui/options/row-renderer.js';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

describe('Options accessibility and CSS safety', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('createRow applies accessible labels to generated controls', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const row = createRow(
      container,
      [
        {
          key: 'action',
          type: 'select',
          className: 'customDo',
          options: [['faster', 'Increase speed']],
          label: 'Shortcut action',
        },
        {
          key: 'keyInput',
          type: 'text',
          className: 'customKey',
          label: 'Shortcut key',
        },
        {
          key: 'disabled',
          type: 'checkbox',
          className: 'ruleDisabled',
          label: 'Disable site rule',
        },
      ],
      {},
      { removable: true, removeLabel: 'Remove shortcut' }
    );

    expect(row.querySelector('.customDo').getAttribute('aria-label')).toBe('Shortcut action');
    expect(row.querySelector('.customKey').getAttribute('aria-label')).toBe('Shortcut key');
    expect(row.querySelector('.ruleDisabled').getAttribute('aria-label')).toBe('Disable site rule');
    expect(row.querySelector('.removeParent').getAttribute('aria-label')).toBe('Remove shortcut');
  });

  it('validateCustomCSSSafety blocks CSS that can load remote resources', async () => {
    const { validateCustomCSSSafety } = await import('../../../src/ui/options/options.js');

    expect(validateCustomCSSSafety('@import "https://example.com/a.css";')).toMatch(
      /Remote-loading/
    );
    expect(
      validateCustomCSSSafety('vsc-controller { background: url(https://x.test/a.png); }')
    ).toMatch(/Remote-loading/);
    expect(validateCustomCSSSafety('vsc-controller { top: 4px; }')).toBe('');
  });
});
