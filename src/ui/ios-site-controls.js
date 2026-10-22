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

class IOSSiteControls {
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
      style.textContent = profile.controls
        .map((control) => `${scope} ${control} { display: none !important; }`)
        .join('\n');
      node.setAttribute(SITE_CONTROL_ATTRIBUTE, this.token);
      (doc.head || doc.documentElement).appendChild(style);
      return true;
    } catch {
      this.release();
      return false;
    }
  }

  release() {
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
