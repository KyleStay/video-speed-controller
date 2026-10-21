import '../../../src/utils/video-load-diagnostics.js';

describe('VideoLoadDiagnostics', () => {
  let recorder;
  let frames;
  let frameId;
  let clock;

  const rect = (x, y, width, height) => ({ x, y, width, height });
  const property = (node, key, value) =>
    Object.defineProperty(node, key, { configurable: true, value, writable: true });
  const video = (parent = document.body) => {
    const media = document.createElement('video');
    parent.append(media);
    property(media, 'readyState', 0);
    property(media, 'networkState', 2);
    return media;
  };
  const tick = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    clock += 16;
    for (const callback of callbacks) {
      callback(clock);
    }
  };
  const events = (type) => recorder.snapshot().events.filter((event) => event.event === type);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    frames = new Map();
    frameId = 0;
    clock = 0;
    vi.spyOn(window.performance, 'now').mockImplementation(() => clock);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id));
    property(window, 'scrollX', 0);
    property(window, 'scrollY', 0);
    recorder = new window.VSC.VideoLoadDiagnostics(document);
  });

  afterEach(() => {
    recorder.cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete window.VSC_controller;
  });

  it('has no active listeners, timers or reads before explicit start', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const media = video();
    const geometry = vi.spyOn(media, 'getBoundingClientRect');
    recorder.observeRoot(document);
    media.dispatchEvent(new Event('loadeddata'));
    recorder.mark('before-controller', media);
    expect(add).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(recorder.snapshot()).toEqual({ schema: 1, active: false, reason: 'other', events: [] });
  });

  it('captures synchronous readiness then exactly two coalesced frames', () => {
    const media = video();
    recorder.start({ reason: 'diagnostic-build' });
    media.dispatchEvent(new Event('loadeddata'));
    media.dispatchEvent(new Event('canplay'));
    expect(events('loadeddata')[0].media.readyState).toBe(0);
    expect(frames.size).toBe(1);
    media.readyState = 4;
    tick();
    tick();
    expect(events('frame').map((entry) => [entry.phase, entry.media.readyState])).toEqual([
      [1, 4],
      [2, 4],
    ]);
    expect(frames.size).toBe(0);
    expect(recorder.snapshot().reason).toBe('diagnostic-build');
  });

  it('limits retained events, drops untrusted labels and never serializes page text or keys', () => {
    const media = video();
    media.id = 'SECRET-ID';
    media.className = 'SECRET-CLASS';
    media.src = 'https://secret.example/PRIVATE-SOURCE';
    media.textContent = 'SECRET-TEXT';
    recorder.start({ reason: 'https://SECRET-REASON' });
    recorder.mark('SECRET-LABEL', media);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'SECRET-KEY' }));
    for (let index = 0; index < 300; index++) {
      recorder.mark('after-controller', media);
    }
    const report = recorder.snapshot();
    expect(report.events).toHaveLength(240);
    expect(report.reason).toBe('other');
    expect(JSON.stringify(report)).not.toMatch(/SECRET|PRIVATE|https:/);
    expect(
      report.events.every((entry) => Number.isFinite(entry.seq) && Number.isFinite(entry.t))
    ).toBe(true);
    report.events[0].page.y = 99;
    expect(recorder.snapshot().events[0].page.y).toBe(0);
  });

  it('captures composed nested scrollers and actual inner controller geometry', () => {
    const scroller = document.createElement('div');
    document.body.append(scroller);
    property(scroller, 'scrollTop', 500);
    property(scroller, 'scrollLeft', 70);
    property(scroller, 'scrollHeight', 2000);
    const host = document.createElement('div');
    scroller.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const media = video(shadow);
    const wrapper = document.createElement('div');
    const ui = wrapper.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.id = 'controller';
    ui.append(inner);
    media.vsc = { div: wrapper, iosPlayer: { active: true } };
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue(rect(12, 34, 92, 44));
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));
    recorder.observeRoot(shadow);
    recorder.start();
    media.dispatchEvent(new Event('loadstart'));
    const entry = events('loadstart')[0];
    expect(entry.scrollers).toContainEqual(
      expect.objectContaining({ x: 70, y: 500, scrollHeight: 2000 })
    );
    expect(entry.media.controllerRect).toEqual(rect(12, 34, 92, 44));
    expect(entry.media.hostRect).toEqual(rect(0, 0, 0, 0));
    expect(entry.media.custom).toBe(true);
    expect(entry.scrollers.length).toBeLessThanOrEqual(8);
  });

  it('observes late shadow roots once and removes their listeners promptly', () => {
    recorder.start();
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const media = video(shadow);
    recorder.observeRoot(shadow);
    recorder.observeRoot(shadow);
    media.dispatchEvent(new Event('playing', { composed: true }));
    expect(events('playing')).toHaveLength(1);
    recorder.unobserveRoot(shadow);
    media.dispatchEvent(new Event('loadeddata'));
    expect(events('loadeddata')).toHaveLength(0);
  });

  it('coalesces scroll and rate limits ordinary input and scroll without polling', () => {
    recorder.start();
    for (let index = 0; index < 20; index++) {
      document.dispatchEvent(new Event('scroll'));
    }
    expect(frames.size).toBe(1);
    tick();
    expect(events('scroll')).toHaveLength(1);
    for (let index = 0; index < 20; index++) {
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    }
    expect(frames.size).toBe(0);
    expect(events('keydown')).toHaveLength(1);
    clock += 125;
    document.dispatchEvent(new Event('scroll'));
    tick();
    expect(events('scroll')).toHaveLength(2);
  });

  it('freezes a sudden page top jump after two context frames even inside the limiter', () => {
    window.scrollY = 720;
    recorder.start();
    document.dispatchEvent(new Event('scroll'));
    tick();
    window.scrollY = 0;
    document.dispatchEvent(new Event('scroll'));
    expect(events('scroll-before-jump').at(-1).page.y).toBe(720);
    expect(events('suspected-top-jump').at(-1).page.y).toBe(0);
    tick();
    expect(recorder.active).toBe(true);
    tick();
    expect(recorder.snapshot()).toMatchObject({ active: false, reason: 'suspected-top-jump' });
    expect(events('frame').filter((entry) => entry.trigger === 'suspected-top-jump')).toHaveLength(
      2
    );
    const count = recorder.snapshot().events.length;
    document.dispatchEvent(new Event('scroll'));
    expect(recorder.snapshot().events).toHaveLength(count);
  });

  it('detects a nested jump from a prior media ancestor sample', () => {
    const scroller = document.createElement('div');
    document.body.append(scroller);
    property(scroller, 'scrollTop', 600);
    property(scroller, 'scrollHeight', 2000);
    const media = video(scroller);
    recorder.start();
    recorder.mark('before-controller', media);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(events('scroll-before-jump').at(-1).scrollers[0].y).toBe(600);
    expect(events('suspected-top-jump').at(-1).scrollers[0].y).toBe(0);
    tick();
    tick();
    expect(recorder.active).toBe(false);
  });

  it('recaptures the same media scroller after a simultaneous page and nested jump from outside media', () => {
    window.scrollY = 720;
    const scroller = document.createElement('div');
    document.body.append(scroller);
    property(scroller, 'scrollTop', 220);
    property(scroller, 'scrollHeight', 2000);
    const media = video(scroller);
    const button = document.createElement('button');
    document.body.append(button);
    recorder.start();
    recorder.mark('after-controller', media);
    const nestedId = events('after-controller')[0].scrollers[0].id;
    tick();
    tick();
    expect(frames.size).toBe(0);
    window.scrollY = 0;
    scroller.scrollTop = 0;
    button.dispatchEvent(new Event('pointerdown', { composed: true }));
    tick();
    tick();
    const context = events('frame').filter(
      (entry) => entry.trigger === 'suspected-top-jump' && entry.mediaId === 1
    );
    expect(context.map((entry) => entry.phase)).toEqual([1, 2]);
    expect(
      context.every(
        (entry) =>
          entry.page.y === 0 && entry.scrollers.some((item) => item.id === nestedId && item.y === 0)
      )
    ).toBe(true);
    expect(events('after-controller')[0].scrollers[0]).toMatchObject({ id: nestedId, y: 220 });
    expect(recorder.active).toBe(false);
  });

  it('detects jumps in readiness before the browser delivers its scroll event', () => {
    window.scrollY = 720;
    const media = video();
    recorder.start();
    window.scrollY = 0;
    media.dispatchEvent(new Event('loadeddata'));
    expect(events('scroll-before-jump').at(-1).page.y).toBe(720);
    expect(events('suspected-top-jump').at(-1).page.y).toBe(0);
    document.dispatchEvent(new Event('scroll'));
    tick();
    tick();
    expect(recorder.active).toBe(false);
    expect(events('suspected-top-jump')).toHaveLength(1);
  });

  it('bounds anonymous roots, scrollers and pending media without retaining disconnected media', () => {
    let parent = document.body;
    for (let index = 0; index < 12; index++) {
      const box = document.createElement('div');
      property(box, 'scrollTop', 200);
      parent.append(box);
      parent = box;
    }
    const media = video(parent);
    recorder.start();
    recorder.mark('before-controller', media);
    const first = events('before-controller')[0].scrollers;
    expect(first).toHaveLength(8);
    recorder.mark('after-controller', media);
    expect(events('after-controller')[0].scrollers.map((item) => item.id)).toEqual(
      first.map((item) => item.id)
    );
    for (let index = 0; index < 40; index++) {
      recorder.mark('before-controller', video());
    }
    expect(recorder.pending.size).toBe(16);
    media.remove();
    tick();
    tick();
    expect(events('frame').every((event) => event.mediaId !== 1)).toBe(true);
    for (let index = 0; index < 80; index++) {
      recorder.observeRoot(document.createElement('div').attachShadow({ mode: 'open' }));
    }
    expect(recorder.roots.length).toBeLessThanOrEqual(64);
  });

  it('captures fullscreen entry/exit against weak last media and focus scrollers', () => {
    const media = video();
    recorder.start();
    media.dispatchEvent(new Event('play'));
    property(document, 'fullscreenElement', media);
    document.dispatchEvent(new Event('fullscreenchange'));
    property(document, 'fullscreenElement', null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(events('fullscreenchange').map((entry) => entry.media.nativeFullscreen)).toEqual([
      true,
      false,
    ]);
    const box = document.createElement('div');
    property(box, 'scrollTop', 220);
    document.body.append(box);
    const button = document.createElement('button');
    box.append(button);
    button.focus();
    expect(events('focusin').at(-1).activeTag).toBe('BUTTON');
    expect(events('focusin').at(-1).scrollers[0].y).toBe(220);
  });

  it('uses composed input and focus targets without serializing their contents', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    property(box, 'scrollTop', 500);
    shadow.append(box);
    const button = document.createElement('button');
    box.append(button);
    recorder.observeRoot(shadow);
    recorder.start();
    button.dispatchEvent(new Event('pointerdown', { composed: true }));
    expect(events('pointerdown')[0].scrollers[0].y).toBe(500);
    button.focus();
    expect(events('focusin')).toHaveLength(1);
    expect(events('focusin')[0].scrollers[0].y).toBe(500);
  });

  it('retains reports on stop, clears IDs on clear, and restarts explicitly', () => {
    const first = video();
    const second = video();
    recorder.start();
    recorder.mark('before-controller', first);
    recorder.mark('after-controller', second);
    recorder.stop();
    expect(frames.size).toBe(0);
    expect(events('after-controller')[0].mediaId).toBe(2);
    recorder.clear();
    expect(recorder.snapshot().events).toEqual([]);
    recorder.start({ reason: 'popup' });
    recorder.mark('after-controller', second);
    expect(events('after-controller')[0].mediaId).toBe(1);
    expect(recorder.snapshot().reason).toBe('popup');
  });

  it('can restart document capture after lifecycle cleanup on the same recorder', () => {
    const media = video();
    recorder.start();
    recorder.cleanup();
    expect(recorder.roots).toHaveLength(0);
    recorder.start({ reason: 'popup' });
    media.dispatchEvent(new Event('loadeddata'));
    expect(events('loadeddata')).toHaveLength(1);
    expect(recorder.roots).toHaveLength(1);
  });

  it('stops automatically after ten minutes and cancels original-window work after adoption', () => {
    const media = video();
    recorder.start();
    recorder.mark('before-controller', media);
    const inert = document.implementation.createHTMLDocument('private');
    inert.body.append(media);
    tick();
    expect(events('frame')).toHaveLength(0);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(600000);
    expect(events('duration-limit')).toHaveLength(1);
    expect(recorder.active).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('guards hostile page getters, non-finite values and the optional hook', () => {
    const media = video();
    property(media, 'playbackRate', Infinity);
    vi.spyOn(media, 'hasAttribute').mockReturnValue({ private: 'SECRET' });
    Object.defineProperty(media, 'vsc', {
      configurable: true,
      get() {
        throw new Error('PRIVATE');
      },
    });
    vi.spyOn(media, 'getBoundingClientRect').mockImplementation(() => {
      throw new Error('PRIVATE');
    });
    recorder.start();
    expect(() => recorder.mark('after-controller', media)).not.toThrow();
    expect(events('after-controller')[0].media).toMatchObject({
      rate: 0,
      rect: null,
      controllerRect: null,
    });
    window.VSC_controller = { videoDiagnostics: recorder };
    expect(() => window.VSC.recordVideoDiagnostic('scroll-restore-before', media)).not.toThrow();
    expect(events('scroll-restore-before')).toHaveLength(1);
    window.VSC_controller = {
      get videoDiagnostics() {
        throw new Error('PRIVATE');
      },
    };
    expect(() => window.VSC.recordVideoDiagnostic('after-controller', media)).not.toThrow();
    expect(JSON.stringify(recorder.snapshot())).not.toContain('PRIVATE');
    expect(JSON.stringify(recorder.snapshot())).not.toContain('SECRET');
  });

  it('pagehide cancels deferred snapshots while retaining history and cleanup detaches everything', () => {
    const media = video();
    recorder.start();
    recorder.mark('after-controller', media);
    window.dispatchEvent(new Event('pagehide'));
    expect(frames.size).toBe(0);
    expect(events('pagehide')).toHaveLength(1);
    recorder.cleanup();
    const count = recorder.snapshot().events.length;
    media.dispatchEvent(new Event('play'));
    window.dispatchEvent(new Event('pageshow'));
    expect(recorder.snapshot().events).toHaveLength(count);
    expect(recorder.roots).toHaveLength(0);
  });

  it('freezes a pending incident on pagehide when animation frames may stop running', () => {
    window.scrollY = 720;
    recorder.start();
    window.scrollY = 0;
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));
    expect(recorder.snapshot()).toMatchObject({ active: false, reason: 'suspected-top-jump' });
    expect(frames.size).toBe(0);
    expect(events('suspected-top-jump')).toHaveLength(1);
  });
});
