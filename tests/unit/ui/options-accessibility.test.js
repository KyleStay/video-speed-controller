import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRow } from '../../../src/ui/options/row-renderer.js';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

const optionsCss = readFileSync(resolve(process.cwd(), 'src/ui/options/options.css'), 'utf8');

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

  it('supports arrow-key navigation for options tabs', async () => {
    document.body.innerHTML = `
      <button id="tab-settings" class="header-tab active" role="tab" aria-selected="true" aria-controls="panel-settings" tabindex="0">Settings</button>
      <button id="tab-advanced" class="header-tab" role="tab" aria-selected="false" aria-controls="panel-advanced" tabindex="-1">Advanced</button>
      <button id="tab-faq" class="header-tab" role="tab" aria-selected="false" aria-controls="panel-faq" tabindex="-1">FAQ</button>
      <div id="panel-settings" role="tabpanel"></div>
      <div id="panel-advanced" role="tabpanel" hidden></div>
      <div id="panel-faq" role="tabpanel" hidden></div>
    `;

    const { setupTabNavigation } = await import('../../../src/ui/options/options.js');
    setupTabNavigation();

    document
      .getElementById('tab-settings')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(document.getElementById('tab-settings').getAttribute('aria-selected')).toBe('false');
    expect(document.getElementById('tab-settings').getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById('panel-settings').hidden).toBe(true);
    expect(document.getElementById('tab-advanced').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('tab-advanced').getAttribute('tabindex')).toBe('0');
    expect(document.getElementById('panel-advanced').hidden).toBe(false);
  });

  it('reveals the Advanced tab before focusing invalid controller settings', async () => {
    document.body.innerHTML = `
      <div id="status" role="status"></div>
      <button id="tab-settings" class="header-tab active" role="tab" aria-selected="true" aria-controls="panel-settings" tabindex="0">Settings</button>
      <button id="tab-advanced" class="header-tab" role="tab" aria-selected="false" aria-controls="panel-advanced" tabindex="-1">Advanced</button>
      <button id="tab-faq" class="header-tab" role="tab" aria-selected="false" aria-controls="panel-faq" tabindex="-1">FAQ</button>
      <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings"></div>
      <div id="panel-advanced" role="tabpanel" aria-labelledby="tab-advanced" hidden>
        <input id="controllerOpacity" value="0.3" />
        <input id="controllerButtonSize" value="64" />
      </div>
      <div id="panel-faq" role="tabpanel" aria-labelledby="tab-faq" hidden></div>
      <div id="site-rules-container"></div>
    `;

    const { setupTabNavigation, validate } = await import('../../../src/ui/options/options.js');
    setupTabNavigation();

    expect(validate()).toBe(false);
    expect(document.getElementById('panel-advanced').hidden).toBe(false);
    expect(document.getElementById('tab-advanced').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(document.getElementById('controllerButtonSize'));
    expect(document.getElementById('controllerButtonSize').getAttribute('aria-invalid')).toBe(
      'true'
    );
    expect(document.getElementById('controllerButtonSize').getAttribute('aria-errormessage')).toBe(
      'status'
    );
    expect(document.getElementById('status').textContent).toBe(
      'Error: Controller button size must be between 10 and 32.'
    );
  });

  it('closes the split action menu with Escape and restores focus', async () => {
    document.body.innerHTML = `
      <div class="split-button">
        <button id="split-toggle" aria-expanded="false" aria-controls="split-menu">More</button>
        <div id="split-menu" hidden>
          <button id="import">Import</button>
          <button id="export">Export</button>
        </div>
      </div>
    `;

    const { setupSplitMenu } = await import('../../../src/ui/options/options.js');
    setupSplitMenu();

    expect(document.getElementById('split-toggle').hasAttribute('aria-haspopup')).toBe(false);

    document
      .getElementById('split-toggle')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(document.getElementById('split-menu').hidden).toBe(false);
    expect(document.getElementById('split-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.getElementById('import'));

    document
      .getElementById('import')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('split-menu').hidden).toBe(true);
    expect(document.getElementById('split-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(document.getElementById('split-toggle'));

    document
      .getElementById('split-toggle')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document
      .getElementById('import')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById('export'));

    document
      .getElementById('split-toggle')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('export').focus();
    document.getElementById('export').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('split-menu').hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('split-toggle'));
  });

  it('validates controller opacity and button size ranges before saving', async () => {
    document.body.innerHTML = `
      <input id="controllerOpacity" value="-0.1" />
      <input id="controllerButtonSize" value="14" />
    `;

    const { validateControllerSettings } = await import('../../../src/ui/options/options.js');
    expect(validateControllerSettings()).toMatchObject({
      valid: false,
      message: 'Controller opacity must be between 0 and 1.',
    });

    document.getElementById('controllerOpacity').value = '0';
    document.getElementById('controllerButtonSize').value = '64';

    expect(validateControllerSettings()).toMatchObject({
      valid: false,
      message: 'Controller button size must be between 10 and 32.',
    });

    document.getElementById('controllerButtonSize').value = '16';

    expect(validateControllerSettings()).toMatchObject({
      valid: true,
      controllerOpacity: 0,
      controllerButtonSize: 16,
    });
  });

  it('keeps mobile preference checkbox layout from applying to site rule rows', () => {
    expect(optionsCss).toContain(".row:not(.site-rule):has(> input[type='checkbox'])");
    expect(optionsCss).not.toContain(".row:has(input[type='checkbox'])");
  });

  it('keeps shortcut text visible in forced colors mode', () => {
    expect(optionsCss).toContain('@media (forced-colors: active)');
    expect(optionsCss).toContain('.customKey');
    expect(optionsCss).toContain('color: CanvasText');
    expect(optionsCss).toContain('text-shadow: none');
  });

  it('keeps native numeric constraints aligned with range-only validation', () => {
    document.body.innerHTML = `
      <input id="controllerOpacity" type="number" min="0" max="1" step="any" value="0.33" />
      <input id="controllerButtonSize" type="number" min="10" max="32" step="any" value="14.5" />
    `;

    expect(document.getElementById('controllerOpacity').validity.valid).toBe(true);
    expect(document.getElementById('controllerButtonSize').validity.valid).toBe(true);
  });
});
