/** Regression coverage for a ready <source>-backed video retaining hidden controls. */
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

describe('VideoController source readiness visibility', () => {
  let dom;
  let controllers;

  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    dom = createMockDOM();
    controllers = [];
    window.VSC.stateManager.controllers.clear();
    window.VSC.siteHandlerManager.initialize(document);
  });

  afterEach(() => {
    controllers.forEach((controller) => {
      if (!controller.disposed) {
        controller.remove();
      }
    });
    window.VSC.stateManager.controllers.clear();
    dom.cleanup();
    cleanupChromeMock();
    vi.restoreAllMocks();
  });

  async function attach(options = {}) {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const events = new window.VSC.EventManager(config, null);
    const actions = new window.VSC.ActionHandler(config, events);
    const video = createMockVideo({
      readyState: 4,
      currentSrc: 'blob:https://example.com/active',
      ...options,
    });
    // Use DOM dispatch and real MutationObserver delivery. The general media
    // fixture's manual event registry cannot exercise browser listener cleanup.
    for (const key of [
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'matches',
      'querySelector',
      'querySelectorAll',
    ]) {
      delete video[key];
    }
    const source = document.createElement('source');
    source.src = 'https://example.com/same-clip.m3u8';
    video.appendChild(source);
    video.src = 'blob:https://example.com/active';
    dom.container.appendChild(video);
    const add = vi.spyOn(video, 'addEventListener');
    const remove = vi.spyOn(video, 'removeEventListener');
    const controller = new window.VSC.VideoController(video, null, config, actions);
    controllers.push(controller);
    return { video, source, controller, add, remove };
  }

  const deliverMutations = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const hidden = (controller) => controller.div.classList.contains('vsc-nosource');

  it('reveals source-child playback after transient empty source attributes reach loadeddata', async () => {
    const { video, source, controller } = await attach();
    expect(hidden(controller)).toBe(false);
    video.currentSrc = '';
    video.readyState = 0;
    video.removeAttribute('src');
    await deliverMutations();
    expect(hidden(controller)).toBe(true);
    expect(video.querySelector('source')).toBe(source);

    // Safari selected the child source without writing the video src attribute.
    video.currentSrc = 'blob:https://example.com/selected-child';
    video.readyState = 4;
    video.dispatchEvent(new Event('loadeddata'));
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.src).toBe('');
    expect(hidden(controller)).toBe(false);
  });

  it('keeps already-decoded media visible when the site removes its src attribute', async () => {
    const { video, controller } = await attach({ currentSrc: '', readyState: 2 });
    expect(hidden(controller)).toBe(false);
    video.removeAttribute('src');
    await deliverMutations();
    expect(video.currentSrc).toBe('');
    expect(video.readyState).toBe(2);
    expect(hidden(controller)).toBe(false);
  });

  it('hides genuinely emptied sourceless media, then reveals a later decoded source', async () => {
    const { video, source, controller } = await attach();
    video.removeAttribute('src');
    await deliverMutations();
    expect(hidden(controller)).toBe(false);
    source.remove();
    video.currentSrc = '';
    video.readyState = 0;
    video.dispatchEvent(new Event('emptied'));
    expect(hidden(controller)).toBe(true);

    video.currentSrc = 'blob:https://example.com/replacement';
    video.readyState = 4;
    video.dispatchEvent(new Event('loadeddata'));
    expect(hidden(controller)).toBe(false);
  });

  it('hides a sourceless replacement at loadstart before any later src mutation', async () => {
    const { video, source, controller } = await attach();
    video.removeAttribute('src');
    await deliverMutations();
    source.remove();
    video.currentSrc = '';
    video.readyState = 0;
    video.dispatchEvent(new Event('loadstart'));
    expect(hidden(controller)).toBe(true);
  });

  it('unregisters readiness listeners and never changes the removed controller after cleanup', async () => {
    const { video, controller, add, remove } = await attach();
    const readinessTypes = ['loadeddata', 'loadstart', 'emptied'];
    const registered = add.mock.calls.filter(([type]) => readinessTypes.includes(type));
    expect(registered.some(([type]) => type === 'loadeddata')).toBe(true);
    controller.remove();
    for (const [type, listener] of registered) {
      expect(
        remove.mock.calls.some(
          ([removedType, removedListener]) => removedType === type && removedListener === listener
        )
      ).toBe(true);
    }

    const retainedWrapper = controller.div;
    expect(hidden(controller)).toBe(false);
    video.currentSrc = '';
    video.readyState = 0;
    video.removeAttribute('src');
    for (const type of readinessTypes) {
      video.dispatchEvent(new Event(type));
    }
    await deliverMutations();
    expect(retainedWrapper.classList.contains('vsc-nosource')).toBe(false);

    retainedWrapper.classList.add('vsc-nosource');
    video.currentSrc = 'blob:https://example.com/after-cleanup';
    video.readyState = 4;
    video.setAttribute('src', 'blob:https://example.com/after-cleanup');
    video.dispatchEvent(new Event('loadeddata'));
    await deliverMutations();
    expect(retainedWrapper.classList.contains('vsc-nosource')).toBe(true);
    expect(video.vsc).toBeUndefined();
  });
});
