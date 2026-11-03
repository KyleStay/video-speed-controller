/**
 * Unit tests for ActionHandler class
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import jsdomIDL from 'jsdom/lib/generated/idl/utils.js';

// Load all required modules

let mockDOM;

describe('ActionHandler', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    // Clear state manager for tests
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // Initialize site handler manager for tests
    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  /**
   * Helper function to create a test video with a controller
   * This replaces the old pattern of config.addMediaElement()
   */
  function createTestVideoWithController(config, actionHandler, videoOptions = {}) {
    const mockVideo = createMockVideo(videoOptions);

    // Ensure the video has a proper parent element for DOM operations
    if (!mockVideo.parentElement) {
      const parentDiv = document.createElement('div');
      document.body.appendChild(parentDiv);
      parentDiv.appendChild(mockVideo);
    }

    // Store initial playback rate to preserve test expectations
    const initialPlaybackRate = mockVideo.playbackRate;

    // Create a proper VideoController for this video
    new window.VSC.VideoController(mockVideo, mockVideo.parentElement, config, actionHandler);

    // Restore initial playback rate for test consistency
    mockVideo.playbackRate = initialPlaybackRate;

    return mockVideo;
  }

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  it('ActionHandler should set video speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable persistence for this test

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler);

    actionHandler.adjustSpeed(mockVideo, 2.0);

    expect(mockVideo.playbackRate).toBe(2.0);
    expect(mockVideo.vsc.speedIndicator.textContent).toBe('2.00');
    expect(mockVideo.vsc.speedIndicator.getAttribute('aria-label')).toBe(
      'Playback speed 2.00. Press Enter to reset speed.'
    );
    expect(config.settings.lastSpeed).toBe(2.0);
  });

  it('establishes the accepted rate before synchronously resuming a rendition change', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const manager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, manager);
    const video = createTestVideoWithController(config, actionHandler);
    const order = [];
    const transition = {
      finish: vi.fn(() => {
        expect(video.playbackRate).toBe(3);
        expect(manager.getMediaRateState(video).acceptedSpeed).toBe(3);
        order.push('resume');
      }),
      abort: vi.fn(),
    };
    const begin = vi.spyOn(window.VSC.SafariHLSPlayback, 'begin').mockImplementation(() => {
      expect(manager.getMediaRateState(video).applyingSpeed).toBe(true);
      order.push('switch');
      return transition;
    });
    try {
      expect(actionHandler.setSpeed(video, 3, 'internal')).toBe(true);
      order.push('returned');
      expect(order).toEqual(['switch', 'resume', 'returned']);
      expect(transition.abort).not.toHaveBeenCalled();
    } finally {
      begin.mockRestore();
      video.vsc.remove();
      manager.cleanup();
    }
  });

  describe('owned-player hardware shortcut targeting', () => {
    let eventManager;
    let actionHandler;
    let owned;
    let other;

    const keys = [
      ['D', 'KeyD', 'd', 68, 'playbackRate', 1.1],
      ['S', 'KeyS', 's', 83, 'playbackRate', 0.9],
      ['Z', 'KeyZ', 'z', 90, 'currentTime', 40],
      ['X', 'KeyX', 'x', 88, 'currentTime', 60],
    ];

    function pressKey(target, code, key, keyCode) {
      const event = new window.KeyboardEvent('keydown', {
        code,
        key,
        keyCode,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    }

    beforeEach(async () => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.rememberSpeed = false;
      config.settings.exclusiveKeys = true;
      actionHandler = new window.VSC.ActionHandler(config, null);
      eventManager = new window.VSC.EventManager(config, actionHandler);
      actionHandler.eventManager = eventManager;
      owned = createTestVideoWithController(config, actionHandler, {
        playbackRate: 1,
        currentTime: 50,
      });
      other = createTestVideoWithController(config, actionHandler, {
        playbackRate: 1.8,
        currentTime: 70,
      });
      window.VSC.IOSPlayer.activePlayers.set(document, { video: owned });
      eventManager.setupKeyboardShortcuts(document);
    });

    afterEach(() => {
      window.VSC.IOSPlayer.activePlayers.delete(document);
      eventManager.cleanup();
      owned.vsc?.remove();
      other.vsc?.remove();
    });

    it.each(keys)(
      '%s changes only the active owned video',
      (_label, code, key, keyCode, property, expected) => {
        const event = pressKey(document.body, code, key, keyCode);

        expect(event.defaultPrevented).toBe(true);
        expect(owned[property]).toBe(expected);
        expect(other.playbackRate).toBe(1.8);
        expect(other.currentTime).toBe(70);
      }
    );

    it.each(keys)(
      '%s cannot act on a revoked owned presentation or fall through after it closes',
      (_label, code, key, keyCode) => {
        const execute = vi.spyOn(actionHandler, 'executeAction');
        const presentationCurrent = vi.fn(() => {
          window.VSC.IOSPlayer.activePlayers.delete(document);
          return false;
        });
        window.VSC.IOSPlayer.activePlayers.set(document, { video: owned, presentationCurrent });
        try {
          pressKey(document.body, code, key, keyCode);
          expect(presentationCurrent).toHaveBeenCalledOnce();
          expect(execute).not.toHaveBeenCalled();
          expect(owned.playbackRate).toBe(1);
          expect(owned.currentTime).toBe(50);
          expect(other.playbackRate).toBe(1.8);
          expect(other.currentTime).toBe(70);
        } finally {
          execute.mockRestore();
        }
      }
    );

    it('keeps ordinary owned routing when its current presentation is verified', () => {
      const owner = {
        video: owned,
        presentationCurrent: vi.fn(function () {
          expect(this).toBe(owner);
          return true;
        }),
      };
      window.VSC.IOSPlayer.activePlayers.set(document, owner);
      pressKey(document.body, 'KeyD', 'd', 68);
      expect(owner.presentationCurrent).toHaveBeenCalledOnce();
      expect(owned.playbackRate).toBe(1.1);
      expect(other.playbackRate).toBe(1.8);
    });

    it('does not act when presentation validation throws', () => {
      const execute = vi.spyOn(actionHandler, 'executeAction');
      window.VSC.IOSPlayer.activePlayers.set(document, {
        video: owned,
        presentationCurrent() {
          throw new Error('Revoked source');
        },
      });
      try {
        pressKey(document.body, 'KeyD', 'd', 68);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        execute.mockRestore();
      }
    });

    it.each(['input', 'select'])('preserves typing in an owned-player shadow %s', (tagName) => {
      const host = document.createElement('vsc-ios-player');
      const shadow = host.attachShadow({ mode: 'open' });
      const field = document.createElement(tagName);
      shadow.append(field);
      document.body.append(host);
      field.focus();
      const execute = vi.spyOn(actionHandler, 'executeAction');

      for (const [_label, code, key, keyCode] of keys) {
        expect(pressKey(field, code, key, keyCode).defaultPrevented).toBe(false);
      }

      expect(execute).not.toHaveBeenCalled();
      expect(owned.playbackRate).toBe(1);
      expect(owned.currentTime).toBe(50);
      expect(other.playbackRate).toBe(1.8);
      expect(other.currentTime).toBe(70);
      execute.mockRestore();
      host.remove();
    });

    it('keeps eventless popup commands global while an owned player is active', () => {
      actionHandler.runAction('ADJUST_SPEED', 0.1);

      expect(owned.playbackRate).toBe(1.1);
      expect(other.playbackRate).toBe(1.9);
    });

    it('keeps controller clicks scoped to their own media', () => {
      const button = document.createElement('button');
      other.vsc.div.shadowRoot.append(button);
      actionHandler.runAction('faster', 0.1, { type: 'click', target: button });

      expect(owned.playbackRate).toBe(1);
      expect(other.playbackRate).toBe(1.9);
    });

    it('restores ordinary keyboard targeting when the owned player closes', () => {
      window.VSC.IOSPlayer.activePlayers.delete(document);
      pressKey(document.body, 'KeyD', 'd', 68);

      expect(owned.playbackRate).toBe(1.1);
      expect(other.playbackRate).toBe(1.9);
    });
  });

  it('ActionHandler should handle faster action', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    actionHandler.runAction('faster', 0.1);

    expect(mockVideo.playbackRate).toBe(1.1);
  });

  it('keeps touch preset states and the accessible pill label current after speed changes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createTestVideoWithController(config, actionHandler);
    const controller = video.vsc;
    const shadow = controller.div.shadowRoot;
    controller.controlsManager.setTouchMode(shadow, true);

    actionHandler.adjustSpeed(video, 2);
    actionHandler.adjustSpeed(video, 1.5);

    expect(shadow.querySelector('[data-value="1.5"]').getAttribute('aria-pressed')).toBe('true');
    expect(shadow.querySelector('[data-value="2"]').getAttribute('aria-pressed')).toBe('false');
    expect(controller.speedIndicator.getAttribute('aria-label')).toBe(
      'Playback speed 1.50 times. Tap to show speed controls.'
    );

    actionHandler.adjustSpeed(video, 1.6);
    expect(shadow.querySelectorAll('.touch-preset[aria-pressed="true"]')).toHaveLength(0);
    controller.remove();
    eventManager.cleanup();
  });

  it('ActionHandler should handle slower action', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    actionHandler.runAction('slower', 0.1);
    expect(mockVideo.playbackRate).toBe(0.9);
  });

  it('ActionHandler should respect speed limits', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 16.0 });

    // Should not exceed maximum speed
    actionHandler.runAction('faster', 1.0);
    expect(mockVideo.playbackRate).toBe(16.0);

    // Test minimum speed
    mockVideo.playbackRate = 0.07;
    actionHandler.runAction('slower', 0.1);
    expect(mockVideo.playbackRate).toBe(0.07);
  });

  it('ActionHandler should handle pause action', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { paused: false });

    actionHandler.runAction('pause');
    expect(mockVideo.paused).toBe(true);
  });

  it('ActionHandler should handle mute action', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { muted: false });
    actionHandler.runAction('muted');

    expect(mockVideo.muted).toBe(true);
  });

  it('ActionHandler should handle volume actions', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { volume: 0.5 });
    actionHandler.runAction('louder', 0.1);
    expect(mockVideo.volume).toBe(0.6);

    actionHandler.runAction('softer', 0.2);
    expect(mockVideo.volume).toBe(0.4);
  });

  it('ActionHandler should handle seek actions', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 50 });

    actionHandler.runAction('advance', 10);
    expect(mockVideo.currentTime).toBe(60);

    actionHandler.runAction('rewind', 5);
    expect(mockVideo.currentTime).toBe(55);
  });

  it('ActionHandler should handle mark and jump actions', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 30 });

    // Set mark
    actionHandler.runAction('mark');
    expect(mockVideo.vsc.mark).toBe(30);

    // Change time
    mockVideo.currentTime = 50;

    // Jump to mark
    actionHandler.runAction('jump');
    expect(mockVideo.currentTime).toBe(30);
  });

  it('ActionHandler should work with mark/jump key bindings', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    actionHandler.eventManager = eventManager;

    const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 25 });
    // Set initial mark to undefined for test
    mockVideo.vsc.mark = undefined;

    // Verify mark key binding exists (M = 77)
    const markBinding = config.settings.keyBindings.find((kb) => kb.action === 'mark');
    expect(markBinding).toBeDefined();
    expect(markBinding.key).toBe(77);

    // Verify jump key binding exists (J = 74)
    const jumpBinding = config.settings.keyBindings.find((kb) => kb.action === 'jump');
    expect(jumpBinding).toBeDefined();
    expect(jumpBinding.key).toBe(74);

    // Simulate pressing M key to set mark
    eventManager.handleKeydown({
      code: 'KeyM',
      key: 'm',
      keyCode: 77,
      target: document.body,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      timeStamp: 1000,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(mockVideo.vsc.mark).toBe(25);

    // Change video time
    mockVideo.currentTime = 60;

    // Simulate pressing J key to jump to mark
    eventManager.handleKeydown({
      code: 'KeyJ',
      key: 'j',
      keyCode: 74,
      target: document.body,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      timeStamp: 2000,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(mockVideo.currentTime).toBe(25);
  });

  it('ActionHandler should toggle display visibility', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler);
    const controller = video.vsc.div;

    // Initially controller should not be hidden
    expect(controller.classList.contains('vsc-hidden')).toBe(false);
    expect(controller.classList.contains('vsc-manual')).toBe(false);

    // First toggle - should hide
    actionHandler.runAction('display', null, null);
    expect(controller.classList.contains('vsc-hidden')).toBe(true);
    expect(controller.classList.contains('vsc-manual')).toBe(true);

    // Second toggle - should show, vsc-manual persists (user expressed intent)
    actionHandler.runAction('display', null, null);
    expect(controller.classList.contains('vsc-hidden')).toBe(false);
    expect(controller.classList.contains('vsc-manual')).toBe(true);

    // Third toggle - should hide again
    actionHandler.runAction('display', null, null);
    expect(controller.classList.contains('vsc-hidden')).toBe(true);
    expect(controller.classList.contains('vsc-manual')).toBe(true);
  });

  // --- flashController visibility rules ---

  it('flashController: startHidden=true → never flashes, even after V toggle', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.startHidden = true;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createTestVideoWithController(config, actionHandler);
    const controller = video.vsc.div;

    // Before any V toggle
    actionHandler.flashController(controller);
    expect(controller.classList.contains('vsc-show')).toBe(false);

    // After user presses V (shows controller manually)
    controller.classList.add('vsc-manual');
    controller.classList.remove('vsc-hidden');
    actionHandler.flashController(controller);
    expect(controller.classList.contains('vsc-show')).toBe(false);
  });

  it('flashController: startHidden=false → flashes on speed change', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.startHidden = false;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createTestVideoWithController(config, actionHandler);
    const controller = video.vsc.div;

    actionHandler.flashController(controller);
    expect(controller.classList.contains('vsc-show')).toBe(true);
  });

  it('flashController: startHidden=false, user hid with V → does not flash', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.startHidden = false;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createTestVideoWithController(config, actionHandler);
    const controller = video.vsc.div;

    // User pressed V to hide
    controller.classList.add('vsc-manual');
    controller.classList.add('vsc-hidden');

    actionHandler.flashController(controller);
    expect(controller.classList.contains('vsc-show')).toBe(false);
  });

  it('ActionHandler should work with videos in nested shadow DOM', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Create nested shadow DOM structure
    const host = document.createElement('div');
    const level1Shadow = host.attachShadow({ mode: 'open' });

    const nestedHost = document.createElement('div');
    level1Shadow.appendChild(nestedHost);
    const level2Shadow = nestedHost.attachShadow({ mode: 'open' });

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    level2Shadow.appendChild(mockVideo);

    document.body.appendChild(host);

    // Create a proper mock speedIndicator that behaves like a real DOM element
    const mockSpeedIndicator = {
      textContent: '1.00',
      // Add other properties that might be needed
      nodeType: 1,
      tagName: 'SPAN',
    };

    // Mock video controller structure for shadow DOM video
    mockVideo.vsc = {
      div: mockDOM.container,
      speedIndicator: mockSpeedIndicator,
      // Add remove method to prevent errors during cleanup
      remove: () => {},
    };

    // Register with state manager for runAction to find it
    window.VSC.stateManager.controllers.set('shadow-dom-test', {
      id: 'shadow-dom-test',
      element: mockVideo,
      videoSrc: mockVideo.currentSrc || 'test-video',
      tagName: 'VIDEO',
      created: Date.now(),
      isActive: true,
    });

    // Test speed change on shadow DOM video
    actionHandler.runAction('faster', 0.2);
    expect(mockVideo.playbackRate).toBe(1.2);

    // Test slower action
    actionHandler.runAction('slower', 0.1);
    expect(mockVideo.playbackRate).toBe(1.1);

    // Test direct speed setting
    actionHandler.adjustSpeed(mockVideo, 2.5);
    expect(mockVideo.playbackRate).toBe(2.5);
    expect(mockVideo.vsc.speedIndicator.textContent).toBe('2.50');
  });

  it('adjustSpeed should handle absolute speed changes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable persistence for this test

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: mockDOM.container,
      speedIndicator: { textContent: '1.00' },
    };

    // Test absolute speed change
    actionHandler.adjustSpeed(mockVideo, 1.5);
    expect(mockVideo.playbackRate).toBe(1.5);
    expect(mockVideo.vsc.speedIndicator.textContent).toBe('1.50');
    expect(config.settings.lastSpeed).toBe(1.5);

    // Test speed limits
    actionHandler.adjustSpeed(mockVideo, 20); // Above max
    expect(mockVideo.playbackRate).toBe(16); // Clamped to max

    actionHandler.adjustSpeed(mockVideo, 0.01); // Below min
    expect(mockVideo.playbackRate).toBe(0.07); // Clamped to min
  });

  it('adjustSpeed should handle relative speed changes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: mockDOM.container,
      speedIndicator: { textContent: '1.00' },
    };

    // Test relative speed increase
    actionHandler.adjustSpeed(mockVideo, 0.5, { relative: true });
    expect(mockVideo.playbackRate).toBe(1.5);

    // Test relative speed decrease
    actionHandler.adjustSpeed(mockVideo, -0.3, { relative: true });
    expect(mockVideo.playbackRate).toBe(1.2);

    // Test relative with limits
    mockVideo.playbackRate = 15.9;
    actionHandler.adjustSpeed(mockVideo, 0.5, { relative: true });
    expect(mockVideo.playbackRate).toBe(16); // Clamped to max
  });

  it('adjustSpeed should not corrupt lastSpeed on external changes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    // Set user preference via internal change
    actionHandler.adjustSpeed(mockVideo, 1.5, { source: 'internal' });
    expect(config.settings.lastSpeed).toBe(1.5);

    // External change applies to playback but must NOT update lastSpeed
    // (fight detection enforcement happens upstream in event-manager)
    actionHandler.adjustSpeed(mockVideo, 2.0, { source: 'external' });
    expect(mockVideo.playbackRate).toBe(2.0); // External change reaches video
    expect(config.settings.lastSpeed).toBe(1.5); // But lastSpeed is preserved

    // Internal change should update both
    actionHandler.adjustSpeed(mockVideo, 2.5, { source: 'internal' });
    expect(mockVideo.playbackRate).toBe(2.5);
    expect(config.settings.lastSpeed).toBe(2.5);
  });

  it('getPreferredSpeed should return global lastSpeed when rememberSpeed is on', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Test with set lastSpeed
    config.settings.lastSpeed = 1.75;
    expect(actionHandler.getPreferredSpeed()).toBe(1.75);

    // Test fallback when no lastSpeed
    config.settings.lastSpeed = null;
    expect(actionHandler.getPreferredSpeed()).toBe(1.0);

    // Different lastSpeed should be reflected
    config.settings.lastSpeed = 2.5;
    expect(actionHandler.getPreferredSpeed()).toBe(2.5);

    // When rememberSpeed is off, should return 1.0
    config.settings.rememberSpeed = false;
    expect(actionHandler.getPreferredSpeed()).toBe(1.0);
  });

  it('adjustSpeed should validate input properly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Test with null video
    actionHandler.adjustSpeed(null, 1.5);
    // Should not throw, just log warning

    // Test with video without controller
    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    delete mockVideo.vsc;
    const initialSpeed = mockVideo.playbackRate;
    actionHandler.adjustSpeed(mockVideo, 1.5);
    expect(mockVideo.playbackRate).toBe(initialSpeed); // Should not change

    // Test with invalid value types
    const validVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    // String value
    actionHandler.adjustSpeed(validVideo, '1.5');
    expect(validVideo.playbackRate).toBe(1.0); // Should not change

    // null value
    actionHandler.adjustSpeed(validVideo, null);
    expect(validVideo.playbackRate).toBe(1.0); // Should not change

    // undefined value
    actionHandler.adjustSpeed(validVideo, undefined);
    expect(validVideo.playbackRate).toBe(1.0); // Should not change

    // NaN value
    actionHandler.adjustSpeed(validVideo, NaN);
    expect(validVideo.playbackRate).toBe(1.0); // Should not change
  });

  it('setSpeed should save global speed to storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable persistence for this test

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      playbackRate: 1.0,
      currentSrc: 'https://example.com/video.mp4',
    });
    mockVideo.vsc = {
      div: mockDOM.container,
      speedIndicator: { textContent: '1.00' },
    };

    // Track what gets saved
    let savedData = null;
    config.save = (data) => {
      savedData = data;
    };

    // Test that only lastSpeed is saved
    actionHandler.setSpeed(mockVideo, 1.5, 'internal');

    expect(savedData.lastSpeed).toBe(1.5);
    expect(config.settings.lastSpeed).toBe(1.5); // Global speed updated
  });

  it('do not persist video speed to storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Create two different videos with controllers
    const video1 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video1.mp4',
    });
    const video2 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video2.mp4',
    });

    // Track saves to verify behavior
    const savedCalls = [];
    const originalSave = config.save;
    config.save = (data) => {
      savedCalls.push({ ...data });
      return originalSave.call(config, data);
    };

    // Change speeds on different videos
    await actionHandler.adjustSpeed(video1, 1.5);
    await actionHandler.adjustSpeed(video2, 2.0);

    // With rememberSpeed = false, no speeds should be persisted to storage
    expect(savedCalls.length).toBe(0);

    // Videos should still have their playback rates set
    expect(video1.playbackRate).toBe(1.5);
    expect(video2.playbackRate).toBe(2.0);
  });

  it('rememberSpeed: true should only store global speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;

    // Clear any existing speeds from previous tests

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video1 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video1.mp4',
    });
    const video2 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video2.mp4',
    });

    // Change speeds on different videos
    await actionHandler.adjustSpeed(video1, 1.5);
    await actionHandler.adjustSpeed(video2, 2.0);

    // Global lastSpeed should be updated
    expect(config.settings.lastSpeed).toBe(2.0);
  });

  it('speed limits should be enforced correctly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    // Test minimum speed limit
    await actionHandler.adjustSpeed(video, 0.01); // Below minimum
    expect(video.playbackRate).toBe(0.07); // Should clamp to minimum

    // Test maximum speed limit
    await actionHandler.adjustSpeed(video, 20.0); // Above maximum
    expect(video.playbackRate).toBe(16.0); // Should clamp to maximum

    // Test negative speed (should clamp to minimum)
    await actionHandler.adjustSpeed(video, -1.0);
    expect(video.playbackRate).toBe(0.07);
  });

  // COMPREHENSIVE PHASE 6 TESTS
  it('adjustSpeed should handle complex relative mode scenarios', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });

    // Test relative from various starting points
    actionHandler.adjustSpeed(video, 0.25, { relative: true });
    expect(video.playbackRate).toBe(2.25);

    // Test relative with float precision
    actionHandler.adjustSpeed(video, 0.33, { relative: true });
    expect(video.playbackRate).toBe(2.58); // Should be rounded to 2 decimals

    // Test relative from very low speed
    video.playbackRate = 0.05; // Below 0.1 threshold
    actionHandler.adjustSpeed(video, 0.1, { relative: true });
    expect(video.playbackRate).toBe(0.1); // Should use 0.0 as base for very low speeds

    // Test large relative changes
    video.playbackRate = 1.0;
    actionHandler.adjustSpeed(video, 5.0, { relative: true });
    expect(video.playbackRate).toBe(6.0);
  });

  it('adjustSpeed should handle multiple source types comprehensively', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.25;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    // Test default source (should be 'internal')
    actionHandler.adjustSpeed(video, 1.5);
    expect(video.playbackRate).toBe(1.5);
    expect(config.settings.lastSpeed).toBe(1.5);

    // Test explicit internal source
    actionHandler.adjustSpeed(video, 1.8, { source: 'internal' });
    expect(video.playbackRate).toBe(1.8);
    expect(config.settings.lastSpeed).toBe(1.8);

    // Test external source — applies to video but doesn't touch lastSpeed
    actionHandler.adjustSpeed(video, 2.5, { source: 'external' });
    expect(video.playbackRate).toBe(2.5);
    expect(config.settings.lastSpeed).toBe(1.8);
  });

  it('adjustSpeed should work correctly with multiple videos', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable persistence for this test

    const actionHandler = new window.VSC.ActionHandler(config, null);

    // Create multiple videos with different sources
    const video1 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://site1.com/video1.mp4',
    });
    const video2 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://site2.com/video2.mp4',
    });
    const video3 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://site1.com/video3.mp4',
    });

    // Set different speeds for each video
    actionHandler.adjustSpeed(video1, 1.5);
    actionHandler.adjustSpeed(video2, 2.0);
    actionHandler.adjustSpeed(video3, 1.25);

    // Verify each video has correct speed
    expect(video1.playbackRate).toBe(1.5);
    expect(video2.playbackRate).toBe(2.0);
    expect(video3.playbackRate).toBe(1.25);

    // Verify global speed behavior - all videos share same preferred speed
    expect(actionHandler.getPreferredSpeed(video1)).toBe(1.25);
    expect(actionHandler.getPreferredSpeed(video2)).toBe(1.25);
    expect(actionHandler.getPreferredSpeed(video3)).toBe(1.25);
  });

  it('adjustSpeed should handle global mode with multiple videos', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Global mode

    const actionHandler = new window.VSC.ActionHandler(config, null);

    const video1 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://site1.com/video1.mp4',
    });
    const video2 = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://site2.com/video2.mp4',
    });

    // Change speed on first video
    actionHandler.adjustSpeed(video1, 1.8);
    expect(config.settings.lastSpeed).toBe(1.8);

    // getPreferredSpeed should return global speed for both videos
    expect(actionHandler.getPreferredSpeed(video1)).toBe(1.8);
    expect(actionHandler.getPreferredSpeed(video2)).toBe(1.8);

    // Change speed on second video
    actionHandler.adjustSpeed(video2, 2.2);
    expect(config.settings.lastSpeed).toBe(2.2);

    // Both videos should now prefer the new global speed
    expect(actionHandler.getPreferredSpeed(video1)).toBe(2.2);
    expect(actionHandler.getPreferredSpeed(video2)).toBe(2.2);
  });

  it('adjustSpeed should handle edge cases and error conditions', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);

    // Test with video missing vsc property
    const videoNoVsc = createMockVideo({ playbackRate: 1.0 });
    actionHandler.adjustSpeed(videoNoVsc, 1.5); // Should not crash, just warn

    // Test with video missing speedIndicator
    const videoNoIndicator = createMockVideo({ playbackRate: 1.0 });
    videoNoIndicator.vsc = {}; // No speedIndicator
    // Manually register with state manager for this edge case test
    window.VSC.stateManager.controllers.set('test-no-indicator', {
      id: 'test-no-indicator',
      element: videoNoIndicator,
      videoSrc: 'test-video',
      tagName: 'VIDEO',
      created: Date.now(),
      isActive: true,
    });
    actionHandler.adjustSpeed(videoNoIndicator, 1.5); // Should work but skip UI update
    expect(videoNoIndicator.playbackRate).toBe(1.5);

    // Test with very small incremental changes
    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    actionHandler.adjustSpeed(video, 0.001, { relative: true });
    expect(video.playbackRate).toBe(1.0); // Should round to 2 decimals (1.00)

    actionHandler.adjustSpeed(video, 0.01, { relative: true });
    expect(video.playbackRate).toBe(1.01); // Should round to 1.01
  });

  it('adjustSpeed should preserve lastSpeed across external changes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const video = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video.mp4',
    });

    // External change reaches the video (force enforcement is in event-manager)
    actionHandler.adjustSpeed(video, 3.0, { source: 'external' });
    expect(video.playbackRate).toBe(3.0);
    expect(config.settings.lastSpeed).toBe(1.5);

    // Internal changes update both
    actionHandler.adjustSpeed(video, 1.8, { source: 'internal' });
    expect(video.playbackRate).toBe(1.8);
    expect(config.settings.lastSpeed).toBe(1.8);
  });

  it('reset action should use configured reset speed value', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Test with default reset speed (1.0)
    const mockVideo1 = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });
    actionHandler.runAction('reset', 1.0); // Pass the value as keyboard handler would
    expect(mockVideo1.playbackRate).toBe(1.0);

    // Test with custom reset speed
    config.setKeyBinding('reset', 1.5);
    const mockVideo2 = createTestVideoWithController(config, actionHandler, { playbackRate: 2.5 });
    actionHandler.runAction('reset', 1.5); // Pass the custom value
    expect(mockVideo2.playbackRate).toBe(1.5);

    // Test reset memory toggle functionality with custom reset speed
    const mockVideo3 = createTestVideoWithController(config, actionHandler, { playbackRate: 1.5 });

    // First reset should remember current speed and go to reset speed
    mockVideo3.playbackRate = 2.2;
    actionHandler.runAction('reset', 1.5); // Pass custom value
    expect(mockVideo3.playbackRate).toBe(1.5); // Should reset to configured value
    expect(mockVideo3.vsc.speedBeforeReset).toBe(2.2); // Should remember previous speed

    // Second reset should restore remembered speed
    actionHandler.runAction('reset', 1.5); // Pass custom value
    expect(mockVideo3.playbackRate).toBe(2.2); // Should restore remembered speed
    expect(mockVideo3.vsc.speedBeforeReset).toBe(null); // Should clear memory
  });

  // --- Cross-toggle tests (reset ↔ preferred speed) ---

  it('reset at target with no memory should cross-toggle to preferred speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = null;

    // Reset at 1.0x with no memory → should cross-toggle to preferred speed (1.8)
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(1.8);
    expect(video.vsc.speedBeforeReset).toBe(1.0);
  });

  it('preferred at target with no memory should cross-toggle to reset speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.8 });
    video.vsc.speedBeforeReset = null;

    // Preferred at 1.8x with no memory → should cross-toggle to reset speed (1.0)
    actionHandler.resetSpeed(video, 1.8, 1.0);
    expect(video.playbackRate).toBe(1.0);
    expect(video.vsc.speedBeforeReset).toBe(1.8);
  });

  it('cross-toggle should not fire when crossTarget equals target', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = null;

    // If both reset and preferred are configured to 1.0, cross-toggle should be a no-op
    actionHandler.resetSpeed(video, 1.0, 1.0);
    expect(video.playbackRate).toBe(1.0);
    expect(video.vsc.speedBeforeReset).toBe(null);
  });

  it('cross-toggle should not fire when memory exists', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = 2.5;

    // At target with memory → should restore, not cross-toggle
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(2.5);
    expect(video.vsc.speedBeforeReset).toBe(null);
  });

  it('reset key should toggle between 1.0 and preferred speed repeatedly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = null;

    // Press 1: at 1.0 with no memory → cross-toggle to 1.8
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(1.8);

    // Press 2: at 1.8, not at target (1.0) → remember 1.8, go to 1.0
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(1.0);

    // Press 3: at 1.0 with memory (1.8) → restore to 1.8
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(1.8);

    // Press 4: at 1.8, not at target (1.0) → remember 1.8, go to 1.0
    actionHandler.resetSpeed(video, 1.0, 1.8);
    expect(video.playbackRate).toBe(1.0);
  });

  it('cross-toggle works end-to-end via runAction with default bindings', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    // Ensure default bindings are in effect
    config.setKeyBinding('reset', 1.0);
    config.setKeyBinding('fast', 1.8);

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = null;

    // runAction('reset', 1.0) should cross-toggle to preferred (1.8) via config lookup
    actionHandler.runAction('reset', 1.0);
    expect(video.playbackRate).toBe(1.8);

    // Reset back
    actionHandler.runAction('reset', 1.0);
    expect(video.playbackRate).toBe(1.0);
  });

  it('cross-toggle works end-to-end via runAction for fast action', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Ensure default bindings are in effect
    config.setKeyBinding('reset', 1.0);
    config.setKeyBinding('fast', 1.8);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.8 });
    video.vsc.speedBeforeReset = null;

    // runAction('fast', 1.8) should cross-toggle to reset (1.0)
    actionHandler.runAction('fast', 1.8);
    expect(video.playbackRate).toBe(1.0);

    // Fast back
    actionHandler.runAction('fast', 1.8);
    expect(video.playbackRate).toBe(1.8);
  });

  it('cross-toggle with custom reset and preferred speeds', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    // Set custom speeds
    config.setKeyBinding('reset', 1.5);
    config.setKeyBinding('fast', 2.0);

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.5 });
    video.vsc.speedBeforeReset = null;

    // Reset at custom 1.5 with no memory → cross-toggle to custom preferred 2.0
    actionHandler.runAction('reset', 1.5);
    expect(video.playbackRate).toBe(2.0);

    // Toggle back
    actionHandler.runAction('reset', 1.5);
    expect(video.playbackRate).toBe(1.5);
  });

  it('resetSpeed without crossTarget preserves backward compatibility', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });
    video.vsc.speedBeforeReset = null;

    // Called without crossTarget (e.g. from double-click reset) → should be a no-op at target
    actionHandler.resetSpeed(video, 1.0);
    expect(video.playbackRate).toBe(1.0);
    expect(video.vsc.speedBeforeReset).toBe(null);
  });

  it('lastSpeed should update during session even when rememberSpeed is false', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false; // Disable cross-session persistence
    config.settings.lastSpeed = 1.0; // Start with default speed

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Track storage saves
    const savedCalls = [];
    const originalSave = config.save;
    config.save = function (data) {
      savedCalls.push({ ...data });
      return originalSave.call(config, data);
    };

    const video = createTestVideoWithController(config, actionHandler, {
      currentSrc: 'https://example.com/video.mp4',
    });

    // Change speed to 1.4
    await actionHandler.adjustSpeed(video, 1.4);

    // lastSpeed should be updated in memory for session persistence
    expect(config.settings.lastSpeed).toBe(1.4);

    // No storage saves should occur
    expect(savedCalls.length).toBe(0);

    // Simulate play event (which calls getTargetSpeed)
    const targetSpeed = video.vsc.getTargetSpeed(video);
    expect(targetSpeed).toBe(1.4);

    // Restore original save method
    config.save = originalSave;
  });

  // --- Frame-step (rewindFrame / advanceFrame) ---

  it('stepFrame: paused video advances currentTime by 1/fps using fallback fps', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, {
      paused: true,
      currentTime: 50,
      duration: 100,
    });
    // No requestVideoFrameCallback on the mock → detectedFps stays null.
    expect(video.vsc.detectedFps).toBe(null);

    actionHandler.runAction('advanceFrame', 30);
    expect(video.currentTime).toBeCloseTo(50 + 1 / 30, 5);

    actionHandler.runAction('rewindFrame', 30);
    expect(video.currentTime).toBeCloseTo(50, 5);
  });

  it('stepFrame: uses detectedFps over the fallback when available', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, {
      paused: true,
      currentTime: 20,
      duration: 100,
    });
    video.vsc.detectedFps = 60; // e.g. measured 60fps clip

    actionHandler.runAction('advanceFrame', 30); // fallback 30 must be ignored
    expect(video.currentTime).toBeCloseTo(20 + 1 / 60, 5);
  });

  it('stepFrame: playing video is a no-op (only steps while paused)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, {
      paused: false,
      currentTime: 40,
      duration: 100,
    });

    actionHandler.runAction('advanceFrame', 30);
    expect(video.currentTime).toBe(40);
  });

  it('stepFrame: a malformed negative fallback fps does not reverse direction', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const video = createTestVideoWithController(config, actionHandler, {
      paused: true,
      currentTime: 50,
      duration: 100,
    });

    // Imported binding value of -30 is truthy — without sanitizing it would make
    // advanceFrame seek backwards. It must fall back to a positive 30fps step.
    actionHandler.runAction('advanceFrame', -30);
    expect(video.currentTime).toBeCloseTo(50 + 1 / 30, 5);
  });

  it('stepFrame: no-op on <audio> elements (frames are meaningless)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const audioLike = { tagName: 'AUDIO', paused: true, currentTime: 10, vsc: {} };
    actionHandler.stepFrame(audioLike, 1, 30);
    expect(audioLike.currentTime).toBe(10);
  });

  it('stepFrame: clamps at 0 and at duration', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // At the start: stepping back stays at 0.
    const atStart = createTestVideoWithController(config, actionHandler, {
      paused: true,
      currentTime: 0,
      duration: 100,
    });
    actionHandler.runAction('rewindFrame', 30);
    expect(atStart.currentTime).toBe(0);
    if (window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // At the end: stepping forward stays at duration.
    const atEnd = createTestVideoWithController(config, actionHandler, {
      paused: true,
      currentTime: 100,
      duration: 100,
    });
    actionHandler.runAction('advanceFrame', 30);
    expect(atEnd.currentTime).toBe(100);
  });

  it('reset action should work with keyboard event simulation', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    actionHandler.eventManager = eventManager;

    // Test with custom reset speed via keyboard simulation
    config.setKeyBinding('reset', 1.5);
    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });

    // Simulate pressing R key (82) - this will pass the configured value automatically
    eventManager.handleKeydown({
      code: 'KeyR',
      key: 'r',
      keyCode: 82,
      target: document.body,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      timeStamp: 3000,
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    expect(mockVideo.playbackRate).toBe(1.5); // Should use configured reset speed
  });
  describe('accepted playback speed state', () => {
    function setup() {
      const config = window.VSC.videoSpeedConfig;
      config.settings.lastSpeed = 1.25;
      config.settings.rememberSpeed = true;
      const actionHandler = new window.VSC.ActionHandler(config, null);
      const video = createTestVideoWithController(config, actionHandler);
      const save = vi.spyOn(config, 'save').mockImplementation(() => {});
      return { config, actionHandler, video, save };
    }

    afterEach(() => vi.restoreAllMocks());

    it('clamps direct setSpeed callers on Chrome as well as shortcut adjustments', () => {
      const { video, actionHandler, config, save } = setup();
      expect(actionHandler.setSpeed(video, 32, 'user')).toBe(true);
      expect(video.playbackRate).toBe(16);
      expect(config.settings.lastSpeed).toBe(16);
      expect(save).toHaveBeenCalledWith({ lastSpeed: 16 });
    });

    it('caps legacy high speed user commands at 16 and establishes lifecycle authority', () => {
      const { video, actionHandler, config, save } = setup();
      const manager = new window.VSC.EventManager(config, actionHandler);
      actionHandler.eventManager = manager;
      const setter = vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange');
      try {
        expect(actionHandler.setSpeed(video, 64, 'user')).toBe(true);
        expect(setter).toHaveBeenCalledExactlyOnceWith(video, 16);
        expect(video.playbackRate).toBe(16);
        expect(config.settings.lastSpeed).toBe(16);
        expect(manager.getMediaRateState(video).acceptedSpeed).toBe(16);
        expect(manager.getMediaRateState(video).lifecycleSpeed).toBe(16);
        expect(save).toHaveBeenCalledWith({ lastSpeed: 16 });
      } finally {
        manager.cleanup();
      }
    });

    it.each([NaN, Infinity, -Infinity, undefined, '32'])(
      'rejects non-finite or non-numeric direct input %s',
      (speed) => {
        const { video, actionHandler, config, save } = setup();
        const before = video.playbackRate;
        expect(actionHandler.setSpeed(video, speed, 'user')).toBe(false);
        expect(video.playbackRate).toBe(before);
        expect(config.settings.lastSpeed).toBe(1.25);
        expect(save).not.toHaveBeenCalled();
      }
    );

    it('does not persist or render a rejected native rate request', () => {
      const { video, actionHandler, config, save } = setup();
      const indicator = video.vsc.speedIndicator.textContent;
      vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation(() => {
        expect(config.settings.lastSpeed).toBe(8);
        throw new DOMException('Unsupported rate', 'NotSupportedError');
      });
      expect(actionHandler.setSpeed(video, 8, 'user')).toBe(false);
      expect(config.settings.lastSpeed).toBe(1.25);
      expect(video.vsc.speedIndicator.textContent).toBe(indicator);
      expect(save).not.toHaveBeenCalled();
    });

    it('does not recursively fight a synchronous native clamp during an explicit write', () => {
      const { video, actionHandler, config, save } = setup();
      const eventManager = new window.VSC.EventManager(config, actionHandler);
      actionHandler.eventManager = eventManager;
      const handler = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation((media) => {
          media.playbackRate = 2;
          eventManager.handleRateChange({ target: media, stopImmediatePropagation: vi.fn() });
        });
      try {
        expect(actionHandler.setSpeed(video, 8, 'user')).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(config.settings.lastSpeed).toBe(2);
        expect(save).toHaveBeenCalledWith({ lastSpeed: 2 });
        expect(eventManager.getMediaRateState(video).applyingSpeed).toBe(false);
        handler.mockImplementation(() => {
          throw new Error('Unsupported');
        });
        expect(actionHandler.setSpeed(video, 8, 'user')).toBe(false);
        expect(eventManager.getMediaRateState(video).applyingSpeed).toBe(false);
        expect(config.settings.lastSpeed).toBe(2);
      } finally {
        eventManager.cleanup();
      }
    });

    it.each(['synchronous', 'deferred'])(
      'retains a source-specific initialization clamp without retrying or saving it (%s events)',
      (timing) => {
        vi.useFakeTimers();
        const { video, actionHandler, config, save } = setup();
        config.settings.lastSpeed = 8;
        const eventManager = new window.VSC.EventManager(config, actionHandler);
        actionHandler.eventManager = eventManager;
        const forward = (event) => eventManager.handleRateChange(event);
        video.addEventListener('ratechange', forward);
        let writes = 0;
        const handler = vi
          .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
          .mockImplementation((media, requested) => {
            if (++writes > 4) {
              throw new Error('Recursive rate restoration');
            }
            media.playbackRate = media === video ? 2 : requested;
            const dispatch = () => media.dispatchEvent(new Event('ratechange'));
            if (timing === 'synchronous') {
              dispatch();
            } else {
              setTimeout(dispatch, 0);
            }
          });
        try {
          expect(actionHandler.setSpeed(video, 8, 'init')).toBe(true);
          vi.advanceTimersByTime(10);
          expect(handler).toHaveBeenCalledTimes(1);
          expect(video.playbackRate).toBe(2);
          expect(config.settings.lastSpeed).toBe(8);
          expect(save).not.toHaveBeenCalled();
          expect(video.vsc.speedIndicator.textContent).toBe('2.00');
          // An unrelated media element must keep its own requested authority.
          const other = createTestVideoWithController(config, actionHandler);
          expect(actionHandler.setSpeed(other, 8, 'init')).toBe(true);
          expect(eventManager.getMediaRateState(video).acceptedSpeed).toBe(2);
          expect(eventManager.getMediaRateState(other).acceptedSpeed).toBe(8);
          expect(eventManager.getMediaRateState(other)).not.toBe(
            eventManager.getMediaRateState(video)
          );
          other.vsc.remove();
        } finally {
          video.removeEventListener('ratechange', forward);
          eventManager.cleanup();
          vi.useRealTimers();
        }
      }
    );

    it.each(['synchronous', 'deferred'])(
      'keeps different media clamps through sibling commands and site resets (%s)',
      (timing) => {
        vi.useFakeTimers();
        const { video, actionHandler, config } = setup();
        const other = createTestVideoWithController(config, actionHandler);
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        const manager = new window.VSC.EventManager(config, actionHandler);
        actionHandler.eventManager = manager;
        const notify = (media) =>
          manager.handleRateChange({ target: media, stopImmediatePropagation: vi.fn() });
        let writes = 0;
        vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation(
          (media, rate) => {
            if (++writes > 10) {
              throw new Error('Repeated unsupported rate');
            }
            media.playbackRate = media === video ? Math.min(rate, 2) : rate;
            const dispatch = () => notify(media);
            if (timing === 'synchronous') {
              dispatch();
            } else {
              setTimeout(dispatch, 0);
            }
          }
        );
        try {
          actionHandler.setSpeed(video, 8, 'user');
          actionHandler.setSpeed(other, 8, 'user');
          vi.advanceTimersByTime(10);
          notify(video);
          expect(writes).toBe(2);
          expect(config.settings.lastSpeed).toBe(8);
          // A command on B cannot force A to retry a rejected rate, either
          // during its cooldown or in the later fight-back path.
          actionHandler.setSpeed(other, 4, 'user');
          for (const elapsed of [10, 5000]) {
            vi.advanceTimersByTime(elapsed);
            video.playbackRate = 1;
            notify(video);
            vi.advanceTimersByTime(10);
            expect(video.playbackRate).toBe(2);
            expect(manager.getMediaRateState(video).acceptedSpeed).toBe(2);
            expect(config.settings.lastSpeed).toBe(4);
          }
          expect(writes).toBe(5);
        } finally {
          manager.cleanup();
          other.vsc.remove();
          vi.useRealTimers();
        }
      }
    );

    it('retains local initialization readback when a site mutates the rate and then throws', () => {
      const { video, actionHandler, config, save } = setup();
      config.settings.lastSpeed = 8;
      const eventManager = new window.VSC.EventManager(config, actionHandler);
      actionHandler.eventManager = eventManager;
      const handler = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation((media) => {
          media.playbackRate = 2;
          throw new Error('Partial write');
        });
      try {
        expect(actionHandler.setSpeed(video, 8, 'init')).toBe(false);
        eventManager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(config.settings.lastSpeed).toBe(8);
        expect(video.playbackRate).toBe(2);
        expect(save).not.toHaveBeenCalled();
      } finally {
        eventManager.cleanup();
      }
    });

    it('does not establish initialization authority when no user preference exists', () => {
      const { video, actionHandler, config, save } = setup();
      config.settings.lastSpeed = null;
      const eventManager = new window.VSC.EventManager(config, actionHandler);
      actionHandler.eventManager = eventManager;
      try {
        expect(actionHandler.setSpeed(video, 1.5, 'init')).toBe(true);
        expect(config.settings.lastSpeed).toBeNull();
        expect(eventManager.getMediaRateState(video).acceptedSpeed).toBeUndefined();
        expect(save).not.toHaveBeenCalled();
      } finally {
        eventManager.cleanup();
      }
    });

    it('handles a null rejection and retains actual authority after a partial site write', () => {
      const { video, actionHandler, config, save } = setup();
      const handler = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation(() => {
          throw null;
        });
      expect(actionHandler.setSpeed(video, 8, 'user')).toBe(false);
      expect(config.settings.lastSpeed).toBe(1.25);
      handler.mockImplementation((media) => {
        media.playbackRate = 2;
        throw 'Site rejected';
      });
      expect(actionHandler.setSpeed(video, 8, 'user')).toBe(false);
      expect(config.settings.lastSpeed).toBe(2);
      expect(save).not.toHaveBeenCalled();
    });

    it('uses native accepted readback when a source clamps the rate', () => {
      const { video, actionHandler, config, save } = setup();
      vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation((media) => {
        media.playbackRate = 2;
      });
      expect(actionHandler.setSpeed(video, 8, 'user')).toBe(true);
      expect(config.settings.lastSpeed).toBe(2);
      expect(video.vsc.speedIndicator.textContent).toBe('2.00');
      expect(save).toHaveBeenCalledWith({ lastSpeed: 2 });
    });
  });
});

describe('ActionHandler committed X playback relative commands', () => {
  let video, controller, actionHandler, config, loop, pending, writes;

  beforeEach(() => {
    window.VSC_controller?.mutationObserver?.stop();
    video = document.createElement('video');
    document.body.append(video);
    video.playbackRate = 2.1;
    config = { settings: { lastSpeed: 2.1, rememberSpeed: false }, save: vi.fn() };
    actionHandler = new window.VSC.ActionHandler(config, null);
    controller = { video, actionHandler, config, speedIndicator: document.createElement('span') };
    video.vsc = controller;
    pending = null;
    loop = {
      requestedSpeed: vi.fn(() => pending),
      queueRelative: vi.fn((_controller, target, source) => {
        if (source === 'external' || source === 'init') {
          return false;
        }
        pending = target;
        return true;
      }),
      cancelRelative: vi.fn(() => {
        pending = null;
      }),
    };
    vi.spyOn(window.VSC.TwitterMP4Playback, 'get').mockImplementation((target) =>
      target === video ? loop : undefined
    );
    vi.spyOn(window.VSC.TwitterCaptionPlayback, 'requestedSpeed').mockReturnValue(undefined);
    writes = vi
      .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
      .mockImplementation((target, rate) => {
        target.playbackRate = rate;
      });
  });

  afterEach(() => {
    delete video.vsc;
    video.remove();
    vi.restoreAllMocks();
  });

  it('uses the pending loop target for every delta and leaves native/config state unaccepted', () => {
    for (let click = 0; click < 19; click++) {
      expect(actionHandler.adjustSpeed(video, 0.1, { relative: true })).toBe(false);
    }
    expect(loop.queueRelative).toHaveBeenLastCalledWith(controller, 4, 'internal');
    expect(video.playbackRate).toBe(2.1);
    expect(config.settings.lastSpeed).toBe(2.1);
    expect(config.save).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('retains existing snapping and product bounds while a loop target is pending', () => {
    pending = 0.95;
    actionHandler.adjustSpeed(video, 0.1, { relative: true });
    expect(loop.queueRelative).toHaveBeenLastCalledWith(controller, 1, 'internal');
    pending = 15.9;
    actionHandler.adjustSpeed(video, 1, { relative: true });
    expect(loop.queueRelative).toHaveBeenLastCalledWith(controller, 16, 'internal');
    pending = 0.08;
    actionHandler.adjustSpeed(video, -1, { relative: true });
    expect(loop.queueRelative).toHaveBeenLastCalledWith(controller, 0.07, 'internal');
  });

  it('keeps the existing caption request base ahead of an unrelated loop request', () => {
    pending = 4;
    window.VSC.TwitterCaptionPlayback.requestedSpeed.mockReturnValue(2.5);
    actionHandler.adjustSpeed(video, 0.1, { relative: true });
    expect(loop.queueRelative).toHaveBeenLastCalledWith(controller, 2.6, 'internal');
  });

  it.each(['internal', 'external', 'init'])(
    'cancels pending relative intent before an absolute %s command',
    (source) => {
      pending = 4;
      expect(actionHandler.setSpeed(video, 1.5, source)).toBe(true);
      expect(loop.cancelRelative).toHaveBeenCalledOnce();
      expect(pending).toBeNull();
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 1.5);
    }
  );

  it.each(['external', 'init'])(
    'does not use a pending target for a relative %s update',
    (source) => {
      pending = 4;
      expect(actionHandler.adjustSpeed(video, 0.1, { relative: true, source })).toBe(true);
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 2.2);
      expect(loop.requestedSpeed).not.toHaveBeenCalled();
      expect(pending).toBeNull();
    }
  );

  it('preserves immediate relative changes on ordinary media', () => {
    window.VSC.TwitterMP4Playback.get.mockReturnValue(undefined);
    expect(actionHandler.adjustSpeed(video, 0.1, { relative: true })).toBe(true);
    expect(writes).toHaveBeenCalledExactlyOnceWith(video, 2.2);
    expect(video.playbackRate).toBe(2.2);
    expect(loop.queueRelative).not.toHaveBeenCalled();
    expect(loop.cancelRelative).not.toHaveBeenCalled();
  });
});

describe('ActionHandler native iOS relative burst', () => {
  let video, controller, actionHandler, manager, config, rate, writes, source, onWrite, paused;
  let captionBegin, mp4Begin, hlsBegin, play;

  beforeEach(() => {
    vi.useFakeTimers();
    window.VSC_controller?.mutationObserver?.stop();
    video = document.createElement('video');
    video.src = 'blob:https://x.com/current-native';
    document.body.append(video);
    source = video.src;
    rate = 2.1;
    paused = false;
    onWrite = null;
    writes = [];
    Object.defineProperties(video, {
      currentSrc: { configurable: true, get: () => source },
      paused: { configurable: true, get: () => paused },
    });
    // Observe the real jsdom WebIDL setter without replacing the captured native accessor.
    const implementation = jsdomIDL.implForWrapper(video);
    Object.defineProperty(implementation, '_playbackRate', {
      configurable: true,
      get: () => rate,
      set: (value) => {
        writes.push(value);
        rate = value;
        onWrite?.(value);
      },
    });
    config = {
      settings: { enabled: true, lastSpeed: 2.1, rememberSpeed: true },
      speedPreferenceRevision: 0,
      save: vi.fn(),
    };
    manager = new window.VSC.EventManager(config, null);
    actionHandler = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = actionHandler;
    manager.setupRateChangeListener(document);
    controller = { video, actionHandler, config, speedIndicator: document.createElement('span') };
    video.vsc = controller;
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(false);
    vi.spyOn(window.VSC.TwitterMP4Playback, 'get').mockReturnValue(undefined);
    vi.spyOn(window.VSC.TwitterMP4Playback, 'getPending').mockReturnValue(undefined);
    vi.spyOn(window.VSC.TwitterCaptionPlayback, 'requestedSpeed').mockReturnValue(undefined);
    captionBegin = vi.spyOn(window.VSC.TwitterCaptionPlayback, 'begin').mockReturnValue(null);
    mp4Begin = vi.spyOn(window.VSC.TwitterMP4Playback, 'begin').mockReturnValue(null);
    hlsBegin = vi.spyOn(window.VSC.SafariHLSPlayback, 'begin').mockReturnValue(null);
    vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation((v, speed) => {
      v.playbackRate = speed;
    });
    play = vi.spyOn(video, 'play').mockImplementation(() => {
      throw new Error('No Play in native rate queue');
    });
  });

  afterEach(() => {
    manager.cleanup();
    video.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function faster() {
    return actionHandler.adjustSpeed(video, 0.1, { relative: true });
  }
  function pending() {
    faster();
    faster();
  }

  it.each([
    ['X', true],
    ['non-X', false],
  ])(
    '%s keeps all 19 deltas with first synchronous 2.2 and one native 4 write after 100ms',
    (_scope, isTwitter) => {
      window.VSC.EventManager.isTwitterHost.mockReturnValue(isTwitter);
      expect(faster()).toBe(true);
      expect(captionBegin).toHaveBeenCalledOnce();
      expect(mp4Begin).toHaveBeenCalledOnce();
      expect(hlsBegin).toHaveBeenCalledOnce();
      expect(writes).toEqual([2.2]);
      for (let i = 1; i < 19; i++) {
        expect(faster()).toBe(false);
      }
      expect(rate).toBe(2.2);
      expect(config.settings.lastSpeed).toBe(2.2);
      expect(controller.speedIndicator.textContent).toBe('2.20');
      expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 2.2 });
      vi.advanceTimersByTime(99);
      expect(writes).toEqual([2.2]);
      vi.advanceTimersByTime(1);
      expect(writes).toEqual([2.2, 4]);
      expect(config.settings.lastSpeed).toBe(4);
      expect(controller.speedIndicator.textContent).toBe('4.00');
      expect(manager.getMediaRateState(video).acceptedSpeed).toBe(4);
      expect(config.save).toHaveBeenLastCalledWith({ lastSpeed: 4 });
      expect(play).not.toHaveBeenCalled();
      expect(captionBegin).toHaveBeenCalledOnce();
    }
  );

  it('never selects a newly eligible transition or site handler at delayed flush', () => {
    pending();
    const transition = { finish: vi.fn(), deferred: true };
    captionBegin.mockReturnValue(transition);
    const siteHandler = window.VSC.siteHandlerManager.handleSpeedChange;
    siteHandler.mockClear();
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2, 2.3]);
    expect(captionBegin).toHaveBeenCalledOnce();
    expect(siteHandler).not.toHaveBeenCalled();
    expect(transition.finish).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('keeps ordinary first-command transition selection synchronous and never arms after it', () => {
    const transition = { finish: vi.fn() };
    captionBegin.mockReturnValue(transition);
    expect(faster()).toBe(true);
    expect(transition.finish).toHaveBeenCalledOnce();
    expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
    faster();
    expect(captionBegin).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([2.2, 2.3]);
  });

  it.each(['caption', 'mp4', 'hls'])(
    'keeps the2× crossing synchronous for the%s adapter and its sole Play',
    (adapter) => {
      rate = config.settings.lastSpeed = 1.9;
      controller.div = document.createElement('div');
      vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockReturnValue([video]);
      let inputActive = false;
      play.mockImplementation(() => {
        expect(inputActive).toBe(true);
        return Promise.resolve();
      });
      const begin = { caption: captionBegin, mp4: mp4Begin, hls: hlsBegin }[adapter];
      const deferred = { deferred: true, finish: vi.fn() };
      begin.mockImplementation((_controller, speed) => {
        if (speed <= 2) {
          return null;
        }
        expect(inputActive).toBe(true);
        video.play();
        return deferred;
      });
      const input = () => {
        inputActive = true;
        try {
          actionHandler.runAction('faster', 0.1, { type: 'keydown', target: document.body });
        } finally {
          inputActive = false;
        }
      };
      input();
      expect(rate).toBe(2);
      expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
      input();
      expect(begin).toHaveBeenLastCalledWith(
        controller,
        2.1,
        'internal',
        ...(adapter === 'caption' ? [{ previousSpeed: 2 }] : [])
      );
      expect(play).toHaveBeenCalledOnce();
      expect(deferred.finish).not.toHaveBeenCalled();
      expect(writes).toEqual([2]);
      expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
      vi.advanceTimersByTime(100);
      expect(play).toHaveBeenCalledOnce();
      expect(writes).toEqual([2]);
    }
  );

  it.each(['caption pending', 'hls pending', 'active hls', 'active mp4', 'pending mp4'])(
    'does not arm over%s ownership',
    (kind) => {
      if (kind === 'caption pending') {
        controller.twitterCaptionPending = {};
      }
      if (kind === 'hls pending') {
        controller.safariPlaybackPending = {};
      }
      if (kind === 'active hls') {
        controller.safariPlayback = {};
      }
      if (kind === 'active mp4') {
        window.VSC.TwitterMP4Playback.get.mockReturnValue({});
      }
      if (kind === 'pending mp4') {
        window.VSC.TwitterMP4Playback.getPending.mockReturnValue({});
      }
      expect(faster()).toBe(true);
      expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
      expect(faster()).toBe(true);
      expect(writes).toEqual([2.2, 2.3]);
    }
  );

  it('does not queue when native accepted readback is clamped to2×', () => {
    onWrite = () => {
      rate = 2;
    };
    faster();
    expect(config.settings.lastSpeed).toBe(2);
    expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
    faster();
    expect(captionBegin).toHaveBeenCalledTimes(2);
    expect(mp4Begin).toHaveBeenCalledTimes(2);
    expect(hlsBegin).toHaveBeenCalledTimes(2);
    expect(play).not.toHaveBeenCalled();
  });

  it('composes later bursts after an earlier own flush without using an installation-time preference', () => {
    for (let i = 0; i < 5; i++) {
      faster();
    }
    vi.advanceTimersByTime(110);
    expect(rate).toBe(2.6);
    for (let i = 0; i < 14; i++) {
      faster();
    }
    vi.advanceTimersByTime(100);
    expect(rate).toBe(4);
    expect(writes).toEqual([2.2, 2.6, 2.7, 4]);
  });

  it('preserves snapping and both bounds when composing queued input', () => {
    faster();
    actionHandler.adjustSpeed(video, 100, { relative: true });
    expect(manager.getMediaRateState(video).nativeRelative.target).toBe(16);
    actionHandler.adjustSpeed(video, -100, { relative: true });
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2, 1]);
    expect(manager.getMediaRateState(video).acceptedSpeed).toBe(1);
    actionHandler.adjustSpeed(video, -100, { relative: true });
    expect(rate).toBe(0.07);
  });

  it.each(['internal', 'external', 'init'])(
    'absolute%s supersedes the queue while NaN preserves it',
    (kind) => {
      pending();
      expect(actionHandler.setSpeed(video, NaN)).toBe(false);
      expect(manager.getMediaRateState(video).nativeRelative.target).toBe(2.3);
      actionHandler.setSpeed(video, 1.5, kind);
      vi.advanceTimersByTime(100);
      expect(writes).toEqual([2.2, 1.5]);
    }
  );

  it('still flushes valid relative intent while paused and never resumes', () => {
    pending();
    paused = true;
    vi.advanceTimersByTime(100);
    expect(rate).toBe(2.3);
    expect(video.paused).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it('uses actual clamped readback for accepted state, UI and persistence', () => {
    pending();
    onWrite = () => {
      rate = 2.25;
    };
    vi.advanceTimersByTime(100);
    expect(rate).toBe(2.25);
    expect(config.settings.lastSpeed).toBe(2.25);
    expect(controller.speedIndicator.textContent).toBe('2.25');
    expect(manager.getMediaRateState(video).acceptedSpeed).toBe(2.25);
    expect(config.save).toHaveBeenLastCalledWith({ lastSpeed: 2.25 });
  });

  it.each([
    [
      'source',
      () => {
        source = 'blob:https://x.com/foreign';
      },
    ],
    [
      'source write and restore',
      () => {
        const src = video.src;
        video.src = 'blob:foreign';
        video.src = src;
      },
    ],
    [
      'poster write and restore',
      () => {
        video.setAttribute('poster', 'foreign');
        video.removeAttribute('poster');
      },
    ],
    [
      'child write and restore',
      () => {
        const node = document.createElement('source');
        video.append(node);
        node.remove();
      },
    ],
    [
      'source child attribute write and restore',
      () => {
        video.firstElementChild.src = 'foreign';
        video.firstElementChild.removeAttribute('src');
      },
    ],
    [
      'external preference replacement',
      () => {
        config.speedPreferenceRevision++;
      },
    ],
    [
      'external preference removal',
      () => {
        delete config.settings.lastSpeed;
        config.speedPreferenceRevision++;
      },
    ],
    [
      'settings replacement',
      () => {
        config.settings = { ...config.settings };
      },
    ],
    [
      'config replacement',
      () => {
        controller.config = { settings: config.settings };
      },
    ],
    [
      'controller replaced',
      () => {
        video.vsc = { ...controller };
      },
    ],
    [
      'disposed',
      () => {
        controller.disposed = true;
      },
    ],
    [
      'disabled',
      () => {
        config.settings.enabled = false;
      },
    ],
    [
      'setSpeed replaced',
      () => {
        actionHandler.setSpeed = vi.fn();
      },
    ],
    [
      'applySpeed replaced',
      () => {
        actionHandler.applySpeed = vi.fn();
      },
    ],
    [
      'rate descriptor replaced',
      () => {
        Object.defineProperty(video, 'playbackRate', {
          configurable: true,
          value: rate,
          writable: true,
        });
      },
    ],
    [
      'external native rate',
      () => {
        rate = 3;
      },
    ],
    [
      'adoption',
      () => {
        document.implementation.createHTMLDocument('other').body.append(video);
      },
    ],
    [
      'navigation',
      () => {
        history.replaceState(null, '', '/native-queue-other');
      },
    ],
    [
      'cooldown refreshed',
      () => {
        manager.refreshCoolDown(video);
      },
    ],
    [
      'source lifecycle reset',
      () => {
        manager.releaseMediaState(video);
      },
    ],
    [
      'teardown',
      () => {
        manager.cleanup();
      },
    ],
    [
      'caption pending',
      () => {
        controller.twitterCaptionPending = {};
      },
    ],
  ])('cancels%s with no late rate/UI/persistence', (_name, change) => {
    video.append(document.createElement('source'));
    pending();
    const before = config.save.mock.calls.length;
    change();
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2]);
    expect(config.save.mock.calls.length).toBe(before);
    expect(controller.speedIndicator.textContent).toBe('2.20');
    expect(play).not.toHaveBeenCalled();
  });

  it('rejects transient source intent that occurs before a second relative input', () => {
    faster();
    video.src = 'blob:other';
    video.src = source;
    expect(faster()).toBe(true);
    expect(writes).toEqual([2.2, 2.3]);
    expect(captionBegin).toHaveBeenCalledTimes(2);
  });

  it.each(['source', 'same-value newer command', 'preference'])(
    'does not persist old flush after reentrant%s',
    (kind) => {
      pending();
      const saves = config.save.mock.calls.length;
      onWrite = () => {
        onWrite = null;
        if (kind === 'source') {
          source = 'blob:foreign';
        } else if (kind === 'preference') {
          config.speedPreferenceRevision++;
        } else {
          actionHandler.setSpeed(video, 2.3);
        }
      };
      vi.advanceTimersByTime(100);
      expect(config.save.mock.calls.length).toBe(
        saves + (kind === 'same-value newer command' ? 1 : 0)
      );
      if (kind === 'same-value newer command') {
        expect(config.settings.lastSpeed).toBe(2.3);
      }
    }
  );

  it('cannot revive a hint after current drains a transient source mutation', () => {
    faster();
    const hint = manager.getMediaRateState(video).nativeRelative;
    video.src = 'blob:foreign';
    video.src = source;
    expect(hint.current()).toBe(false);
    expect(hint.current()).toBe(false);
    hint.queue(4, 'internal');
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2]);
    expect(manager.getMediaRateState(video).nativeRelative).toBeNull();
  });

  it.each([false, true])(
    'preserves a same-target newer command after release/recreate during native write (throw%s)',
    (throws) => {
      pending();
      onWrite = () => {
        onWrite = null;
        manager.releaseMediaState(video);
        actionHandler.setSpeed(video, 2.3);
        if (throws) {
          throw new Error('Old setter returns late');
        }
      };
      vi.advanceTimersByTime(100);
      expect(config.settings.lastSpeed).toBe(2.3);
      expect(config.save).toHaveBeenCalledTimes(2);
      expect(config.save).toHaveBeenLastCalledWith({ lastSpeed: 2.3 });
      expect(manager.getMediaRateState(video).acceptedSpeed).toBe(2.3);
    }
  );

  it('restores accepted preference if release/recreate invalidates before the native setter without newer input', () => {
    pending();
    const refresh = manager.refreshCoolDown.bind(manager);
    vi.spyOn(manager, 'refreshCoolDown').mockImplementation((...args) => {
      refresh(...args);
      manager.releaseMediaState(video);
      manager.getOrCreateMediaRateState(video);
    });
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2]);
    expect(config.settings.lastSpeed).toBe(2.2);
    expect(controller.speedIndicator.textContent).toBe('2.20');
    expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 2.2 });
  });

  it('ignores UI-only attribute churn while retaining exact source observation', () => {
    pending();
    video.classList.add('site-playing');
    video.style.opacity = '1';
    video.setAttribute('playsinline', '');
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2, 2.3]);
  });

  it('cancels an in-flight native hint when release occurs without another command', () => {
    pending();
    const hint = manager.getMediaRateState(video).nativeRelative;
    onWrite = () => {
      manager.releaseMediaState(video);
    };
    vi.advanceTimersByTime(100);
    expect(hint.cancelled).toBe(true);
    expect(manager.getMediaRateState(video)).toBeNull();
    expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 2.2 });
  });

  it('never invokes a later own rate setter during delayed flush', () => {
    pending();
    const setter = vi.fn(() => {
      video.play();
    });
    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get: () => rate,
      set: setter,
    });
    vi.advanceTimersByTime(100);
    expect(setter).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(writes).toEqual([2.2]);
  });

  it('rejects an intermediate rate accessor instead of legitimizing it as native', () => {
    const prototype = window.HTMLVideoElement.prototype;
    const prior = Object.getOwnPropertyDescriptor(prototype, 'playbackRate');
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLMediaElement.prototype,
      'playbackRate'
    );
    Object.defineProperty(prototype, 'playbackRate', {
      configurable: true,
      get: descriptor.get,
      set: descriptor.set,
    });
    try {
      faster();
      expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
      expect(faster()).toBe(true);
      expect(writes).toEqual([2.2, 2.3]);
    } finally {
      if (prior) {
        Object.defineProperty(prototype, 'playbackRate', prior);
      } else {
        delete prototype.playbackRate;
      }
    }
  });

  it('rejects replacement of the canonical captured native setter even if its wrapper delegates', () => {
    const prototype = window.HTMLMediaElement.prototype;
    const prior = Object.getOwnPropertyDescriptor(prototype, 'playbackRate');
    Object.defineProperty(prototype, 'playbackRate', {
      ...prior,
      set(value) {
        prior.set.call(this, value);
      },
    });
    try {
      faster();
      expect(manager.getMediaRateState(video).nativeRelative).toBeUndefined();
      expect(faster()).toBe(true);
    } finally {
      Object.defineProperty(prototype, 'playbackRate', prior);
    }
  });

  it('retains a native partial-write readback after throw without persisting or seeding another hint', () => {
    pending();
    onWrite = () => {
      rate = 2.25;
      throw new Error('Native partial write');
    };
    vi.advanceTimersByTime(100);
    expect(manager.getMediaRateState(video).acceptedSpeed).toBe(2.25);
    expect(config.settings.lastSpeed).toBe(2.25);
    expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 2.2 });
    expect(manager.getMediaRateState(video).nativeRelative).toBeNull();
  });

  it('expires unused source hints and restores full synchronous selection for the next burst', () => {
    faster();
    vi.advanceTimersByTime(100);
    expect(manager.getMediaRateState(video).nativeRelative).toBeNull();
    expect(faster()).toBe(true);
    expect(captionBegin).toHaveBeenCalledTimes(2);
  });

  it('keeps non-iOS relative commands immediate', () => {
    window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
    pending();
    vi.advanceTimersByTime(100);
    expect(writes).toEqual([2.2, 2.3]);
    expect(captionBegin).toHaveBeenCalledTimes(2);
  });
});
