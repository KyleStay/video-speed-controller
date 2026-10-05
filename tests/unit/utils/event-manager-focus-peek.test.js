import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

let mockDOM;
let managers;

function setup({ exclusiveKeys = true, media = true, keyBindings } = {}) {
  const actions = [];
  const eventManager = new window.VSC.EventManager(
    {
      settings: {
        exclusiveKeys,
        keyBindings: keyBindings || [
          { action: 'rewind', code: 'KeyZ', keyCode: 90, value: 10 },
          { action: 'advance', code: 'KeyX', keyCode: 88, value: 10 },
        ],
      },
    },
    { runAction: (action, value) => actions.push({ action, value }) }
  );
  managers.push(eventManager);
  vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockReturnValue(
    media ? [createMockVideo()] : []
  );
  eventManager.setupKeyboardShortcuts(document);
  return { actions, eventManager };
}

function preview(ownerDocument = document, chords = ['z', 'shift+z']) {
  const host = ownerDocument.createElement('focus-peek-overlay');
  const state = { active: true, chords, queries: [] };
  host.addEventListener('focuspeek:claim-zoom-shortcut', (event) => {
    state.queries.push(event.detail);
    if (state.active && state.chords.includes(event.detail)) {
      event.preventDefault();
    }
  });
  ownerDocument.body.appendChild(host);
  return { host, state };
}

function key(type = 'keydown', { target = document.body, ...extra } = {}) {
  const event = new target.ownerDocument.defaultView.KeyboardEvent(type, {
    code: 'KeyZ',
    key: 'z',
    keyCode: 90,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  mockDOM = createMockDOM();
  managers = [];
});
afterEach(() => {
  managers.forEach((manager) => manager.cleanup());
  document.querySelectorAll('focus-peek-overlay, iframe').forEach((node) => node.remove());
  mockDOM.cleanup();
  vi.restoreAllMocks();
});

describe('Focus Peek zoom shortcut ownership', () => {
  it.each([true, false])(
    'yields Z and Shift+Z with exclusiveKeys=%s and resumes rewind after close',
    (exclusiveKeys) => {
      const { actions } = setup({ exclusiveKeys });
      const { state } = preview();
      const handled = vi.fn((event) => event.preventDefault());
      document.addEventListener('keydown', handled, {
        once: true,
        capture: true,
      });
      const zoom = key();
      expect(handled).toHaveBeenCalledOnce();
      expect(zoom.defaultPrevented).toBe(true);
      expect(key('keydown', { key: 'Z', shiftKey: true }).defaultPrevented).toBe(false);
      expect(actions).toEqual([]);
      state.active = false;
      const rewind = key();
      expect(rewind.defaultPrevented).toBe(exclusiveKeys);
      expect(actions).toEqual([{ action: 'rewind', value: 10 }]);
    }
  );

  it('does not suppress unrelated bindings or disabled preview chords', () => {
    const { actions } = setup();
    preview(document, ['z']);
    key('keydown', { code: 'KeyX', key: 'x', keyCode: 88 });
    key('keydown', { key: 'Z', shiftKey: true });
    expect(actions).toEqual([
      { action: 'advance', value: 10 },
      { action: 'rewind', value: 10 },
    ]);
  });

  it('uses logical custom chords rather than hard-coded physical KeyZ', () => {
    const { actions } = setup({
      keyBindings: [
        { action: 'rewind', code: 'KeyZ', keyCode: 90, value: 10 },
        { action: 'rewind', code: 'KeyQ', keyCode: 81, value: 10 },
      ],
    });
    preview(document, ['q']);
    key('keydown', { code: 'KeyQ', key: 'q', keyCode: 81 });
    expect(actions).toEqual([]);
    key('keydown', { code: 'KeyZ', key: 'w' }); // Non-QWERTY logical key.
    expect(actions).toEqual([{ action: 'rewind', value: 10 }]);
  });

  it('leaves Ctrl/Alt/Meta chords to VSC and never asks for an irrelevant key', () => {
    const { eventManager } = setup();
    const { state } = preview();
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      expect(eventManager.focusPeekOwnsZoomShortcut({ key: 'z', [modifier]: true })).toBe(false);
    }
    key('keydown', { code: 'KeyB', key: 'b', keyCode: 66 });
    expect(state.queries).toEqual([]);
  });

  it('avoids the late-media rescan for a key owned by a preview', () => {
    const { eventManager } = setup({ media: false });
    const { state } = preview();
    eventManager.requestMediaRescan = vi.fn(() => false);
    key();
    expect(eventManager.requestMediaRescan).not.toHaveBeenCalled();
    state.active = false;
    key();
    expect(eventManager.requestMediaRescan).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'isolates parent and same-origin child shortcuts, exclusiveKeys=%s',
    (exclusiveKeys) => {
      const { actions } = setup({ exclusiveKeys });
      const { state } = preview();
      const frame = document.createElement('iframe');
      document.body.appendChild(frame);
      const child = frame.contentWindow;
      child.VSC = {
        ...window.VSC,
        stateManager: { getControlledElements: () => [child.document.createElement('video')] },
      };
      const source = readFileSync('src/utils/event-manager.js', 'utf8');
      runInNewContext(source, {
        window: child,
        document: child.document,
        performance: child.performance,
      });
      const childActions = [];
      const childManager = new child.VSC.EventManager(
        {
          settings: {
            exclusiveKeys,
            keyBindings: [{ action: 'rewind', code: 'KeyZ', keyCode: 90, value: 10 }],
          },
        },
        { runAction: (action) => childActions.push(action) }
      );
      managers.push(childManager);
      childManager.setupKeyboardShortcuts(child.document);

      // An active parent preview yields only its parent's shortcut.
      key();
      expect(actions).toEqual([]);
      expect(childActions).toEqual([]);
      key('keydown', { target: child.document.body });
      expect(childActions).toEqual(['rewind']);
      expect(actions).toEqual([]);

      state.active = false;
      key();
      expect(actions).toEqual([{ action: 'rewind', value: 10 }]);
      expect(childActions).toEqual(['rewind']);
      preview(child.document);
      key('keydown', { target: child.document.body });
      expect(childActions).toEqual(['rewind']);
    }
  );

  it('clears earlier Twitter claims and leaves preview keypress/keyup alone', () => {
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
    const { actions } = setup();
    const { state } = preview();
    state.active = false;
    key();
    expect(actions).toHaveLength(1);
    state.active = true;
    expect(key().defaultPrevented).toBe(false);
    expect(key('keypress').defaultPrevented).toBe(false);
    expect(key('keyup').defaultPrevented).toBe(false);
    expect(actions).toHaveLength(1);
  });

  it('keeps rewind available if the preview query fails', () => {
    const { actions } = setup();
    const { host } = preview();
    vi.spyOn(host, 'dispatchEvent').mockImplementation(() => {
      throw new Error('detached realm');
    });
    key();
    expect(actions).toEqual([{ action: 'rewind', value: 10 }]);
  });
});
