/** The owned iOS player surface. Media and playback behavior belong to its owner. */
(function () {
  'use strict';

  class IOSPlayerView {
    constructor(doc) {
      this.host = doc.createElement('vsc-ios-player');
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            display: block;
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            color-scheme: dark;
            color: #fff;
            font: 16px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            -webkit-text-size-adjust: 100%;
          }
          :host([hidden]) { display: none !important; }
          *, *::before, *::after { box-sizing: border-box; }
          dialog {
            all: initial;
            display: none;
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            width: 100dvw;
            height: 100dvh;
            max-width: none;
            max-height: none;
            margin: 0;
            padding: 0;
            border: 0;
            overflow: hidden;
            background: #000;
            color: #fff;
            font: inherit;
            color-scheme: dark;
            overscroll-behavior: contain;
          }
          dialog[open] { display: block; }
          dialog::backdrop { background: #000; }
          .player { position: relative; width: 100%; height: 100%; overflow: hidden; }
          .stage {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            background: #000;
            touch-action: none;
          }
          slot { display: contents; }
          ::slotted(*) {
            display: block !important;
            position: relative !important;
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            object-fit: var(--stayfast-video-fit, contain) !important;
            background: #000 !important;
          }
          .hud {
            position: absolute;
            inset: 0;
            display: grid;
            grid-template-rows: auto minmax(56px, 1fr) auto;
            gap: 12px;
            padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
              max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
            background: linear-gradient(#000b, transparent 28%, transparent 55%, #000d);
            pointer-events: none;
            visibility: visible;
            opacity: 1;
          }
          :host([data-controls-hidden]) .hud,
          dialog[data-controls-hidden] .hud { visibility: hidden; opacity: 0; }
          :host([data-controls-hidden]) .hud:focus-within,
          dialog[data-controls-hidden] .hud:focus-within { visibility: visible; opacity: 1; }
          :host([data-controls-locked]) .hud,
          :host([data-controls-locked]) .seek-feedback { display: none !important; }
          .unlock {
            position: absolute;
            z-index: 5;
            top: max(12px, env(safe-area-inset-top));
            right: max(16px, env(safe-area-inset-right));
            min-width: 44px;
            min-height: 44px;
          }
          .seek-feedback {
            position: absolute;
            z-index: 2;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: calc(50% - 16px);
            padding: 12px 16px;
            border-radius: 999px;
            background: #000b;
            color: #fff;
            font-size: clamp(24px, 6vw, 40px);
            font-weight: 700;
            line-height: 1.2;
            text-align: center;
            white-space: nowrap;
            pointer-events: none;
          }
          .seek-feedback[data-side='left'] { left: 25%; }
          .seek-feedback[data-side='right'] { left: 75%; }
          header {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }
          .identity { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fffc; font-size: 14px; font-weight: 650; }
          button, select, input { font: inherit; color: inherit; pointer-events: auto; }
          button, select {
            min-width: 44px;
            min-height: 44px;
            margin: 0;
            padding: 10px 14px;
            border: 1px solid #ffffff24;
            border-radius: 14px;
            background: #242424c9;
            color: #fff;
            font-size: 16px;
            line-height: 1.25;
            font-weight: 550;
            text-align: center;
            cursor: pointer;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
          }
          button:active { background: #ffffff40; }
          button:disabled, select:disabled, input:disabled { opacity: .45; cursor: default; }
          button:focus-visible, select:focus-visible, input:focus-visible {
            outline: 3px solid #67e8f9;
            outline-offset: 3px;
          }
          .transport {
            display: flex;
            align-items: center;
            justify-content: center;
            align-self: center;
            justify-self: center;
            gap: clamp(14px, 5vw, 32px);
          }
          .transport button {
            min-width: 64px;
            min-height: 64px;
            border-radius: 50%;
            padding: 12px;
            font-size: 18px;
            font-weight: 650;
            background: #141414b3;
          }
          .transport .play { min-width: 80px; min-height: 80px; background: #ffffffed; color: #111; }
          footer { position: relative; min-width: 0; display: grid; gap: 8px; }
          .timeline { display: flex; align-items: center; gap: 10px; min-width: 0; }
          .time { min-width: 3.5ch; color: #fffd; font-size: 13px; font-variant-numeric: tabular-nums; }
          input[type='range'] {
            flex: 1;
            width: 100%;
            min-width: 44px;
            height: 44px;
            margin: 0;
            padding: 0;
            border: 0;
            background: transparent;
            accent-color: #67e8f9;
            cursor: pointer;
          }
          input[data-ref='seek'] { -webkit-appearance: none; appearance: none; direction: ltr; }
          input[data-ref='seek']::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: linear-gradient(to right, #67e8f9 var(--seek-progress, 0%), #ffffff45 var(--seek-progress, 0%));
          }
          input[data-ref='seek']::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; margin-top: -4.5px;
            border: 0; border-radius: 50%; background: #fff;
          }
          input[data-ref='seek']::-moz-range-track {
            height: 3px; border-radius: 999px; background: #ffffff45;
          }
          input[data-ref='seek']::-moz-range-progress {
            height: 3px; border-radius: 999px; background: #67e8f9;
          }
          input[data-ref='seek']::-moz-range-thumb {
            width: 12px; height: 12px; border: 0; border-radius: 50%; background: #fff;
          }
          .options { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; }
          select {
            -webkit-appearance: none; appearance: none;
            height: 46px; min-height: 46px; max-width: 100%; text-align: start;
            padding-right: 32px;
            background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
            background-position: right 14px center, right 9px center;
            background-size: 5px 5px; background-repeat: no-repeat;
          }
          .extra-options {
            position: absolute; z-index: 3;
            left: 0; right: 0;
            bottom: calc(100% + 8px);
            display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px;
            max-height: calc(var(--stayfast-viewport-height, 100dvh) - 140px); overflow-y: auto;
            padding: 12px; border: 1px solid #ffffff30; border-radius: 18px;
            background: #181818f5; box-shadow: 0 8px 30px #0008; pointer-events: auto;
          }
          .speed { color: #67e8f9; font-weight: 700; }
          .custom-speed {
            position: absolute; z-index: 4;
            left: 0; right: 0;
            bottom: calc(100% + 8px);
            display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px;
            max-height: calc(var(--stayfast-viewport-height, 100dvh) - 24px); overflow-y: auto;
            padding: 12px; border: 1px solid #ffffff30; border-radius: 18px; background: #181818f5;
          }
          .custom-speed input {
            width: 110px; min-width: 44px; min-height: 46px; padding: 8px 10px;
            border: 1px solid #ffffff40; border-radius: 12px; background: #181818; font-size: 16px;
          }
          .captions { min-width: 120px; max-width: min(220px, 100%); }
          .escape { justify-self: center; border-color: transparent; background: transparent; color: #fffc; font-size: 14px; }
          .time-toggle { min-width: 44px; padding: 0 4px; border: 0; background: transparent; font-size: 13px; font-weight: 400; }
          .scrub-hint { margin: 0; min-height: 1.2em; text-align: center; color: #fffc; font-size: 12px; }
          input[type='range'] { touch-action: none; }
          .volume { flex: 0 1 100px; max-width: 100px; }
          .status { margin: 0; color: #fffd; text-align: center; font-size: 14px; overflow-wrap: anywhere; }
          .status:empty { display: none; }
          [hidden] { display: none !important; }
          @media (orientation: landscape) and (max-height: 500px) {
            .hud { gap: 4px; padding-top: max(6px, env(safe-area-inset-top)); padding-bottom: max(6px, env(safe-area-inset-bottom)); }
            footer { gap: 2px; }
            .transport button { min-width: 56px; min-height: 56px; }
            .transport .play { min-width: 64px; min-height: 64px; }
            .options { gap: 6px; }
            .escape { padding-top: 8px; padding-bottom: 8px; }
          }
          @media (max-width: 360px) {
            .hud { padding-left: max(10px, env(safe-area-inset-left)); padding-right: max(10px, env(safe-area-inset-right)); }
            .identity { font-size: 12px; }
            button, select { padding-left: 10px; padding-right: 10px; }
            .options { gap: 6px; }
          }
        </style>
        <dialog aria-label="StayFast video player" aria-modal="true" tabindex="-1">
          <div class="player">
            <div class="stage" role="group" aria-label="Video display"><slot name="media"></slot></div>
            <div class="hud">
              <header>
                <button type="button" data-ref="done" aria-label="Close StayFast video player">Done</button>
                <span class="identity">StayFast</span>
                <button type="button" data-ref="lock" aria-label="Lock playback controls" aria-pressed="false">Lock</button>
                <button type="button" data-ref="fullscreen" aria-label="Enter full screen">Full screen</button>
              </header>
              <div class="transport" role="group" aria-label="Playback controls">
                <button type="button" data-ref="back" aria-label="Rewind 10 seconds">−10s</button>
                <button type="button" class="play" data-ref="play" aria-label="Play">Play</button>
                <button type="button" data-ref="forward" aria-label="Forward 10 seconds">+10s</button>
              </div>
              <footer>
                <div class="options" role="group" aria-label="Video options">
                  <select class="speed" data-ref="speed" aria-label="Playback speed">
                    <option value="0.5">0.5×</option><option value="0.75">0.75×</option>
                    <option value="1" selected>1×</option><option value="1.25">1.25×</option>
                    <option value="1.5">1.5×</option><option value="1.75">1.75×</option>
                    <option value="2">2×</option><option value="2.5">2.5×</option>
                    <option value="3">3×</option><option value="4">4×</option>
                    ${[6, 8, 12, 16]
                      .filter((speed) => speed <= window.VSC.Constants.SPEED_LIMITS.MAX)
                      .map((speed) => `<option value="${speed}">${speed}×</option>`)
                      .join('')}
                    <option value="custom">Custom…</option>
                  </select>
                  <button type="button" data-ref="normal" aria-label="Normal speed" aria-pressed="false">1×</button>
                  <button type="button" data-ref="preferred" aria-label="Preferred speed" aria-pressed="false">Pref</button>
                  <button type="button" data-ref="fit" aria-label="Fill screen (crop edges)" aria-pressed="false" title="Fill crops the video edges">Fill</button>
                  <button type="button" data-ref="mute" aria-label="Mute audio">Mute</button>
                  <button type="button" data-ref="more" aria-label="More video options" aria-expanded="false" aria-controls="extra-options">More</button>
                  <div class="custom-speed" data-ref="customSpeedGroup" role="group" aria-label="Custom playback speed" hidden>
                    <input type="number" data-ref="customSpeed" aria-label="Custom playback speed" inputmode="decimal" min="0.07" max="${window.VSC.Constants.SPEED_LIMITS.MAX}" step="any" />
                    <button type="button" data-ref="customSpeedApply">Set speed</button>
                  </div>
                </div>
                <div class="extra-options" id="extra-options" data-ref="extra" role="group" aria-label="More video options" hidden>
                  <button type="button" data-ref="frameBack" aria-label="Frame back" title="Frame back">|◀</button>
                  <button type="button" data-ref="frameForward" aria-label="Frame forward" title="Frame forward">▶|</button>
                  <select class="captions" data-ref="captions" aria-label="Captions"><option value="off">Captions off</option></select>
                  <select data-ref="audio" aria-label="Audio language" hidden></select>
                  <button type="button" data-ref="live" aria-label="Go to live edge" hidden>Go live</button>
                  <input type="range" class="volume" data-ref="volume" aria-label="Volume" min="0" max="1" step="0.05" value="1" hidden />
                  <button type="button" data-ref="pip" aria-label="Picture in Picture">PiP</button>
                  <button type="button" data-ref="airplay" aria-label="Choose AirPlay device">AirPlay</button>
                  <button type="button" data-ref="native" aria-label="Open Apple fullscreen player" hidden>Apple player</button>
                  <button type="button" class="escape" data-ref="site">Use site player</button>
                </div>
                <p class="status" data-ref="status" role="status" aria-live="polite" aria-atomic="true"></p>
                <p class="scrub-hint" id="scrub-hint" data-ref="scrubHint" role="status" aria-live="polite">Drag away from the timeline for finer scrubbing.</p>
                <div class="timeline">
                  <span class="time" data-ref="current">0:00</span>
                  <input type="range" data-ref="seek" aria-label="Seek video" aria-describedby="scrub-hint" min="0" max="100" step="0.1" value="0" />
                  <button type="button" class="time time-toggle" data-ref="duration" aria-label="Show remaining time">--:--</button>
                </div>
              </footer>
            </div>
            <button type="button" class="unlock" data-ref="unlock" aria-label="Unlock playback controls" hidden>Unlock</button>
            <div class="seek-feedback" data-ref="seekFeedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
        </dialog>
      `;
      this.dialog = this.shadow.querySelector('dialog');
      this.screen = this.shadow.querySelector('.player');
      this.stage = this.shadow.querySelector('.stage');
      this.mediaSlot = this.shadow.querySelector('slot[name="media"]');
      this.refs = {};
      for (const element of this.shadow.querySelectorAll('[data-ref]')) {
        this.refs[element.dataset.ref] = element;
      }
    }

    updateSeekProgress() {
      const range = this.refs.seek;
      const min = Number(range.min);
      const max = Number(range.max);
      const value = Number(range.value);
      const fraction =
        !range.disabled && Number.isFinite(value) && max > min
          ? Math.max(0, Math.min(1, (value - min) / (max - min)))
          : 0;
      const progress = `${Math.round(fraction * 100000) / 1000}%`;
      if (range.style.getPropertyValue('--seek-progress') !== progress) {
        range.style.setProperty('--seek-progress', progress);
      }
    }

    destroy() {
      this.host.remove();
    }
  }

  window.VSC = window.VSC || {};
  window.VSC.IOSPlayerView = IOSPlayerView;
})();
