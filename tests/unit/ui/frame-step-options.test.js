/**
 * Options-page coverage for the frame-step actions:
 *  - ACTION_OPTIONS exposes the "Rewind frame" / "Advance frame" labels.
 *  - The recorder keeps bare-key frame-step bindings shift-exclusive so a
 *    re-recorded "," can't hijack Shift+"," ("<", YouTube's speed key).
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

describe('Frame-step options', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('ACTION_OPTIONS exposes Rewind frame and Advance frame labels', async () => {
    const { ACTION_OPTIONS } = await import('../../../src/ui/options/options.js');
    const map = new Map(ACTION_OPTIONS);
    expect(map.get('rewindFrame')).toBe('Rewind frame');
    expect(map.get('advanceFrame')).toBe('Advance frame');
  });

  // Mirrors the shift-exclusive stamping in options.js createKeyBindings, driven
  // by the real SHIFT_EXCLUSIVE_ACTIONS set so it fails if that set drifts.
  async function buildBinding(action, input) {
    const { SHIFT_EXCLUSIVE_ACTIONS } = await import('../../../src/ui/options/options.js');
    const binding = {
      action,
      code: input.code,
      key: input.keyCode,
      keyCode: input.keyCode,
      displayKey: input.displayKey,
      value: input.value,
      predefined: true,
    };
    if (input.modifiers) {
      binding.modifiers = input.modifiers;
    }
    if (!binding.modifiers && input.code && SHIFT_EXCLUSIVE_ACTIONS.has(action)) {
      binding.modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    }
    return binding;
  }

  it('re-recording a bare "," for rewindFrame stamps all-false modifiers', async () => {
    const binding = await buildBinding('rewindFrame', {
      code: 'Comma',
      keyCode: 188,
      displayKey: ',',
      value: 30,
      modifiers: undefined,
    });
    expect(binding.modifiers).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
  });

  it('re-recording a bare "." for advanceFrame stamps all-false modifiers', async () => {
    const binding = await buildBinding('advanceFrame', {
      code: 'Period',
      keyCode: 190,
      displayKey: '.',
      value: 30,
      modifiers: undefined,
    });
    expect(binding.modifiers).toEqual({ ctrl: false, alt: false, shift: false, meta: false });
  });

  it('an explicitly recorded chord on a frame-step action is preserved as-is', async () => {
    const binding = await buildBinding('advanceFrame', {
      code: 'Period',
      keyCode: 190,
      displayKey: '.',
      value: 30,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false },
    });
    expect(binding.modifiers).toEqual({ ctrl: true, alt: false, shift: false, meta: false });
  });

  it('a non-frame-step action does NOT get modifiers stamped for a bare key', async () => {
    const binding = await buildBinding('slower', {
      code: 'KeyS',
      keyCode: 83,
      displayKey: 's',
      value: 0.1,
      modifiers: undefined,
    });
    expect(binding.modifiers).toBeUndefined();
  });
});
