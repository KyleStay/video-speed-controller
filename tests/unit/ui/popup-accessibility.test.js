import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  cleanupChromeMock,
  installChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

const popupHtml = readFileSync(resolve(process.cwd(), 'src/ui/popup/popup.html'), 'utf8');
const popupCss = readFileSync(resolve(process.cwd(), 'src/ui/popup/popup.css'), 'utf8');

function renderPopup() {
  document.body.innerHTML = `
    <button id="config"></button>
    <button id="disable"></button>
    <button id="speed-decrease" data-delta="-0.1"><span>-0.1</span></button>
    <button id="speed-reset">1x</button>
    <button id="speed-increase" data-delta="0.1"><span>+0.1</span></button>
    <div class="preset-grid" role="group" aria-label="Speed presets">
      <button class="preset-btn" data-speed="0.5" aria-pressed="false">0.5</button>
      <button class="preset-btn" data-speed="1.0" aria-pressed="false">1</button>
      <button class="preset-btn" data-speed="1.5" aria-pressed="false">1.5</button>
    </div>
    <form id="custom-speed-form">
      <input id="custom-speed-input" aria-describedby="status" aria-invalid="false" />
      <button id="custom-speed-apply" type="submit">Set</button>
    </form>
    <div id="status" class="status hide" role="status" aria-live="polite"></div>
  `;
}

async function initializePopup() {
  vi.resetModules();
  await import('../../../src/ui/popup/popup.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('Popup accessibility', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    chrome.tabs.sendMessage = vi.fn((_tabId, _message, callback) => {
      callback?.({ ok: true, mediaCount: 1, currentSpeed: 1 });
    });
    renderPopup();
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('names preset groups and initializes pressed states', async () => {
    await initializePopup();

    const presetGrid = document.querySelector('.preset-grid');
    expect(presetGrid.getAttribute('role')).toBe('group');
    expect(presetGrid.getAttribute('aria-label')).toBe('Speed presets');
    expect(
      [...document.querySelectorAll('.preset-btn')].every((button) =>
        button.hasAttribute('aria-pressed')
      )
    ).toBe(true);

    const customSpeedInput = document.getElementById('custom-speed-input');
    expect(customSpeedInput.getAttribute('aria-describedby')).toBe('status');
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
  });

  it('marks invalid custom speed input and avoids sending invalid commands', async () => {
    await initializePopup();
    chrome.tabs.sendMessage.mockClear();

    const customSpeedInput = document.getElementById('custom-speed-input');
    customSpeedInput.value = '20';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('status').textContent).toBe(
      'Speed must be between 0.07x and 16x.'
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

    customSpeedInput.value = '1.25';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      { type: 'VSC_SET_SPEED', payload: { speed: 1.25 } },
      expect.any(Function)
    );
  });

  it('keeps invalid custom speed state until the typed value is valid', async () => {
    await initializePopup();

    const customSpeedInput = document.getElementById('custom-speed-input');
    customSpeedInput.value = '20';
    document
      .getElementById('custom-speed-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');

    customSpeedInput.value = '19';
    customSpeedInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('true');

    customSpeedInput.value = '1.5';
    customSpeedInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(customSpeedInput.getAttribute('aria-invalid')).toBe('false');
  });

  it('disables speed controls when the active tab cannot be controlled', async () => {
    chrome.tabs.query = vi.fn((_query, callback) => {
      callback([{ id: 1, url: 'chrome://extensions' }]);
    });
    chrome.tabs.sendMessage = vi.fn((_tabId, _message, callback) => {
      chrome.runtime.lastError = { message: 'Cannot access this page' };
      callback?.();
      chrome.runtime.lastError = null;
    });

    await initializePopup();

    expect(document.getElementById('status').textContent).toBe(
      'Controls are not available on browser pages.'
    );
    expect(document.getElementById('speed-decrease').disabled).toBe(true);
    expect(document.querySelector('.preset-btn').disabled).toBe(true);
    expect(document.getElementById('custom-speed-input').disabled).toBe(true);
    expect(document.getElementById('config').disabled).toBe(false);
    expect(document.getElementById('disable').disabled).toBe(false);
  });

  it('uses custom validation and visible disabled states for popup controls', () => {
    expect(popupHtml).toContain('id="custom-speed-form"');
    expect(popupHtml).toContain('novalidate');
    expect(popupCss).toContain('.control-btn:disabled');
    expect(popupCss).toContain('.control-btn:disabled:hover');
  });
});
