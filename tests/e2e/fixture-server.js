import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installPrecisionTrace, installSurfaceTrace } from './precision-trace.js';
import {
  RATE_PROBE_RATES,
  summarizeFrameCadence,
  validateRateProbeReport,
} from './rate-probe-validation.js';

const fixtureHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast browser fixture</title></head>
  <body><main id="fixture-root"></main></body>
</html>`;

const frameHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast frame fixture</title></head>
  <body>
    <main id="fixture-root">
      <video id="frame-video" muted preload="auto" src="/sample.webm"></video>
    </main>
  </body>
</html>`;

const emptyFrameHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast empty frame fixture</title></head>
  <body><main id="fixture-root"></main></body>
</html>`;

const mobileHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>StayFast mobile fixture</title>
    <style>
      body { margin: 0; font: 16px system-ui; background: #f3f7fa; color: #123; }
      h1, p { margin: 16px; }
      .player { position: relative; width: 100%; }
      video { display: block; width: 100%; aspect-ratio: 16 / 9; }
      #play, #pause, #enter-fullscreen { min-height: 44px; margin: 16px; }
      .scroll-space { height: 1400px; }
    </style>
  </head>
  <body>
    <h1>StayFast mobile controls</h1>
    <div class="player"><video id="mobile-video" muted loop playsinline controls preload="auto" src="/sample.webm"></video></div>
    <button id="play" type="button">Play test video</button>
    <button id="pause" type="button">Pause test video</button>
    <button id="enter-fullscreen" type="button">Enter native fullscreen</button>
    <p id="media-status" role="status" aria-live="polite">Loading test media</p>
    <p>Touch the speed pill to open controls. Drag the page to scroll.</p>
    <div class="scroll-space"></div>
    <script>
      const video = document.querySelector('video');
      if (new URLSearchParams(location.search).has('precision')) (${installPrecisionTrace.toString()})(video);
      if (new URLSearchParams(location.search).has('surface-scrub')) (${installSurfaceTrace.toString()})(video);
      if (new URLSearchParams(location.search).has('rtl')) document.documentElement.dir = 'rtl';
      const scrollFixture = new URLSearchParams(location.search).get('scroll');
      if (scrollFixture === 'page' || scrollFixture === 'nested') {
        const spacer = document.createElement('div');
        spacer.style.height = '900px';
        spacer.setAttribute('aria-label', 'Page scroll fixture spacer');
        document.body.prepend(spacer);
        if (scrollFixture === 'nested') {
          const viewport = document.createElement('div');
          viewport.id = 'scroll-container';
          viewport.style.cssText = 'height:360px;overflow:auto;overscroll-behavior:contain;';
          const content = document.createElement('div');
          content.style.cssText = 'width:570px;min-height:1300px;padding-top:260px;box-sizing:border-box;';
          const player = video.parentNode;
          player.style.cssText = 'width:330px;margin-left:110px;';
          player.before(viewport);
          viewport.append(content);
          content.append(player);
        }
      }
      const feedOverlay = new URLSearchParams(location.search).has('feed-overlay');
      if (feedOverlay) {
        // Video-sized player inside a zero-height tracker, with sibling chrome
        // on the outer picture rather than the inner player.
        const shell = video.parentElement;
        shell.style.aspectRatio = '16 / 9';
        const tracker = document.createElement('div');
        tracker.style.cssText = 'height:0;overflow:visible';
        const inner = document.createElement('div');
        inner.style.position = 'relative';
        shell.append(tracker); tracker.append(inner); inner.append(video);
      }
      if (new URLSearchParams(location.search).has('lower-metadata')) {
        const shell = document.querySelector('.player');
        const layer = video.parentElement;
        layer.style.cssText = 'position:relative;z-index:0';
        const metadata = document.createElement('a');
        metadata.id = 'player-metadata'; metadata.href = '#profile'; metadata.textContent = 'Creator profile';
        metadata.style.cssText = 'position:absolute;left:16px;right:16px;bottom:12px;height:40px;z-index:2;background:white';
        metadata.addEventListener('click', event => { event.preventDefault(); window.__metadataClicks = (window.__metadataClicks || 0) + 1; });
        shell.append(metadata);
      }
      const ownedDiagnostics = new URLSearchParams(location.search).has('owned');
      if (ownedDiagnostics) {
        window.__stayfastOwnedFixture = { video, source: video.src, parent: video.parentNode, nativeFullscreenCalls: 0 };
        if (typeof video.webkitEnterFullscreen !== 'function' && !new URLSearchParams(location.search).has('standard-fullscreen')) {
          video.webkitEnterFullscreen = () => { window.__stayfastOwnedFixture.nativeFullscreenCalls++; };
        }
      }
      const takeoverFixture = new URLSearchParams(location.search).has('takeover');
      const theaterOverlay = new URLSearchParams(location.search).has('theater-overlay');
      if (theaterOverlay) {
        const open = document.createElement('button');
        open.id = 'open-site-viewer'; open.textContent = 'Open site video viewer';
        open.style.minHeight = '44px';
        document.querySelector('#play').before(open);
        open.addEventListener('click', () => {
          const dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
          dialog.tabIndex = -1;
          dialog.style.cssText = 'position:fixed;inset:0;overflow-y:auto;background:#f3f7fa;z-index:10';
          const picture = document.createElement('div');
          picture.className = 'site-viewer-picture'; picture.style.position = 'relative';
          picture.tabIndex = 0;
          const cover = document.createElement('div');
          cover.id = 'site-picture-overlay';
          cover.setAttribute('aria-label', 'Video picture'); cover.setAttribute('role', 'button');
          cover.style.cssText = 'position:absolute;inset:0';
          for (const type of ['pointerdown', 'pointermove', 'touchstart', 'click']) {
            cover.addEventListener(type, event => event.stopImmediatePropagation());
          }
          picture.append(document.querySelector('.player'), cover);
          dialog.append(picture, document.querySelector('#play'), document.querySelector('#pause'), document.querySelector('#media-status'));
          document.body.append(dialog);
        });
      }
      if (new URLSearchParams(location.search).has('reveal-overlay')) {
        const plain = new URLSearchParams(location.search).has('plain-overlay');
        const overlay = document.createElement(plain ? 'div' : 'button');
        overlay.id = 'site-picture-overlay';
        if (!plain) overlay.type = 'button';
        overlay.setAttribute('aria-label', 'Video picture');
        overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;';
        for (const type of ['pointerdown', 'touchstart', 'click']) {
          overlay.addEventListener(type, event => event.stopImmediatePropagation());
        }
        (feedOverlay && !new URLSearchParams(location.search).has('lower-metadata') ? document.querySelector('.player') : video.parentElement).append(overlay);
      }
      const fullscreenNames = ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'webkitEnterFullscreen', 'webkitEnterFullScreen', 'webkitSetPresentationMode'];
      window.__stayfastInitialFullscreen = new Map(fullscreenNames.map((name) => [name, {
        method: video[name], descriptor: Object.getOwnPropertyDescriptor(video, name),
      }]));
      if (takeoverFixture) {
        const shell = video.parentElement;
        shell.classList.add('video-js');
        shell.setAttribute('data-vsc-ios-site-controls', 'site-original');
        const siteChrome = document.createElement('div');
        siteChrome.className = 'vjs-control-bar'; siteChrome.id = 'site-original-chrome';
        siteChrome.textContent = 'Original site controls'; shell.append(siteChrome);
        const unrelated = document.createElement('button');
        unrelated.className = 'vjs-control-bar'; unrelated.id = 'unrelated-page-control';
        unrelated.textContent = 'Unrelated page control'; unrelated.style.minHeight = '44px';
        document.querySelector('#pause').after(unrelated);
        const trace = window.__stayfastTakeover = {
          video, shell, source: video.src, originalControls: video.getAttribute('controls'),
          events: [], nativeBegins: 0, nativeDOMEntries: 0, ownedInsertions: 0,
          requests: 0, failures: 0, lastRequest: 'none',
        };
        const record = (kind, detail = {}) => {
          trace.events.push({ kind, ...detail });
          if (trace.events.length > 64) trace.events.shift();
        };
        trace.request = (route, event) => {
          const target = route === 'container' ? shell : video;
          const name = route === 'webkit' ? 'webkitEnterFullscreen' :
            route === 'presentation' ? 'webkitSetPresentationMode' : 'requestFullscreen';
          trace.requests++;
          trace.lastRequest = route;
          record('request', { route, trusted: event?.isTrusted === true,
            active: navigator.userActivation?.isActive === true });
          try {
            if (typeof target[name] !== 'function') throw new Error('API unavailable: ' + name);
            const result = target[name](...(route === 'presentation' ? ['fullscreen'] : []));
            return Promise.resolve(result).then(() => record('settled', { route }), (error) => {
              trace.failures++; record('denied', { route, name: error.name });
            });
          } catch (error) {
            trace.failures++; record('denied', { route, name: error.name });
            return Promise.resolve();
          }
        };
        const actions = document.createElement('div');
        actions.id = 'site-player-actions';
        actions.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin:8px;';
        for (const [route, label] of [['video','Site video fullscreen'], ['container','Site player fullscreen'],
          ['webkit','Site Apple fullscreen'], ['presentation','Site presentation fullscreen']]) {
          const button = document.createElement('button');
          button.id = 'site-fullscreen-' + route;
          button.textContent = label; button.type = 'button'; button.style.minHeight = '44px';
          button.addEventListener('click', (event) => { trace.request(route, event); });
          actions.append(button);
        }
        document.querySelector('#play').before(actions);
        video.addEventListener('webkitbeginfullscreen', () => { trace.nativeBegins++; record('native-begin'); });
        document.addEventListener('fullscreenchange', () => {
          if (document.fullscreenElement === video || document.fullscreenElement === shell) {
            trace.nativeDOMEntries++; record('native-dom-entry');
          }
        });
        new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.matches('vsc-ios-player')) trace.ownedInsertions++;
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
        trace.programmatic = async () => {
          for (const route of ['video', 'container', ...(typeof video.webkitEnterFullscreen === 'function' ? ['webkit'] : []), ...(typeof video.webkitSetPresentationMode === 'function' ? ['presentation'] : [])]) {
            await trace.request(route);
          }
          document.querySelector('#site-fullscreen-video').click();
          document.querySelector('#site-fullscreen-container').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        };
        if (new URLSearchParams(location.search).has('onload-fullscreen')) {
          trace.runOnloadProbe = () => {
            if (trace.onloadStarted || video.readyState < 1 || !video.vsc?.iosPlayer?.attached || video.controls) return;
            trace.onloadStarted = true;
            trace.runOnloadProbe = null;
            trace.programmatic().then(() => { trace.onloadComplete = true; updateStatus(); });
          };
        }
      }
      const mediaStatus = document.querySelector('#media-status');
      const errors = [];
      const observedRoots = new WeakSet();
      const updateStatus = () => {
        if (takeoverFixture) window.__stayfastTakeover.runOnloadProbe?.();
        const hosts = document.querySelectorAll(ownedDiagnostics ? 'vsc-controller, vsc-ios-player' : 'vsc-controller');
        for (const host of hosts) {
          if (host.shadowRoot && !observedRoots.has(host.shadowRoot)) {
            observedRoots.add(host.shadowRoot);
            controllerObserver.observe(host.shadowRoot, { childList: true, characterData: true, subtree: true });
          }
        }
        let text = 'Playback rate: ' + video.playbackRate +
          '; controllers: ' + document.querySelectorAll('vsc-controller').length +
          '; ready: ' + video.readyState + '; errors: ' + errors.length +
          '; paused: ' + video.paused + '; time: ' + video.currentTime.toFixed(2) +
          '; plays inline: ' + video.hasAttribute('playsinline') +
          '; webkit inline: ' + video.hasAttribute('webkit-playsinline') +
          '; inline property: ' + video.playsInline +
          '; inline values: ' + JSON.stringify([video.getAttribute('playsinline'), video.getAttribute('webkit-playsinline')]) +
          '; original inline flags: ' + JSON.stringify(window.__stayfastInlineOriginal || ['', null]) +
          '; media error: ' + (video.error ? video.error.code : 0) +
          '; native fullscreen: ' + (video.webkitDisplayingFullscreen === true || video.webkitPresentationMode === 'fullscreen') +
          '; namespace: ' + !!window.VSC + '; initialized: ' + window.VSC_controller?.initialized +
          '; abort: ' + window.VSC?.videoSpeedConfig?.settings?._abort +
          '; lastSpeed: ' + window.VSC?.videoSpeedConfig?.settings?.lastSpeed;
        if (takeoverFixture) {
          const trace = window.__stayfastTakeover;
          const inline = video.vsc?.controlsManager?.inlinePlayer;
          text += '; takeover controls: ' + video.controls + '; takeover requests: ' + trace.requests +
            '; takeover native begins: ' + trace.nativeBegins + '; takeover native DOM: ' + trace.nativeDOMEntries +
            '; takeover inserts: ' + trace.ownedInsertions + '; takeover last request: ' + trace.lastRequest +
            '; takeover onload complete: ' + !!trace.onloadComplete +
            '; takeover inline: ' + !!inline + '; takeover owner active: ' + !!video.vsc?.iosPlayer?.active +
            '; takeover site controls hidden: ' + (getComputedStyle(document.querySelector('#site-original-chrome')).display === 'none') +
            '; takeover unrelated visible: ' + (getComputedStyle(document.querySelector('#unrelated-page-control')).display !== 'none') +
            '; takeover APIs restored: ' + [...window.__stayfastInitialFullscreen].every(([name, original]) => {
              const current = Object.getOwnPropertyDescriptor(video, name);
              return !original.descriptor && !current || !!original.descriptor && !!current &&
                ['value','get','set','writable','configurable','enumerable'].every((key) => original.descriptor[key] === current[key]);
            });
        }
        if (ownedDiagnostics) {
          text += '; touch trace: ' + JSON.stringify(window.__stayfastTouchTrace || []);
          const speedSelect = document.querySelector('vsc-ios-player')?.shadowRoot?.querySelector('[aria-label="Playback speed"]');
          const inlineHost = video.vsc?.div;
          const inlinePanel = inlineHost?.shadowRoot?.querySelector('#controls');
          if (inlineHost) controllerObserver.observe(inlineHost, { attributes: true, attributeFilter: ['class', 'data-vsc-inline-idle'] });
          text += '; inline speed label: ' + (inlineHost?.shadowRoot?.querySelector('.draggable')?.textContent || 'none');
          const inlineOpen = inlineHost?.classList.contains('vsc-touch-open');
          const inlineStyle = inlinePanel && inlineOpen ? getComputedStyle(inlinePanel) : null;
          text += '; inline panel height: ' + (inlineStyle ? inlinePanel.getBoundingClientRect().height : 0) +
            '; inline panel block size: ' + (inlineStyle?.blockSize || 'none') +
            '; inline panel rows: ' + (inlineStyle?.gridTemplateRows || 'none');
          const owner = video.vsc?.iosPlayer;
          const inline = video.vsc?.controlsManager?.inlinePlayer;
          const inlineRange = inline?.refs.timeline;
          const inlineRect = inlineRange?.getBoundingClientRect();
          const mediaBottom = video.getBoundingClientRect().bottom;
          const shellBottom = document.querySelector('.player').getBoundingClientRect().bottom;
          const inlineBottom = Math.min(innerHeight, mediaBottom, shellBottom);
          text += '; precision mode: ' + (owner?.active ? 'fullscreen' : inline?.available() ? 'inline' : 'none') +
            '; inline timeline hidden: ' + !!(inline?.idle || inline?.refs.timelineGroup.hidden) +
            '; inline opacity: ' + (inline ? getComputedStyle(inline.root).opacity : 'none') +
            '; inline scrub active: ' + !!inline?.scrubber?.active +
            '; inline scrub hint: ' + (inline?.refs.scrubHint?.textContent || 'none') +
            '; inline selected time: ' + (inline?.refs.time?.textContent || 'none') +
            '; inline timeline height: ' + (inlineRect?.height || 0) +
            '; inline timeline bottom gap: ' + (inlineRect ? Math.round((inlineBottom - inlineRect.bottom) * 100) / 100 : 'none') +
            '; inline timeline geometry: ' + JSON.stringify(inlineRect ? {left:inlineRect.left,top:inlineRect.top,right:inlineRect.right,bottom:inlineRect.bottom} : null);
          const precisionRange = owner?.active ? owner.ui?.refs.seek : inlineRange;
          if (precisionRange) window.__stayfastPrecision?.bind(precisionRange);
          text += '; speed select height: ' + (speedSelect ? speedSelect.getBoundingClientRect().height : 0) +
            '; speed select min height: ' + (speedSelect ? getComputedStyle(speedSelect).minHeight : 'none') +
            '; video fit: ' + getComputedStyle(video).objectFit +
            '; fit mode: ' + (owner?.fit || 'none') +
            '; fit button: ' + (owner?.ui?.refs?.fit?.getAttribute('aria-label') || 'none') +
            '; remaining mode: ' + !!owner?.remaining +
            '; duration text: ' + (owner?.ui?.refs?.duration?.textContent || 'none') +
            '; scrub active: ' + !!owner?.scrubber?.active +
            '; scrub hint: ' + (owner?.ui?.refs?.scrubHint?.textContent || 'none');
          if (owner?.ui) {
            const shadow = owner.ui.shadow;
            const timeline = shadow.querySelector('.timeline');
            const hud = shadow.querySelector('.hud');
            const options = shadow.querySelector('.options');
            const bounds = timeline.getBoundingClientRect();
            const bottom = hud.getBoundingClientRect().bottom - parseFloat(getComputedStyle(hud).paddingBottom);
            text += '; timeline height: ' + owner.ui.refs.seek.getBoundingClientRect().height +
              '; seek direction: ' + getComputedStyle(owner.ui.refs.seek).direction +
              '; timeline last: ' + (timeline === timeline.parentElement.lastElementChild) +
              '; timeline after options: ' + (bounds.top >= options.getBoundingClientRect().bottom) +
              '; timeline bottom gap: ' + Math.round((bottom - bounds.bottom) * 100) / 100 +
              '; seek fill: ' + owner.ui.refs.seek.style.getPropertyValue('--seek-progress');
          }

          const scrollContainer = document.querySelector('#scroll-container');
          const baseline = window.__stayfastScrollBaseline;
          text += '; page scroll: ' + scrollX + ',' + scrollY +
            '; nested scroll: ' + (scrollContainer ? scrollContainer.scrollLeft + ',' + scrollContainer.scrollTop : 'none') +
            '; video top: ' + video.getBoundingClientRect().top.toFixed(1) +
            '; saved scroll: ' + (baseline ? baseline.pageX + ',' + baseline.pageY : 'none') +
            '; saved nested: ' + (baseline ? baseline.nestedX + ',' + baseline.nestedY : 'none') +
            '; saved video top: ' + (baseline ? baseline.videoTop.toFixed(1) : 'none') +
            '; saved entry: ' + (baseline?.entry?.sequence || 0) +
            '; saved entry kind: ' + (baseline?.entry?.kind || 'none');
          text += '; original identity: ' + (document.getElementById('mobile-video') === video) +
            '; currentSrc: ' + (video.currentSrc || video.src) +
            '; source preserved: ' + ((video.currentSrc || video.src) === window.__stayfastOwnedFixture.source) +
            '; owner active: ' + !!video.vsc?.iosPlayer?.active +
            '; muted: ' + video.muted + '; native controls: ' + video.controls +
            '; inline restored: ' + (video.parentNode === window.__stayfastOwnedFixture.parent) +
            '; owned hosts: ' + document.querySelectorAll('vsc-ios-player').length +
            '; controls hidden: ' + !!document.querySelector('vsc-ios-player')?.hasAttribute('data-controls-hidden') +
            '; controls locked: ' + !!video.vsc?.iosPlayer?.controlsLocked +
            '; seek feedback: ' + (video.vsc?.iosPlayer?.ui?.refs.seekFeedback?.textContent || 'none') +
            '; owned fullscreen: ' + !!video.vsc?.iosPlayer?.ownedFullscreen?.owns?.() +
            '; fullscreen available: ' + !!video.vsc?.iosPlayer?.ownedFullscreen?.available?.();
          if (window.__stayfastSurface?.report) {
            text += '; surface scrub: ' + JSON.stringify(window.__stayfastSurface.report);
          }
          if (window.__stayfastPrecision?.report) {
            text += '; precision: ' + JSON.stringify(window.__stayfastPrecision.report);
          }
          for (const host of document.querySelectorAll('vsc-ios-player')) {
            controllerObserver.observe(host, { attributes: true, attributeFilter: ['data-controls-hidden'] });
            const dialog = host.shadowRoot?.querySelector('dialog');
            if (!dialog) continue;
            let status = dialog.querySelector('#owned-player-status');
            if (!status) {
              status = document.createElement('p');
              status.id = 'owned-player-status';
              status.setAttribute('role', 'status');
              status.style.cssText = 'position:absolute;top:64px;left:8px;right:8px;z-index:5;margin:0;padding:4px;color:#67e8f9;background:#000b;font:10px/1.2 monospace;overflow-wrap:anywhere;max-height:24dvh;overflow:hidden;pointer-events:none;';
              (host.shadowRoot.querySelector('.player') || dialog).append(status);
            }
            if (status.textContent !== text) status.textContent = text;
          }
        }
        if (mediaStatus.textContent !== text) mediaStatus.textContent = text;
      };
      const controllerObserver = new MutationObserver(updateStatus);
      if (window.__stayfastPrecision) window.__stayfastPrecision.onReport = updateStatus;
      if (window.__stayfastSurface) window.__stayfastSurface.onReport = updateStatus;
      controllerObserver.observe(video, { attributes: true, attributeFilter: ['playsinline', 'webkit-playsinline'] });
      if (scrollFixture === 'page' || scrollFixture === 'nested') {
        const actions = document.createElement('div');
        actions.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483646;display:grid;gap:4px;';
        const remember = (entry = null) => {
          const node = document.querySelector('#scroll-container');
          window.__stayfastScrollBaseline = {
            pageX: scrollX, pageY: scrollY,
            nestedX: node?.scrollLeft || 0, nestedY: node?.scrollTop || 0,
            videoTop: video.getBoundingClientRect().top, entry,
          };
          updateStatus();
        };
        window.__stayfastRememberScroll = remember;
        if (ownedDiagnostics) {
          let entrySequence = 0;
          // XCTest can scroll a clipped target into view before delivering its tap.
          // Capture the real transaction boundary before any owned-player action.
          window.addEventListener('click', (event) => {
            const owner = video.vsc?.iosPlayer;
            if (!event.isTrusted || !owner || owner.active) return;
            const path = event.composedPath();
            const primary = video.vsc.div?.shadowRoot?.querySelector('.inline-fullscreen');
            const custom = owner.button;
            const kind = custom?.getAttribute('aria-label') === 'Open StayFast player' && path.includes(custom)
              ? 'custom'
              : primary?.getAttribute('aria-label') === 'Open video fullscreen' &&
                primary.dataset.action === 'ownedFullscreen' && path.includes(primary)
                ? 'primary' : null;
            if (!kind) return;
            const entry = { sequence: ++entrySequence, kind };
            remember(entry);
            try {
              const frame = window.frameElement;
              if (frame && parent !== window && frame.contentWindow === window &&
                  frame.ownerDocument === parent.document && location.origin !== 'null' &&
                  parent.location.origin === location.origin) {
                parent.__stayfastRememberParentScroll?.(window, entry);
              }
            } catch {
              // QA measurement never crosses an inaccessible parent boundary.
            }
          }, true);
        }
        for (const label of ['Prepare scroll baseline', 'Remember scroll position']) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.style.cssText = 'min-height:44px;font:16px system-ui;';
          button.addEventListener('click', (event) => {
            if (!event.isTrusted) return;
            if (label === 'Prepare scroll baseline') {
              scrollTo({ top: 720, left: 0, behavior: 'instant' });
              document.querySelector('#scroll-container')?.scrollTo({ top: 220, left: 70, behavior: 'instant' });
            }
            remember();
          });
          actions.append(button);
        }
        document.body.append(actions);
        addEventListener('scroll', updateStatus, true);
      }
      if (ownedDiagnostics && new URLSearchParams(location.search).has('touchtrace')) {
        window.__stayfastTouchTrace = [];
        let touchTraceTimer;
        for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'touchstart', 'touchend']) {
          window.addEventListener(type, (event) => {
            const stage = video.vsc?.iosPlayer?.ui?.stage;
            if (!stage) return;
            const rect = stage.getBoundingClientRect();
            const point = event.changedTouches?.[0] || event;
            const entry = [type, event.pointerType || 'touch', Math.round((point.clientX - rect.left) / rect.width * 100), Math.round(performance.now()), event.target.tagName, event.composedPath().includes(stage)];
            queueMicrotask(() => {
              const gestures = video.vsc?.iosPlayer?.gestures;
              entry.push(gestures?.points.size, !!gestures?.tap, gestures?.lastTap?.zone || '-');
              window.__stayfastTouchTrace.push(entry);
              window.__stayfastTouchTrace.splice(0, Math.max(0, window.__stayfastTouchTrace.length - 16));
              clearTimeout(touchTraceTimer);
              touchTraceTimer = setTimeout(updateStatus, 500);
            });
          }, true);
        }
      }
      for (const type of ['loadedmetadata', 'loadeddata', 'ratechange', 'playing', 'pause', 'timeupdate', 'error', 'webkitbeginfullscreen', 'webkitendfullscreen', 'webkitpresentationmodechanged']) {
        video.addEventListener(type, updateStatus);
      }
      new MutationObserver(updateStatus).observe(ownedDiagnostics ? document : document.querySelector('.player'), { childList: true, subtree: true, ...(ownedDiagnostics ? {attributes:true,attributeFilter:['data-controls-locked','data-controls-hidden','hidden','inert']} : {}) });
      addEventListener('error', (event) => { errors.push(event.message); updateStatus(); });
      addEventListener('unhandledrejection', (event) => { errors.push(String(event.reason)); updateStatus(); });
      for (const type of ['VSC_SETTINGS_READY', 'VSC_BRIDGE_READY', 'VSC_MESSAGE']) {
        document.addEventListener(type, () => setTimeout(updateStatus, 0), true);
      }
      document.querySelector('#pause').addEventListener('click', () => video.pause());
      document.querySelector('#play').addEventListener('click', () => {
        video.play();
      });
      const fullscreenButton = document.querySelector('#enter-fullscreen');
      fullscreenButton.disabled = typeof video.webkitEnterFullscreen !== 'function';
      fullscreenButton.addEventListener('click', () => {
        try {
          video.webkitEnterFullscreen();
        } catch (error) {
          errors.push(String(error));
          updateStatus();
        }
      });
      updateStatus();
      setTimeout(updateStatus, 3000);
    </script>
  </body>
</html>`;

// Compare a closed-root native baseline with an explicitly controlled visible video.
export const rateProbeHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Native rate probe</title></head><body style="font:16px system-ui;margin:16px">
<h1>Native playback rate probe</h1><div id="native-player"></div><button id="start-probe" style="min-height:44px;font:inherit">Start rate probe</button><p id="rate-results" role="status" aria-live="polite">Rate probe ready</p>
<script>
const rates = ${JSON.stringify(RATE_PROBE_RATES)};
const summarizeFrameCadence = ${summarizeFrameCadence.toString()};
const validateRateProbeReport = ${validateRateProbeReport.toString()};
const controlled = new URLSearchParams(location.search).has('controlled');
const owned = new URLSearchParams(location.search).has('owned');
const presentation = owned ? 'owned' : 'inline';
const pageErrors = [];
addEventListener('error', event => pageErrors.push(String(event.message)));
addEventListener('unhandledrejection', event => pageErrors.push(String(event.reason)));
const host = document.querySelector('#native-player');
const root = controlled ? host : host.attachShadow({mode:'closed'});
const video = document.createElement('video');
video.src = '/probe.mp4'; video.muted = true; video.playsInline = true; video.controls = true; video.preload = 'auto'; video.style.cssText = 'width:100%;max-height:180px'; root.append(video);
const status = document.querySelector('#rate-results');
const button = document.querySelector('#start-probe');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const frameCounters = () => {
  let quality;
  try { quality = video.getVideoPlaybackQuality?.(); } catch {}
  const read = getter => { try { const value = getter(); return Number.isFinite(value) ? value : null; } catch { return null; } };
  return {
    totalVideoFrames: read(() => quality?.totalVideoFrames),
    droppedVideoFrames: read(() => quality?.droppedVideoFrames),
    corruptedVideoFrames: read(() => quality?.corruptedVideoFrames),
    webkitDecodedFrameCount: read(() => video.webkitDecodedFrameCount),
    webkitDroppedFrameCount: read(() => video.webkitDroppedFrameCount),
  };
};
const firstPresentedFrame = () => new Promise(resolve => {
  if (typeof video.requestVideoFrameCallback !== 'function') { resolve('unavailable'); return; }
  let token;
  const timeout = setTimeout(() => { try { video.cancelVideoFrameCallback?.(token); } catch {} resolve('timedOut'); }, 5000);
  try { token = video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve('presented'); }); } catch { clearTimeout(timeout); resolve('unavailable'); }
});
const seek = (time) => new Promise((resolve, reject) => {
  let timeout;
  const done = () => { clearTimeout(timeout); video.removeEventListener('seeked', done); resolve(); };
  timeout = setTimeout(() => { video.removeEventListener('seeked', done); reject(new Error('seek timeout')); }, 4000);
  video.addEventListener('seeked', done); video.currentTime = time; if (!video.seeking) done();
});
button.addEventListener('click', async () => {
  button.disabled = true;
  const results = [];
  const setterAcceptance = [];
  const originalVideo = video;
  const originalSrc = video.src;
  const originalSource = video.currentSrc || video.src;
  const originalSrcObject = video.srcObject;
  let ownedPlayer;
  let ownedSession;
  const identityPreserved = () => originalVideo.isConnected && originalVideo.ownerDocument === document && (!owned || ownedPlayer?.video === originalVideo);
  const sourcePreserved = () => video.src === originalSrc && video.srcObject === originalSrcObject && (video.currentSrc || video.src) === originalSource;
  const ownedActive = () => !!(ownedPlayer?.active && ownedPlayer.session === ownedSession && video.vsc?.iosPlayer === ownedPlayer && ownedPlayer.ui?.host.isConnected);
  for (const media of ['video','audio']) {
    const detached = document.createElement(media);
    for (const requested of [16,32,64,128,256,1024]) { try { detached.playbackRate = requested; setterAcceptance.push({media,requested,readback:detached.playbackRate}); } catch(error) { setterAcceptance.push({media,requested,error:String(error)}); } }
  }
  status.textContent = 'Rate probe running';
  try {
    // Establish media activation synchronously in this real user gesture.
    const activation = video.play();
    if (owned) {
      if (!controlled) throw new Error('Owned probing requires an extension-controlled video');
      ownedPlayer = video.vsc?.iosPlayer;
      if (!ownedPlayer || ownedPlayer.open({fullscreen:true}) !== true) throw new Error('Owned player unavailable');
      ownedSession = ownedPlayer.session;
      if (!ownedActive() || !identityPreserved() || !sourcePreserved()) throw new Error('Owned player did not preserve the original media session');
    }
    await activation;
    for (const requested of rates) {
      video.pause(); video.loop = false;
      let frameToken;
      const removeListeners = [];
      try {
        await seek(5);
        // One second of warmup plus six measured seconds, with an end margin.
        if (!Number.isFinite(video.duration) || video.duration < 5 + requested * 7 + 1) throw new Error('Insufficient media duration for the complete sample');
        let setterAccepted = true;
        if (controlled) {
          if (!video.vsc?.actionHandler) throw new Error('Extension controller unavailable');
          setterAccepted = video.vsc.actionHandler.setSpeed(video, requested, 'user') === true;
        } else video.playbackRate = requested;
        if (!setterAccepted) throw new Error('Extension rejected the playback rate');
        if (Math.abs(video.playbackRate - requested) > requested * 0.001) throw new Error('Requested playback rate was not accepted');
        await video.play();
        const firstFrame = await firstPresentedFrame();
        if (firstFrame !== 'presented') throw new Error('Video-frame callbacks ' + firstFrame);
        const warmupClock = performance.now();
        await delay(1000);
        const warmupElapsed = (performance.now() - warmupClock) / 1000;
        if (video.duration - video.currentTime < requested * 6 + 1) throw new Error('Insufficient remaining media for the complete measurement');
        const events = {waiting:0,stalled:0,pause:0,ended:0,error:0,hidden:0};
        const eventStates = [];
        let eventStatesTruncated = false;
        const captureEventState = (event) => {
          if (eventStates.length >= 32) { eventStatesTruncated = true; return; }
          const state = {event,elapsedMs:performance.now()-startClock,currentTime:null,readyState:null,networkState:null,bufferedAhead:null};
          try {
            state.currentTime = video.currentTime;
            state.readyState = video.readyState;
            state.networkState = video.networkState;
            const buffered = video.buffered;
            let ahead = 0;
            for (let index = 0; index < buffered.length; index++) {
              if (buffered.start(index) <= state.currentTime && buffered.end(index) >= state.currentTime) ahead = Math.max(ahead, buffered.end(index)-state.currentTime);
            }
            state.bufferedAhead = ahead;
          } catch { /* Missing event-time state fails validation. */ }
          eventStates.push(state);
        };
        const listen = (target, type, callback) => {
          target.addEventListener(type, callback);
          removeListeners.push(() => target.removeEventListener(type, callback));
        };
        for (const type of ['waiting','stalled','pause','ended','error']) listen(video, type, () => {
          events[type]++;
          if (type === 'waiting' || type === 'stalled') captureEventState(type);
        });
        listen(document, 'visibilitychange', () => { if (document.visibilityState !== 'visible') events.hidden++; });
        const ownershipAtStart = !!video.vsc;
        const ownedAtStart = ownedActive();
        const originalIdentityAtStart = identityPreserved();
        const originalSourceAtStart = sourcePreserved();
        let ownershipChanged = false;
        if (owned) {
          for (const type of ['emptied','loadstart']) listen(video, type, () => { ownershipChanged = true; });
        }
        const qualityStart = frameCounters();
        const startTime = video.currentTime;
        const startClock = performance.now();
        const callbackTimes = [];
        let sampling = true;
        const countPresented = () => {
          if (!sampling) return;
          // Measure callback delivery on the same clock as the window edges.
          callbackTimes.push(performance.now() - startClock);
          ownershipChanged = ownershipChanged || ownershipAtStart !== !!video.vsc || (owned && (!ownedActive() || !identityPreserved() || !sourcePreserved()));
          frameToken = video.requestVideoFrameCallback(countPresented);
        };
        frameToken = video.requestVideoFrameCallback(countPresented);
        await delay(6000);
        const endClock = performance.now();
        sampling = false;
        video.cancelVideoFrameCallback?.(frameToken);
        frameToken = undefined;
        const seconds = (endClock - startClock) / 1000;
        const cadence = summarizeFrameCadence(callbackTimes, endClock - startClock);
        const qualityEnd = frameCounters();
        const endTime = video.currentTime;
        const webkitDecodedFrames = qualityStart.webkitDecodedFrameCount === null || qualityEnd.webkitDecodedFrameCount === null ? null : qualityEnd.webkitDecodedFrameCount - qualityStart.webkitDecodedFrameCount;
        results.push({requested,readback:video.playbackRate,setterAccepted,firstFrame,...cadence,callbackFps:cadence?.callbackHz ?? null,qualityStart,qualityEnd,
          // Legacy field now means only the actual WebKit decoded counter.
          decodedFrames:webkitDecodedFrames,webkitDecodedFrames,duration:video.duration,warmupElapsed,startTime,measuredTimeRate:(endTime-startTime)/seconds,elapsed:seconds,time:endTime,ended:video.ended,paused:video.paused,error:video.error?.code || 0,readyState:video.readyState,visibility:document.visibilityState,events,eventStates,eventStatesTruncated,extensionControlled:!!video.vsc,ownedPresentation:ownedAtStart && ownedActive(),originalIdentityAtStart,originalIdentityAtEnd:identityPreserved(),originalSourceAtStart,originalSourceAtEnd:sourcePreserved(),ownershipChanged:ownershipChanged || ownershipAtStart !== !!video.vsc || (owned && !ownedActive())});
      } catch(error) {
        results.push({requested,error:String(error),readback:video.playbackRate,paused:video.paused,ended:video.ended,extensionControlled:!!video.vsc});
      } finally {
        if (frameToken !== undefined) video.cancelVideoFrameCallback?.(frameToken);
        removeListeners.forEach(remove => remove());
        video.pause();
      }
      status.textContent = 'Rate probe results: ' + JSON.stringify({setterAcceptance,results});
    }
  } catch(error) { results.push({error:String(error)}); }
  finally {
    video.pause();
    try {
      ownedPlayer?.close();
      if (ownedPlayer?.active || ownedPlayer?.ui?.host.isConnected) throw new Error('Owned player remained open after probing');
    } catch(error) { pageErrors.push('Owned player cleanup failed: ' + String(error)); }
    video.playbackRate = 1;
    button.disabled = false;
  }
  window.__nativeRateResults = {mode:controlled ? 'extension' : 'native-baseline',presentation,setterAcceptance,results,pageErrors};
  window.__nativeRateResults.validation = validateRateProbeReport(window.__nativeRateResults);
  status.textContent = 'Rate probe complete: ' + JSON.stringify(window.__nativeRateResults);
});
</script></body></html>`;

export function parseByteRange(value, length) {
  if (!value) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) {
    return false;
  }
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
  const start = suffixLength === null ? Number(match[1]) : Math.max(0, length - suffixLength);
  const requestedEnd = suffixLength === null && match[2] ? Number(match[2]) : length - 1;
  const end = Math.min(requestedEnd, length - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    return false;
  }
  return { start, end };
}

function respondWithMedia(request, response, media, contentType = 'video/webm') {
  const range = parseByteRange(request.headers.range, media.length);
  if (range === null) {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': media.length,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    response.end(media);
    return;
  }

  if (range === false) {
    response.writeHead(416, { 'Content-Range': `bytes */${media.length}` });
    response.end();
    return;
  }

  const { start, end } = range;

  response.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${media.length}`,
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(media.subarray(start, end + 1));
}

export async function startFixtureServer({
  mp4Path = resolve('tests/e2e/sample.mp4'),
  probeMp4Path = mp4Path,
  htmlRoutes = {},
  port = 0,
} = {}) {
  // VP8/WebM has native Chrome/Firefox decoding without OS H.264 libraries.
  // Synthetic 60s black clip; regenerate with the command in the manual guide.
  const mediaPath = resolve('tests/e2e/sample.webm');
  const media = await readFile(mediaPath);
  const mp4 = await readFile(mp4Path);
  const probeMp4 = probeMp4Path === mp4Path ? mp4 : await readFile(probeMp4Path);
  const customFeed = await readFile(resolve('tests/e2e/custom-feed.html'), 'utf8');
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/sample.webm') {
      respondWithMedia(request, response, media);
      return;
    }
    if (url.pathname === '/probe.mp4') {
      respondWithMedia(request, response, probeMp4, 'video/mp4');
      return;
    }
    if (url.pathname === '/sample.mp4') {
      respondWithMedia(request, response, mp4, 'video/mp4');
      return;
    }

    if (url.pathname === '/frame.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(url.searchParams.has('empty') ? emptyFrameHtml : frameHtml);
      return;
    }

    if (url.pathname === '/rate-probe.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(rateProbeHtml);
      return;
    }

    if (url.pathname === '/custom-feed.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline' chrome-extension: moz-extension: safari-web-extension:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(customFeed);
      return;
    }

    if (url.pathname === '/mobile.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      let html = url.searchParams.has('mp4')
        ? mobileHtml.replaceAll('/sample.webm', '/sample.mp4')
        : mobileHtml;
      let inlineOriginal = ['', null];
      if (url.searchParams.has('no-playsinline')) {
        html = html
          .replace('muted loop playsinline controls', 'muted loop controls')
          .replace('id="mobile-video"', 'id="mobile-video" aria-label="Test video"');
        inlineOriginal = [null, null];
      } else if (url.searchParams.has('site-inline')) {
        html = html.replace(
          'muted loop playsinline controls',
          'muted loop playsinline="site-standard" webkit-playsinline="site-webkit" controls'
        );
        inlineOriginal = ['site-standard', 'site-webkit'];
      }
      html = html.replace(
        '<div class="player">',
        `<script>window.__stayfastInlineOriginal = ${JSON.stringify(inlineOriginal)};</script><div class="player">`
      );
      response.end(html);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/fixture.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(fixtureHtml);
      return;
    }

    if (Object.hasOwn(htmlRoutes, url.pathname) && typeof htmlRoutes[url.pathname] === 'string') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(htmlRoutes[url.pathname]);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let stopped = false;

  return {
    baseUrl,
    mediaUrl: `${baseUrl}/sample.webm`,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
