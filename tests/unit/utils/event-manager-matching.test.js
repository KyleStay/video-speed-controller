/**
 * Tests for event.code-based keyboard matching algorithm in EventManager.
 * Covers: chord match, simple match, legacy fallback, IME guard, dedup, precedence.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
let mockDOM;

function setupEnv(keyBindings) {
  const config = window.VSC.videoSpeedConfig;
  config._loaded = true;
  config.settings.keyBindings = keyBindings;

  const actions = [];
  const actionHandler = {
    runAction: (action, value, _event) => actions.push({ action, value }),
  };

  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const video = createMockVideo({ playbackRate: 1.0 });
  if (!video.parentElement) {
    mockDOM.container.appendChild(video);
  }
  video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set('test-video', {
    id: 'test-video',
    element: video,
    videoSrc: 'test',
    tagName: 'VIDEO',
    created: Date.now(),
    isActive: true,
  });

  return { config, eventManager, actions, video };
}

function makeEvent(overrides = {}) {
  return {
    code: overrides.code || '',
    key: overrides.key || '',
    keyCode: overrides.keyCode || 0,
    ctrlKey: overrides.ctrlKey || false,
    altKey: overrides.altKey || false,
    shiftKey: overrides.shiftKey || false,
    metaKey: overrides.metaKey || false,
    isComposing: overrides.isComposing || false,
    timeStamp: overrides.timeStamp || Date.now(),
    type: overrides.type || 'keydown',
    target: overrides.target || document.body,
    preventDefault: () => {},
    stopPropagation: () => {},
    stopImmediatePropagation: () => {},
  };
}

describe('EventManager Matching', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  // Chord matching

  it('Chord: Ctrl+KeyS matches chord binding, not simple binding', () => {
    const { eventManager, actions } = setupEnv([
      { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
      {
        action: 'save-chord',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        value: 0,
        force: false,
        modifiers: { ctrl: true, alt: false, shift: false, meta: false },
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        ctrlKey: true,
        timeStamp: 100,
      })
    );

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('save-chord');
  });

  // Simple matching

  it('Simple: KeyS matches simple binding when no modifiers active', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        timeStamp: 200,
      })
    );

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('slower');
  });

  it('Matched shortcut prevents same-target page capture listeners when exclusiveKeys is enabled', () => {
    const { config, eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);
    config.settings.exclusiveKeys = true;

    eventManager.setupKeyboardShortcuts(document);

    let siteHandled = false;
    const youtubeLikeHandler = () => {
      siteHandled = true;
    };
    document.addEventListener('keydown', youtubeLikeHandler, true);

    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      key: 's',
      keyCode: 83,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    document.removeEventListener('keydown', youtubeLikeHandler, true);
    eventManager.cleanup();

    expect(actions).toEqual([{ action: 'slower', value: 0.1 }]);
    expect(siteHandled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Matched shortcut allows page listeners on generic sites when exclusiveKeys is disabled', () => {
    const { config, eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);
    config.settings.exclusiveKeys = false;

    eventManager.setupKeyboardShortcuts(document);

    let siteHandled = false;
    const siteHandler = () => {
      siteHandled = true;
    };
    document.addEventListener('keydown', siteHandler, true);

    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      key: 's',
      keyCode: 83,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    document.removeEventListener('keydown', siteHandler, true);
    eventManager.cleanup();

    expect(actions).toEqual([{ action: 'slower', value: 0.1 }]);
    expect(siteHandled).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('YouTube host detection covers YouTube watch and embed domains only', () => {
    expect(window.VSC.EventManager.isYouTubeHost('www.youtube.com')).toBe(true);
    expect(window.VSC.EventManager.isYouTubeHost('m.youtube.com')).toBe(true);
    expect(window.VSC.EventManager.isYouTubeHost('www.youtube-nocookie.com')).toBe(true);
    expect(window.VSC.EventManager.isYouTubeHost('notyoutube.com')).toBe(false);
  });

  it('Reddit host detection covers Reddit domains only', () => {
    expect(window.VSC.EventManager.isRedditHost('reddit.com')).toBe(true);
    expect(window.VSC.EventManager.isRedditHost('www.reddit.com')).toBe(true);
    expect(window.VSC.EventManager.isRedditHost('old.reddit.com')).toBe(true);
    expect(window.VSC.EventManager.isRedditHost('new.reddit.com')).toBe(true);
    expect(window.VSC.EventManager.isRedditHost('notreddit.com')).toBe(false);
  });

  it('site-specific claim path does not require exclusiveKeys', () => {
    const { config, eventManager } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);
    config.settings.exclusiveKeys = false;

    const originalIsShortcutClaimHost = window.VSC.EventManager.isShortcutClaimHost;
    window.VSC.EventManager.isShortcutClaimHost = () => true;

    expect(eventManager.shouldClaimShortcutEvent()).toBe(true);

    window.VSC.EventManager.isShortcutClaimHost = originalIsShortcutClaimHost;
  });

  it('Reddit matched shortcuts block same-target page capture listeners without exclusiveKeys', () => {
    const { config, eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);
    config.settings.exclusiveKeys = false;

    const originalIsShortcutClaimHost = window.VSC.EventManager.isShortcutClaimHost;
    window.VSC.EventManager.isShortcutClaimHost = () => true;

    eventManager.setupKeyboardShortcuts(document);

    let siteHandled = false;
    const redditLikeHandler = () => {
      siteHandled = true;
    };
    document.addEventListener('keydown', redditLikeHandler, true);

    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      key: 's',
      keyCode: 83,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    document.removeEventListener('keydown', redditLikeHandler, true);
    eventManager.cleanup();
    window.VSC.EventManager.isShortcutClaimHost = originalIsShortcutClaimHost;

    expect(actions).toEqual([{ action: 'slower', value: 0.1 }]);
    expect(siteHandled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Unmatched keys still reach same-target page capture listeners', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.setupKeyboardShortcuts(document);

    let siteHandledCount = 0;
    const youtubeLikeHandler = () => {
      siteHandledCount++;
    };
    document.addEventListener('keydown', youtubeLikeHandler, true);

    const event = new KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      keyCode: 75,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    document.removeEventListener('keydown', youtubeLikeHandler, true);
    eventManager.cleanup();

    expect(actions.length).toBe(0);
    expect(siteHandledCount).toBe(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Matched shortcuts do not fire or block page listeners while typing in editable fields', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.setupKeyboardShortcuts(document);

    let siteHandledCount = 0;
    const youtubeLikeHandler = () => {
      siteHandledCount++;
    };
    document.addEventListener('keydown', youtubeLikeHandler, true);

    const editableTargets = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    editableTargets[3].setAttribute('contenteditable', 'true');
    editableTargets[4].setAttribute('role', 'textbox');
    editableTargets[5].setAttribute('role', 'searchbox');

    editableTargets.forEach((target, index) => {
      document.body.appendChild(target);
      const event = new KeyboardEvent('keydown', {
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      expect(event.defaultPrevented, `editable target ${index}`).toBe(false);
    });

    document.removeEventListener('keydown', youtubeLikeHandler, true);
    eventManager.cleanup();

    expect(actions.length).toBe(0);
    expect(siteHandledCount).toBe(editableTargets.length);
  });

  it('Matched shortcuts do not fire when editable controls appear in composedPath', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    const searchInput = document.createElement('input');
    const retargetedHost = document.createElement('reddit-search-large');
    document.body.appendChild(retargetedHost);

    eventManager.handleKeydown({
      ...makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        target: retargetedHost,
        timeStamp: 250,
      }),
      composedPath: () => [searchInput, retargetedHost, document.body, document, window],
    });

    expect(actions.length).toBe(0);
    retargetedHost.remove();
  });

  it('Matched shortcuts do not fire when focus is inside an open shadow search input', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    const searchHost = document.createElement('reddit-search-large');
    const shadowRoot = searchHost.attachShadow({ mode: 'open' });
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    shadowRoot.appendChild(searchInput);
    document.body.appendChild(searchHost);
    searchInput.focus();

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        target: document.body,
        timeStamp: 260,
      })
    );

    expect(actions.length).toBe(0);
    searchInput.blur();
    searchHost.remove();
  });

  it('Active typing focus in another document does not suppress current document shortcuts', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    const otherDocument = document.implementation.createHTMLDocument('iframe');
    const otherInput = otherDocument.createElement('input');
    otherDocument.body.appendChild(otherInput);
    otherInput.focus();

    const currentTarget = document.createElement('div');
    document.body.appendChild(currentTarget);
    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        target: currentTarget,
        timeStamp: 270,
      })
    );

    expect(actions).toEqual([{ action: 'slower', value: 0.1 }]);
    currentTarget.remove();
  });

  it('Simple: Shift+KeyS still matches simple KeyS binding (backward compat)', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 'S',
        keyCode: 83,
        shiftKey: true,
        timeStamp: 300,
      })
    );

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('slower');
  });

  it('Simple: Ctrl+KeyS does NOT match simple binding', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        ctrlKey: true,
        timeStamp: 400,
      })
    );

    expect(actions.length).toBe(0);
  });

  // Legacy fallback

  it('Legacy: binding with code:null matches on keyCode', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'custom',
        code: null,
        key: 255,
        keyCode: 255,
        displayKey: '',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'Unidentified',
        key: '',
        keyCode: 255,
        timeStamp: 500,
      })
    );

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('custom');
  });

  it('Legacy: Ctrl+keyCode does NOT match legacy binding (modifier gating)', () => {
    const { eventManager, actions } = setupEnv([
      { action: 'slower', code: null, key: 83, keyCode: 83, value: 0.1, force: false },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: '',
        key: 's',
        keyCode: 83,
        ctrlKey: true,
        timeStamp: 600,
      })
    );

    expect(actions.length).toBe(0);
  });

  // Empty event.code runtime fallback

  it('Empty event.code: falls back to keyCode matching for all bindings', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: '',
        key: 's',
        keyCode: 83,
        timeStamp: 700,
      })
    );

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('slower');
  });

  // IME guards

  it('IME: isComposing=true should block all matching', () => {
    const { eventManager, actions } = setupEnv([
      { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        isComposing: true,
        timeStamp: 800,
      })
    );

    expect(actions.length).toBe(0);
  });

  it('IME: keyCode 229 should block all matching', () => {
    const { eventManager, actions } = setupEnv([
      { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: '',
        key: '',
        keyCode: 229,
        timeStamp: 900,
      })
    );

    expect(actions.length).toBe(0);
  });

  it('IME: key="Process" should block all matching', () => {
    const { eventManager, actions } = setupEnv([
      { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
    ]);

    eventManager.handleKeydown(
      makeEvent({
        code: '',
        key: 'Process',
        keyCode: 0,
        timeStamp: 1000,
      })
    );

    expect(actions.length).toBe(0);
  });

  // Event deduplication

  it('Event dedup: same code+key+timeStamp+type should be deduplicated', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
    ]);

    const event = makeEvent({ code: 'KeyS', key: 's', keyCode: 83, timeStamp: 1100 });
    eventManager.handleKeydown(event);
    eventManager.handleKeydown(event);

    expect(actions.length).toBe(1);
  });

  // Non-QWERTY layout matching
  // event.code is physical key position — the same physical key fires the same
  // binding regardless of what character it produces on the user's layout.
  // AZERTY 'Z' key is at physical position KeyW; a binding stored as code:"KeyW"
  // correctly fires when that key is pressed (event.code="KeyW").

  it('AZERTY: binding stored at correct physical code fires on that physical key', () => {
    // After re-recording on AZERTY, 'Z' key stores code:"KeyW" (physical position).
    // Pressing 'Z' on AZERTY produces event.code="KeyW" → match.
    const { eventManager, actions } = setupEnv([
      {
        action: 'rewind',
        code: 'KeyW',
        key: 87,
        keyCode: 87,
        displayKey: 'z',
        value: 10,
        force: false,
      },
    ]);
    eventManager.handleKeydown(makeEvent({ code: 'KeyW', key: 'z', keyCode: 90, timeStamp: 1150 }));
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('rewind');
  });

  it('AZERTY: migrated binding (wrong code:"KeyZ") does NOT fire on AZERTY Z press (code:"KeyW")', () => {
    // The v2 migration stored code:"KeyZ" for keyCode:90 (QWERTY assumption).
    // On AZERTY, pressing 'Z' gives event.code="KeyW" — no match until user re-records.
    // This test documents the known migration artifact that prompts re-recording.
    const { eventManager, actions } = setupEnv([
      {
        action: 'rewind',
        code: 'KeyZ',
        key: 90,
        keyCode: 90,
        displayKey: 'z',
        value: 10,
        force: false,
      },
    ]);
    eventManager.handleKeydown(makeEvent({ code: 'KeyW', key: 'z', keyCode: 90, timeStamp: 1160 }));
    expect(actions.length).toBe(0);
  });

  // Dead key guard

  it('Dead key press does not trigger any binding', () => {
    // On French/European keyboards, keys like ^ are dead keys — the first
    // keypress produces event.key='Dead' and should not fire shortcuts.
    const { eventManager, actions } = setupEnv([
      {
        action: 'reset',
        code: 'BracketLeft',
        key: 192,
        keyCode: 192,
        displayKey: '`',
        value: 1.0,
        force: false,
      },
    ]);
    eventManager.handleKeydown(
      makeEvent({ code: 'BracketLeft', key: 'Dead', keyCode: 192, timeStamp: 1200 })
    );
    expect(actions.length).toBe(0);
  });

  // Numpad key matching

  it('Numpad: NumpadEnter binding fires correctly on NumpadEnter press', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'reset',
        code: 'NumpadEnter',
        key: 13,
        keyCode: 13,
        displayKey: 'Num Enter',
        value: 1.0,
        force: false,
      },
    ]);
    eventManager.handleKeydown(
      makeEvent({ code: 'NumpadEnter', key: 'Enter', keyCode: 13, timeStamp: 1400 })
    );
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('reset');
  });

  it('Numpad: Enter binding (code:"Enter") does NOT fire on NumpadEnter — keys are distinct, no coalesce', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'reset',
        code: 'Enter',
        key: 13,
        keyCode: 13,
        displayKey: 'Enter',
        value: 1.0,
        force: false,
      },
    ]);
    eventManager.handleKeydown(
      makeEvent({ code: 'NumpadEnter', key: 'Enter', keyCode: 13, timeStamp: 1500 })
    );
    expect(actions.length).toBe(0);
  });

  it('displayKeyFromCode: NumpadEnter → "Num Enter" (distinct from regular Enter)', () => {
    expect(window.VSC.Constants.displayKeyFromCode('NumpadEnter')).toBe('Num Enter');
    expect(window.VSC.Constants.displayKeyFromCode('Enter')).toBe('Enter');
  });

  // Chord precedence

  it('Chord precedence: Ctrl+S chord fires instead of plain S binding', () => {
    const { eventManager, actions } = setupEnv([
      {
        action: 'slower',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        displayKey: 's',
        value: 0.1,
        force: false,
      },
      {
        action: 'ctrl-s-action',
        code: 'KeyS',
        key: 83,
        keyCode: 83,
        value: 0,
        force: true,
        modifiers: { ctrl: true, alt: false, shift: false, meta: false },
      },
    ]);

    // Plain S → slower
    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        timeStamp: 1200,
      })
    );
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('slower');

    // Ctrl+S → chord action
    eventManager.handleKeydown(
      makeEvent({
        code: 'KeyS',
        key: 's',
        keyCode: 83,
        ctrlKey: true,
        timeStamp: 1300,
      })
    );
    expect(actions.length).toBe(2);
    expect(actions[1].action).toBe('ctrl-s-action');
  });
});
