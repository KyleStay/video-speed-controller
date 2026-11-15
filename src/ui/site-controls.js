/** Scoped, reversible suppression of site player chrome. */
window.VSC = window.VSC || {};

const SITE_CONTROL_ATTRIBUTE = 'data-vsc-site-controls';
const HIDDEN_CONTROL_ATTRIBUTE = 'data-vsc-site-hidden-control';
const STRONG_NODE_LIMIT = 512;
const GENERIC_CONTROL_PROFILE = { controls: [] };
const PROTECTED_CONTENT = [
  'video',
  'audio',
  'canvas',
  'ogvjs',
  'vsc-controller',
  '.ytp-caption-window-container',
  '.caption-window',
  '.caption',
  '.subtitle',
  '.captions-text',
  '.vjs-text-track-display',
  '.plyr__captions',
  '.jw-captions',
  '[role="caption"]',
  '[data-testid="captions"]',
  '[data-testid="subtitles"]',
  '[class~="captions"]',
  '[class~="subtitles"]',
].join(',');
const STRONG_CONTROLS =
  'button,[role="button"],summary,input:not([type="hidden"]),select,textarea,[role="slider"],[role="scrollbar"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],progress,[role="progressbar"],a[href]';
const CONTROL_LINK_LABEL =
  /\b(play|pause|replay|mute|unmute|volume|full\s*screen|seek|rewind|forward|skip|speed|settings|quality|captions?|subtitles?|picture.in.picture|share|download)\b/i;
const SITE_CONTROL_PROFILES = [
  {
    container: '.html5-video-player',
    controls: [
      '.ytp-chrome-top',
      '.ytp-chrome-bottom',
      '.ytp-gradient-top',
      '.ytp-gradient-bottom',
      '.ytp-pause-overlay',
      '.ytp-large-play-button',
    ],
  },
  { container: '.video-js', controls: ['.vjs-control-bar', '.vjs-big-play-button'] },
  { container: '.plyr', controls: ['.plyr__controls', '.plyr__control--overlaid'] },
  { container: '.jwplayer', controls: ['.jw-controlbar', '.jw-display-controls'] },
  {
    container: '[data-testid="videoPlayer"]',
    controls: [
      '[data-testid="videoControlPlayButton"]',
      '[data-testid="videoControlPlaybackRate"]',
      '[data-testid="videoControlFullscreenButton"]',
      '[data-testid="videoControlVolumeButton"]',
      '[data-testid="videoControlMuteButton"]',
      '[data-testid="videoControlSeekBar"]',
      '[data-testid="videoControlCurrentTime"]',
      '[data-testid="videoControlDuration"]',
    ],
  },
];
const siteControlOwners = new WeakMap();
let siteControlSequence = 0;
const XDS_NESTED_CONTROL_GROUP =
  'div.pointer-events-none.absolute.inset-s-0.inset-e-0.bottom-0.z-20.flex.items-end > [class~="group/controls"]';
const XDS_SITE_CONTROL_PROFILE = {
  controls: [
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Play"]',
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Pause"]',
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Replay"]',
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Watch again"]',
    '> [data-slot="xds-context-menu-trigger"] > [class~="group/controls"]',
    `> [data-slot="xds-context-menu-trigger"] > ${XDS_NESTED_CONTROL_GROUP}`,
    '> [data-slot="xds-context-menu-trigger"] [data-slot="xds-button"][aria-label="Mute"]',
    '> [data-slot="xds-context-menu-trigger"] [data-slot="xds-button"][aria-label="Unmute"]',
    '> [data-slot="xds-context-menu-trigger"] [data-slot="xds-button"][aria-label="Replay"]',
  ],
};

class SiteControls {
  static isXDocument(doc) {
    try {
      return /(^|\.)(x\.com|twitter\.com)$/.test(doc.location.hostname);
    } catch {
      return false;
    }
  }

  /** X's current player has no legacy test IDs. Recognize its exact sibling structure. */
  static findXPlayer(video) {
    try {
      const doc = video?.ownerDocument;
      const node = video?.parentElement;
      if (
        !this.isXDocument(doc) ||
        video.localName !== 'video' ||
        !video.isConnected ||
        !node ||
        node.getRootNode() !== doc ||
        node.querySelectorAll('video').length !== 1 ||
        node.querySelector('iframe')
      ) {
        return null;
      }
      const triggers = node.querySelectorAll(':scope > [data-slot="xds-context-menu-trigger"]');
      if (triggers.length !== 1) {
        return null;
      }
      const trigger = triggers[0];
      if (
        !trigger.querySelector(
          ':scope > button[aria-label="Play"], :scope > button[aria-label="Pause"], :scope > button[aria-label="Replay"]'
        ) ||
        trigger.querySelectorAll(
          `:scope > [class~="group/controls"], :scope > ${XDS_NESTED_CONTROL_GROUP}`
        ).length !== 1
      ) {
        return null;
      }
      return { node, trigger, profile: XDS_SITE_CONTROL_PROFILE, doc };
    } catch {
      return null;
    }
  }

  constructor(video) {
    this.video = video;
    this.token = `vsc-${++siteControlSequence}`;
    this.container = null;
    this.document = null;
    this.profile = null;
    this.style = null;
    this.originalMarker = null;
    this.hadMarker = false;
    this.hideAllButtons = false;
    this.hiddenControls = new Map();
  }

  /** Changing policy releases the old scope; only the lifecycle owner may acquire it. */
  setHideAllButtons(enabled) {
    enabled = enabled === true;
    if (this.hideAllButtons !== enabled) {
      this.release();
      this.hideAllButtons = enabled;
    }
  }

  strongNodes(node) {
    const nodes = [];
    const walker = node.ownerDocument.createTreeWalker(node, 1);
    let next;
    while ((next = walker.nextNode())) {
      if (nodes.length === STRONG_NODE_LIMIT) {
        return null;
      }
      nodes.push(next);
    }
    return nodes;
  }

  strongCandidate(node, profile = GENERIC_CONTROL_PROFILE) {
    const doc = this.video.ownerDocument;
    const root = node?.getRootNode();
    if (
      !node?.isConnected ||
      node.ownerDocument !== doc ||
      node.matches('body,html,dialog,[role="dialog"],vsc-controller') ||
      (root !== doc && (root?.mode !== 'open' || !root.host?.isConnected))
    ) {
      return null;
    }
    const nodes = this.strongNodes(node);
    if (!nodes) {
      return null;
    }
    const media = nodes.filter((element) => element.matches('video,audio,iframe,ogvjs'));
    if (media.length !== 1 || media[0] !== this.video) {
      return null;
    }
    return { node, doc, root, profile, nodes };
  }

  findContainer() {
    try {
      const video = this.video;
      if (!this.hideAllButtons || video?.localName !== 'video' || !video.isConnected) {
        return null;
      }
      const known = SiteControls.findXPlayer(video);
      if (known) {
        return this.strongCandidate(known.node, known.profile);
      }
      let node = video.parentElement;
      for (let depth = 0; node && depth < 24; depth++, node = node.parentElement) {
        if (node.matches('body,html,vsc-controller,dialog,[role="dialog"]')) {
          break;
        }
        const profile = SITE_CONTROL_PROFILES.find(({ container }) => node.matches(container));
        if (profile) {
          return this.strongCandidate(node, profile);
        }
      }
      const rect = video.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) {
        return null;
      }
      let candidate = null;
      node = video.parentElement;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        if (node.matches('body,html,vsc-controller,dialog,[role="dialog"],[aria-modal="true"]')) {
          break;
        }
        const bounds = node.getBoundingClientRect();
        if (!(bounds.width > 0 && bounds.height > 0)) {
          const css = video.ownerDocument.defaultView.getComputedStyle(node);
          if (
            css.display === 'contents' ||
            (css.overflowX === 'visible' && css.overflowY === 'visible')
          ) {
            continue;
          }
          break;
        }
        if (
          !['left', 'top', 'right', 'bottom'].every(
            (edge) => Math.abs(bounds[edge] - rect[edge]) <= 2
          )
        ) {
          break;
        }
        const next = this.strongCandidate(node);
        if (!next) {
          return null;
        }
        candidate = next;
      }
      return candidate;
    } catch {
      return null;
    }
  }

  restoreHiddenControl(node, state) {
    try {
      if (node.getAttribute(HIDDEN_CONTROL_ATTRIBUTE) === this.token) {
        if (state.hadMarker) {
          node.setAttribute(HIDDEN_CONTROL_ATTRIBUTE, state.originalMarker);
        } else {
          node.removeAttribute(HIDDEN_CONTROL_ATTRIBUTE);
        }
      }
    } catch {
      // A later site write or replaced DOM API remains the site's property.
    }
  }

  refreshHiddenControls(candidate) {
    const { node, nodes, profile } = candidate;
    const recognized = new Set();
    for (const selector of profile.controls) {
      for (const control of node.querySelectorAll(`:scope ${selector}`)) {
        recognized.add(control);
      }
    }
    const controls = new Set(
      nodes.filter((control) => {
        const protectedParent = control.closest(PROTECTED_CONTENT);
        if (
          (protectedParent && (protectedParent === node || node.contains(protectedParent))) ||
          control.querySelector(PROTECTED_CONTENT)
        ) {
          return false;
        }
        if (recognized.has(control)) {
          return true;
        }
        if (!this.hideAllButtons) {
          return false;
        }
        if (!control.matches(STRONG_CONTROLS)) {
          return false;
        }
        return (
          !control.matches('a[href]:not([role="button"])') ||
          CONTROL_LINK_LABEL.test(
            `${control.getAttribute('aria-label') || ''} ${control.getAttribute('title') || ''} ${control.textContent}`
          )
        );
      })
    );
    for (const [control, state] of this.hiddenControls) {
      if (!controls.has(control)) {
        this.restoreHiddenControl(control, state);
        this.hiddenControls.delete(control);
      }
    }
    for (const control of controls) {
      if (!this.hiddenControls.has(control)) {
        this.hiddenControls.set(control, {
          hadMarker: control.hasAttribute(HIDDEN_CONTROL_ATTRIBUTE),
          originalMarker: control.getAttribute(HIDDEN_CONTROL_ATTRIBUTE),
        });
        control.setAttribute(HIDDEN_CONTROL_ATTRIBUTE, this.token);
      }
    }
  }

  observeStrongScope() {
    try {
      this.strongObserver?.disconnect();
    } catch {
      // A replaced observer API must not prevent releasing CSS ownership.
    }
    const node = this.container;
    const observer = new this.document.defaultView.MutationObserver(() => {
      try {
        if (node.getAttribute(SITE_CONTROL_ATTRIBUTE) !== this.token || !this.style?.isConnected) {
          observer.disconnect();
          return;
        }
        const candidate = this.findContainer();
        if (
          candidate?.node !== node ||
          candidate.root !== this.root ||
          candidate.doc !== this.document
        ) {
          this.release();
          return;
        }
        this.refreshHiddenControls(candidate);
        if (node.parentNode !== this.strongParent) {
          this.observeStrongScope();
        }
      } catch {
        this.release();
      }
    });
    this.strongObserver = observer;
    this.strongParent = node.parentNode;
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'role',
        'aria-label',
        'title',
        'href',
        'type',
        'data-testid',
        SITE_CONTROL_ATTRIBUTE,
      ],
    });
    // A direct boundary removal/reparenting is outside its own subtree.
    // Observe only that parent's child list; ancestor teardown uses existing discovery.
    if (node.parentNode) {
      observer.observe(node.parentNode, { childList: true });
    }
  }

  acquire() {
    const candidate = this.findContainer();
    if (
      candidate?.node === this.container &&
      candidate?.doc === this.document &&
      candidate?.profile === this.profile &&
      (candidate?.root || candidate?.doc) === this.root
    ) {
      try {
        // A site's changed marker is a handback, not an invitation to fight it.
        const current =
          this.container.getAttribute(SITE_CONTROL_ATTRIBUTE) === this.token &&
          this.style?.isConnected === true;
        if (current && candidate.nodes) {
          this.refreshHiddenControls(candidate);
        }
        return current;
      } catch {
        if (candidate.nodes) {
          this.release();
        }
        return false;
      }
    }
    this.release();
    if (!candidate || siteControlOwners.has(candidate.node)) {
      return false;
    }
    try {
      const { node, profile, doc } = candidate;
      this.hadMarker = node.hasAttribute(SITE_CONTROL_ATTRIBUTE);
      this.originalMarker = node.getAttribute(SITE_CONTROL_ATTRIBUTE);
      this.container = node;
      this.document = doc;
      this.root = candidate.root || doc;
      this.profile = profile;
      siteControlOwners.set(node, this);
      const style = doc.createElement('style');
      this.style = style;
      const scope = `[${SITE_CONTROL_ATTRIBUTE}="${this.token}"]`;
      style.textContent = `${scope} [${HIDDEN_CONTROL_ATTRIBUTE}="${this.token}"] { display: none !important; }`;
      node.setAttribute(SITE_CONTROL_ATTRIBUTE, this.token);
      (this.root === doc ? doc.head || doc.documentElement : this.root).appendChild(style);
      if (candidate.nodes) {
        this.refreshHiddenControls(candidate);
        this.observeStrongScope();
      }
      return true;
    } catch {
      this.release();
      return false;
    }
  }

  release() {
    try {
      this.strongObserver?.disconnect();
    } catch {
      // Continue restoring styles and markers if a page patches disconnect.
    }
    this.strongObserver = null;
    this.strongParent = null;
    for (const [node, state] of this.hiddenControls) {
      this.restoreHiddenControl(node, state);
    }
    this.hiddenControls.clear();
    const container = this.container;
    const style = this.style;
    const hadMarker = this.hadMarker;
    const originalMarker = this.originalMarker;
    this.container = null;
    this.document = null;
    this.root = null;
    this.profile = null;
    this.style = null;
    this.originalMarker = null;
    this.hadMarker = false;
    if (container && siteControlOwners.get(container) === this) {
      siteControlOwners.delete(container);
    }
    try {
      if (container?.getAttribute(SITE_CONTROL_ATTRIBUTE) === this.token) {
        if (hadMarker) {
          container.setAttribute(SITE_CONTROL_ATTRIBUTE, originalMarker);
        } else {
          container.removeAttribute(SITE_CONTROL_ATTRIBUTE);
        }
      }
    } catch {
      // Independent cleanup must continue if the site replaces an attribute API.
    }
    try {
      style?.remove();
    } catch {
      try {
        style?.parentNode?.removeChild(style);
      } catch {
        // A detached/adopted document or replaced DOM API may already be gone.
      }
    }
  }

  cleanup() {
    this.release();
  }
}

window.VSC.SiteControls = SiteControls;
