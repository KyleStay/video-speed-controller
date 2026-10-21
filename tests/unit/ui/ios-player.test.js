import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('iOS player ownership, playback, and restoration', () => {
  const created = [];
  const navigatorDescriptors = new Map();
  const dialogDescriptors = new Map();

  function setPlatform(
    userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X)',
    touches = 5
  ) {
    for (const [key, value] of Object.entries({
      userAgent,
      maxTouchPoints: touches,
      platform: userAgent.includes('iPhone') ? 'iPhone' : 'MacIntel',
    })) {
      Object.defineProperty(navigator, key, { configurable: true, value });
    }
  }

  function makeController(tag = 'video') {
    const parent = document.createElement('section');
    const before = document.createElement('p');
    const after = document.createElement('p');
    const video = document.createElement(tag);
    const div = document.createElement('vsc-controller');
    const shadow = div.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="controller"><div id="controls"></div></div>';
    parent.append(before, video, after, div);
    document.body.append(parent);

    video.src = 'https://media.example.test/original.mp4';
    video.controls = true;
    video.style.cssText = 'width: 320px; height: 180px; object-fit: cover;';
    video.currentTime = 12.5;
    video.playbackRate = 1.5;
    const stream = { original: true };
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      writable: true,
      value: stream,
    });
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
    let paused = true;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    video.play = vi.fn(() => {
      paused = false;
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    video.pause = vi.fn(() => {
      paused = true;
      video.dispatchEvent(new Event('pause'));
    });
    video.getBoundingClientRect = () => ({
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      right: 320,
      bottom: 280,
      width: 320,
      height: 180,
    });
    const actionHandler = {
      setSpeed: vi.fn((media, speed) => {
        media.playbackRate = speed;
      }),
      seek: vi.fn((media, delta) => {
        media.currentTime += delta;
      }),
    };
    const controller = {
      video,
      div,
      actionHandler,
      config: {
        settings: { ...window.VSC.Constants.DEFAULT_SETTINGS },
        getKeyBinding: (action) => (['rewind', 'advance'].includes(action) ? 10 : 0.1),
      },
      remove: vi.fn(),
      repairDOMPlacement: vi.fn(),
    };
    video.vsc = controller;
    const player = new window.VSC.IOSPlayer(controller);
    const item = { player, controller, video, div, parent, before, after, stream };
    created.push(item);
    return item;
  }

  it('does not rewrite unchanged controls on playback progress while keeping live changes visible', () => {
    const { player, video } = makeController();
    player.attach();
    player.open();
    const { refs, shadow } = player.ui;
    player.update();
    const playText = refs.play.firstChild;
    const durationText = refs.duration.firstChild;
    const observer = new MutationObserver(() => {});
    observer.observe(shadow, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    for (const type of ['timeupdate', 'progress', 'timeupdate']) {
      video.dispatchEvent(new Event(type));
    }
    expect(observer.takeRecords()).toEqual([]);

    video.currentTime = 25;
    video.dispatchEvent(new Event('timeupdate'));
    expect(refs.current.textContent).toBe('0:25');
    expect(Number(refs.seek.value)).toBe(25);
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    expect(refs.play.firstChild).toBe(playText);
    expect(refs.duration.firstChild).toBe(durationText);

    video.play();
    expect(refs.play.textContent).toBe('Pause');
    video.muted = true;
    video.dispatchEvent(new Event('volumechange'));
    expect(refs.mute.textContent).toBe('Unmute');
    video.playbackRate = 16;
    video.dispatchEvent(new Event('ratechange'));
    expect(refs.speed.value).toBe('16');
    observer.disconnect();
  });

  it('leaves locked controls untouched during playback and synchronizes them on unlock', () => {
    const { player, video } = makeController();
    player.attach();
    player.open();
    player.setControlsLocked(true);
    const { refs } = player.ui;
    const before = refs.current.textContent;
    const observer = new MutationObserver(() => {});
    observer.observe(player.ui.shadow.querySelector('.hud'), {
      subtree: true,
      childList: true,
      attributes: true,
    });
    video.currentTime = 34;
    video.dispatchEvent(new Event('timeupdate'));
    expect(refs.current.textContent).toBe(before);
    expect(observer.takeRecords()).toEqual([]);
    player.setControlsLocked(false);
    expect(refs.current.textContent).toBe('0:34');
    expect(Number(refs.seek.value)).toBe(34);
    observer.disconnect();
  });

  const flushEvents = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    for (const key of ['userAgent', 'maxTouchPoints', 'platform']) {
      navigatorDescriptors.set(key, Object.getOwnPropertyDescriptor(navigator, key));
    }
    setPlatform();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    for (const [name, implementation] of Object.entries({
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    })) {
      dialogDescriptors.set(
        name,
        Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)
      );
      Object.defineProperty(HTMLDialogElement.prototype, name, {
        configurable: true,
        value: implementation,
      });
    }
  });

  afterEach(() => {
    for (const { player, parent } of created.splice(0)) {
      player.cleanup();
      parent.remove();
    }
    for (const [key, descriptor] of navigatorDescriptors) {
      if (descriptor) {
        Object.defineProperty(navigator, key, descriptor);
      } else {
        delete navigator[key];
      }
    }
    for (const [key, descriptor] of dialogDescriptors) {
      if (descriptor) {
        Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
      } else {
        delete HTMLDialogElement.prototype[key];
      }
    }
    vi.restoreAllMocks();
  });

  describe('scroll preservation across presentation boundaries', () => {
    function scrollingWindow(x = 25, y = 650) {
      vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => x);
      vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
      const write = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
        x = options.left;
        y = options.top;
      });
      return {
        write,
        read: () => [x, y],
        move(left, top) {
          x = left;
          y = top;
        },
      };
    }

    it('undoes modal focus jumps on open and preserves fresh page/container positions on close', () => {
      const { player, parent, video } = makeController();
      const scroll = scrollingWindow();
      const outer = document.createElement('section');
      document.body.append(outer);
      outer.append(parent);
      outer.scrollLeft = 20;
      outer.scrollTop = 400;
      parent.scrollLeft = 12;
      parent.scrollTop = 200;
      const focus = document.createElement('button');
      parent.prepend(focus);
      focus.focus();
      vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function () {
        this.open = true;
        scroll.move(0, 0);
        outer.scrollLeft = outer.scrollTop = 0;
        parent.scrollLeft = parent.scrollTop = 0;
      });
      player.attach();
      expect(player.open()).toBe(true);
      expect(scroll.read()).toEqual([25, 650]);
      expect([outer.scrollLeft, outer.scrollTop, parent.scrollLeft, parent.scrollTop]).toEqual([
        20, 400, 12, 200,
      ]);
      // Deliberate scrolling while the owned player is open must survive exit.
      scroll.move(80, 950);
      outer.scrollLeft = 45;
      outer.scrollTop = 550;
      parent.scrollLeft = 35;
      parent.scrollTop = 350;
      vi.spyOn(focus, 'focus').mockImplementation(() => {
        scroll.move(0, 0);
        outer.scrollLeft = outer.scrollTop = 0;
        parent.scrollLeft = parent.scrollTop = 0;
      });
      player.close();
      expect(scroll.read()).toEqual([80, 950]);
      expect([outer.scrollLeft, outer.scrollTop, parent.scrollLeft, parent.scrollTop]).toEqual([
        45, 550, 35, 350,
      ]);
      expect(scroll.write).toHaveBeenLastCalledWith({ left: 80, top: 950, behavior: 'instant' });
      expect(video.parentNode).toBe(parent);
      player.cleanup();
      outer.remove();
    });

    it('restores the native-entry snapshot after fullscreen ends without changing the media session', () => {
      const { player, parent, video, stream } = makeController();
      const scroll = scrollingWindow();
      parent.scrollLeft = 15;
      parent.scrollTop = 260;
      video.webkitEnterFullscreen = vi.fn(() => {
        scroll.move(0, 0);
        parent.scrollLeft = parent.scrollTop = 0;
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
      });
      player.attach();
      expect(player.enterNativeFullscreen()).toBe(true);
      expect(scroll.read()).toEqual([0, 0]);
      video.dispatchEvent(new Event('webkitendfullscreen'));
      expect(scroll.read()).toEqual([25, 650]);
      expect([parent.scrollLeft, parent.scrollTop]).toEqual([15, 260]);
      expect(video.srcObject).toBe(stream);
      expect(video.currentTime).toBe(12.5);
      expect(player.nativeScroll).toBeNull();
    });

    it('does not invent a scroll snapshot from an unsolicited native begin after Safari has jumped', () => {
      const { player, video } = makeController();
      const scroll = scrollingWindow();
      player.attach();
      // No extension request preceded this event; Safari/site presentation has
      // already moved the viewport before announcing the native transition.
      scroll.move(0, 0);
      video.dispatchEvent(new Event('webkitbeginfullscreen'));
      expect(player.nativeScroll ?? null).toBeNull();
      scroll.move(25, 720);
      scroll.write.mockClear();
      video.dispatchEvent(new Event('webkitendfullscreen'));
      expect(scroll.read()).toEqual([25, 720]);
      expect(scroll.write).not.toHaveBeenCalled();
      expect(player.active).toBe(false);
    });

    it('does not resample custom-player scroll after external native entry has already jumped', () => {
      const { player, video } = makeController();
      const scroll = scrollingWindow(25, 720);
      player.attach();
      player.open();
      expect(player.active).toBe(true);
      scroll.move(0, 0);
      video.dispatchEvent(new Event('webkitbeginfullscreen'));
      expect(player.active).toBe(false);
      expect(player.nativeScroll ?? null).toBeNull();
      scroll.move(25, 720);
      scroll.write.mockClear();
      video.dispatchEvent(new Event('webkitendfullscreen'));
      expect(scroll.read()).toEqual([25, 720]);
      expect(scroll.write).not.toHaveBeenCalled();
    });

    it.each(['emptied', 'loadstart'])(
      'does not invent stale scroll from late native begin/end after %s',
      (eventType) => {
        const { player, video } = makeController();
        const scroll = scrollingWindow();
        video.webkitEnterFullscreen = vi.fn();
        player.attach();
        player.enterNativeFullscreen();
        video.srcObject = { feedItem: 'replacement' };
        video.dispatchEvent(new Event(eventType));
        // Events queued by the old media presentation can arrive after reset.
        scroll.move(0, 0);
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
        expect(player.nativeScroll ?? null).toBeNull();
        scroll.move(25, 720);
        scroll.write.mockClear();
        video.dispatchEvent(new Event('webkitendfullscreen'));
        expect(scroll.read()).toEqual([25, 720]);
        expect(scroll.write).not.toHaveBeenCalled();
        expect(player.active).toBe(false);
      }
    );

    it('ignores stale native rejections and restores only the current attempt snapshot', async () => {
      const { player, video } = makeController();
      const scroll = scrollingWindow();
      const rejections = [];
      video.requestFullscreen = vi.fn(
        () => new Promise((_resolve, reject) => rejections.push(reject))
      );
      player.attach();
      player.enterNativeFullscreen();
      scroll.move(70, 970);
      player.enterNativeFullscreen();
      scroll.move(0, 0);
      rejections[0](new Error('older attempt denied'));
      await flushEvents();
      expect(scroll.read()).toEqual([0, 0]);
      expect(player.nativeSession).toBe(true);
      rejections[1](new Error('current attempt denied'));
      await flushEvents();
      expect(scroll.read()).toEqual([70, 970]);
      expect(player.nativeSession).toBe(false);
    });

    it('preserves newer scrolling after genuine wheel input cancels held Apple recovery', async () => {
      const { player, video, parent } = makeController();
      const scroll = scrollingWindow();
      parent.scrollTop = 230;
      let reject;
      video.webkitEnterFullscreen = vi.fn(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          })
      );
      player.attach();
      player.open();
      const add = vi.spyOn(window, 'addEventListener');
      expect(player.enterNativeFullscreen()).toBe(true);
      const recovery = player.nativeRecovery;
      const wheel = add.mock.calls.find(
        ([type, , options]) => type === 'wheel' && options === true
      )?.[1];
      expect(wheel).toBe(recovery.cancel);
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(player.nativeRecovery).toBe(recovery);
      // jsdom cannot synthesize trusted input; invoke the actual registered guard.
      wheel({ type: 'wheel', isTrusted: true });
      expect(player.nativeRecovery).toBeNull();
      scroll.move(70, 970);
      parent.scrollTop = 900;
      scroll.write.mockClear();
      const reopen = vi.spyOn(player, 'open');
      reject(new Error('Apple denied after scrolling'));
      await flushEvents();
      expect(reopen).not.toHaveBeenCalled();
      expect(player.active).toBe(false);
      expect(player.nativeSession).toBe(false);
      expect(player.nativeScroll).toBeNull();
      expect(scroll.read()).toEqual([70, 970]);
      expect(parent.scrollTop).toBe(900);
      expect(scroll.write).not.toHaveBeenCalled();
      expect(document.querySelector('vsc-ios-player')).toBeNull();
    });

    it('restores a synchronous denied native attempt and cancels all scroll callbacks on cleanup', () => {
      const { player, video } = makeController();
      const scroll = scrollingWindow();
      const queue = new Map();
      let id = 0;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        queue.set(++id, callback);
        return id;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => queue.delete(key));
      video.webkitEnterFullscreen = vi.fn(() => {
        scroll.move(0, 0);
        throw new Error('denied');
      });
      player.attach();
      expect(player.enterNativeFullscreen()).toBe(false);
      expect(scroll.read()).toEqual([25, 650]);
      expect(queue.size).toBe(1);
      player.cleanup();
      expect(queue.size).toBe(0);
      scroll.move(90, 1000);
      video.dispatchEvent(new Event('webkitendfullscreen'));
      expect(scroll.read()).toEqual([90, 1000]);
    });
  });

  it('accepts a custom speed without overwriting typing during playback updates', () => {
    const { player, video, controller } = makeController();
    player.attach();
    player.open();
    const { speed, customSpeed, customSpeedGroup, customSpeedApply } = player.ui.refs;
    speed.value = 'custom';
    speed.dispatchEvent(new Event('change'));
    expect(customSpeedGroup.hidden).toBe(false);
    expect(customSpeed.value).toBe('1.5');
    customSpeed.value = '3.25';
    video.dispatchEvent(new Event('timeupdate'));
    expect(customSpeed.value).toBe('3.25');
    customSpeedApply.click();
    expect(controller.actionHandler.setSpeed).toHaveBeenCalledWith(video, 3.25, 'user');
    expect(customSpeedGroup.hidden).toBe(true);
    expect(speed.value).toBe('3.25');
    expect(video.playbackRate).toBe(3.25);
  });

  it('validates custom speed and preserves the actual rate when the browser declines it', () => {
    const { player, video, controller } = makeController();
    player.attach();
    player.open();
    const { speed, customSpeed, customSpeedGroup, customSpeedApply, status } = player.ui.refs;
    speed.value = 'custom';
    speed.dispatchEvent(new Event('change'));
    for (const value of ['', '0', '-1', '17']) {
      customSpeed.value = value;
      customSpeedApply.click();
    }
    expect(controller.actionHandler.setSpeed).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/Enter a speed/);
    expect(customSpeedGroup.hidden).toBe(false);
    controller.actionHandler.setSpeed.mockReturnValue(false);
    customSpeed.value = '4.25';
    customSpeed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(status.textContent).toMatch(/could not use/);
    expect(video.playbackRate).toBe(1.5);
    expect(speed.value).toBe('1.5');
    expect(customSpeedGroup.hidden).toBe(false);
  });

  it('renders the accepted rate when a browser clamps the custom request', () => {
    const { player, video, controller } = makeController();
    player.attach();
    player.open();
    controller.actionHandler.setSpeed.mockImplementation((media) => {
      media.playbackRate = 2;
      return true;
    });
    player.applySpeed(4);
    expect(video.playbackRate).toBe(2);
    expect(player.ui.refs.speed.value).toBe('2');
    expect(player.ui.refs.status.textContent).toBe('This video accepted 2×.');
  });

  it('keeps custom speed and More exclusive and dismisses the custom sheet before the dialog', () => {
    const { player, controller } = makeController();
    controller.controlsManager = { setTouchExpanded: vi.fn() };
    player.attach();
    player.open();
    expect(controller.controlsManager.setTouchExpanded).toHaveBeenCalledWith(
      controller.div.shadowRoot,
      false
    );
    const { speed, customSpeed, customSpeedGroup, extra, more } = player.ui.refs;
    more.click();
    expect(extra.hidden).toBe(false);
    speed.value = 'custom';
    speed.dispatchEvent(new Event('change'));
    expect(extra.hidden).toBe(true);
    expect(customSpeedGroup.hidden).toBe(false);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    customSpeed.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(customSpeedGroup.hidden).toBe(true);
    expect(player.ui.shadow.activeElement).toBe(speed);
    expect(player.active).toBe(true);
    speed.value = 'custom';
    speed.dispatchEvent(new Event('change'));
    more.click();
    expect(extra.hidden).toBe(false);
    expect(customSpeedGroup.hidden).toBe(true);
  });

  it('supports iPhone and desktop-mode iPad video, but leaves desktop and audio alone', () => {
    const { video } = makeController();
    expect(window.VSC.IOSPlayer.isSupported(video)).toBe(true);
    setPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5);
    expect(window.VSC.IOSPlayer.isSupported(video)).toBe(true);
    setPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0);
    expect(window.VSC.IOSPlayer.isSupported(video)).toBe(false);
    const desktop = makeController();
    desktop.player.attach();
    expect(desktop.video.controls).toBe(true);
    expect(desktop.video.hasAttribute('playsinline')).toBe(false);
    expect(desktop.video.hasAttribute('webkit-playsinline')).toBe(false);
    expect(desktop.div.shadowRoot.querySelector('button')).toBeNull();
    setPlatform();
    const audio = makeController('audio');
    expect(window.VSC.IOSPlayer.isSupported(audio.video)).toBe(false);
    audio.player.attach();
    expect(audio.video.controls).toBe(true);
    expect(audio.video.hasAttribute('playsinline')).toBe(false);
    expect(audio.video.hasAttribute('webkit-playsinline')).toBe(false);
    expect(audio.div.shadowRoot.querySelector('button')).toBeNull();
  });

  it('adds one explicit custom entry point while preserving native controls and inline playback', () => {
    const { player, video, div } = makeController();
    player.attach();
    player.attach();
    const buttons = div.shadowRoot.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Custom player');
    expect(buttons[0].getAttribute('aria-label') || buttons[0].textContent).toMatch(
      /Open StayFast player/i
    );
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(player.active).toBe(false);
  });

  describe('inline policy while the video remains controlled', () => {
    it('adds missing inline flags before ordinary play without touching controls, source or native APIs', async () => {
      const { player, video, controller, parent, stream } = makeController();
      const enter = vi.fn();
      video.webkitEnterFullscreen = enter;
      const descriptor = Object.getOwnPropertyDescriptor(video, 'webkitEnterFullscreen');
      const source = video.getAttribute('src');
      player.attach();
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
      expect(video.controls).toBe(true);
      expect(Object.getOwnPropertyDescriptor(video, 'webkitEnterFullscreen')).toEqual(descriptor);
      await video.play();
      video.dispatchEvent(new Event('playing'));
      await flushEvents();
      expect(player.active).toBe(false);
      expect(document.querySelector('vsc-ios-player')).toBeNull();
      expect(video.parentNode).toBe(parent);
      expect(video.srcObject).toBe(stream);
      expect(video.getAttribute('src')).toBe(source);
      expect(video.currentTime).toBe(12.5);
      expect(video.playbackRate).toBe(1.5);
      expect(enter).not.toHaveBeenCalled();
      expect(controller.remove).not.toHaveBeenCalled();
    });

    it('keeps inline flags through custom close and explicit native fullscreen, then restores missing originals on cleanup', () => {
      const { player, video } = makeController();
      video.webkitEnterFullscreen = vi.fn(() => {
        expect(video.playsInline).toBe(true);
        expect(video.hasAttribute('webkit-playsinline')).toBe(true);
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
      });
      player.attach();
      player.open();
      player.close();
      expect(video.playsInline).toBe(true);
      expect(video.controls).toBe(true);
      expect(player.enterNativeFullscreen()).toBe(true);
      video.dispatchEvent(new Event('webkitendfullscreen'));
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
      expect(player.active).toBe(false);
      player.cleanup();
      expect(video.hasAttribute('playsinline')).toBe(false);
      expect(video.hasAttribute('webkit-playsinline')).toBe(false);
    });

    it('preserves existing inline attribute values and later site edits on cleanup', async () => {
      const { player, video } = makeController();
      video.setAttribute('playsinline', 'site-inline');
      video.setAttribute('webkit-playsinline', 'site-webkit');
      player.attach();
      video.setAttribute('playsinline', 'site-updated');
      video.setAttribute('webkit-playsinline', 'site-webkit-updated');
      await flushEvents();
      player.open();
      player.close();
      player.cleanup();
      expect(video.getAttribute('playsinline')).toBe('site-updated');
      expect(video.getAttribute('webkit-playsinline')).toBe('site-webkit-updated');
    });

    it('remembers a site removal as handback intent while temporarily enforcing inline playback', async () => {
      const { player, video } = makeController();
      video.setAttribute('playsinline', 'site-inline');
      video.setAttribute('webkit-playsinline', 'site-webkit');
      player.attach();
      video.removeAttribute('playsinline');
      video.removeAttribute('webkit-playsinline');
      await flushEvents();
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
      player.cleanup();
      expect(video.hasAttribute('playsinline')).toBe(false);
      expect(video.hasAttribute('webkit-playsinline')).toBe(false);
    });

    it('does not overwrite synchronous site edits when cleanup runs before observer delivery', () => {
      const { player, video } = makeController();
      player.attach();
      video.setAttribute('playsinline', 'new-site-value');
      video.removeAttribute('webkit-playsinline');
      player.cleanup();
      expect(video.getAttribute('playsinline')).toBe('new-site-value');
      expect(video.hasAttribute('webkit-playsinline')).toBe(false);
    });

    it('preserves a site claim of the same inline-presence value before observer delivery', () => {
      const { player, video } = makeController();
      player.attach();
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      player.cleanup();
      expect(video.hasAttribute('playsinline')).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
    });

    it('hands back after bounded inline conflicts without disposing or dropping the controller', async () => {
      const { player, video, controller, div } = makeController();
      player.attach();
      for (let attempt = 0; attempt < 12; attempt++) {
        video.removeAttribute('playsinline');
        await flushEvents();
      }
      expect(video.hasAttribute('playsinline')).toBe(false);
      expect(player.attached).toBe(true);
      expect(player.disposed).toBe(false);
      expect(video.vsc).toBe(controller);
      expect(controller.remove).not.toHaveBeenCalled();
      expect(div.shadowRoot.querySelector('button')).not.toBeNull();
      video.dispatchEvent(new Event('playing'));
      await flushEvents();
      expect(video.hasAttribute('playsinline')).toBe(false);
      expect(player.active).toBe(false);
      expect(video.currentTime).toBe(12.5);
    });

    it('rearms inline policy for a new source and for an explicit custom-player selection', async () => {
      const { player, video } = makeController();
      player.attach();
      for (let attempt = 0; attempt < 12; attempt++) {
        video.removeAttribute('playsinline');
        await flushEvents();
      }
      expect(video.playsInline).toBe(false);
      video.dispatchEvent(new Event('emptied'));
      expect(video.playsInline).toBe(true);
      for (let attempt = 0; attempt < 12; attempt++) {
        video.removeAttribute('playsinline');
        await flushEvents();
      }
      expect(video.playsInline).toBe(false);
      player.button.click();
      expect(player.active).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
      player.close();
      expect(video.playsInline).toBe(true);
    });

    it('restores site intent on Use site player and reclaims inline policy only on explicit custom entry', async () => {
      const { player, video } = makeController();
      player.attach();
      player.open();
      player.restoreSitePlayer();
      expect(video.hasAttribute('playsinline')).toBe(false);
      expect(video.hasAttribute('webkit-playsinline')).toBe(false);
      video.dispatchEvent(new Event('playing'));
      await flushEvents();
      expect(video.playsInline).toBe(false);
      player.button.click();
      expect(player.active).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('webkit-playsinline')).toBe(true);
    });
  });

  it('keeps the original video, source/session references, position and speed through an open/close cycle', async () => {
    const { player, video, controller, parent, before, after, stream } = makeController();
    const source = video.getAttribute('src');
    const style = video.getAttribute('style');
    const load = vi.spyOn(video, 'load');
    player.attach();
    await player.open();
    expect(player.active).toBe(true);
    expect(player.ui.host.contains(video)).toBe(true);
    expect(video.vsc).toBe(controller);
    expect(video.getAttribute('src')).toBe(source);
    expect(video.srcObject).toBe(stream);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(load).not.toHaveBeenCalled();

    player.close();
    expect(player.active).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.previousSibling).toBe(before);
    expect(video.nextSibling).toBe(after);
    expect(video.getAttribute('style')).toBe(style);
    expect(video.getAttribute('src')).toBe(source);
    expect(video.srcObject).toBe(stream);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.vsc).toBe(controller);
  });

  it('routes speed and seek actions only to the owned video', async () => {
    const { player, video, controller } = makeController();
    const other = makeController();
    player.attach();
    await player.open();
    const { speed, back, forward } = player.ui.refs;
    speed.value = '2';
    speed.dispatchEvent(new Event('change', { bubbles: true }));
    back.click();
    forward.click();
    expect(controller.actionHandler.setSpeed).toHaveBeenCalledWith(video, 2, 'user');
    expect(controller.actionHandler.seek).toHaveBeenNthCalledWith(1, video, -10);
    expect(controller.actionHandler.seek).toHaveBeenNthCalledWith(2, video, 10);
    expect(other.video.playbackRate).toBe(1.5);
    expect(other.video.currentTime).toBe(12.5);
    expect(other.controller.actionHandler.setSpeed).not.toHaveBeenCalled();
  });

  it('keeps normal and preferred speed absolute, reads current preferences, and targets only this video', () => {
    const { player, video, controller } = makeController();
    const other = makeController();
    let preferred = 1.8;
    controller.config.getKeyBinding = () => preferred;
    player.attach();
    player.open();
    player.ui.refs.preferred.click();
    expect(video.playbackRate).toBe(1.8);
    preferred = 2.4;
    player.ui.refs.preferred.click();
    expect(video.playbackRate).toBe(2.4);
    player.ui.refs.normal.click();
    player.ui.refs.normal.click();
    expect(video.playbackRate).toBe(1);
    preferred = undefined;
    player.ui.refs.preferred.click();
    expect(video.playbackRate).toBe(1);
    expect(other.video.playbackRate).toBe(1.5);
    expect(other.controller.actionHandler.setSpeed).not.toHaveBeenCalled();
    expect(controller.actionHandler.setSpeed).toHaveBeenLastCalledWith(video, 1, 'user');
  });

  it('changes only caption/subtitle tracks and preserves hidden streaming metadata', async () => {
    const { player, video } = makeController();
    const metadata = { kind: 'metadata', label: 'Ad markers', language: '', mode: 'hidden' };
    const chapters = { kind: 'chapters', label: 'Chapters', language: 'en', mode: 'hidden' };
    const subtitles = { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' };
    const descriptions = {
      kind: 'descriptions',
      label: 'Description',
      language: 'en',
      mode: 'hidden',
    };
    const tracks = [metadata, chapters, subtitles, descriptions];
    const trackList = new EventTarget();
    Object.assign(trackList, tracks, { length: tracks.length });
    trackList[Symbol.iterator] = () => tracks[Symbol.iterator]();
    Object.defineProperty(video, 'textTracks', { configurable: true, value: trackList });
    player.attach();
    await player.open();
    const menu = player.ui.refs.captions;
    expect([...menu.options].map((option) => option.textContent)).toEqual([
      'Captions off',
      'English',
    ]);
    menu.value = [...menu.options].find((option) => option.textContent === 'English').value;
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    expect(subtitles.mode).toBe('showing');
    expect(metadata.mode).toBe('hidden');
    expect(chapters.mode).toBe('hidden');
    expect(descriptions.mode).toBe('hidden');

    menu.value = 'off';
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    expect(subtitles.mode).toBe('disabled');
    expect(metadata.mode).toBe('hidden');
    expect(chapters.mode).toBe('hidden');
    expect(descriptions.mode).toBe('hidden');
  });

  it('restores owned longhand styles while retaining a site change to one side', async () => {
    const { player, video } = makeController();
    video.style.margin = '3px 4px 5px 6px';
    video.style.padding = '7px 8px 9px 10px';
    player.attach();
    await player.open();
    video.style.setProperty('margin-left', '19px', 'important');
    video.style.setProperty('padding-right', '21px', 'important');
    player.close();

    expect(video.style.marginTop).toBe('3px');
    expect(video.style.marginRight).toBe('4px');
    expect(video.style.marginBottom).toBe('5px');
    expect(video.style.marginLeft).toBe('19px');
    expect(video.style.paddingTop).toBe('7px');
    expect(video.style.paddingRight).toBe('21px');
    expect(video.style.paddingBottom).toBe('9px');
    expect(video.style.paddingLeft).toBe('10px');
  });

  it.each([
    ['close', false],
    ['cleanup', false],
    ['close', true],
    ['cleanup', true],
  ])(
    'owns touch-action only during presentation and restores it on %s (container=%s)',
    (end, container) => {
      const { player, video, parent } = makeController();
      if (container) {
        parent.classList.add('plyr');
      }
      video.style.setProperty('touch-action', 'pan-y', 'important');
      parent.style.setProperty('touch-action', 'manipulation');
      player.attach();
      expect(video.style.getPropertyValue('touch-action')).toBe('pan-y');
      player.open();
      expect(player.portalNode).toBe(container ? parent : video);
      expect(video.style.getPropertyValue('touch-action')).toBe('none');
      expect(video.style.getPropertyPriority('touch-action')).toBe('important');
      expect(parent.style.getPropertyValue('touch-action')).toBe(
        container ? 'none' : 'manipulation'
      );
      expect(parent.style.getPropertyPriority('touch-action')).toBe(container ? 'important' : '');
      player[end]();
      expect(video.style.getPropertyValue('touch-action')).toBe('pan-y');
      expect(video.style.getPropertyPriority('touch-action')).toBe('important');
      expect(parent.style.getPropertyValue('touch-action')).toBe('manipulation');
      expect(parent.style.getPropertyPriority('touch-action')).toBe('');
    }
  );

  it.each(['close', 'cleanup'])('preserves later site touch-action edits on %s', (end) => {
    const { player, video, parent } = makeController();
    parent.classList.add('plyr');
    player.attach();
    player.open();
    video.style.setProperty('touch-action', 'manipulation');
    parent.style.setProperty('touch-action', 'pan-y', 'important');
    player[end]();
    expect(video.style.getPropertyValue('touch-action')).toBe('manipulation');
    expect(video.style.getPropertyPriority('touch-action')).toBe('');
    expect(parent.style.getPropertyValue('touch-action')).toBe('pan-y');
    expect(parent.style.getPropertyPriority('touch-action')).toBe('important');
  });

  it('ignores a rejected playback promise belonging to a closed presentation', async () => {
    const { player, video } = makeController();
    let rejectOldPlay;
    video.play.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOldPlay = reject;
        })
    );
    player.attach();
    player.open({ play: true });
    player.close();
    player.open({ play: true });
    expect(video.paused).toBe(false);
    rejectOldPlay(new DOMException('Old playback was interrupted', 'AbortError'));
    await flushEvents();

    expect(player.active).toBe(true);
    expect(player.ui.refs.status.textContent).toBe('');
    expect(player.ui.refs.play.getAttribute('aria-label')).toBe('Pause video');
  });

  it('keeps playing and video clicks inline until custom player is explicitly chosen', async () => {
    const { player, video, parent } = makeController();
    await video.play();
    player.attach();
    video.dispatchEvent(new Event('playing'));
    const siteClick = vi.fn();
    video.addEventListener('click', siteClick);
    video.click();
    await flushEvents();
    expect(player.active).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.controls).toBe(true);
    expect(siteClick).toHaveBeenCalledOnce();
    player.button.click();
    expect(player.active).toBe(true);
    expect(video.controls).toBe(false);
    player.close();
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it('leaves native controls intact when a PiP return is refused by another custom player', () => {
    const first = makeController();
    const second = makeController();
    first.player.attach();
    second.player.attach();
    first.player.open();
    first.video.webkitPresentationMode = 'picture-in-picture';
    first.video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(first.video.controls).toBe(true);
    expect(first.player.active).toBe(false);
    second.player.open();
    const descriptor = Object.getOwnPropertyDescriptor(first.video, 'webkitEnterFullscreen');
    first.video.webkitPresentationMode = 'inline';
    first.video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(first.player.active).toBe(false);
    expect(first.player.mediaPrepared).toBe(false);
    expect(first.player.attributeObserver).toBeFalsy();
    expect(first.video.controls).toBe(true);
    expect(first.video.parentNode).toBe(first.parent);
    expect(Object.getOwnPropertyDescriptor(first.video, 'webkitEnterFullscreen')).toEqual(
      descriptor
    );
    expect(second.player.active).toBe(true);
  });

  it('allows only one active owned player per document and restores the previous video', async () => {
    const first = makeController();
    const second = makeController();
    first.player.attach();
    second.player.attach();
    await first.player.open();
    const oldHost = first.player.ui.host;
    await second.player.open();
    expect(first.player.active).toBe(false);
    expect(first.video.parentNode).toBe(first.parent);
    expect(oldHost.isConnected).toBe(false);
    expect(second.player.active).toBe(true);
    expect(second.video.vsc).toBe(second.controller);
  });

  it('opens fullscreen in the owned viewport without calling a captured Apple API', () => {
    const { player, video, stream, controller } = makeController();
    const native = vi.fn();
    const enter = vi
      .spyOn(window.VSC.IOSPlayerFullscreen.prototype, 'enter')
      .mockReturnValue(false);
    video.webkitEnterFullscreen = native;
    player.attach();
    expect(player.open({ fullscreen: true })).toBe(true);
    expect(player.active).toBe(true);
    expect(player.ui.host.isConnected).toBe(true);
    expect(player.ui.host.contains(video)).toBe(true);
    expect(video.vsc).toBe(controller);
    expect(video.srcObject).toBe(stream);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(native).not.toHaveBeenCalled();
    expect(player.nativeSession).not.toBe(true);
    expect(enter).toHaveBeenCalledExactlyOnceWith(expect.any(window.VSC.IOSPlayerScrollState));
  });

  it('opens owned fullscreen without native APIs or loaded metadata', () => {
    const { player, video } = makeController();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'webkitSupportsFullscreen', { configurable: true, value: false });
    player.attach();
    expect(player.canEnterNativeFullscreen()).toBe(false);
    expect(player.open({ fullscreen: true })).toBe(true);
    expect(player.active).toBe(true);
    expect(player.ui.refs.native.hidden).toBe(true);
    expect(player.ui.host.contains(video)).toBe(true);
  });

  it('reveals the explicit Apple player when metadata makes native fullscreen available', () => {
    const { player, video, stream } = makeController();
    const native = vi.fn();
    video.webkitEnterFullscreen = native;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'webkitSupportsFullscreen', { configurable: true, value: true });
    player.attach();
    player.open();
    const ui = player.ui;
    expect(ui.refs.native.hidden).toBe(true);
    expect(player.canEnterNativeFullscreen()).toBe(false);

    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(player.ui).toBe(ui);
    expect(ui.refs.native.hidden).toBe(false);
    expect(player.canEnterNativeFullscreen()).toBe(true);
    expect(native).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(stream);
    player.toggleMore(true);
    ui.refs.native.click();
    expect(native).toHaveBeenCalledOnce();
    expect(player.active).toBe(false);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.srcObject).toBe(stream);
  });

  it('keeps the owned session when its Full screen control has no container API', () => {
    const { player, video } = makeController();
    video.webkitEnterFullscreen = vi.fn();
    player.attach();
    player.open();
    const host = player.ui.host;
    const toggle = vi.spyOn(player.ownedFullscreen, 'toggle').mockReturnValue(false);
    expect(player.requestFullscreen()).toBe(false);
    expect(toggle).toHaveBeenCalledOnce();
    expect(player.active).toBe(true);
    expect(player.ui.host).toBe(host);
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
    expect(player.nativeSession).not.toBe(true);
  });

  it('enters original native fullscreen synchronously without an intermediate custom presentation', () => {
    const { player, video, parent, stream, controller } = makeController();
    const original = vi.fn(function () {
      expect(this).toBe(video);
      expect(video.parentNode).toBe(parent);
      expect(video.controls).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(document.querySelector('vsc-ios-player')).toBeNull();
    });
    video.webkitEnterFullscreen = original;
    const descriptor = Object.getOwnPropertyDescriptor(video, 'webkitEnterFullscreen');
    player.attach();
    expect(Object.getOwnPropertyDescriptor(video, 'webkitEnterFullscreen')).toEqual(descriptor);
    expect(player.enterNativeFullscreen()).toBe(true);
    expect(original).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.srcObject).toBe(stream);
    expect(video.play).not.toHaveBeenCalled();
    const exit = vi.fn();
    video.webkitExitFullscreen = exit;
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    video.dispatchEvent(new Event('webkitendfullscreen'));
    video.dispatchEvent(new Event('playing'));
    expect(exit).not.toHaveBeenCalled();
    expect(player.active).toBe(false);
    expect(controller.repairDOMPlacement).toHaveBeenCalled();
    player.cleanup();
    expect(Object.getOwnPropertyDescriptor(video, 'webkitEnterFullscreen')).toEqual(descriptor);
  });

  it('restores custom presentation before native entry and keeps the saved browser method', () => {
    const { player, video, parent } = makeController();
    const original = vi.fn(() => {
      expect(video.parentNode).toBe(parent);
      expect(video.controls).toBe(true);
      expect(player.active).toBe(false);
    });
    video.webkitEnterFullscreen = original;
    player.attach();
    player.open();
    expect(player.ui.refs.native.hidden).toBe(false);
    const laterSiteMethod = vi.fn();
    video.webkitEnterFullscreen = laterSiteMethod;
    player.toggleMore(true);
    player.ui.refs.native.click();
    expect(original).toHaveBeenCalledOnce();
    expect(laterSiteMethod).not.toHaveBeenCalled();
    expect(video.webkitEnterFullscreen).toBe(laterSiteMethod);
    expect(player.active).toBe(false);
  });

  it.each(['webkitEnterFullScreen', 'webkitSetPresentationMode', 'requestFullscreen'])(
    'supports native fallback %s without replacing page methods',
    (name) => {
      const { player, video } = makeController();
      video[name] = vi.fn();
      player.attach();
      expect(player.enterNativeFullscreen()).toBe(true);
      expect(video[name]).toHaveBeenCalledWith(
        ...(name === 'webkitSetPresentationMode' ? ['fullscreen'] : [])
      );
      expect(player.active).toBe(false);
    }
  );

  it.each(['unsupported', 'throw', 'reject'])(
    'keeps owned entry labels and availability after an explicit Apple failure (%s)',
    async (mode) => {
      const { player, video, div, stream } = makeController();
      const src = video.src;
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'inline-fullscreen';
      primary.dataset.action = 'ownedFullscreen';
      primary.title = 'Open StayFast fullscreen player';
      primary.setAttribute('aria-label', 'Open video fullscreen');
      div.shadowRoot.querySelector('#controls').append(primary);
      if (mode !== 'unsupported') {
        video.webkitEnterFullscreen = vi.fn(() => {
          if (mode === 'throw') {
            throw new Error('Apple player denied');
          }
          return Promise.reject(new Error('Apple player denied'));
        });
      }
      player.attach();
      const attributes = Object.fromEntries(
        [...primary.attributes].map(({ name, value }) => [name, value])
      );
      const ownedEntryTitle = player.button.getAttribute('title');
      player.open();
      player.enterNativeFullscreen();
      await flushEvents();
      expect(player.nativeFullscreenError).toMatch(/Apple fullscreen is unavailable/);
      expect(player.active).toBe(true);
      expect(player.ui.host.isConnected).toBe(true);
      expect(player.ui.refs.status.textContent).toBe(player.nativeFullscreenError);
      expect(player.ui.refs.status.getAttribute('role')).toBe('status');
      expect(player.ui.host.contains(video)).toBe(true);
      expect(video.play).not.toHaveBeenCalled();
      expect(video.srcObject).toBe(stream);
      expect(video.src).toBe(src);
      expect(video.currentTime).toBe(12.5);
      expect(video.playbackRate).toBe(1.5);
      if (mode !== 'unsupported') {
        expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
      }
      expect(
        Object.fromEntries([...primary.attributes].map(({ name, value }) => [name, value]))
      ).toEqual(attributes);
      expect(primary.disabled).toBe(false);
      expect(primary.getAttribute('aria-description')).toBeNull();
      expect(player.button.getAttribute('title')).toBe(ownedEntryTitle);
      expect(player.open({ fullscreen: true })).toBe(true);
      expect(player.active).toBe(true);
      expect(player.ui.host.contains(video)).toBe(true);
    }
  );

  it('leaves an inline-origin native denial inline and ignores late events after cleanup', async () => {
    const { player, video, parent } = makeController();
    let reject;
    video.requestFullscreen = vi.fn(
      () =>
        new Promise((resolve, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    player.attach();
    expect(player.enterNativeFullscreen()).toBe(true);
    reject(new Error('NotAllowedError'));
    await flushEvents();
    expect(player.nativeSession).toBe(false);
    expect(video.controls).toBe(true);
    expect(video.parentNode).toBe(parent);
    player.cleanup();
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    video.dispatchEvent(new Event('webkitendfullscreen'));
    expect(player.enterNativeFullscreen()).toBe(false);
    expect(player.active).toBe(false);
  });

  it.each([
    'close',
    'reopen',
    'reopen-close',
    'other-player',
    'other-player-close',
    'cleanup',
    'pagehide',
    'popstate',
    'pushState',
    'replaceState',
    'root',
    'emptied',
    'loadstart',
    'src',
    'srcObject',
    'currentSrc',
    'source-getter',
    'detach',
    'native-begin',
  ])(
    'does not recover a denied Apple request after newer intent or source ownership: %s',
    async (change) => {
      const originalRoot = document.documentElement;
      const originalURL = document.URL;
      const { player, video } = makeController();
      const other = makeController();
      other.player.attach();
      let reject;
      video.webkitEnterFullscreen = vi.fn(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          })
      );
      player.attach();
      player.open();
      const session = player.session;
      expect(player.enterNativeFullscreen()).toBe(true);
      expect(player.active).toBe(false);
      if (change === 'close') {
        player.close();
      } else if (change === 'reopen' || change === 'reopen-close') {
        player.open();
        if (change === 'reopen-close') {
          player.close();
        }
      } else if (change === 'other-player' || change === 'other-player-close') {
        other.player.open();
        if (change === 'other-player-close') {
          other.player.close();
        }
      } else if (change === 'cleanup') {
        player.cleanup();
      } else if (change === 'pagehide' || change === 'popstate') {
        window.dispatchEvent(new Event(change));
      } else if (change === 'pushState' || change === 'replaceState') {
        window.history[change]({}, '', `${window.location.pathname}?native-recovery=${change}`);
      } else if (change === 'root') {
        const replacement = document.createElement('html');
        replacement.append(document.head, document.body);
        document.replaceChild(replacement, document.documentElement);
      } else if (change === 'emptied' || change === 'loadstart') {
        video.dispatchEvent(new Event(change));
      } else if (change === 'src') {
        video.src = 'https://media.example.test/new.mp4';
      } else if (change === 'srcObject') {
        video.srcObject = { replacement: true };
      } else if (change === 'currentSrc') {
        Object.defineProperty(video, 'currentSrc', {
          configurable: true,
          value: 'https://media.example.test/new.mp4',
        });
      } else if (change === 'source-getter') {
        Object.defineProperty(video, 'srcObject', {
          configurable: true,
          get() {
            throw new Error('unavailable');
          },
        });
      } else if (change === 'detach') {
        video.remove();
      } else if (change === 'native-begin') {
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
      }
      const open = vi.spyOn(player, 'open');
      const fullscreen = vi.spyOn(window.VSC.IOSPlayerFullscreen.prototype, 'enter');
      const activePlayer = window.VSC.IOSPlayer.activePlayers.get(document);
      reject(new Error('late Apple denial'));
      await flushEvents();
      expect(open).not.toHaveBeenCalled();
      expect(fullscreen).not.toHaveBeenCalled();
      expect(window.VSC.IOSPlayer.activePlayers.get(document)).toBe(activePlayer);
      expect(player.session).toBe(change.startsWith('reopen') ? session + 1 : session);
      expect(player.nativeFullscreenError).toBe('');
      expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
      expect(video.play).not.toHaveBeenCalled();
      if (change === 'pushState' || change === 'replaceState') {
        window.history.replaceState({}, '', originalURL);
      } else if (change === 'root') {
        originalRoot.append(document.head, document.body);
        document.replaceChild(originalRoot, document.documentElement);
      }
    }
  );

  it.each(['pointerdown', 'touchstart', 'keydown', 'wheel'])(
    'releases pending recovery guards after genuine %s intent',
    async (type) => {
      const { player, video } = makeController();
      let reject;
      video.webkitEnterFullscreen = vi.fn(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          })
      );
      player.attach();
      player.open();
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      player.enterNativeFullscreen();
      const cancel = player.nativeRecovery.cancel;
      expect(add).toHaveBeenCalledWith(type, cancel, true);
      // Programmatically dispatched events cannot stand in for fresh user intent.
      window.dispatchEvent(new Event(type));
      expect(player.nativeRecovery).not.toBeNull();
      // jsdom cannot construct trusted DOM events; exercise the registered handler.
      cancel({ isTrusted: true });
      expect(player.nativeRecovery).toBeNull();
      for (const input of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
        expect(remove).toHaveBeenCalledWith(input, cancel, true);
      }
      reject(new Error('denied after newer input'));
      await flushEvents();
      expect(player.active).toBe(false);
      expect(player.nativeSession).toBe(false);
      expect(document.querySelector('vsc-ios-player')).toBeNull();
    }
  );

  it.each(['resolve', 'reject', 'cleanup'])(
    'removes pending recovery input listeners on %s',
    async (settle) => {
      const { player, video } = makeController();
      let resolve;
      let reject;
      video.webkitEnterFullscreen = vi.fn(
        () =>
          new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
          })
      );
      player.attach();
      player.open();
      const remove = vi.spyOn(window, 'removeEventListener');
      player.enterNativeFullscreen();
      const cancel = player.nativeRecovery.cancel;
      if (settle === 'resolve') {
        resolve();
      } else if (settle === 'reject') {
        reject(new Error('denied'));
      } else {
        player.cleanup();
      }
      await flushEvents();
      expect(player.nativeRecovery).toBeNull();
      for (const input of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
        expect(remove).toHaveBeenCalledWith(input, cancel, true);
        expect(
          remove.mock.calls.filter(([type, listener]) => type === input && listener === cancel)
        ).toHaveLength(1);
      }
      if (settle === 'reject') {
        expect(player.active).toBe(true);
        expect(player.ui.refs.status.textContent).toMatch(/Apple fullscreen is unavailable/);
      } else {
        expect(player.active).toBe(false);
      }
    }
  );

  it('does not let a native begin observer take over the owned viewport', async () => {
    const { player, video } = makeController();
    player.attach();
    const open = vi.spyOn(player, 'open');
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
    video.dispatchEvent(new Event('webkitendfullscreen'));
    await flushEvents();
    expect(open).not.toHaveBeenCalled();
    expect(player.active).toBe(false);
    expect(document.querySelector('vsc-ios-player')).toBeNull();
  });

  it('handles missing, throwing or detached native fullscreen APIs without opening a modal', () => {
    const missing = makeController();
    missing.player.attach();
    expect(missing.player.enterNativeFullscreen()).toBe(false);
    const failing = makeController();
    failing.video.webkitEnterFullscreen = vi.fn(() => {
      throw new Error('denied');
    });
    failing.player.attach();
    expect(failing.player.enterNativeFullscreen()).toBe(false);
    expect(failing.video.controls).toBe(true);
    failing.video.remove();
    expect(failing.player.enterNativeFullscreen()).toBe(false);
    expect(failing.video.webkitEnterFullscreen).toHaveBeenCalledOnce();
    expect(document.querySelector('vsc-ios-player')).toBeNull();
  });

  it('waits for native readiness and tries a synchronous fallback without losing the gesture', () => {
    const { player, video } = makeController();
    video.webkitEnterFullscreen = vi.fn(() => {
      throw new Error('unsupported entry');
    });
    video.webkitSetPresentationMode = vi.fn();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    player.attach();
    expect(player.canEnterNativeFullscreen()).toBe(false);
    expect(player.enterNativeFullscreen()).toBe(false);
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'webkitSupportsFullscreen', { configurable: true, value: false });
    expect(player.canEnterNativeFullscreen()).toBe(false);
    Object.defineProperty(video, 'webkitSupportsFullscreen', { configurable: true, value: true });
    expect(player.enterNativeFullscreen()).toBe(true);
    expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
    expect(video.webkitSetPresentationMode).toHaveBeenCalledWith('fullscreen');
    expect(player.nativeFullscreenError).toBe('');
  });

  it('restores attributes, styles and listeners on repeatable cleanup', async () => {
    const { player, video, div, parent } = makeController();
    const attributes = Object.fromEntries(
      [...video.attributes].map(({ name, value }) => [name, value])
    );
    player.attach();
    await player.open();
    const host = player.ui.host;
    player.cleanup();
    player.cleanup();
    expect(
      Object.fromEntries([...video.attributes].map(({ name, value }) => [name, value]))
    ).toEqual(attributes);
    expect(video.parentNode).toBe(parent);
    expect(host.isConnected).toBe(false);
    expect(div.shadowRoot.querySelector('button')).toBeNull();
    video.dispatchEvent(new Event('playing'));
    await flushEvents();
    expect(player.active).toBe(false);
  });

  it('offers an escape to site controls without automatically reclaiming the next play', async () => {
    const { player, video, parent } = makeController();
    player.attach();
    await player.open();
    player.restoreSitePlayer();
    expect(player.active).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.controls).toBe(true);
    video.dispatchEvent(new Event('playing'));
    await flushEvents();
    expect(player.active).toBe(false);
  });

  it('keeps direct native fullscreen and explicit custom entry usable after site-player handback', () => {
    const { player, video, parent } = makeController();
    video.webkitEnterFullscreen = vi.fn();
    player.attach();
    player.open();
    player.restoreSitePlayer();
    expect(player.attached).toBe(true);
    expect(player.disposed).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.controls).toBe(true);
    video.dispatchEvent(new Event('playing'));
    expect(player.active).toBe(false);
    expect(player.canEnterNativeFullscreen()).toBe(true);
    expect(player.enterNativeFullscreen()).toBe(true);
    expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event('webkitendfullscreen'));
    player.button.click();
    expect(player.active).toBe(true);
    expect(video.controls).toBe(false);
    expect(window.VSC.IOSPlayer.siteRelinquished.has(video)).toBe(false);
  });

  it('hands back control after a bounded fight with a site repeatedly restoring native controls', async () => {
    const { player, video, div } = makeController();
    player.attach();
    await player.open();
    for (let attempt = 0; attempt < 12; attempt++) {
      video.controls = true;
      await flushEvents();
    }

    expect(player.active).toBe(false);
    expect(player.attached).toBe(false);
    expect(video.controls).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(false);
    expect(div.shadowRoot.querySelector('button')).toBeNull();
    video.dispatchEvent(new Event('playing'));
    await flushEvents();
    expect(player.active).toBe(false);
  });

  it('hands back the viewport during PiP and restores ownership only when PiP returns inline', async () => {
    const { player, video, parent, controller } = makeController();
    Object.defineProperty(video, 'webkitPresentationMode', {
      configurable: true,
      writable: true,
      value: 'inline',
    });
    video.webkitSupportsPresentationMode = (mode) => mode === 'picture-in-picture';
    const present = vi.fn((mode) => {
      video.webkitPresentationMode = mode;
      video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    });
    video.webkitSetPresentationMode = present;
    player.attach();
    await player.open({ play: true });
    const source = video.src;
    expect(player.ui.refs.pip.hidden).toBe(false);
    player.ui.refs.pip.click();
    expect(present).toHaveBeenCalledWith('picture-in-picture');
    expect(player.active).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.src).toBe(source);
    expect(video.vsc).toBe(controller);

    video.webkitPresentationMode = 'inline';
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(player.active).toBe(true);
    expect(video.vsc).toBe(controller);
    video.webkitPresentationMode = 'picture-in-picture';
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    player.cleanup();
    video.webkitPresentationMode = 'inline';
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    expect(player.active).toBe(false);
  });

  describe('recycled feed media cannot inherit a previous source presentation', () => {
    function replaceFeedSource(video, eventType = 'emptied') {
      video.srcObject = { feedItem: 'replacement' };
      video.src = 'https://media.example.test/next-feed-item.mp4';
      video.dispatchEvent(new Event(eventType));
    }

    it.each(['emptied', 'loadstart'])(
      'does not reopen a recycled video from an earlier source PiP return after %s',
      (eventType) => {
        const { player, video, parent } = makeController();
        Object.defineProperty(video, 'webkitPresentationMode', {
          configurable: true,
          writable: true,
          value: 'inline',
        });
        player.attach();
        player.open();
        video.webkitPresentationMode = 'picture-in-picture';
        video.dispatchEvent(new Event('webkitpresentationmodechanged'));
        expect(player.active).toBe(false);
        replaceFeedSource(video, eventType);
        video.webkitPresentationMode = 'inline';
        video.dispatchEvent(new Event('webkitpresentationmodechanged'));
        expect(player.active).toBe(false);
        expect(video.parentNode).toBe(parent);
        expect(document.querySelector('vsc-ios-player')).toBeNull();
      }
    );

    it.each(['emptied', 'loadstart'])(
      'does not reopen a new feed source on pageshow using an earlier custom session flag after %s',
      async (eventType) => {
        const { player, video, parent } = makeController();
        player.attach();
        player.open({ play: true });
        window.dispatchEvent(new Event('pagehide'));
        expect(player.active).toBe(false);
        replaceFeedSource(video, eventType);
        await video.play();
        window.dispatchEvent(new Event('pageshow'));
        expect(player.active).toBe(false);
        expect(video.parentNode).toBe(parent);
        expect(document.querySelector('vsc-ios-player')).toBeNull();
      }
    );

    it.each(['emptied', 'loadstart'])(
      'does not replay an old native fullscreen scroll snapshot after feed source replacement on %s',
      (eventType) => {
        const { player, video } = makeController();
        let y = 0;
        vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
          y = options.top;
        });
        video.webkitEnterFullscreen = vi.fn();
        player.attach();
        player.enterNativeFullscreen();
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
        replaceFeedSource(video, eventType);
        y = 720;
        video.dispatchEvent(new Event('webkitendfullscreen'));
        expect(y).toBe(720);
        expect(player.active).toBe(false);
      }
    );
    it.each(['emptied', 'loadstart'])(
      'returns an active custom player inline at the current page position after %s',
      (eventType) => {
        const { player, video, parent, controller } = makeController();
        let y = 100;
        vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
          y = options.top;
        });
        player.attach();
        player.open({ play: true });
        const oldHost = player.ui.host;
        // The feed advances while this original element is reused. Handback must
        // keep this current position even if restoring focus would move to top.
        y = 720;
        const focus = player.focusBeforeOpen;
        vi.spyOn(focus, 'focus').mockImplementation(() => {
          y = 0;
        });
        replaceFeedSource(video, eventType);
        expect(player.active).toBe(false);
        expect(oldHost.isConnected).toBe(false);
        expect(video.parentNode).toBe(parent);
        expect(video.controls).toBe(true);
        expect(video.playsInline).toBe(true);
        expect(y).toBe(720);
        expect(video.vsc).toBe(controller);
        expect(controller.remove).not.toHaveBeenCalled();
        expect(video.pause).not.toHaveBeenCalled();
      }
    );

    it.each(['emptied', 'loadstart'])(
      'ignores a late native rejection from the old source after %s',
      async (eventType) => {
        const { player, video } = makeController();
        let y = 0;
        vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        const scroll = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
          y = options.top;
        });
        let reject;
        video.requestFullscreen = vi.fn(
          () =>
            new Promise((_resolve, rejectPromise) => {
              reject = rejectPromise;
            })
        );
        player.attach();
        expect(player.enterNativeFullscreen()).toBe(true);
        replaceFeedSource(video, eventType);
        y = 720;
        scroll.mockClear();
        reject(new Error('Old source fullscreen denied'));
        await flushEvents();
        expect(y).toBe(720);
        expect(scroll).not.toHaveBeenCalled();
        expect(player.nativeSession).toBe(false);
        expect(player.active).toBe(false);
        expect(player.nativeFullscreenError).toBe('');
      }
    );

    it('retains same-source history return for an explicitly chosen custom player', async () => {
      const { player, video, stream } = makeController();
      player.attach();
      player.open({ play: true });
      const source = video.src;
      window.dispatchEvent(new Event('pagehide'));
      expect(player.active).toBe(false);
      window.dispatchEvent(new Event('pageshow'));
      await flushEvents();
      expect(player.active).toBe(true);
      expect(player.ui.host.contains(video)).toBe(true);
      expect(video.src).toBe(source);
      expect(video.srcObject).toBe(stream);
    });
  });

  it('hides system presentation controls when media explicitly disables PiP or remote playback', () => {
    const { player, video } = makeController();
    const present = vi.fn();
    video.webkitSetPresentationMode = present;
    video.webkitSupportsPresentationMode = () => true;
    video.webkitShowPlaybackTargetPicker = vi.fn();
    Object.defineProperty(video, 'disablePictureInPicture', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(video, 'disableRemotePlayback', {
      configurable: true,
      value: true,
    });
    video.setAttribute('disablepictureinpicture', '');
    video.setAttribute('disableremoteplayback', '');
    player.attach();
    player.open();

    expect(player.ui.refs.pip.hidden).toBe(true);
    expect(player.ui.refs.airplay.hidden).toBe(true);
    expect(present).not.toHaveBeenCalled();
    expect(video.webkitShowPlaybackTargetPicker).not.toHaveBeenCalled();
  });

  it('switches between fit and cropped fill while restoring the original media styling', () => {
    const { player, video } = makeController();
    video.style.setProperty('object-fit', 'scale-down', 'important');
    const originalStyle = video.getAttribute('style');
    player.attach();
    player.open();
    const { fit } = player.ui.refs;

    expect(video.style.getPropertyValue('object-fit')).toBe('contain');
    expect(fit.getAttribute('aria-pressed')).toBe('false');
    fit.click();
    expect(video.style.getPropertyValue('object-fit')).toBe('cover');
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    fit.click();
    expect(video.style.getPropertyValue('object-fit')).toBe('contain');
    fit.click();
    player.close();

    expect(video.getAttribute('style')).toBe(originalStyle);
    expect(video.style.getPropertyPriority('object-fit')).toBe('important');
    expect(video.playbackRate).toBe(1.5);
  });

  it('toggles finite remaining media time and presents live streams without a false countdown', () => {
    const { player, video } = makeController();
    player.attach();
    player.open();
    const { duration } = player.ui.refs;
    expect(duration.textContent).toBe('2:00');
    expect(duration.disabled).toBe(false);

    duration.click();
    expect(duration.textContent).toBe('−1:47');
    expect(duration.getAttribute('aria-label')).toMatch(/total duration/i);
    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    expect(duration.textContent).toBe('−1:30');
    expect(video.playbackRate).toBe(1.5);
    duration.click();
    expect(duration.textContent).toBe('2:00');

    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    video.dispatchEvent(new Event('durationchange'));
    expect(duration.textContent).toBe('LIVE');
    expect(duration.disabled).toBe(true);
    duration.click();
    expect(duration.textContent).toBe('LIVE');
  });

  it('selects exposed native audio tracks without altering captions, metadata or the media session', () => {
    const { player, video, stream } = makeController();
    const english = { id: 'en', label: 'English', language: 'en', enabled: true };
    const spanish = { id: 'es', label: 'Spanish', language: 'es', enabled: false };
    const audioTracks = Object.assign(new EventTarget(), {
      0: english,
      1: spanish,
      length: 2,
    });
    const captions = { kind: 'captions', label: 'English CC', mode: 'showing' };
    const metadata = { kind: 'metadata', label: 'Site events', mode: 'hidden' };
    Object.defineProperty(video, 'audioTracks', { configurable: true, value: audioTracks });
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: [captions, metadata],
    });
    const source = video.src;
    const load = vi.spyOn(video, 'load');
    player.attach();
    player.open();
    const { audio } = player.ui.refs;
    expect(audio.hidden).toBe(false);
    expect(Array.from(audio.options, (option) => option.textContent)).toEqual([
      'English',
      'Spanish',
    ]);
    expect(audio.value).toBe('0');
    audio.value = '1';
    audio.dispatchEvent(new Event('change', { bubbles: true }));

    expect(english.enabled).toBe(false);
    expect(spanish.enabled).toBe(true);
    expect(captions.mode).toBe('showing');
    expect(metadata.mode).toBe('hidden');
    expect(video.src).toBe(source);
    expect(video.srcObject).toBe(stream);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(1.5);
    expect(load).not.toHaveBeenCalled();

    audioTracks.length = 1;
    delete audioTracks[1];
    audioTracks.dispatchEvent(new Event('removetrack'));
    expect(audio.hidden).toBe(true);
  });

  it('opens and closes More accessibly and consumes Escape before dismissing the player', () => {
    const { player } = makeController();
    player.attach();
    player.open();
    const { more, extra, fit } = player.ui.refs;
    expect(extra.hidden).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-controls')).toBe(extra.id);
    more.click();
    expect(extra.hidden).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    more.click();
    expect(extra.hidden).toBe(true);
    more.click();
    fit.focus();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    fit.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(player.active).toBe(true);
    expect(extra.hidden).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(player.ui.shadow.activeElement).toBe(more);
  });

  it('isolates owned-stage touches from site players without cancelling Safari clicks or outside touches', () => {
    const { player, video, parent } = makeController();
    const container = document.createElement('div');
    container.className = 'video-js';
    parent.insertBefore(container, video);
    container.append(video);
    const siteVideoTouch = vi.fn();
    const siteContainerTouch = vi.fn();
    const outsideTouch = vi.fn();
    video.addEventListener('touchend', siteVideoTouch);
    container.addEventListener('touchend', siteContainerTouch);
    const outside = document.createElement('button');
    parent.append(outside);
    outside.addEventListener('touchend', outsideTouch);
    player.attach();
    player.open();

    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      const touch = new Event(type, { bubbles: true, composed: true, cancelable: true });
      video.dispatchEvent(touch);
      expect(touch.defaultPrevented).toBe(false);
    }
    expect(siteVideoTouch).not.toHaveBeenCalled();
    expect(siteContainerTouch).not.toHaveBeenCalled();
    const outsideEvent = new Event('touchend', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    outside.dispatchEvent(outsideEvent);
    expect(outsideTouch).toHaveBeenCalledOnce();
    expect(outsideEvent.defaultPrevented).toBe(false);

    // Keep the discarded subtree to verify its guard is actually unsubscribed,
    // in addition to checking the restored site's normal event path.
    const stage = player.ui.stage;
    const stageParent = stage.parentNode;
    const stageBubble = vi.fn();
    stageParent.addEventListener('touchend', stageBubble);
    const stageTarget = document.createElement('span');
    stage.append(stageTarget);
    stageTarget.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(stageBubble).not.toHaveBeenCalled();
    player.cleanup();
    stageTarget.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(stageBubble).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(siteVideoTouch).toHaveBeenCalledOnce();
    expect(siteContainerTouch).toHaveBeenCalledOnce();
  });

  describe('seek feedback', () => {
    it('reports actual clamped movement and resets the total when direction changes', () => {
      vi.useFakeTimers();
      try {
        const { player, video } = makeController();
        player.attach();
        player.open();
        const { forward, back, seekFeedback } = player.ui.refs;
        video.currentTime = 118;
        forward.click();
        expect(video.currentTime).toBe(120);
        expect(seekFeedback.textContent).toBe('+2s');
        expect(seekFeedback.dataset.side).toBe('right');
        expect(seekFeedback.hidden).toBe(false);
        forward.click();
        expect(video.currentTime).toBe(120);
        expect(seekFeedback.textContent).toBe('+2s');
        back.click();
        expect(video.currentTime).toBe(110);
        expect(seekFeedback.textContent).toBe('−10s');
        expect(seekFeedback.dataset.side).toBe('left');
        back.click();
        expect(seekFeedback.textContent).toBe('−20s');
        expect(video.playbackRate).toBe(1.5);
        expect(video.play).not.toHaveBeenCalled();
        expect(video.pause).not.toHaveBeenCalled();
        player.cleanup();
      } finally {
        vi.useRealTimers();
      }
    });

    it('accumulates consecutive seeks and restarts its bounded dismissal timer', () => {
      vi.useFakeTimers();
      try {
        const { player } = makeController();
        player.attach();
        player.open();
        const { forward, seekFeedback } = player.ui.refs;
        forward.click();
        expect(seekFeedback.textContent).toBe('+10s');
        vi.advanceTimersByTime(600);
        forward.click();
        expect(seekFeedback.textContent).toBe('+20s');
        vi.advanceTimersByTime(799);
        expect(seekFeedback.hidden).toBe(false);
        vi.advanceTimersByTime(1);
        expect(seekFeedback.hidden).toBe(true);
        expect(player.seekFeedbackTimer).toBeNull();
        player.cleanup();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears feedback on lock and close without carrying totals into a new session', () => {
      vi.useFakeTimers();
      try {
        const { player, video, controller } = makeController();
        player.attach();
        player.open();
        let refs = player.ui.refs;
        refs.forward.click();
        refs.lock.click();
        expect(refs.seekFeedback.hidden).toBe(true);
        expect(player.seekFeedbackTimer).toBeNull();
        const before = video.currentTime;
        controller.actionHandler.seek.mockClear();
        refs.forward.click();
        expect(controller.actionHandler.seek).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(before);
        expect(refs.seekFeedback.hidden).toBe(true);
        refs.unlock.click();
        refs.forward.click();
        expect(refs.seekFeedback.textContent).toBe('+10s');
        player.close();
        expect(player.seekFeedbackTimer).toBeNull();
        expect(refs.seekFeedback.hidden).toBe(true);
        player.open();
        refs = player.ui.refs;
        refs.forward.click();
        expect(refs.seekFeedback.textContent).toBe('+10s');
        vi.advanceTimersByTime(800);
        expect(refs.seekFeedback.hidden).toBe(true);
        player.cleanup();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('playback control lock', () => {
    function touch(stage, type, id, x, y) {
      const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
      Object.assign(event, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
      stage.dispatchEvent(event);
    }

    it.each([180, 220])(
      'does not reinterpret center touch pairs at x=%s as browser double-click seeks',
      (x) => {
        const { player, video, controller } = makeController();
        const now = vi.spyOn(window.performance, 'now').mockReturnValue(100);
        player.attach();
        player.open();
        const { stage } = player.ui;
        stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
        for (const id of [1, 2]) {
          now.mockReturnValue(id * 100);
          touch(stage, 'pointerdown', id, x, 100);
          touch(stage, 'pointerup', id, x, 100);
          // Safari may synthesize both ordinary clicks before the dblclick.
          stage.dispatchEvent(
            new MouseEvent('click', { bubbles: true, composed: true, clientX: x })
          );
        }
        stage.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            composed: true,
            cancelable: true,
            clientX: x,
          })
        );
        expect(controller.actionHandler.seek).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(12.5);
        expect(video.playbackRate).toBe(1.5);
        expect(player.active).toBe(true);
      }
    );

    it('locks the HUD and stage gestures without pausing, seeking, changing rate or replacing media', async () => {
      const { player, controller, video, stream } = makeController();
      player.attach();
      player.open({ play: true });
      await Promise.resolve();
      const { host, stage, refs, shadow } = player.ui;
      const pause = video.pause;
      const play = video.play;
      const fit = vi.spyOn(player, 'setFit');
      const ratechange = vi.fn();
      video.addEventListener('ratechange', ratechange);
      pause.mockClear();
      play.mockClear();
      refs.lock.click();
      expect(player.controlsLocked).toBe(true);
      expect(host.hasAttribute('data-controls-locked')).toBe(true);
      expect(shadow.querySelector('.hud').inert).toBe(true);
      expect(refs.unlock.hidden).toBe(false);
      const hidden = host.hasAttribute('data-controls-hidden');
      stage.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      stage.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, composed: true, clientX: 300 })
      );
      touch(stage, 'pointerdown', 1, 50, 50);
      touch(stage, 'pointerdown', 2, 150, 50);
      touch(stage, 'pointermove', 2, 250, 50);
      touch(stage, 'pointerup', 1, 50, 50);
      touch(stage, 'pointerup', 2, 250, 50);
      expect(player.controlsLocked).toBe(true);
      expect(host.hasAttribute('data-controls-hidden')).toBe(hidden);
      expect(fit).not.toHaveBeenCalled();
      expect(controller.actionHandler.seek).not.toHaveBeenCalled();
      expect(controller.actionHandler.setSpeed).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(ratechange).not.toHaveBeenCalled();
      expect(video.paused).toBe(false);
      expect(video.currentTime).toBe(12.5);
      expect(video.playbackRate).toBe(1.5);
      expect(video.srcObject).toBe(stream);
      expect(video.vsc).toBe(controller);
      video.removeEventListener('ratechange', ratechange);
    });

    it('cancels an active queued scrub on Lock and accepts a fresh scrub after Unlock', async () => {
      window.VSC_controller.teardown();
      vi.useFakeTimers();
      const { player, video, controller } = makeController();
      try {
        player.attach();
        player.open();
        await video.play();
        const { refs } = player.ui;
        const scrubber = player.scrubber;
        refs.seek.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          width: 120,
          height: 44,
        });
        refs.seek.setPointerCapture = vi.fn();
        refs.seek.releasePointerCapture = vi.fn((pointerId) => {
          touch(refs.seek, 'lostpointercapture', pointerId, 32.5, 22);
        });
        video.play.mockClear();
        video.pause.mockClear();
        controller.actionHandler.seek.mockClear();
        touch(refs.seek, 'pointerdown', 7, 12.5, 22);
        touch(window, 'pointermove', 7, 32.5, 22);
        expect(video.pause).toHaveBeenCalledOnce();
        expect(video.paused).toBe(true);
        expect(scrubber.active).toBe(true);
        expect(scrubber.pending).toBe(32.5);
        expect(controller.actionHandler.seek).not.toHaveBeenCalled();

        refs.lock.click();
        expect(player.controlsLocked).toBe(true);
        expect(scrubber.active).toBe(false);
        expect(refs.seek.releasePointerCapture).toHaveBeenCalledWith(7);
        vi.advanceTimersByTime(60);
        touch(window, 'pointermove', 7, 82.5, 22);
        touch(window, 'pointerup', 7, 82.5, 22);
        // A delayed native range event also cannot bypass the locked seek path.
        refs.seek.value = '90';
        refs.seek.dispatchEvent(new Event('input', { bubbles: true }));
        refs.seek.dispatchEvent(new Event('change', { bubbles: true }));
        expect(controller.actionHandler.seek).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(12.5);
        expect(video.play).not.toHaveBeenCalled();
        expect(video.paused).toBe(true);

        refs.unlock.click();
        touch(window, 'pointerup', 7, 82.5, 22);
        expect(video.play).not.toHaveBeenCalled();
        expect(controller.actionHandler.seek).not.toHaveBeenCalled();
        // Playback and a new pointer establish fresh intent after unlocking.
        await video.play();
        video.play.mockClear();
        touch(refs.seek, 'pointerdown', 8, 12.5, 22);
        touch(window, 'pointermove', 8, 22.5, 22);
        vi.advanceTimersByTime(50);
        expect(video.currentTime).toBe(22.5);
        expect(controller.actionHandler.seek).toHaveBeenCalledExactlyOnceWith(video, 10);
        touch(window, 'pointerup', 8, 22.5, 22);
        expect(video.play).toHaveBeenCalledOnce();
        expect(video.paused).toBe(false);
        expect(video.playbackRate).toBe(1.5);
      } finally {
        player.cleanup();
        vi.useRealTimers();
      }
    });

    it('focuses the separate unlock target and returns focus without scrolling before Done restores the page', () => {
      const { player, parent } = makeController();
      const previous = document.createElement('button');
      parent.append(previous);
      previous.focus();
      const pageFocus = vi.spyOn(previous, 'focus');
      player.attach();
      player.open();
      const { refs, shadow } = player.ui;
      const unlockFocus = vi.spyOn(refs.unlock, 'focus');
      const lockFocus = vi.spyOn(refs.lock, 'focus');
      refs.lock.click();
      expect(unlockFocus).toHaveBeenCalledWith({ preventScroll: true });
      expect(shadow.activeElement).toBe(refs.unlock);
      refs.unlock.click();
      expect(player.controlsLocked).toBe(false);
      expect(shadow.querySelector('.hud').inert).toBe(false);
      expect(refs.unlock.hidden).toBe(true);
      expect(lockFocus).toHaveBeenCalledWith({ preventScroll: true });
      expect(shadow.activeElement).toBe(refs.lock);
      refs.done.click();
      expect(player.active).toBe(false);
      expect(player.controlsLocked).toBe(false);
      expect(document.activeElement).toBe(previous);
      expect(pageFocus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('unlocks through window shortcut capture even when Escape is a custom playback binding', () => {
      window.VSC_controller.teardown();
      const { player, video, controller } = makeController();
      player.attach();
      player.open();
      player.ui.refs.lock.click();
      const runAction = vi.fn();
      const manager = new window.VSC.EventManager(
        {
          settings: {
            ...controller.config.settings,
            exclusiveKeys: true,
            keyBindings: [{ code: 'Escape', action: 'reset', value: 1 }],
          },
        },
        { runAction }
      );
      const media = vi
        .spyOn(window.VSC.stateManager, 'getControlledElements')
        .mockReturnValue([video]);
      const keydown = vi.spyOn(manager, 'handleKeydown');
      manager.setupKeyboardShortcuts(document);
      try {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        player.ui.refs.unlock.dispatchEvent(event);
        expect(keydown).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
        expect(player.controlsLocked).toBe(false);
        expect(player.active).toBe(true);
        expect(player.ui.shadow.activeElement).toBe(player.ui.refs.lock);
        expect(runAction).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(12.5);
        expect(video.playbackRate).toBe(1.5);
      } finally {
        manager.cleanup();
        media.mockRestore();
        keydown.mockRestore();
      }
    });

    it.each([
      ['Enter', 'Enter'],
      [' ', 'Space'],
      ['Tab', 'Tab'],
    ])('preserves Unlock keyboard activation/navigation for a custom %s binding', (key, code) => {
      window.VSC_controller.teardown();
      const { player, video, controller } = makeController();
      player.attach();
      player.open();
      player.ui.refs.lock.click();
      const { refs, shadow } = player.ui;
      expect(shadow.activeElement).toBe(refs.unlock);
      const runAction = vi.fn();
      const manager = new window.VSC.EventManager(
        {
          settings: {
            ...controller.config.settings,
            exclusiveKeys: true,
            keyBindings: [{ code, action: 'reset', value: 1 }],
          },
        },
        { runAction }
      );
      const media = vi
        .spyOn(window.VSC.stateManager, 'getControlledElements')
        .mockReturnValue([video]);
      const keydown = vi.spyOn(manager, 'handleKeydown');
      const targetKey = vi.fn();
      refs.unlock.addEventListener('keydown', targetKey);
      manager.setupKeyboardShortcuts(document);
      try {
        const event = new KeyboardEvent('keydown', {
          key,
          code,
          bubbles: true,
          composed: true,
          cancelable: true,
        });
        expect(refs.unlock.dispatchEvent(event)).toBe(true);
        expect(keydown).toHaveBeenCalledOnce();
        expect(targetKey).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(false);
        expect(runAction).not.toHaveBeenCalled();
        expect(player.controlsLocked).toBe(true);
        refs.unlock.dispatchEvent(
          new KeyboardEvent('keyup', { key, code, bubbles: true, composed: true })
        );
        // jsdom omits the browser's keyboard default activation/focus steps.
        // The uncanceled event above leaves them available; exercise the same
        // native button activation path to verify the resulting owned unlock.
        refs.unlock.click();
        expect(player.controlsLocked).toBe(false);
        expect(player.active).toBe(true);
        expect(shadow.activeElement).toBe(refs.lock);
        expect(video.currentTime).toBe(12.5);
        expect(video.playbackRate).toBe(1.5);
      } finally {
        manager.cleanup();
        media.mockRestore();
        keydown.mockRestore();
      }
    });

    it.each(['Escape', 'cancel'])(
      'unlocks first on %s and keeps the owned player open',
      (method) => {
        const { player } = makeController();
        player.attach();
        player.open();
        player.ui.refs.lock.click();
        const event =
          method === 'Escape'
            ? new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                composed: true,
                cancelable: true,
              })
            : new Event('cancel', { cancelable: true });
        (method === 'Escape' ? player.ui.refs.unlock : player.ui.dialog).dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(player.controlsLocked).toBe(false);
        expect(player.active).toBe(true);
        expect(player.ui.host.hasAttribute('data-controls-locked')).toBe(false);
      }
    );

    it.each(['close', 'cleanup', 'emptied', 'loadstart', 'picture-in-picture'])(
      'clears lock ownership on %s',
      (method) => {
        const { player, video } = makeController();
        player.attach();
        player.open();
        player.ui.refs.lock.click();
        expect(player.controlsLocked).toBe(true);
        if (method === 'close' || method === 'cleanup') {
          player[method]();
        } else if (method === 'picture-in-picture') {
          video.webkitPresentationMode = 'picture-in-picture';
          video.dispatchEvent(new Event('webkitpresentationmodechanged'));
        } else {
          video.dispatchEvent(new Event(method));
        }
        expect(player.active).toBe(false);
        expect(player.controlsLocked).toBe(false);
        if (method !== 'cleanup') {
          if (method === 'picture-in-picture') {
            video.webkitPresentationMode = 'inline';
            video.dispatchEvent(new Event('webkitpresentationmodechanged'));
          } else {
            player.open();
          }
          expect(player.active).toBe(true);
          expect(player.controlsLocked).toBe(false);
          expect(player.ui.host.hasAttribute('data-controls-locked')).toBe(false);
          expect(player.ui.shadow.querySelector('.hud').inert).toBeFalsy();
        }
      }
    );
  });

  it('keeps the HUD hidden through a delayed control blur and lets a subsequent stage tap wake it', () => {
    const { player } = makeController();
    player.attach();
    player.open();
    const { host, stage, refs } = player.ui;
    refs.duration.focus();
    expect(player.ui.shadow.activeElement).toBe(refs.duration);
    stage.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    );
    expect(host.hasAttribute('data-controls-hidden')).toBe(true);

    // Safari can deliver this after the stage's blur-and-hide handler returns.
    refs.duration.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: stage })
    );
    expect(host.hasAttribute('data-controls-hidden')).toBe(true);
    stage.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    );
    expect(host.hasAttribute('data-controls-hidden')).toBe(false);
    expect(player.active).toBe(true);
  });

  it('seeks Go live to the current playable edge without escaping a changing live window', () => {
    const { player, video, controller } = makeController();
    let end = 200;
    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 100, end: () => end },
    });
    video.currentTime = 150;
    player.attach();
    player.open();
    const { live, duration } = player.ui.refs;
    expect(duration.textContent).toBe('LIVE');
    expect(live.hidden).toBe(false);
    expect(live.disabled).toBe(false);
    live.click();
    expect(video.currentTime).toBeCloseTo(199.9);
    expect(controller.actionHandler.seek).toHaveBeenLastCalledWith(video, expect.any(Number));

    end = 160;
    video.currentTime = 150;
    video.dispatchEvent(new Event('durationchange'));
    live.click();
    expect(video.currentTime).toBeCloseTo(159.9);
    expect(video.currentTime).toBeGreaterThanOrEqual(100);
    expect(video.currentTime).toBeLessThanOrEqual(end);
  });

  it('rewinds and replays only the captured ended video', () => {
    const { player, video, controller, stream } = makeController();
    const other = makeController();
    Object.defineProperty(video, 'ended', { configurable: true, value: true });
    video.currentTime = 120;
    const source = video.src;
    player.attach();
    player.open();
    expect(player.ui.refs.play.textContent).toBe('Replay');
    expect(player.ui.refs.play.getAttribute('aria-label')).toBe('Replay video');
    player.ui.refs.play.click();

    expect(controller.actionHandler.seek).toHaveBeenCalledWith(video, -120);
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.src).toBe(source);
    expect(video.srcObject).toBe(stream);
    expect(video.playbackRate).toBe(1.5);
    expect(other.video.play).not.toHaveBeenCalled();
    expect(other.video.currentTime).toBe(12.5);
  });

  it('exposes volume only when the platform reports it unlocked and reflects the muted state', () => {
    const { player, video } = makeController();
    const cssDescriptor = Object.getOwnPropertyDescriptor(window, 'CSS');
    let supported = false;
    let locked = false;
    const supports = vi.fn(() => supported);
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { supports },
    });
    vi.spyOn(video, 'matches').mockImplementation((selector) =>
      selector === ':volume-locked' ? locked : false
    );
    try {
      video.volume = 0.6;
      player.attach();
      player.open();
      const { volume } = player.ui.refs;
      expect(volume.hidden).toBe(true);
      expect(supports).toHaveBeenCalledWith('selector(:volume-locked)');

      supported = true;
      locked = true;
      video.dispatchEvent(new Event('volumechange'));
      expect(volume.hidden).toBe(true);
      locked = false;
      video.dispatchEvent(new Event('volumechange'));
      expect(volume.hidden).toBe(false);
      expect(Number(volume.value)).toBe(0.6);
      video.muted = true;
      video.dispatchEvent(new Event('volumechange'));
      expect(Number(volume.value)).toBe(0);
      volume.value = '0.4';
      volume.dispatchEvent(new Event('input', { bubbles: true }));
      expect(video.volume).toBe(0.4);
      expect(video.muted).toBe(false);

      locked = true;
      volume.value = '0.9';
      volume.dispatchEvent(new Event('input', { bubbles: true }));
      expect(video.volume).toBe(0.4);
    } finally {
      if (cssDescriptor) {
        Object.defineProperty(window, 'CSS', cssDescriptor);
      } else {
        delete window.CSS;
      }
    }
  });

  it('rechecks PiP and AirPlay restrictions at click time when the site changes flags after opening', () => {
    const { player, video } = makeController();
    const present = vi.fn();
    const airplay = vi.fn();
    video.webkitSetPresentationMode = present;
    video.webkitSupportsPresentationMode = () => true;
    video.webkitShowPlaybackTargetPicker = airplay;
    player.attach();
    player.open();
    const { pip, airplay: airplayButton } = player.ui.refs;
    expect(pip.hidden).toBe(false);
    expect(airplayButton.hidden).toBe(false);

    video.setAttribute('disablepictureinpicture', '');
    video.setAttribute('disableremoteplayback', '');
    pip.click();
    airplayButton.click();
    expect(present).not.toHaveBeenCalled();
    expect(airplay).not.toHaveBeenCalled();
    expect(player.active).toBe(true);
  });

  it('shows a recoverable play state when Safari rejects playback', async () => {
    const { player, video } = makeController();
    video.play.mockRejectedValue(new DOMException('A gesture is required', 'NotAllowedError'));
    player.attach();
    await player.open({ play: true });
    await flushEvents();
    expect(player.active).toBe(true);
    expect(player.ui.refs.status.textContent).not.toBe('');
    expect(player.ui.refs.play.disabled).toBe(false);
    expect(video.paused).toBe(true);
  });

  it('ends the owned session when its original page anchor disappears', async () => {
    const { player, video, parent, controller } = makeController();
    controller.remove.mockImplementation(() => {
      // Match real VideoController.remove(): observer reconciliation must see
      // the expando cleared rather than repeatedly disposing the same media.
      player.cleanup();
      delete video.vsc;
      controller.div.remove();
    });
    player.attach();
    await player.open();
    const host = player.ui.host;
    const anchor = [...parent.childNodes].find((node) => node.nodeType === Node.COMMENT_NODE);
    expect(anchor).toBeDefined();
    anchor.remove();
    await flushEvents();
    expect(player.active).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(controller.remove).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('never resurrects a portaled video removed by the site during observer disposal', async () => {
    const { player, video, parent, controller } = makeController();
    controller.remove.mockImplementation(() => {
      player.cleanup();
      delete video.vsc;
      controller.div.remove();
    });
    player.attach();
    await player.open();
    const host = player.ui.host;
    expect([...parent.childNodes].some((node) => node.nodeType === Node.COMMENT_NODE)).toBe(true);

    video.remove();
    // VideoMutationObserver disposes detached media through this real contract.
    controller.remove();
    await flushEvents();

    expect(player.active).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(video.isConnected).toBe(false);
    expect(parent.contains(video)).toBe(false);
    expect(video.vsc).toBeUndefined();
    expect(controller.remove).toHaveBeenCalledOnce();
  });

  it('restores a retained site container without reinserting its removed video', async () => {
    const { player, video, parent, controller } = makeController();
    const container = document.createElement('div');
    container.className = 'video-js';
    parent.insertBefore(container, video);
    container.append(video);
    controller.remove.mockImplementation(() => {
      player.cleanup();
      delete video.vsc;
      controller.div.remove();
    });
    player.attach();
    await player.open();
    const host = player.ui.host;
    expect(host.contains(container)).toBe(true);

    video.remove();
    controller.remove();
    await flushEvents();

    expect(player.active).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(container.parentNode).toBe(parent);
    expect(container.isConnected).toBe(true);
    expect(container.contains(video)).toBe(false);
    expect(video.isConnected).toBe(false);
    expect(video.vsc).toBeUndefined();
    expect(controller.remove).toHaveBeenCalledOnce();
  });

  it('leaves a connected site-reparented video in its new location without pausing it', async () => {
    const { player, video, parent, controller, stream } = makeController();
    controller.remove.mockImplementation(() => {
      player.cleanup();
      delete video.vsc;
      controller.div.remove();
    });
    player.attach();
    await player.open({ play: true });
    const host = player.ui.host;
    const source = video.src;
    const newSiteParent = document.createElement('div');
    parent.append(newSiteParent);

    newSiteParent.append(video);
    await flushEvents();

    expect(player.active).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(video.parentNode).toBe(newSiteParent);
    expect(video.isConnected).toBe(true);
    expect(video.paused).toBe(false);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.src).toBe(source);
    expect(video.srcObject).toBe(stream);
    expect(video.playbackRate).toBe(1.5);
    expect(controller.remove).not.toHaveBeenCalled();
    expect(video.vsc).toBe(controller);
    expect(video.controls).toBe(true);
    expect(window.VSC.IOSPlayer.siteRelinquished.has(video)).toBe(true);

    video.dispatchEvent(new Event('playing'));
    await flushEvents();
    expect(player.active).toBe(false);
    expect(video.parentNode).toBe(newSiteParent);

    controller.div.shadowRoot.querySelector('button').click();
    expect(player.active).toBe(true);
    expect(window.VSC.IOSPlayer.siteRelinquished.has(video)).toBe(false);
    expect(video.vsc).toBe(controller);
  });

  it('preserves a new site video replacing the owned media instead of deleting it with the shell', async () => {
    const { player, video, parent, controller } = makeController();
    controller.remove.mockImplementation(() => {
      player.cleanup();
      delete video.vsc;
      controller.div.remove();
    });
    player.attach();
    await player.open();
    const host = player.ui.host;
    const replacement = document.createElement('video');
    replacement.src = 'https://media.example.test/site-replacement.mp4';
    const replacementSource = replacement.src;

    video.replaceWith(replacement);
    controller.remove();
    await flushEvents();

    expect(player.active).toBe(false);
    expect(host.isConnected).toBe(false);
    expect(video.isConnected).toBe(false);
    expect(replacement.isConnected).toBe(true);
    expect(replacement.parentNode).toBe(parent);
    expect(replacement.src).toBe(replacementSource);
    expect(replacement.paused).toBe(true);
    expect(replacement.hasAttribute('slot')).toBe(false);
    expect(controller.remove).toHaveBeenCalledOnce();
  });
});
