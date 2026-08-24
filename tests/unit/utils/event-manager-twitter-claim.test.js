/**
 * Tests for X/Twitter shortcut-claim host detection.
 *
 * VSC already claims matched shortcuts on selected sites whose own keyboard
 * handlers conflict with VSC. X/Twitter belongs on that list so VSC's bare
 * Period frame-step binding wins over X's "." shortcut.
 *
 * Frame-step modifier behavior itself is covered by frame-step-bindings.test.js
 * and event-manager-matching.test.js: bare "." matches advanceFrame while
 * Shift+"." (">") does not.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

const PERIOD_BINDING = {
  action: 'advanceFrame',
  code: 'Period',
  key: 190,
  keyCode: 190,
  displayKey: '.',
  value: 30,
  modifiers: { ctrl: false, alt: false, shift: false, meta: false },
};

let mockDOM;
let eventManagers;
let pageListeners;

function setupEnv(keyBindings = [PERIOD_BINDING]) {
  const config = window.VSC.videoSpeedConfig;
  config._loaded = true;
  config.settings.keyBindings = keyBindings;
  config.settings.exclusiveKeys = false;

  const actions = [];
  const eventManager = new window.VSC.EventManager(config, {
    runAction: (action, value) => actions.push({ action, value }),
  });
  eventManagers.push(eventManager);

  const video = createMockVideo({ playbackRate: 1 });
  if (!video.parentElement) {
    mockDOM.container.appendChild(video);
  }
  video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set('twitter-test-video', {
    id: 'twitter-test-video',
    element: video,
    videoSrc: 'test',
    tagName: 'VIDEO',
    created: Date.now(),
    isActive: true,
  });

  return { actions, eventManager };
}

function makeKeyboardEvent(type, overrides = {}) {
  return new KeyboardEvent(type, {
    code: overrides.code ?? 'Period',
    key: overrides.key ?? '.',
    shiftKey: overrides.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

function listenForPageKeyboardEvents(eventTypes = ['keydown', 'keypress', 'keyup']) {
  const observed = [];

  eventTypes.forEach((type) => {
    const handler = (event) => observed.push(event.type);
    window.addEventListener(type, handler, true);
    pageListeners.push({ type, handler });
  });

  return observed;
}

describe('EventManager X/Twitter shortcut claiming', () => {
  it('detects x.com and its subdomains', () => {
    expect(window.VSC.EventManager.isTwitterHost('x.com')).toBe(true);
    expect(window.VSC.EventManager.isTwitterHost('www.x.com')).toBe(true);
    expect(window.VSC.EventManager.isTwitterHost('mobile.x.com')).toBe(true);
  });

  it('detects legacy twitter.com and its subdomains', () => {
    expect(window.VSC.EventManager.isTwitterHost('twitter.com')).toBe(true);
    expect(window.VSC.EventManager.isTwitterHost('www.twitter.com')).toBe(true);
    expect(window.VSC.EventManager.isTwitterHost('mobile.twitter.com')).toBe(true);
  });

  it('rejects lookalike domains', () => {
    expect(window.VSC.EventManager.isTwitterHost('notx.com')).toBe(false);
    expect(window.VSC.EventManager.isTwitterHost('examplex.com')).toBe(false);
    expect(window.VSC.EventManager.isTwitterHost('nottwitter.com')).toBe(false);
    expect(window.VSC.EventManager.isTwitterHost('twitter.com.example.com')).toBe(false);
  });

  it('includes X/Twitter in the shortcut-claim host list', () => {
    expect(window.VSC.EventManager.isShortcutClaimHost('x.com')).toBe(true);
    expect(window.VSC.EventManager.isShortcutClaimHost('www.x.com')).toBe(true);
    expect(window.VSC.EventManager.isShortcutClaimHost('twitter.com')).toBe(true);
    expect(window.VSC.EventManager.isShortcutClaimHost('www.twitter.com')).toBe(true);
  });

  it('preserves the existing YouTube and Reddit claim hosts', () => {
    expect(window.VSC.EventManager.isShortcutClaimHost('www.youtube.com')).toBe(true);
    expect(window.VSC.EventManager.isShortcutClaimHost('reddit.com')).toBe(true);
  });

  it('does not turn unrelated sites into shortcut-claim hosts', () => {
    expect(window.VSC.EventManager.isShortcutClaimHost('example.com')).toBe(false);
  });
});

describe('EventManager X/Twitter shortcut follow-up suppression', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();
    eventManagers = [];
    pageListeners = [];
    window.VSC.stateManager.controllers.clear();
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
  });

  afterEach(() => {
    pageListeners.forEach(({ type, handler }) => {
      window.removeEventListener(type, handler, true);
    });
    eventManagers.forEach((eventManager) => eventManager.cleanup());
    window.VSC.stateManager.controllers.clear();
    mockDOM.cleanup();
    cleanupChromeMock();
    vi.restoreAllMocks();
  });

  it('claims keydown, keypress, and keyup while running the VSC action once', () => {
    const { actions, eventManager } = setupEnv();
    eventManager.setupKeyboardShortcuts(document);
    const observed = listenForPageKeyboardEvents();

    const keydown = makeKeyboardEvent('keydown');
    const keypress = makeKeyboardEvent('keypress');
    const keyup = makeKeyboardEvent('keyup');

    document.body.dispatchEvent(keydown);
    document.body.dispatchEvent(keypress);
    document.body.dispatchEvent(keyup);

    expect(actions).toEqual([{ action: 'advanceFrame', value: 30 }]);
    expect(observed).toEqual([]);
    expect(keydown.defaultPrevented).toBe(true);
    expect(keypress.defaultPrevented).toBe(true);
    expect(keyup.defaultPrevented).toBe(true);
    expect(eventManager.claimedShortcutFollowups.size).toBe(0);
  });

  it('allows an unclaimed shifted shortcut and all of its follow-up events', () => {
    const { actions, eventManager } = setupEnv();
    eventManager.setupKeyboardShortcuts(document);
    const observed = listenForPageKeyboardEvents();

    const events = [
      makeKeyboardEvent('keydown', { key: '>', shiftKey: true }),
      makeKeyboardEvent('keypress', { key: '>', shiftKey: true }),
      makeKeyboardEvent('keyup', { key: '>', shiftKey: true }),
    ];
    events.forEach((event) => document.body.dispatchEvent(event));

    expect(actions).toEqual([]);
    expect(observed).toEqual(['keydown', 'keypress', 'keyup']);
    events.forEach((event) => expect(event.defaultPrevented).toBe(false));
    expect(eventManager.claimedShortcutFollowups.size).toBe(0);
  });

  it('does not claim shortcut events while the user is typing', () => {
    const { actions, eventManager } = setupEnv();
    eventManager.setupKeyboardShortcuts(document);
    const observed = listenForPageKeyboardEvents();
    const input = document.createElement('input');
    document.body.appendChild(input);

    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      input.dispatchEvent(makeKeyboardEvent(type));
    });

    expect(actions).toEqual([]);
    expect(observed).toEqual(['keydown', 'keypress', 'keyup']);
    expect(eventManager.claimedShortcutFollowups.size).toBe(0);
  });

  it('cleanup releases remembered keys and removes follow-up listeners', () => {
    const { actions, eventManager } = setupEnv();
    eventManager.setupKeyboardShortcuts(document);
    document.body.dispatchEvent(makeKeyboardEvent('keydown'));

    expect(actions).toHaveLength(1);
    expect(eventManager.claimedShortcutFollowups.size).toBe(1);

    eventManager.cleanup();
    const observed = listenForPageKeyboardEvents(['keypress', 'keyup']);
    const keypress = makeKeyboardEvent('keypress');
    const keyup = makeKeyboardEvent('keyup');
    document.body.dispatchEvent(keypress);
    document.body.dispatchEvent(keyup);

    expect(observed).toEqual(['keypress', 'keyup']);
    expect(keypress.defaultPrevented).toBe(false);
    expect(keyup.defaultPrevented).toBe(false);
    expect(eventManager.claimedShortcutFollowups.size).toBe(0);
  });

  it('keeps simultaneous same-character keys isolated by event.code', () => {
    const numpadBinding = {
      ...PERIOD_BINDING,
      action: 'numpad-action',
      code: 'NumpadDecimal',
    };
    const { eventManager } = setupEnv([PERIOD_BINDING, numpadBinding]);
    eventManager.setupKeyboardShortcuts(document);

    document.body.dispatchEvent(makeKeyboardEvent('keydown'));
    document.body.dispatchEvent(makeKeyboardEvent('keydown', { code: 'NumpadDecimal' }));
    document.body.dispatchEvent(makeKeyboardEvent('keyup', { code: 'NumpadDecimal' }));

    const legacyPeriodPress = makeKeyboardEvent('keypress', { code: '' });
    document.body.dispatchEvent(legacyPeriodPress);

    expect(legacyPeriodPress.defaultPrevented).toBe(true);
    expect(eventManager.claimedShortcutFollowups.has('code:Period')).toBe(true);

    document.body.dispatchEvent(makeKeyboardEvent('keyup'));
    expect(eventManager.claimedShortcutFollowups.size).toBe(0);
  });
});
