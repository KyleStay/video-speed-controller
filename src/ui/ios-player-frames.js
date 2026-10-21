/** Reversible same-document iframe expansion for an owned player in a child frame. */
window.VSC = window.VSC || {};

const FRAME_MESSAGE = 'VSC_IOS_PLAYER_FRAME';
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ANCESTORS = 128;

const UNCLIP_STYLES = {
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  perspective: 'none',
  filter: 'none',
  'backdrop-filter': 'none',
  contain: 'none',
  'container-type': 'normal',
  'content-visibility': 'visible',
  'will-change': 'auto',
  clip: 'auto',
  'clip-path': 'none',
  'mask-image': 'none',
  isolation: 'auto',
  'mix-blend-mode': 'normal',
  opacity: '1',
  'z-index': '2147483647',
};

const FRAME_STYLES = {
  ...UNCLIP_STYLES,
  position: 'fixed',
  top: '0px',
  right: 'auto',
  bottom: 'auto',
  left: '0px',
  width: '100vw',
  height: '100dvh',
  'min-width': '0px',
  'min-height': '0px',
  'max-width': 'none',
  'max-height': 'none',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-bottom-left-radius': '0px',
  'border-bottom-right-radius': '0px',
  'box-sizing': 'border-box',
  'aspect-ratio': 'auto',
  display: 'block',
  visibility: 'visible',
};

class IOSPlayerFrames {
  constructor(doc = document) {
    this.document = doc;
    this.view = doc.defaultView;
    this.started = false;
    this.localToken = null;
    this.upstreamToken = null;
    this.childSession = null;
    this.onMessage = (event) => this.handleMessage(event);
    this.onPageHide = () => this.cleanup();
  }

  start() {
    if (!this.started && this.view) {
      this.view.addEventListener('message', this.onMessage);
      this.view.addEventListener('pagehide', this.onPageHide);
      this.started = true;
    }
    return this;
  }

  activate(token) {
    if (!IOSPlayerFrames.validToken(token) || !this.view) {
      return false;
    }
    this.start();
    this.localToken = token;
    this.syncUpstream();
    return true;
  }

  deactivate(token) {
    if (token !== this.localToken || !IOSPlayerFrames.validToken(token)) {
      return false;
    }
    this.localToken = null;
    this.syncUpstream();
    return true;
  }

  static validToken(token) {
    return typeof token === 'string' && TOKEN_PATTERN.test(token);
  }

  static validMessage(data) {
    return (
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Object.keys(data).length === 3 &&
      data.type === FRAME_MESSAGE &&
      (data.action === 'open' || data.action === 'close') &&
      IOSPlayerFrames.validToken(data.token)
    );
  }

  handleMessage(event) {
    try {
      if (!IOSPlayerFrames.validMessage(event.data) || !event.source) {
        return;
      }
      const origin = this.view.location.origin;
      if (origin === 'null' || event.origin !== origin) {
        return;
      }
      // Only a same-origin child already entitled to access the parent DOM can
      // request parent presentation. Opaque/cross-origin ad frames stay local.
      const sourceDocument = event.source.document;
      if (!sourceDocument || sourceDocument.defaultView !== event.source) {
        return;
      }
      const { action, token } = event.data;
      if (action === 'close') {
        if (
          this.childSession?.source === event.source &&
          this.childSession.token === token &&
          this.childSession.sourceDocument === sourceDocument
        ) {
          this.releaseChild();
          this.syncUpstream();
        }
        return;
      }
      if (
        this.childSession?.source === event.source &&
        this.childSession.token === token &&
        this.childSession.sourceDocument === sourceDocument
      ) {
        return;
      }
      const frame = this.findFrame(event.source);
      if (!frame) {
        return;
      }
      this.releaseChild();
      const session = {
        frame,
        source: event.source,
        sourceDocument,
        token,
        overrides: new Map(),
        observer: null,
      };
      this.childSession = session;
      try {
        this.expandChild(session);
        session.onLoad = () => this.reconcileChild(session);
        frame.addEventListener('load', session.onLoad);
        session.observer = new this.view.MutationObserver(() => this.reconcileChild(session));
        this.observeSession(session);
      } catch {
        // An unavailable page API must leave the child usable in its original frame.
        this.releaseChild();
      }
      this.syncUpstream();
    } catch {
      // MAIN-world properties and MessageEvent getters may be replaced by the page.
    }
  }

  findFrame(source) {
    const roots = [{ root: this.document, depth: 0 }];
    const visited = new Set();
    while (roots.length) {
      const { root, depth } = roots.shift();
      if (visited.has(root)) {
        continue;
      }
      visited.add(root);
      for (const frame of root.querySelectorAll('iframe')) {
        try {
          if (
            frame.ownerDocument === this.document &&
            frame.isConnected &&
            frame.contentWindow === source
          ) {
            return frame;
          }
        } catch {
          // Comparing WindowProxy identity needs no cross-origin document access.
        }
      }
      if (depth < 10) {
        for (const element of root.querySelectorAll('*')) {
          try {
            if (element.shadowRoot) {
              roots.push({ root: element.shadowRoot, depth: depth + 1 });
            }
          } catch {
            // An inaccessible root is not an owned iframe candidate.
          }
        }
      }
    }
    return null;
  }

  ancestorChain(frame) {
    const chain = [];
    let node = frame;
    for (let index = 0; node && index < MAX_ANCESTORS; index++) {
      const parent = node.parentElement || node.getRootNode()?.host;
      if (!parent) {
        return chain;
      }
      chain.push(parent);
      node = parent;
    }
    throw new Error('Iframe ancestry exceeds the bounded presentation depth');
  }

  override(session, element, property, value) {
    let properties = session.overrides.get(element);
    if (!properties) {
      properties = new Map();
      session.overrides.set(element, properties);
    }
    const style = element.style;
    let record = properties.get(property);
    if (!record) {
      record = {
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      };
      properties.set(property, record);
    }
    style.setProperty(property, value, 'important');
    record.ownedValue = style.getPropertyValue(property);
    record.ownedPriority = style.getPropertyPriority(property);
  }

  expandChild(session) {
    this.scrollRestore?.cancel();
    session.scrollState = new window.VSC.IOSPlayerScrollState(session.frame);
    session.ancestors = this.ancestorChain(session.frame);
    for (const element of session.ancestors) {
      for (const [property, value] of Object.entries(UNCLIP_STYLES)) {
        this.override(session, element, property, value);
      }
    }
    for (const [property, value] of Object.entries(FRAME_STYLES)) {
      this.override(session, session.frame, property, value);
    }
    for (const element of [this.document.documentElement, this.document.body]) {
      if (element) {
        this.override(session, element, 'overflow-x', 'hidden');
        this.override(session, element, 'overflow-y', 'hidden');
        this.override(session, element, 'overscroll-behavior-x', 'none');
        this.override(session, element, 'overscroll-behavior-y', 'none');
      }
    }
    session.scrollState.checkpoint();
  }

  observeSession(session) {
    session.observer.disconnect();
    const roots = new Set([this.document]);
    for (const element of [session.frame, ...session.ancestors]) {
      const root = element.getRootNode();
      if (root.host) {
        roots.add(root);
      }
    }
    for (const root of roots) {
      session.observer.observe(root, { childList: true, subtree: true });
    }
  }

  reconcileChild(session) {
    if (this.childSession !== session) {
      return;
    }
    try {
      if (
        !session.frame.isConnected ||
        session.frame.ownerDocument !== this.document ||
        session.frame.contentWindow !== session.source ||
        session.source.document !== session.sourceDocument
      ) {
        this.releaseChild();
        this.syncUpstream();
        return;
      }
      const ancestors = this.ancestorChain(session.frame);
      if (
        ancestors.length !== session.ancestors.length ||
        ancestors.some((node, index) => node !== session.ancestors[index])
      ) {
        this.restoreStyles(session);
        this.expandChild(session);
        this.observeSession(session);
      }
    } catch {
      this.releaseChild();
      this.syncUpstream();
    }
  }

  restoreStyles(session) {
    session.scrollState?.refresh(true);
    for (const [element, properties] of session.overrides) {
      // CSSOM may coalesce owned longhands into a shorthand. Rebuild each
      // complete family atomically, preserving any side changed by the site.
      const families = {
        margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        'border-width': [
          'border-top-width',
          'border-right-width',
          'border-bottom-width',
          'border-left-width',
        ],
        'border-radius': [
          'border-top-left-radius',
          'border-top-right-radius',
          'border-bottom-right-radius',
          'border-bottom-left-radius',
        ],
      };
      for (const [family, names] of Object.entries(families)) {
        if (!names.every((name) => properties.has(name))) {
          continue;
        }
        try {
          const style = element.style;
          const final = names.map((name) => {
            const record = properties.get(name);
            const value = style.getPropertyValue(name);
            const priority = style.getPropertyPriority(name);
            const owned = value === record.ownedValue && priority === record.ownedPriority;
            return {
              name,
              value: owned ? record.value : value,
              priority: owned ? record.priority : priority,
            };
          });
          style.removeProperty(family);
          for (const item of final) {
            style.removeProperty(item.name);
            if (item.value) {
              style.setProperty(item.name, item.value, item.priority);
            }
            properties.delete(item.name);
          }
        } catch {
          // Fall through to individual restoration if a page replaces CSSOM APIs.
        }
      }
      for (const [property, record] of properties) {
        try {
          const style = element.style;
          if (
            style.getPropertyValue(property) !== record.ownedValue ||
            style.getPropertyPriority(property) !== record.ownedPriority
          ) {
            continue;
          }
          if (record.value) {
            style.setProperty(property, record.value, record.priority);
          } else {
            style.removeProperty(property);
          }
        } catch {
          // Continue restoring other elements if a page replaces one style API.
        }
      }
    }
    session.overrides.clear();
    session.scrollState?.restore(false);
  }

  releaseChild() {
    const session = this.childSession;
    this.childSession = null;
    if (session) {
      try {
        session.observer?.disconnect();
      } catch {
        // Continue style restoration even when a page replaces an observer API.
      }
      try {
        if (session.onLoad) {
          session.frame.removeEventListener('load', session.onLoad);
        }
      } catch {
        // Listener APIs are page-owned too; never strand overridden CSS.
      }
      this.restoreStyles(session);
      this.scrollRestore = session.scrollState;
      this.scrollRestore?.restore();
    }
  }

  syncUpstream() {
    const token = this.childSession?.token || this.localToken;
    if (this.upstreamToken === token) {
      return;
    }
    if (this.upstreamToken) {
      this.postUpstream('close', this.upstreamToken);
    }
    this.upstreamToken = token;
    if (token) {
      this.postUpstream('open', token);
    }
  }

  postUpstream(action, token) {
    try {
      const parent = this.view.parent;
      if (parent && parent !== this.view) {
        const message = { type: FRAME_MESSAGE, action, token };
        if (action === 'close') {
          try {
            const manager = parent.VSC?.iosPlayerFrames;
            const session = manager?.childSession;
            if (
              manager?.document === parent.document &&
              session?.token === token &&
              session.source === this.view &&
              session.sourceDocument === this.document &&
              session.frame.ownerDocument === parent.document &&
              session.frame.contentWindow === this.view
            ) {
              // Native fullscreen must see the restored ancestor layout in this
              // gesture. Only release a session the parent already validated.
              manager.handleMessage({
                data: message,
                source: this.view,
                origin: this.view.location.origin,
              });
            }
          } catch {
            // An inaccessible/uninjected parent still receives the queued close.
          }
        }
        // Retain ordering with an open message that has not been processed yet.
        parent.postMessage(message, '*');
      }
    } catch {
      // An uninjected or unavailable ancestor leaves the player frame-local.
    }
  }

  cleanup() {
    this.releaseChild();
    this.scrollRestore?.cancel();
    this.localToken = null;
    this.syncUpstream();
    if (this.started) {
      this.view.removeEventListener('message', this.onMessage);
      this.view.removeEventListener('pagehide', this.onPageHide);
      this.started = false;
    }
  }
}

window.VSC.IOSPlayerFrames = IOSPlayerFrames;
