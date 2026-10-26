/** Scoped, reversible suppression of recognized site player chrome. */
window.VSC = window.VSC || {};

const SITE_CONTROL_ATTRIBUTE = 'data-vsc-ios-site-controls';
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
const XDS_SITE_CONTROL_PROFILE = {
  controls: [
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Play"]',
    '> [data-slot="xds-context-menu-trigger"] > button[aria-label="Pause"]',
    '> [data-slot="xds-context-menu-trigger"] > [class~="group/controls"]',
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
        trigger.querySelectorAll(':scope > [class~="group/controls"]').length !== 1
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
  }

  findContainer() {
    try {
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

  acquire() {
    const candidate = this.findContainer();
    if (
      candidate?.node === this.container &&
      candidate?.doc === this.document &&
      candidate?.profile === this.profile
    ) {
      try {
        // A site's changed marker is a handback, not an invitation to fight it.
        return (
          this.container.getAttribute(SITE_CONTROL_ATTRIBUTE) === this.token &&
          this.style?.isConnected === true
        );
      } catch {
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
      this.profile = profile;
      siteControlOwners.set(node, this);
      const style = doc.createElement('style');
      this.style = style;
      const scope = `[${SITE_CONTROL_ATTRIBUTE}="${this.token}"]`;
      style.textContent = `${profile.controls
        .map((control) => `${scope} ${control} { display: none !important; }`)
        .join('\n')}\n${scope} { touch-action: pan-y pinch-zoom !important; }`;
      node.setAttribute(SITE_CONTROL_ATTRIBUTE, this.token);
      (doc.head || doc.documentElement).appendChild(style);
      // Site picture overlays can receive input instead of the video itself.
      // Keep wake-up scoped to the same validated single-video container.
      this.releaseSurface = this.video.vsc?.controlsManager?.inlinePlayer?.observeSurface?.(node);
      this.releaseInteraction = window.VSC.IOSInlinePlayer.observeInteractions(node, (event) => {
        this.video.vsc?.controlsManager?.inlinePlayer?.surfaceInteraction(event);
      });
      return true;
    } catch {
      this.release();
      return false;
    }
  }

  release() {
    this.releaseSurface?.();
    this.releaseSurface = null;
    this.releaseInteraction?.();
    this.releaseInteraction = null;
    const container = this.container;
    const style = this.style;
    const hadMarker = this.hadMarker;
    const originalMarker = this.originalMarker;
    this.container = null;
    this.document = null;
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
