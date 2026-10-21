/**
 * Unit tests for EventManager class
 * Tests cooldown behavior to prevent rapid changes
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo } from '../../helpers/test-utils.js';

function endMediaCooldown(eventManager, video) {
  const state = eventManager.getMediaRateState(video);

  if (state?.coolDown) {
    clearTimeout(state.coolDown);
    state.coolDown = false;
  }
}

describe('EventManager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('EventManager should initialize without retained media rate state', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    expect(eventManager.mediaRateStates.size).toBe(0);
  });

  it('handleKeydown takes the no-media fast path for a non-VSC key before building a signature (P5)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    // No controlled media on the page.
    window.VSC.stateManager.controllers.clear();

    const typingSpy = vi.spyOn(eventManager, 'isTypingContext');
    const ownedLookup = vi.spyOn(window.VSC.IOSPlayer.activePlayers, 'get');

    // KeyK is not a VSC binding — the no-media branch must short-circuit on the
    // cheap findMatchingBinding lookup, before the typing-context walk, the
    // signature assignment, and any rescan.
    const event = {
      isComposing: false,
      keyCode: 75,
      key: 'k',
      code: 'KeyK',
      timeStamp: 123,
      type: 'keydown',
    };
    const result = eventManager.handleKeydown(event);

    expect(result).toBe(false);
    // Fast path returns before the typing-context walk and signature assignment.
    expect(typingSpy).not.toHaveBeenCalled();
    expect(ownedLookup).not.toHaveBeenCalled();
    expect(eventManager.lastKeyEventSignature).toBeNull();

    typingSpy.mockRestore();
    ownedLookup.mockRestore();
  });

  describe('owned-player keyboard lock', () => {
    let manager;
    let owner;
    let target;
    let runAction;
    let siteKeydown;
    let controlledMedia;

    function press(key, code, type = 'keydown', options = {}) {
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        composed: true,
        cancelable: true,
        ...options,
      });
      target.dispatchEvent(event);
      return event;
    }

    beforeEach(() => {
      // The module loader starts an extension instance; isolate this real
      // window-capture manager from that instance's keyboard listeners.
      window.VSC_controller.teardown();
      target = document.createElement('button');
      document.body.append(target);
      target.focus();
      controlledMedia = vi
        .spyOn(window.VSC.stateManager, 'getControlledElements')
        .mockReturnValue([createMockVideo()]);
      owner = { active: true, controlsLocked: true };
      window.VSC.IOSPlayer.activePlayers.set(document, owner);
      runAction = vi.fn();
      manager = new window.VSC.EventManager(
        {
          settings: {
            exclusiveKeys: false,
            keyBindings: [
              { code: 'KeyD', action: 'advance', value: 10 },
              { code: 'KeyS', action: 'slower', value: 0.1 },
              { code: 'Escape', action: 'reset', value: 1 },
            ],
          },
        },
        { runAction }
      );
      manager.setupKeyboardShortcuts(document);
      siteKeydown = vi.fn();
      window.addEventListener('keydown', siteKeydown, true);
    });

    afterEach(() => {
      manager.cleanup();
      window.removeEventListener('keydown', siteKeydown, true);
      window.VSC.IOSPlayer.activePlayers.delete(document);
      target.remove();
      controlledMedia.mockRestore();
      vi.restoreAllMocks();
    });

    it('keeps unlocked playback shortcuts and the nonexclusive site preference working', () => {
      owner.controlsLocked = false;
      const event = press('d', 'KeyD');
      expect(runAction).toHaveBeenCalledExactlyOnceWith('advance', 10, event);
      expect(event.defaultPrevented).toBe(false);
      expect(siteKeydown).toHaveBeenCalledOnce();
    });

    it.each([
      ['d', 'KeyD'],
      ['s', 'KeyS'],
      ['k', 'KeyK'],
      ['ArrowLeft', 'ArrowLeft'],
      ['ArrowRight', 'ArrowRight'],
      ['ArrowUp', 'ArrowUp'],
      ['ArrowDown', 'ArrowDown'],
      ['<', 'Comma', { shiftKey: true }],
      ['>', 'Period', { shiftKey: true }],
    ])(
      'claims locked %s playback keys without an extension or site action',
      (key, code, options) => {
        const event = press(key, code, 'keydown', options);
        expect(runAction).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
        expect(siteKeydown).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['Enter', 'Enter'],
      [' ', 'Space'],
    ])('keeps custom-bound %s blocked away from this owned Unlock target', (key, code) => {
      manager.config.settings.keyBindings.push({ code, action: 'reset', value: 1 });
      const otherUnlock = document.createElement('button');
      owner.ui = { refs: { unlock: otherUnlock } };
      const event = press(key, code);
      expect(event.defaultPrevented).toBe(true);
      expect(siteKeydown).not.toHaveBeenCalled();
      expect(runAction).not.toHaveBeenCalled();
    });

    it('lets a custom-bound Escape reach the owned unlock handler', () => {
      const unlock = vi.fn(() => {
        owner.controlsLocked = false;
      });
      target.addEventListener('keydown', unlock);
      const event = press('Escape', 'Escape');
      expect(unlock).toHaveBeenCalledOnce();
      expect(owner.controlsLocked).toBe(false);
      expect(runAction).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('keeps Tab navigation usable even when custom-bound away from Unlock', () => {
      manager.config.settings.keyBindings.push({ code: 'Tab', action: 'reset', value: 1 });
      const event = press('Tab', 'Tab');
      expect(event.defaultPrevented).toBe(false);
      expect(siteKeydown).toHaveBeenCalledOnce();
      expect(runAction).not.toHaveBeenCalled();
    });

    it.each([
      ['Enter', 'Enter'],
      [' ', 'Space'],
    ])(
      'keeps focused owned Unlock activation for custom %s usable through shadow retargeting',
      (key, code) => {
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.append(target);
        document.body.append(host);
        owner.ui = { host, refs: { unlock: target } };
        manager.config.settings.keyBindings.push({ code, action: 'reset', value: 1 });
        target.focus();
        const activation = vi.fn(() => {
          owner.controlsLocked = false;
        });
        target.addEventListener('click', activation);
        try {
          const event = press(key, code);
          expect(event.defaultPrevented).toBe(false);
          expect(siteKeydown).toHaveBeenCalledOnce();
          expect(siteKeydown.mock.calls[0][0].target).toBe(host);
          expect(runAction).not.toHaveBeenCalled();
          target.click();
          expect(activation).toHaveBeenCalledOnce();
          expect(owner.controlsLocked).toBe(false);
        } finally {
          host.remove();
        }
      }
    );

    it.each(['ctrlKey', 'metaKey', 'altKey'])(
      'preserves browser %s shortcuts even if custom-bound',
      (modifier) => {
        manager.config.settings.exclusiveKeys = true;
        manager.config.settings.keyBindings.unshift({
          code: 'KeyD',
          action: 'advance',
          value: 10,
          modifiers: {
            ctrl: modifier === 'ctrlKey',
            meta: modifier === 'metaKey',
            alt: modifier === 'altKey',
            shift: false,
          },
        });
        const event = press('d', 'KeyD', 'keydown', { [modifier]: true });
        expect(event.defaultPrevented).toBe(false);
        expect(siteKeydown).toHaveBeenCalledOnce();
        expect(runAction).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['d', 'KeyD'],
      ['k', 'KeyK'],
    ])('does not let an inert owned input bypass the lock for %s', (key, code) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      target.remove();
      target = document.createElement('input');
      shadow.append(target);
      document.body.append(host);
      owner.ui = { host, refs: { unlock: document.createElement('button') } };
      target.focus();
      const typing = vi.spyOn(manager, 'isTypingContext');
      try {
        const event = press(key, code);
        expect(typing).toHaveReturnedWith(true);
        expect(event.defaultPrevented).toBe(true);
        expect(siteKeydown).not.toHaveBeenCalled();
        expect(runAction).not.toHaveBeenCalled();
      } finally {
        host.remove();
      }
    });

    it('preserves text entry outside the owned dialog', () => {
      target.remove();
      target = document.createElement('input');
      document.body.append(target);
      owner.ui = { host: document.createElement('div') };
      target.focus();
      const event = press('k', 'KeyK');
      expect(event.defaultPrevented).toBe(false);
      expect(siteKeydown).toHaveBeenCalledOnce();
      expect(runAction).not.toHaveBeenCalled();
    });

    it.each([
      ['d', 'KeyD'],
      ['k', 'KeyK'],
      ['ArrowLeft', 'ArrowLeft'],
    ])('still yields locked %s to Focus Peek before claiming it', (key, code) => {
      const preview = document.createElement('focus-peek-overlay');
      const claim = vi.fn((event) => event.preventDefault());
      preview.addEventListener('focuspeek:claim-zoom-shortcut', claim);
      document.body.append(preview);
      try {
        const event = press(key, code);
        expect(claim).toHaveBeenCalledOnce();
        expect(claim.mock.calls[0][0].detail).toBe(key.toLowerCase());
        expect(event.defaultPrevented).toBe(false);
        expect(siteKeydown).toHaveBeenCalledOnce();
        expect(runAction).not.toHaveBeenCalled();
      } finally {
        preview.remove();
      }
    });

    it.each([
      ['d', 'KeyD'],
      ['k', 'KeyK'],
      ['ArrowRight', 'ArrowRight'],
      ['<', 'Comma', { shiftKey: true }],
    ])('suppresses X followups for locked %s without executing it', (key, code, options) => {
      manager.cleanup();
      vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
      manager.setupKeyboardShortcuts(document);
      // Register the page after the extension, as on the live capture chain.
      window.removeEventListener('keydown', siteKeydown, true);
      window.addEventListener('keydown', siteKeydown, true);
      const siteFollowup = vi.fn();
      window.addEventListener('keypress', siteFollowup, true);
      window.addEventListener('keyup', siteFollowup, true);
      try {
        expect(press(key, code, 'keydown', options).defaultPrevented).toBe(true);
        expect(press(key, code, 'keypress', options).defaultPrevented).toBe(true);
        expect(press(key, code, 'keyup', options).defaultPrevented).toBe(true);
        expect(siteKeydown).not.toHaveBeenCalled();
        expect(siteFollowup).not.toHaveBeenCalled();
        expect(runAction).not.toHaveBeenCalled();
        expect(manager.claimedShortcutFollowups.size).toBe(0);
        expect(press('Enter', 'Enter', 'keyup').defaultPrevented).toBe(false);
        expect(siteFollowup).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener('keypress', siteFollowup, true);
        window.removeEventListener('keyup', siteFollowup, true);
      }
    });
  });

  it('refreshCoolDown should activate cooldown period', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const video = createMockVideo();
    expect(eventManager.getMediaRateState(video)).toBeNull();

    eventManager.refreshCoolDown(video);

    expect(eventManager.getMediaRateState(video).coolDown).not.toBe(false);
  });

  it('handleRateChange should block events during cooldown', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: { origin: 'external' },
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.refreshCoolDown(mockVideo);

    eventManager.handleRateChange(mockEvent);
    expect(eventStopped).toBe(true);
  });

  it('does not block ratechange from uncontrolled media during cooldown', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const uncontrolledVideo = createMockVideo({ playbackRate: 1.5 });
    const stopImmediatePropagation = vi.fn();

    eventManager.refreshCoolDown(createMockVideo());
    eventManager.handleRateChange({
      composedPath: () => [uncontrolledVideo],
      target: uncontrolledVideo,
      stopImmediatePropagation,
    });

    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('cooldown should expire after timeout', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const video = createMockVideo();
    eventManager.refreshCoolDown(video);
    expect(eventManager.getMediaRateState(video).coolDown).not.toBe(false);

    const waitMs = (window.VSC.EventManager?.BASE_COOLDOWN_MS || 50) + 50;
    await vi.advanceTimersByTimeAsync(waitMs);

    expect(eventManager.getMediaRateState(video).coolDown).toBe(false);
  });

  it('multiple refreshCoolDown calls should reset timer', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const video = createMockVideo();
    eventManager.refreshCoolDown(video);
    const firstTimeout = eventManager.getMediaRateState(video).coolDown;
    expect(firstTimeout).not.toBe(false);

    await vi.advanceTimersByTimeAsync(100);

    eventManager.refreshCoolDown(video);
    const secondTimeout = eventManager.getMediaRateState(video).coolDown;

    expect(secondTimeout).not.toBe(firstTimeout);
    expect(secondTimeout).not.toBe(false);
  });

  it('cleanup should clear cooldown', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const video = createMockVideo();
    eventManager.refreshCoolDown(video);
    const state = eventManager.getMediaRateState(video);
    expect(state.coolDown).not.toBe(false);

    eventManager.cleanup();
    expect(state.coolDown).toBe(false);
    expect(eventManager.getMediaRateState(video)).toBeNull();
  });

  // Cooldown timing race tests

  it('cooldown should be active BEFORE playbackRate assignment in setSpeed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };

    let cooldownActiveDuringAssignment = false;

    let currentRate = 1.0;
    Object.defineProperty(mockVideo, 'playbackRate', {
      get() {
        return currentRate;
      },
      set(v) {
        cooldownActiveDuringAssignment = Boolean(
          eventManager.getMediaRateState(mockVideo)?.coolDown
        );
        currentRate = v;
      },
      configurable: true,
    });

    actionHandler.setSpeed(mockVideo, 2.0, 'internal');

    expect(cooldownActiveDuringAssignment).toBe(true);
  });

  it('setSpeed should not cause handleRateChange to process event as external', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };

    let externalAdjustCalled = false;
    const originalAdjust = actionHandler.adjustSpeed.bind(actionHandler);
    actionHandler.adjustSpeed = function (video, value, options = {}) {
      if (options.source === 'external') {
        externalAdjustCalled = true;
      }
      return originalAdjust(video, value, options);
    };

    actionHandler.setSpeed(mockVideo, 2.0, 'internal');

    expect(externalAdjustCalled).toBe(false);
  });

  // Fight back / extension event tests

  it('should restore authoritative speed on external ratechange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(1.5);
    expect(eventStopped).toBe(true);
  });

  it('extension-originated events should be ignored before fight detection', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: { origin: 'videoSpeed', speed: '2.00', source: 'internal' },
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(2.0);
    expect(eventStopped).toBe(false);
  });

  // Fight detection tests

  it('should re-apply speed when site resets it (fight back)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(2.0);
    expect(eventStopped).toBe(true);
  });

  it('should surrender after MAX_FIGHT_COUNT rapid resets', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const externalAdjustSpy = vi.fn();
    const actionHandler = new window.VSC.ActionHandler(config, null);
    actionHandler.adjustSpeed = function (_video, _value, options = {}) {
      if (options.source === 'external') {
        externalAdjustSpy();
      }
    };

    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    const maxFights = window.VSC.EventManager.MAX_FIGHT_COUNT;

    for (let i = 0; i < maxFights - 1; i++) {
      endMediaCooldown(eventManager, mockVideo);
      mockVideo.playbackRate = 1.0;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        stopImmediatePropagation: () => {},
      });
    }

    endMediaCooldown(eventManager, mockVideo);
    mockVideo.playbackRate = 1.0;
    externalAdjustSpy.mockClear();
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {},
    });

    expect(externalAdjustSpy).toHaveBeenCalled();
  });

  it('fight count should reset after quiet period', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    for (let i = 0; i < 2; i++) {
      endMediaCooldown(eventManager, mockVideo);
      mockVideo.playbackRate = 1.0;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        stopImmediatePropagation: () => {},
      });
    }

    expect(eventManager.getMediaRateState(mockVideo).fightCount).toBe(2);

    const fightWindowMs = window.VSC.EventManager.FIGHT_WINDOW_MS;
    await vi.advanceTimersByTimeAsync(fightWindowMs + 50);

    expect(eventManager.getMediaRateState(mockVideo)?.fightCount || 0).toBe(0);
  });

  it('does not let one media cooldown swallow another media ratechange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const videoA = createMockVideo({ playbackRate: 1.0 });
    const videoB = createMockVideo({ playbackRate: 1.0 });
    videoA.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };
    videoB.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(videoB, 'readyState', { value: 4, configurable: true });

    actionHandler.setSpeed(videoA, 2.0, 'internal');
    const stopImmediatePropagation = vi.fn();
    eventManager.handleRateChange({
      target: videoB,
      detail: null,
      stopImmediatePropagation,
    });

    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(videoB.playbackRate).toBe(2.0);
    expect(eventManager.getMediaRateState(videoA).fightCount).toBe(0);
    expect(eventManager.getMediaRateState(videoB).fightCount).toBe(1);
  });

  it('does not count one media fights against another media', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const videoA = createMockVideo({ playbackRate: 1.0 });
    const videoB = createMockVideo({ playbackRate: 1.0 });

    for (const video of [videoA, videoB]) {
      video.vsc = { speedIndicator: { textContent: '1.00' } };
      Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    }

    for (let attempt = 0; attempt < window.VSC.EventManager.MAX_FIGHT_COUNT - 1; attempt++) {
      endMediaCooldown(eventManager, videoA);
      videoA.playbackRate = 1.0;
      eventManager.handleRateChange({
        target: videoA,
        detail: null,
        stopImmediatePropagation: vi.fn(),
      });
    }

    eventManager.handleRateChange({
      target: videoB,
      detail: null,
      stopImmediatePropagation: vi.fn(),
    });

    expect(eventManager.getMediaRateState(videoA).fightCount).toBe(
      window.VSC.EventManager.MAX_FIGHT_COUNT - 1
    );
    expect(eventManager.getMediaRateState(videoB).fightCount).toBe(1);
    expect(videoB.playbackRate).toBe(2.0);
  });

  it('arms fight-back cooldown before a synchronous native ratechange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const video = createMockVideo({ playbackRate: 1.0 });
    video.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

    let currentRate = 1.0;
    let assignments = 0;
    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get: () => currentRate,
      set: (value) => {
        currentRate = value;
        assignments++;
        eventManager.handleRateChange({
          target: video,
          detail: null,
          stopImmediatePropagation: vi.fn(),
        });
      },
    });

    eventManager.handleRateChange({
      target: video,
      detail: null,
      stopImmediatePropagation: vi.fn(),
    });

    expect(assignments).toBe(1);
    expect(currentRate).toBe(2.0);
    expect(eventManager.getMediaRateState(video).fightCount).toBe(1);
    expect(eventManager.getMediaRateState(video).coolDown).not.toBe(false);
  });

  it.each([false, true])(
    'retains a clamped fight-back without recursive writes (cooldown %s)',
    async (cooldown) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.lastSpeed = 8;
      const manager = new window.VSC.EventManager(config, null);
      const video = createMockVideo({ playbackRate: 1 });
      video.vsc = {};
      Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
      const notify = () =>
        manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
      const setter = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation((media) => {
          media.playbackRate = 2;
          notify();
        });
      if (cooldown) {
        manager.refreshCoolDown(video);
      }
      try {
        notify();
        notify();
        expect(setter).toHaveBeenCalledTimes(1);
        expect(manager.getMediaRateState(video).acceptedSpeed).toBe(2);
        expect(config.settings.lastSpeed).toBe(8);
      } finally {
        manager.cleanup();
        setter.mockRestore();
      }
    }
  );

  it('caps a legacy restoration at 16 and caches the native accepted lifecycle rate', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    config.settings.lastSpeed = 64;
    const manager = new window.VSC.EventManager(config, null);
    const video = createMockVideo({ playbackRate: 1, readyState: 4 });
    video.vsc = {};
    const setter = vi
      .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
      .mockImplementation((media, speed) => {
        media.playbackRate = speed;
        manager.handleRateChange({ target: media, stopImmediatePropagation: vi.fn() });
      });
    try {
      manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
      manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
      expect(setter).toHaveBeenCalledExactlyOnceWith(video, 16);
      expect(video.playbackRate).toBe(16);
      expect(manager.getMediaRateState(video).acceptedSpeed).toBe(16);
      expect(manager.getMediaRateState(video).lifecycleSpeed).toBe(16);
    } finally {
      manager.cleanup();
      setter.mockRestore();
    }
  });

  it('releaseMediaState clears timers and forgets only that media element', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const videoA = createMockVideo();
    const videoB = createMockVideo();
    eventManager.refreshCoolDown(videoA);
    eventManager.refreshCoolDown(videoB);
    const stateA = eventManager.getMediaRateState(videoA);
    stateA.fightCount = 2;
    stateA.fightTimer = setTimeout(() => {}, window.VSC.EventManager.FIGHT_WINDOW_MS);

    eventManager.releaseMediaState(videoA);

    expect(stateA.coolDown).toBe(false);
    expect(stateA.fightCount).toBe(0);
    expect(stateA.fightTimer).toBeNull();
    expect(eventManager.getMediaRateState(videoA)).toBeNull();
    expect(eventManager.getMediaRateState(videoB).coolDown).not.toBe(false);
  });

  // User gesture window tests

  it.each(['click', 'keydown'])(
    'does not accept a page speed reset after a synthetic %s',
    async (type) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.lastSpeed = 1.5;
      const actionHandler = new window.VSC.ActionHandler(config, null);
      const eventManager = new window.VSC.EventManager(config, actionHandler);
      const video = createMockVideo({ playbackRate: 1 });
      video.vsc = { speedIndicator: { textContent: '1.50' } };
      const mediaSpy = vi
        .spyOn(window.VSC.stateManager, 'getControlledElements')
        .mockReturnValue([video]);
      eventManager.setupEventListeners(document);

      try {
        const gesture =
          type === 'click'
            ? new MouseEvent(type, { bubbles: true })
            : new KeyboardEvent(type, { key: 'k', code: 'KeyK', bubbles: true });
        Object.defineProperty(gesture, 'timeStamp', { value: 1000 });
        document.dispatchEvent(gesture);
        eventManager.handleRateChange({
          target: video,
          timeStamp: 1050,
          stopImmediatePropagation: vi.fn(),
        });

        expect(eventManager.lastUserInteractionAt).toBe(0);
        expect(video.playbackRate).toBe(1.5);
        expect(config.settings.lastSpeed).toBe(1.5);
        expect(eventManager.getMediaRateState(video).fightCount).toBe(1);
      } finally {
        eventManager.cleanup();
        mediaSpy.mockRestore();
      }
    }
  );

  it.each(['click', 'keydown'])('records a trusted %s as user intent', async (type) => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const mediaSpy = vi
      .spyOn(window.VSC.stateManager, 'getControlledElements')
      .mockReturnValue([createMockVideo()]);
    const listenerSpy = vi.spyOn(document, 'addEventListener');

    try {
      eventManager.setupUserGestureListener(document);
      // jsdom cannot generate trusted input. Invoke the browser callback with
      // its trusted event shape; synthetic dispatch is covered above.
      const gesture = {
        isTrusted: true,
        type,
        key: 'k',
        code: 'KeyK',
        timeStamp: 1000,
        target: document.body,
      };
      if (type === 'click') {
        listenerSpy.mock.calls.find(([eventType]) => eventType === 'click')[1](gesture);
      } else {
        eventManager.handleKeydown(gesture);
      }
      expect(eventManager.lastUserInteractionAt).toBe(1000);
    } finally {
      eventManager.cleanup();
      listenerSpy.mockRestore();
      mediaSpy.mockRestore();
    }
  });

  it('should accept external speed change when user interaction preceded it', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;
    config.settings.rememberSpeed = true;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    // Gesture at t=1000ms, ratechange at t=1050ms → delta=50ms < USER_GESTURE_WINDOW_MS(300ms)
    eventManager.lastUserInteractionAt = 1000;

    let eventStopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 1050,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    });

    // Should accept: speed stays at 2.0, lastSpeed updated, fightCount reset
    expect(mockVideo.playbackRate).toBe(2.0);
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(eventManager.getMediaRateState(mockVideo)?.fightCount || 0).toBe(0);
    expect(eventManager.lastUserInteractionAt).toBe(0); // consumed
    expect(eventStopped).toBe(false);
  });

  it.each([0, 250, 1000])(
    'should fight back without a user gesture at page timestamp %sms',
    async (timeStamp) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.lastSpeed = 1.5;

      const actionHandler = new window.VSC.ActionHandler(config, null);
      const eventManager = new window.VSC.EventManager(config, actionHandler);

      const mockVideo = createMockVideo({ playbackRate: 1.0 });
      mockVideo.vsc = { speedIndicator: { textContent: '1.50' } };
      Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

      // A fresh page has no recorded gesture, even inside the first 300ms.
      eventManager.lastUserInteractionAt = 0;
      let eventStopped = false;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        timeStamp,
        stopImmediatePropagation: () => {
          eventStopped = true;
        },
      });

      // Should fight: speed restored to 1.5
      expect(mockVideo.playbackRate).toBe(1.5);
      expect(eventManager.getMediaRateState(mockVideo).fightCount).toBe(1);
      expect(eventStopped).toBe(true);
    }
  );

  it('should fight back when user gesture is outside the window', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    // Gesture at t=100ms, ratechange at t=700ms → delta=600ms > USER_GESTURE_WINDOW_MS(300ms)
    eventManager.lastUserInteractionAt = 100;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 700,
      stopImmediatePropagation: () => {},
    });

    expect(mockVideo.playbackRate).toBe(1.5); // fought back
    expect(eventManager.getMediaRateState(mockVideo).fightCount).toBe(1);
  });

  it('cleanup should clear fight detection state', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const video = createMockVideo();
    eventManager.refreshCoolDown(video);
    const state = eventManager.getMediaRateState(video);
    state.fightCount = 5;
    state.fightTimer = setTimeout(() => {}, 10000);

    eventManager.cleanup();

    expect(state.fightCount).toBe(0);
    expect(state.fightTimer).toBe(null);
    expect(eventManager.getMediaRateState(video)).toBeNull();
  });
});
