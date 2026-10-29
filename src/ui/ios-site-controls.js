/** Scoped, reversible suppression of site player chrome. */
window.VSC = window.VSC || {};

const SITE_CONTROL_ATTRIBUTE = 'data-vsc-ios-site-controls';
const HIDDEN_CONTROL_ATTRIBUTE = 'data-vsc-site-hidden-control';
const STRONG_NODE_LIMIT = 512;
const GENERIC_CONTROL_PROFILE = { controls: [] };
const PROTECTED_CONTENT = [
  'video',
  'audio',
  'canvas',
  'ogvjs',
  'vsc-controller',
  'vsc-ios-player',
  '[data-vsc-twitter-mp4]',
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
  /\b(play|pause|replay|mute|unmute|volume|full\s*screen|seek|rewind|forward|skip|speed|settings|quality|captions?|subtitles?|picture.in.picture|airplay|share|download)\b/i;
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
    '> [data-slot="xds-context-menu-trigger"] > [class~="group/controls"]',
    `> [data-slot="xds-context-menu-trigger"] > ${XDS_NESTED_CONTROL_GROUP}`,
    '> [data-slot="xds-context-menu-trigger"] [data-slot="xds-button"][aria-label="Mute"]',
    '> [data-slot="xds-context-menu-trigger"] [data-slot="xds-button"][aria-label="Unmute"]',
  ],
};

class IOSSiteControls {
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
          ':scope > button[aria-label="Play"], :scope > button[aria-label="Pause"]'
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

  static xFullscreenControl(target) {
    try {
      const doc = target?.ownerDocument;
      if (!this.isXDocument(doc)) {
        return null;
      }
      const legacy = target.closest('[data-testid="videoControlFullscreenButton"]');
      if (legacy) {
        const node = legacy.closest('[data-testid="videoPlayer"]');
        const videos = node?.querySelectorAll('video');
        return videos?.length === 1 && !node.querySelector('iframe')
          ? { node, video: videos[0], control: legacy }
          : null;
      }
      const control = target.closest('a[aria-label="Full screen"][href]');
      if (!control) {
        return null;
      }
      const url = new URL(control.href, doc.URL);
      const path = url.pathname.match(/^\/[^/]+\/status\/(\d+)\/video\/[1-9]\d*\/?$/);
      if (url.origin !== doc.location.origin || !path) {
        return null;
      }
      const trigger = control.closest('[data-slot="xds-context-menu-trigger"]');
      const video = trigger?.parentElement?.querySelector(':scope > video');
      const candidate = this.findXPlayer(video);
      if (
        !candidate ||
        candidate.trigger !== trigger ||
        !control.parentElement?.querySelector(
          ':scope > [inert] button[data-slot="xds-button"] svg[data-icon="icon-media-expand"]'
        )
      ) {
        return null;
      }
      // Where the surrounding post provides permalinks, the entry must name that post.
      const post = candidate.node.closest('article');
      const ids = Array.from(post?.querySelectorAll('a[href*="/status/"]') || [])
        .map(
          (link) => new URL(link.href, doc.URL).pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1]
        )
        .filter(Boolean);
      return ids.length && !ids.includes(path[1]) ? null : { node: candidate.node, video, control };
    } catch {
      return null;
    }
  }

  static xSurfaceControl(target, event) {
    try {
      if (!this.isXDocument(target?.ownerDocument)) {
        return null;
      }
      // X's embedded feed player puts its picture hit surface beneath a
      // focusable wrapper. Recognize only that exact target, never its buttons.
      if (/^video-player-mini-ui-\d+$/.test(target.getAttribute('data-testid') || '')) {
        const component = target.parentElement?.parentElement?.parentElement;
        const node = component?.closest('[data-testid="videoPlayer"]');
        const media = node?.querySelectorAll('video,audio,iframe');
        const video = media?.length === 1 ? media[0] : null;
        if (
          component?.matches('[data-testid="videoComponent"]') &&
          video?.localName === 'video' &&
          component.contains(video) &&
          !target.closest('button,a,[role="button"],[role="slider"],[inert]') &&
          Number.isFinite(event?.clientX) &&
          Number.isFinite(event?.clientY)
        ) {
          const rect = video.getBoundingClientRect();
          const cover = target.getBoundingClientRect();
          if (
            rect.width > 0 &&
            rect.height > 0 &&
            cover.left <= rect.left + 2 &&
            cover.top <= rect.top + 2 &&
            cover.right >= rect.right - 2 &&
            cover.bottom >= rect.bottom - 2 &&
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          ) {
            return { node, video };
          }
        }
        return null;
      }
      if (target.localName === 'video') {
        const modern = this.findXPlayer(target);
        const node = modern?.node || target.closest('[data-testid="videoPlayer"]');
        return node?.querySelectorAll('video').length === 1 && !node.querySelector('iframe')
          ? { node, video: target }
          : null;
      }
      // A pointer-transparent video can leave its exact player/cover container
      // as the hit target. Never extend this to arbitrary descendant overlays.
      const possibleNode = target.matches('[data-slot="xds-context-menu-trigger"]')
        ? target.parentElement
        : target;
      const directVideo = possibleNode?.querySelector(':scope > video');
      const candidate = this.findXPlayer(directVideo);
      const legacy = target.matches('[data-testid="videoPlayer"]')
        ? target.querySelectorAll('video')
        : null;
      const bareVideo =
        candidate && (target === candidate.node || target === candidate.trigger)
          ? directVideo
          : legacy?.length === 1 && !target.querySelector('iframe')
            ? legacy[0]
            : null;
      if (bareVideo && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        const rect = bareVideo.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          return { node: candidate?.node || target, video: bareVideo };
        }
      }
      const trigger = target.closest('[data-slot="xds-context-menu-trigger"]');
      const cover = target.closest('button');
      // The empty direct-child button covers X's whole picture. Transport
      // buttons live inside group/controls and retain their playback actions.
      if (
        cover?.parentElement !== trigger ||
        !cover.matches('button[aria-label="Play"], button[aria-label="Pause"]') ||
        cover.childElementCount !== 0 ||
        cover.textContent.trim() !== ''
      ) {
        return null;
      }
      const video = trigger.parentElement?.querySelector(':scope > video');
      const modern = this.findXPlayer(video);
      return modern?.trigger === trigger ? { node: modern.node, video } : null;
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

  strongContext() {
    const video = this.video;
    const doc = video.ownerDocument;
    const session = window.VSC.TwitterMP4Playback?.get(video);
    if (session) {
      // The retained MSE producer is the only permitted two-video exception.
      // Never infer this relationship from visibility or an attribute alone.
      const original = session.original;
      const player = video.vsc?.iosPlayer;
      const inOwnedView =
        player?.active &&
        player.video === video &&
        player.doc === doc &&
        player.anchor?.parentNode === session.host &&
        player.originParent === session.host &&
        player.ui?.host?.isConnected &&
        player.portalNode === video &&
        video.parentNode === player.ui.host;
      if (
        session.video !== video ||
        session.closed ||
        !session.committed ||
        !session.current() ||
        original === video ||
        !original?.isConnected ||
        original.ownerDocument !== doc ||
        session.parent !== original.parentElement ||
        session.host?.parentNode !== session.parent ||
        !session.host.hasAttribute('data-vsc-twitter-mp4') ||
        (!session.host.contains(video) && !inOwnedView)
      ) {
        return null;
      }
      const node = session.candidate?.scope || original.parentElement;
      if (!node?.contains(original)) {
        return null;
      }
      return { start: node, exact: true, media: [original, video], required: original };
    }
    const player = video.vsc?.iosPlayer;
    if (player?.active) {
      const portal = player.portalNode;
      const origin = player.originParent;
      if (
        player.video !== video ||
        player.doc !== doc ||
        player.originLost ||
        !origin?.isConnected ||
        origin.ownerDocument !== doc ||
        player.anchor?.parentNode !== origin ||
        !player.ui?.host?.isConnected ||
        portal?.parentNode !== player.ui.host ||
        !portal.contains(video)
      ) {
        return null;
      }
      if (portal !== video) {
        return { start: portal, exact: true, media: [video], required: video };
      }
      if (player.placeholder?.parentNode !== origin) {
        return null;
      }
      return { start: origin, reference: player.placeholder, media: [video], portal: true };
    }
    return { start: video.parentElement, reference: video, media: [video], required: video };
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

  strongCandidate(node, context, profile = GENERIC_CONTROL_PROFILE) {
    const doc = this.video.ownerDocument;
    const root = node?.getRootNode();
    if (
      !node?.isConnected ||
      node.ownerDocument !== doc ||
      node.matches('body,html,dialog,[role="dialog"],vsc-ios-player,vsc-controller') ||
      (root !== doc && (root?.mode !== 'open' || !root.host?.isConnected))
    ) {
      return null;
    }
    const nodes = this.strongNodes(node);
    if (!nodes) {
      return null;
    }
    const media = nodes.filter((element) => element.matches('video,audio,iframe,ogvjs'));
    if (
      media.some((element) => !context.media.includes(element)) ||
      (context.required && !media.includes(context.required)) ||
      (!context.portal && !context.exact && !media.includes(this.video))
    ) {
      return null;
    }
    return { node, doc, root, profile, nodes };
  }

  findStrongContainer() {
    const video = this.video;
    if (video?.localName !== 'video' || !video.isConnected) {
      return null;
    }
    const context = this.strongContext();
    if (!context?.start) {
      return null;
    }
    if (context.exact) {
      const profile =
        SITE_CONTROL_PROFILES.find(({ container }) => context.start.matches(container)) ||
        (IOSSiteControls.isXDocument(video.ownerDocument) &&
        context.start.querySelector(':scope > [data-slot="xds-context-menu-trigger"]')
          ? XDS_SITE_CONTROL_PROFILE
          : GENERIC_CONTROL_PROFILE);
      return this.strongCandidate(context.start, context, profile);
    }
    const xPlayer = IOSSiteControls.findXPlayer(video);
    if (xPlayer) {
      return this.strongCandidate(xPlayer.node, context, xPlayer.profile);
    }
    let node = context.start;
    for (let depth = 0; node && depth < 24; depth++, node = node.parentElement) {
      if (node.matches('body,html,vsc-ios-player,vsc-controller,dialog,[role="dialog"]')) {
        break;
      }
      const profile = SITE_CONTROL_PROFILES.find(({ container }) => node.matches(container));
      if (profile) {
        return this.strongCandidate(node, context, profile);
      }
    }
    const rect = context.reference.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      return null;
    }
    let candidate = null;
    node = context.start;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (
        node.matches(
          'body,html,vsc-ios-player,vsc-controller,dialog,[role="dialog"],[aria-modal="true"]'
        )
      ) {
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
      const next = this.strongCandidate(node, context);
      if (!next) {
        return null;
      }
      candidate = next;
    }
    return candidate;
  }

  findContainer() {
    try {
      if (this.hideAllButtons) {
        return this.findStrongContainer();
      }
      const video = this.video;
      const doc = video?.ownerDocument;
      if (video?.localName !== 'video' || !video.isConnected || !doc) {
        return null;
      }
      const xPlayer = IOSSiteControls.findXPlayer(video);
      if (xPlayer) {
        return xPlayer;
      }
      let node = video.parentElement;
      for (let depth = 0; node && depth < 24; depth++, node = node.parentElement) {
        const profile = SITE_CONTROL_PROFILES.find(({ container }) => node.matches(container));
        if (!profile) {
          continue;
        }
        // A document stylesheet cannot safely control another tree. Never climb
        // beyond an ambiguous player into a broader site's container instead.
        if (node.ownerDocument !== doc || node.getRootNode() !== doc) {
          return null;
        }
        const videos = node.querySelectorAll('video');
        if (videos.length !== 1 || videos[0] !== video || node.querySelector('iframe')) {
          return null;
        }
        return { node, profile, doc };
      }
    } catch {
      // Page APIs and reparenting can invalidate a container during discovery.
    }
    return null;
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
        'data-vsc-twitter-mp4',
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
        if (current && this.hideAllButtons) {
          this.refreshHiddenControls(candidate);
        }
        return current;
      } catch {
        if (this.hideAllButtons) {
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
      const inline = this.video.vsc?.controlsManager?.inlinePlayer;
      const touchPolicy = `${scope} { touch-action: pan-y pinch-zoom !important; }`;
      style.textContent = this.hideAllButtons
        ? `${scope} [${HIDDEN_CONTROL_ATTRIBUTE}="${this.token}"] { display: none !important; }${inline ? `\n${touchPolicy}` : ''}`
        : `${profile.controls
            .map((control) => `${scope} ${control} { display: none !important; }`)
            .join('\n')}\n${touchPolicy}`;
      node.setAttribute(SITE_CONTROL_ATTRIBUTE, this.token);
      (this.root === doc ? doc.head || doc.documentElement : this.root).appendChild(style);
      if (this.hideAllButtons) {
        this.refreshHiddenControls(candidate);
        this.observeStrongScope();
      }
      // Site picture overlays can receive input instead of the video itself.
      // Keep wake-up scoped to the same validated single-video container.
      if (inline) {
        this.releaseSurface = inline.observeSurface?.(node);
        this.releaseInteraction = window.VSC.IOSInlinePlayer?.observeInteractions?.(
          node,
          (event) => {
            this.video.vsc?.controlsManager?.inlinePlayer?.surfaceInteraction(event);
          }
        );
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
    try {
      this.releaseSurface?.();
    } catch {
      // Continue style/marker cleanup even if page-owned listener APIs throw.
    }
    this.releaseSurface = null;
    try {
      this.releaseInteraction?.();
    } catch {
      // Interaction cleanup is independent of suppression ownership.
    }
    this.releaseInteraction = null;
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

window.VSC.IOSSiteControls = IOSSiteControls;
