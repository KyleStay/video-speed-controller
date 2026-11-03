/** Opt-in native QA telemetry; never drives extension state. */
export function installNativeProbe(document) {
  const view = document.defaultView;
  const params = new view.URLSearchParams(view.location.search);
  if (!params.has('native-qa')) {
    return () => {};
  }
  const main = document.querySelector('main');
  const panel = document.createElement('section');
  panel.id = 'native-profile-probe';
  const read = document.createElement('button');
  read.type = 'button';
  read.textContent = 'Read profile state';
  const output = document.createElement('p');
  output.id = 'native-profile-state';
  panel.append(read, output);
  main.prepend(panel);
  const originalPadding = document.body.style.paddingTop;
  if (view.parent !== view) {
    panel.hidden = true;
  } else {
    panel.style.cssText =
      'position:fixed;top:4px;right:4px;z-index:2147483646;pointer-events:none;text-align:right';
    read.style.cssText = 'pointer-events:auto;font-size:10px;margin:2px';
    output.style.cssText =
      'max-width:280px;max-height:40px;overflow:auto;background:white;pointer-events:none';
    document.body.style.paddingTop = '136px';
  }
  const ids = new WeakMap();
  const tracked = new Set();
  const callbacks = new Map();
  const errors = [];
  const removers = [];
  const frames = new Map();
  let serial = 0,
    sequence = 0,
    trusted = 0,
    disposed = false;
  const documentId = view.crypto.randomUUID();
  const listen = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    removers.push(() => node.removeEventListener(type, handler, options));
  };
  const key = (node) => {
    if (!node) {
      return null;
    }
    if (!ids.has(node)) {
      ids.set(node, ++serial);
    }
    return ids.get(node);
  };
  const safe = (run, fallback = null) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const stopFrame = (node, record) => {
    if (record.callback !== null) {
      safe(() => node.cancelVideoFrameCallback(record.callback));
    }
    callbacks.delete(node);
  };
  function sample(node) {
    if (tracked.size < 24) {
      tracked.add(node);
    }
    const source = node.currentSrc || node.src || node.querySelector('source')?.src || '';
    let record = callbacks.get(node);
    if (record && record.source !== source) {
      stopFrame(node, record);
      record = null;
    }
    if (node.tagName === 'VIDEO' && typeof node.requestVideoFrameCallback === 'function') {
      if (!record) {
        record = { source, presented: 0, callback: null };
        callbacks.set(node, record);
      }
      if (record.callback === null) {
        record.callback = node.requestVideoFrameCallback((_now, metadata) => {
          record.callback = null;
          if (!disposed && node.isConnected && node.currentSrc === record.source) {
            record.presented = metadata.presentedFrames;
          }
        });
      }
    }
    const track = node.querySelector('track');
    return {
      key: key(node),
      id: node.id,
      tag: node.tagName,
      source,
      owner: key(node.vsc?.div),
      controlled: !!node.vsc?.div?.isConnected,
      visible: node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
      paused: node.paused ?? null,
      muted: node.muted ?? null,
      rate: node.playbackRate ?? null,
      time: Number.isFinite(node.currentTime) ? node.currentTime : null,
      duration: Number.isFinite(node.duration) ? node.duration : null,
      live: node.duration === Infinity,
      ready: node.readyState ?? null,
      frames: safe(
        () => node.getVideoPlaybackQuality().totalVideoFrames,
        node.webkitDecodedFrameCount ?? null
      ),
      presented: record?.presented ?? null,
      seekable: safe(
        () =>
          node.seekable.length
            ? [
                node.seekable.start(node.seekable.length - 1),
                node.seekable.end(node.seekable.length - 1),
              ]
            : [],
        []
      ),
      track: key(track),
      cues: safe(() => track.track.cues.length, 0),
      mediaError: node.error?.code || 0,
      rect: rect(node),
    };
  }
  function localState() {
    for (const [node, record] of callbacks) {
      if (!node.isConnected) {
        stopFrame(node, record);
      }
    }
    return {
      version: 1,
      url: view.location.href,
      anchor: rect(read),
      document: documentId,
      profile: params.get('case'),
      run: params.get('run') || '',
      sequence,
      trusted,
      errors: [...errors],
      detail: view.__mediaProfileState?.() || null,
      fixture: safe(() => {
        const { asset, resets, pendingReset, errors } = view.__mediaMockState();
        return { asset, resets, pendingReset, errors };
      }),
      controllers: document.querySelectorAll('.vsc-controller').length,
      media: [...document.querySelectorAll('video,img')].map(sample),
      retired: [...tracked]
        .filter((node) => !node.isConnected)
        .map((node) => ({ key: key(node), controlled: !!node.vsc })),
      capabilities: {
        mediaSource: !!view.MediaSource,
        managedMediaSource: !!view.ManagedMediaSource,
      },
    };
  }
  function publish() {
    const children = [...document.querySelectorAll('iframe')].map((frame) => ({
      key: key(frame),
      title: frame.title,
      rect: rect(frame),
      state: frames.get(frame) || null,
    }));
    output.textContent = `Profile state: ${JSON.stringify({ ...localState(), children, pendingFrames: children.filter((child) => !child.state).length })}`;
  }
  function collect() {
    sequence++;
    frames.clear();
    for (const frame of document.querySelectorAll('iframe')) {
      frame.contentWindow?.postMessage(
        { type: 'local-profile-read', sequence },
        new view.URL(frame.src).origin
      );
    }
    publish();
  }
  listen(read, 'click', collect);
  listen(
    document,
    'click',
    (event) => {
      if (event.isTrusted) {
        trusted++;
      }
    },
    true
  );
  listen(view, 'error', () => {
    if (errors.length < 16) {
      errors.push('Page error');
    }
  });
  listen(view, 'unhandledrejection', () => {
    if (errors.length < 16) {
      errors.push('Unhandled rejection');
    }
  });
  listen(document, 'securitypolicyviolation', () => {
    if (errors.length < 16) {
      errors.push('CSP violation');
    }
  });
  listen(view, 'message', (event) => {
    if (event.data?.type === 'local-profile-read') {
      const port = params.get('parentPort') || '';
      if (
        !/^\d+$/.test(port) ||
        event.origin !== `http://127.0.0.1:${port}` ||
        event.source !== view.parent ||
        view.parent === view
      ) {
        return;
      }
      event.source.postMessage(
        { type: 'local-profile-state', sequence: event.data.sequence, state: localState() },
        event.origin
      );
      return;
    }
    if (event.data?.type !== 'local-profile-state' || event.data.sequence !== sequence) {
      return;
    }
    const frame = [...document.querySelectorAll('iframe')].find(
      (node) =>
        node.contentWindow === event.source && new view.URL(node.src).origin === event.origin
    );
    if (frame) {
      frames.set(frame, event.data.state);
      publish();
    }
  });
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    removers.splice(0).forEach((remove) => remove());
    for (const [node, record] of callbacks) {
      stopFrame(node, record);
    }
    panel.remove();
    document.body.style.paddingTop = originalPadding;
  }
  listen(view, 'pagehide', dispose, { once: true });
  publish();
  return dispose;
}
