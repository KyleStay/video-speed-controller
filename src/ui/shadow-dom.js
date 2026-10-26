/**
 * Shadow DOM creation and management
 */

window.VSC = window.VSC || {};

class ShadowDOMManager {
  static controlIcons = {
    play: 'm8 5 11 7-11 7Z',
    pause: 'M7 5h3v14H7zm7 0h3v14h-3z',
    replay: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    back: 'M8 3 4 7l4 4M4 7h8a8 8 0 0 1 8 8',
    forward: 'm16 3 4 4-4 4m4-4h-8a8 8 0 0 0-8 8',
    sound: 'M11 4 6 8H3v8h3l5 4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
    muted: 'M11 4 6 8H3v8h3l5 4Zm5 5 5 6m0-6-5 6',
    close: 'm6 6 12 12M6 18 18 6',
    lock: 'M7 10h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM8 10V7a4 4 0 0 1 8 0v3',
    unlock:
      'M7 10h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM8 10V7a4 4 0 0 1 8 0',
    expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
    contract: 'M3 9h6V3m12 6h-6V3M9 21v-6H3m12 6v-6h6',
    preferred: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };

  /** Use DOM APIs so MAIN-world pages enforcing Trusted Types still attach. */
  static setControlIcon(button, name) {
    if (button.dataset.vscIcon === name) {
      return;
    }
    const doc = button.ownerDocument;
    const create = (tag, attributes) => {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      return node;
    };
    const svg = create('svg', {
      class: 'vsc-control-icon',
      viewBox: '0 0 24 24',
      width: '24',
      height: '24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': name === 'more' ? '3' : '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const solid = name === 'play' || name === 'pause';
    svg.appendChild(
      create('path', {
        d: this.controlIcons[name],
        fill: solid ? 'currentColor' : 'none',
        stroke: solid ? 'none' : 'currentColor',
      })
    );
    if (name === 'back' || name === 'forward') {
      const text = create('text', {
        x: name === 'back' ? '11' : '13',
        y: '21',
        stroke: 'none',
        fill: 'currentColor',
        'font-size': '11',
        'font-family': 'system-ui',
        'text-anchor': 'middle',
      });
      text.textContent = '10';
      svg.appendChild(text);
    }
    button.replaceChildren(svg);
    button.dataset.vscIcon = name;
  }

  /**
   * Create shadow DOM for video controller
   * @param {HTMLElement} wrapper - Wrapper element
   * @param {Object} options - Configuration options
   * @returns {ShadowRoot} Created shadow root
   */
  static createShadowDOM(wrapper, options = {}) {
    const { top = '0px', left = '0px', speed = '1.00', opacity = 0.3, buttonSize = 14 } = options;
    const numericOpacity = Number(opacity);
    const activeOpacity = numericOpacity > 0 ? Math.max(numericOpacity, 0.75) : 0;

    const shadow = wrapper.attachShadow({ mode: 'open' });

    // Create style element with embedded CSS for immediate styling
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        line-height: 1.6em;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
      }
      
      :host(:hover) #controls,
      :host(:focus-within) #controls {
        display: inline-block;
      }
      
      /* Hide shadow DOM content for different hiding scenarios */
      :host(.vsc-hidden) #controller,
      :host(.vsc-nosource) #controller {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }

      /* YouTube autohide — fade with player controls.
         :host-context() matches when any ancestor of <vsc-controller> has the
         class, so no JS MutationObserver forwarding is needed. */
      :host-context(.ytp-autohide) #controller {
        visibility: hidden !important;
        opacity: 0 !important;
        transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Temporarily show controller (speed change flash, highest priority).
         vsc-manual:not(vsc-hidden) intentionally has NO CSS rule — user toggling
         back to "show" should restore default behavior (follow autohide), not
         permanently override it. vsc-manual is only read by JS flash guards. */

      /* Show shadow DOM content when host has vsc-show class (highest priority) */
      :host(.vsc-show) #controller {
        display: block !important;
        visibility: visible !important;
        opacity: var(--vsc-controller-active-opacity) !important;
      }
      
      #controller {
        position: absolute;
        top: 0;
        left: 0;
        border: 1px solid rgba(103, 232, 249, 0.34);
        background: rgba(5, 24, 39, 0.96);
        color: #f0fbff;
        border-radius: 9px;
        padding: 4px 5px;
        margin: 10px 10px 10px 15px;
        cursor: default;
        z-index: 9999999;
        white-space: nowrap;
        opacity: var(--vsc-controller-opacity);
        box-shadow: 0 4px 16px rgba(0, 12, 22, 0.28);
        transition: opacity 0.16s ease, border-color 0.16s ease;
      }
      
      #controller:hover,
      #controller:focus-within {
        opacity: var(--vsc-controller-active-opacity);
        border-color: rgba(103, 232, 249, 0.7);
      }
      
      #controller:hover>.draggable,
      #controller:focus-within>.draggable {
        margin-right: 0.8em;
      }
      
      #controls {
        display: none;
        vertical-align: middle;
      }
      
      #controller.dragging {
        cursor: -webkit-grabbing;
        opacity: var(--vsc-controller-active-opacity);
      }
      
      #controller.dragging #controls {
        display: inline-block;
      }
      
      .draggable {
        cursor: -webkit-grab;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: 3.1em;
        height: 1.4em;
        min-width: 24px;
        min-height: 24px;
        text-align: center;
        vertical-align: middle;
        box-sizing: border-box;
        touch-action: none;
        color: #f0fbff;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .draggable::before {
        width: 5px;
        height: 5px;
        margin-right: 5px;
        border-radius: 50%;
        background: #22d3ee;
        box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15);
        content: "";
      }
      
      .draggable:active {
        cursor: -webkit-grabbing;
      }
      
      button {
        opacity: 1;
        cursor: pointer;
        color: #dff8ff;
        background: rgba(148, 203, 221, 0.12);
        font-weight: 600;
        border-radius: 6px;
        padding: 1px 6px;
        font-size: inherit;
        line-height: inherit;
        border: 1px solid rgba(148, 203, 221, 0.2);
        font-family: inherit;
        margin: 0px 2px 2px 2px;
        min-width: 24px;
        min-height: 24px;
        transition: background 0.16s, color 0.16s, border-color 0.16s;
      }
      
      button:focus {
        outline: none;
      }

      button:focus-visible,
      .draggable:focus-visible {
        outline: 2px solid #67e8f9;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(8, 47, 73, 0.92);
      }
      
      @media (hover: hover) {
        button:hover {
          opacity: 1;
          border-color: #22d3ee;
          background: #0e7490;
          color: #ffffff;
        }
      }
      
      button:active {
        background: #155e75;
        color: #ffffff;
        font-weight: bold;
      }
      
      button.rw {
        color: #a8ddea;
      }

      .touch-only {
        display: none;
      }

      :host(.vsc-native-presentation) #controller {
        display: none !important;
      }

      :host([data-vsc-touch]) #controller {
        border-radius: 14px;
        padding: 0;
        margin: 8px;
      }

      :host([data-vsc-touch]:not(.vsc-hidden):not(.vsc-nosource)) #controller {
        visibility: visible !important;
        opacity: var(--vsc-controller-active-opacity) !important;
      }

      :host([data-vsc-touch]) .draggable {
        min-width: 64px;
        min-height: 44px;
        margin: 0;
        padding: 4px 10px;
        font-size: var(--vsc-controller-font-size, 16px) !important;
        cursor: pointer;
        touch-action: manipulation;
      }

      :host([data-vsc-touch]) .draggable::after {
        content: '×';
        margin-left: 2px;
      }

      :host([data-vsc-touch]) #controls {
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        width: 280px;
        max-width: calc(100vw - 16px);
        padding: 8px;
        border: 1px solid rgba(103, 232, 249, 0.4);
        border-radius: 16px;
        background: #051827;
        box-shadow: 0 8px 24px rgba(0, 12, 22, 0.3);
        white-space: normal;
        font-size: var(--vsc-controller-font-size, 16px) !important;
        overflow: auto;
        overscroll-behavior: contain;
      }

      :host([data-vsc-touch].vsc-touch-open) #controls {
        display: grid;
        grid-template-columns: repeat(var(--vsc-touch-columns, 4), minmax(44px, 1fr));
        gap: 4px;
      }

      :host([data-vsc-touch].vsc-touch-open:not(.vsc-hidden):not(.vsc-nosource)) #controller {
        opacity: var(--vsc-controller-expanded-opacity) !important;
      }

      :host([data-vsc-touch]) button {
        min-width: 44px;
        min-height: 44px;
        margin: 0;
        padding: 4px;
        font-size: var(--vsc-controller-font-size, 16px);
        touch-action: manipulation;
      }

      :host([data-vsc-touch]) .touch-only {
        display: block;
      }

      :host([data-vsc-touch]) .touch-heading {
        grid-column: 1 / -2;
        align-self: center;
        padding-left: 6px;
        font-size: 14px;
        font-weight: 600;
        color: #b9d7e5;
      }

      :host([data-vsc-touch]) .touch-preset[aria-pressed='true'] {
        background: #0e7490;
        border-color: #67e8f9;
        color: #fff;
      }

      .inline-fullscreen { display: none; }

      :host([data-vsc-ios-inline]) #controller {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 44px;
        padding: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      :host([data-vsc-ios-inline].vsc-show) #controller {
        display: inline-flex !important;
      }

      :host([data-vsc-ios-inline]) .draggable {
        flex: 0 0 var(--vsc-inline-pill-width, 44px);
        width: var(--vsc-inline-pill-width, 44px);
        min-width: 44px;
        height: 44px;
        min-height: 44px;
        padding: 4px;
        margin: 0;
        overflow: hidden;
        line-height: 1;
        font-size: var(--vsc-inline-font-size, 13px) !important;
        border: 0;
        border-radius: 10px;
        background: transparent;
        text-shadow: 0 1px 3px #000, 0 0 8px #000;
      }

      :host([data-vsc-ios-inline]) .draggable::after {
        flex-shrink: 0;
        font-size: 11px;
        margin-left: 1px;
      }

      :host([data-vsc-ios-inline]) .draggable::before { display: none; }
      :host([data-vsc-ios-inline]) #controller:hover > .draggable,
      :host([data-vsc-ios-inline]) #controller:focus-within > .draggable { margin-right: 0; }

      :host([data-vsc-ios-inline]) .inline-fullscreen {
        display: inline-flex;
        flex: 0 0 44px;
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 10px;
        background: transparent;
        font-size: 18px;
      }

      :host([data-vsc-ios-inline][data-vsc-inline-tiny]) .draggable { display: none; }
      :host([data-vsc-ios-inline][data-vsc-inline-tiny]) .inline-fullscreen {
        border-radius: 10px;
      }

      :host([data-vsc-ios-inline][data-vsc-inline-unavailable]) #controller,
      :host([data-vsc-ios-inline].vsc-native-presentation) #controller {
        display: none !important;
      }

      :host([data-vsc-ios-inline]) #controls {
        position: fixed;
        margin: 0;
        inset: auto;
        height: max-content;
        block-size: max-content;
        min-height: 0;
        align-content: start;
        grid-auto-rows: minmax(44px, max-content);
        line-height: 1.4;
        font-size: clamp(13px, var(--vsc-controller-font-size, 14px), 18px) !important;
      }

      :host([data-vsc-ios-inline]) #controls button {
        font-size: inherit !important;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      :host([data-vsc-ios-inline]) #controls [aria-label='Open StayFast player'] {
        grid-column: 1 / -1;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      :host([data-vsc-ios-inline]:not([data-vsc-inline-owned]).vsc-inline-playing:not(.vsc-touch-open):not(.vsc-show):not(:focus-within)) #controller {
        opacity: var(--vsc-inline-playing-opacity) !important;
      }

      .inline-owned-control, .inline-owned-status { display: none; }
      :host([data-vsc-inline-owned]) .inline-owned-control[hidden] { display: none !important; }
      :host([data-vsc-ios-inline][data-vsc-inline-owned]) #controller {
        width: var(--vsc-inline-owned-width, 44px);
        max-width: var(--vsc-inline-owned-width, 44px);
        height: auto;
        min-height: calc(44px / var(--vsc-inline-scale-y, 1));
        flex-wrap: wrap;
        column-gap: calc(4px / var(--vsc-inline-scale-x, 1));
        row-gap: calc(4px / var(--vsc-inline-scale-y, 1));
        opacity: 1 !important;
        visibility: visible !important;
        transition: opacity 0.16s ease;
      }
      :host([data-vsc-inline-owned]) .inline-owned-control:not([hidden]) {
        display: inline-flex;
        flex: 0 0 calc(44px / var(--vsc-inline-scale-x, 1));
        width: calc(44px / var(--vsc-inline-scale-x, 1));
        height: calc(44px / var(--vsc-inline-scale-y, 1));
        min-width: calc(44px / var(--vsc-inline-scale-x, 1));
        min-height: calc(44px / var(--vsc-inline-scale-y, 1));
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: calc(4px / var(--vsc-inline-scale-y, 1)) calc(4px / var(--vsc-inline-scale-x, 1));
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #fff;
        font-size: calc(13px / var(--vsc-inline-scale-y, 1)) !important;
        line-height: 1;
        touch-action: manipulation;
      }
      .vsc-control-icon {
        display: block;
        width: 24px;
        height: 24px;
        pointer-events: none;
        filter: drop-shadow(0 1px 2px #000) drop-shadow(0 0 4px #0009);
      }
      :host([data-vsc-inline-owned]) .vsc-control-icon {
        width: calc(24px / var(--vsc-inline-scale-x, 1));
        height: calc(24px / var(--vsc-inline-scale-y, 1));
      }
      :host([data-vsc-ios-inline]) .inline-fullscreen:active,
      :host([data-vsc-inline-owned]) button.inline-owned-control:active {
        background: transparent;
        color: #67e8f9;
      }
      :host([data-vsc-ios-inline][data-vsc-inline-owned]) .draggable {
        display: inline-flex;
        flex-basis: calc(var(--vsc-inline-pill-width, 44px) / var(--vsc-inline-scale-x, 1));
        width: calc(var(--vsc-inline-pill-width, 44px) / var(--vsc-inline-scale-x, 1));
        min-width: calc(44px / var(--vsc-inline-scale-x, 1));
        height: calc(44px / var(--vsc-inline-scale-y, 1));
        min-height: calc(44px / var(--vsc-inline-scale-y, 1));
        font-size: calc(var(--vsc-inline-font-size, 13px) / var(--vsc-inline-scale-y, 1)) !important;
      }
      :host([data-vsc-ios-inline][data-vsc-inline-owned]) .inline-fullscreen {
        flex-basis: calc(44px / var(--vsc-inline-scale-x, 1));
        width: calc(44px / var(--vsc-inline-scale-x, 1));
        min-width: calc(44px / var(--vsc-inline-scale-x, 1));
        height: calc(44px / var(--vsc-inline-scale-y, 1));
        min-height: calc(44px / var(--vsc-inline-scale-y, 1));
        font-size: calc(18px / var(--vsc-inline-scale-y, 1));
      }
      :host([data-vsc-inline-owned][data-vsc-inline-layout='compact']) .draggable,
      :host([data-vsc-inline-owned][data-vsc-inline-layout='minimal']) .draggable,
      :host([data-vsc-inline-owned][data-vsc-inline-layout='minimal']) .inline-fullscreen {
        display: none !important;
      }
      :host([data-vsc-inline-owned]) .inline-timeline:not([hidden]) {
        position: absolute;
        left: var(--vsc-inline-timeline-left, 0px);
        top: var(--vsc-inline-timeline-top, 0px);
        width: var(--vsc-inline-timeline-width, 44px);
        min-width: var(--vsc-inline-timeline-width, 44px);
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        gap: calc(6px / var(--vsc-inline-scale-x, 1));
        background: transparent;
      }
      :host([data-vsc-inline-owned]) .inline-seek {
        width: 0;
        flex: 1 1 44px;
        min-width: calc(44px / var(--vsc-inline-scale-x, 1));
        height: calc(44px / var(--vsc-inline-scale-y, 1));
        min-height: calc(44px / var(--vsc-inline-scale-y, 1));
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        -webkit-appearance: none;
        appearance: none;
        direction: ltr;
        touch-action: none;
      }
      :host([data-vsc-inline-owned]) .inline-seek::-webkit-slider-runnable-track {
        height: calc(3px / var(--vsc-inline-scale-y, 1));
        border-radius: 999px;
        background: linear-gradient(to right, #67e8f9 var(--seek-progress, 0%), #ffffff45 var(--seek-progress, 0%));
      }
      :host([data-vsc-inline-owned]) .inline-seek::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: calc(12px / var(--vsc-inline-scale-x, 1));
        height: calc(12px / var(--vsc-inline-scale-y, 1));
        margin-top: calc(-4.5px / var(--vsc-inline-scale-y, 1));
        border: 0; border-radius: 50%; background: #fff;
      }
      :host([data-vsc-inline-owned]) .inline-time {
        font-size: calc(11px / var(--vsc-inline-scale-y, 1));
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      :host([data-vsc-inline-owned]) .inline-scrub-hint {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        max-width: 100%;
        margin: 0;
        padding: calc(4px / var(--vsc-inline-scale-y, 1)) calc(8px / var(--vsc-inline-scale-x, 1));
        border-radius: 6px;
        background: #111e;
        color: #fff;
        font-size: calc(13px / var(--vsc-inline-scale-y, 1));
        line-height: 1.3;
        text-align: center;
        white-space: normal;
        pointer-events: none;
      }
      :host([data-vsc-inline-owned]) .inline-scrub-hint:empty { display: none; }
      :host([data-vsc-ios-inline][data-vsc-inline-owned][data-vsc-inline-strip-hidden]) #controller {
        visibility: hidden !important;
      }
      :host([data-vsc-inline-owned][data-vsc-inline-strip-hidden]:not([data-vsc-inline-idle])) .inline-timeline {
        visibility: visible;
      }
      :host([data-vsc-inline-owned]) .inline-owned-status {
        display: block;
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
      :host([data-vsc-ios-inline][data-vsc-inline-owned][data-vsc-inline-idle]) #controller {
        opacity: 0 !important;
      }
      :host([data-vsc-inline-owned][data-vsc-inline-idle]) #controller,
      :host([data-vsc-inline-owned][data-vsc-inline-idle]) #controller * {
        pointer-events: none !important;
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation: none !important;
          transition: none !important;
        }
      }
    `;
    shadow.appendChild(style);

    // Create controller div
    const controller = document.createElement('div');
    controller.id = 'controller';
    controller.style.cssText = `top:${top}; left:${left}; --vsc-controller-font-size:${buttonSize}px; --vsc-inline-playing-opacity:${numericOpacity > 0 ? Math.max(numericOpacity, 0.4) : 0}; --vsc-controller-opacity:${opacity}; --vsc-controller-active-opacity:${activeOpacity}; --vsc-controller-expanded-opacity:${numericOpacity > 0 ? 1 : 0};`;

    // Create draggable speed indicator
    const draggable = document.createElement('span');
    draggable.setAttribute('data-action', 'drag');
    draggable.setAttribute('role', 'button');
    draggable.setAttribute('tabindex', '0');
    draggable.setAttribute('aria-label', `Playback speed ${speed}. Press Enter to reset speed.`);
    draggable.setAttribute('title', `Playback speed ${speed}. Press Enter to reset speed.`);
    draggable.setAttribute('aria-live', 'polite');
    draggable.className = 'draggable';
    draggable.style.cssText = `font-size: ${buttonSize}px;`;
    draggable.textContent = speed;
    controller.appendChild(draggable);

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'inline-fullscreen';
    fullscreen.dataset.action = 'ownedFullscreen';
    fullscreen.setAttribute('aria-label', 'Open video fullscreen');
    fullscreen.setAttribute('title', 'Open video fullscreen');
    this.setControlIcon(fullscreen, 'expand');
    controller.appendChild(fullscreen);

    // Create controls span
    const controls = document.createElement('span');
    controls.id = 'controls';
    controls.style.cssText = `font-size: ${buttonSize}px; line-height: ${buttonSize}px;`;

    const heading = document.createElement('span');
    heading.className = 'touch-only touch-heading';
    heading.textContent = 'Playback speed';
    controls.appendChild(heading);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'touch-only';
    close.dataset.action = 'close';
    close.setAttribute('aria-label', 'Close speed controls');
    close.textContent = '×';
    controls.appendChild(close);

    for (const preset of [1, 1.25, 1.5, 2]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = preset === 1 ? 'touch-preset' : 'touch-only touch-preset';
      button.dataset.action = 'setSpeed';
      button.dataset.value = String(preset);
      button.setAttribute('aria-label', `Set playback speed to ${preset} times`);
      button.setAttribute('title', preset === 1 ? 'Reset speed to 1×' : `Set speed to ${preset}×`);
      button.setAttribute('aria-pressed', String(Number(speed) === preset));
      button.textContent = `${preset}×`;
      controls.appendChild(button);
    }

    // Create buttons
    const buttons = [
      { action: 'preferredSpeed', text: 'Pref', class: '', label: 'Set preferred speed' },
      { action: 'rewind', text: '«', class: 'rw', label: 'Rewind' },
      { action: 'slower', text: '−', class: '', label: 'Decrease speed' },
      { action: 'faster', text: '+', class: '', label: 'Increase speed' },
      { action: 'advance', text: '»', class: 'rw', label: 'Advance' },
      { action: 'rewindFrame', text: '|◀', class: 'frame-step', label: 'Frame back' },
      { action: 'advanceFrame', text: '▶|', class: 'frame-step', label: 'Frame forward' },
    ];

    buttons.forEach((btnConfig) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-action', btnConfig.action);
      if (btnConfig.class) {
        button.className = btnConfig.class;
      }
      button.setAttribute('aria-label', btnConfig.label);
      button.setAttribute('title', btnConfig.label);
      button.textContent = btnConfig.text;
      controls.appendChild(button);
    });

    controller.appendChild(controls);
    shadow.appendChild(controller);

    window.VSC.logger.debug('Shadow DOM created for video controller');
    return shadow;
  }

  /**
   * Get controller element from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controller element
   */
  static getController(shadow) {
    return shadow.querySelector('#controller');
  }

  /**
   * Get controls container from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Controls element
   */
  static getControls(shadow) {
    return shadow.querySelector('#controls');
  }

  /**
   * Get draggable speed indicator from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {HTMLElement} Speed indicator element
   */
  static getSpeedIndicator(shadow) {
    return shadow.querySelector('.draggable');
  }

  /**
   * Get all buttons from shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @returns {NodeList} Button elements
   */
  static getButtons(shadow) {
    return shadow.querySelectorAll('button');
  }

  /**
   * Update speed display in shadow DOM
   * @param {ShadowRoot} shadow - Shadow root
   * @param {number} speed - New speed value
   */
  static updateSpeedDisplay(shadow, speed) {
    speed = Number(speed);
    if (!Number.isFinite(speed)) {
      return;
    }
    const speedIndicator = this.getSpeedIndicator(shadow);
    if (speedIndicator) {
      const formattedSpeed = window.VSC.Constants.formatSpeed(speed);
      const label = shadow.host.hasAttribute('data-vsc-touch')
        ? `Playback speed ${formattedSpeed} times. Tap to show speed controls.`
        : `Playback speed ${formattedSpeed}. Press Enter to reset speed.`;
      const inline = shadow.host.hasAttribute('data-vsc-ios-inline');
      const compactSpeed =
        speed >= 1000
          ? speed.toExponential(1).replace('.0e', 'e').replace('e+', 'e')
          : String(Number(speed.toFixed(2)));
      speedIndicator.textContent = inline ? compactSpeed : formattedSpeed;
      speedIndicator.dataset.speed = String(speed);
      if (inline) {
        const length = compactSpeed.length;
        const controller = shadow.querySelector('#controller');
        controller.style.setProperty(
          '--vsc-inline-pill-width',
          `${Math.max(44, Math.min(56, (length + 1) * 8 + 10))}px`
        );
        controller.style.setProperty(
          '--vsc-inline-font-size',
          length > 5 ? '11px' : length > 4 ? '11.5px' : '13px'
        );
      }
      speedIndicator.setAttribute('aria-label', label);
      speedIndicator.setAttribute('title', label);
    }
    shadow.querySelectorAll('.touch-preset').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.value) === speed));
    });
  }

  /**
   * Calculate position for controller based on video element
   * @param {HTMLVideoElement} video - Video element
   * @returns {Object} Position object with top and left properties
   */
  static calculatePosition(video) {
    const rect = video.getBoundingClientRect();

    // getBoundingClientRect is relative to the viewport; style coordinates
    // are relative to offsetParent, so we adjust for that here. offsetParent
    // can be null if the video has `display: none` or is not yet in the DOM.
    const offsetRect = video.offsetParent?.getBoundingClientRect();
    const top = `${Math.max(rect.top - (offsetRect?.top || 0), 0)}px`;
    const left = `${Math.max(rect.left - (offsetRect?.left || 0), 0)}px`;

    return { top, left };
  }
}

// Create singleton instance
window.VSC.ShadowDOMManager = ShadowDOMManager;
