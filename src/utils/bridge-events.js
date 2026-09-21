/**
 * CustomEvent transport shared by the MAIN and ISOLATED bundles. Each world
 * owns its own listener registry. Observe only direct document children so
 * replacing <html> rebinds listeners without watching ordinary DOM churn.
 * document.open() also clears DOM listeners, but leaves this observer alive.
 */
export class BridgeEventTarget {
  constructor(ownerDocument = document) {
    this.document = ownerDocument;
    this.root = null;
    this.listeners = new Map();
    this.observer = null;
  }

  refreshRoot() {
    const root = this.document.documentElement;
    if (root === this.root) {
      return;
    }
    for (const [type, handlers] of this.listeners) {
      for (const handler of handlers) {
        this.root?.removeEventListener(type, handler);
        root?.addEventListener(type, handler);
      }
    }
    this.root = root;
  }

  addEventListener(type, handler) {
    this.refreshRoot();
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
    this.root?.addEventListener(type, handler);
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.refreshRoot());
      this.observer.observe(this.document, { childList: true });
    }
  }

  removeEventListener(type, handler) {
    this.root?.removeEventListener(type, handler);
    const handlers = this.listeners.get(type);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this.listeners.delete(type);
    }
    if (this.listeners.size === 0) {
      this.disconnect();
    }
  }

  dispatchEvent(event) {
    this.refreshRoot();
    return this.root?.dispatchEvent(event) ?? false;
  }

  disconnect() {
    for (const [type, handlers] of this.listeners) {
      for (const handler of handlers) {
        this.root?.removeEventListener(type, handler);
      }
    }
    this.listeners.clear();
    this.observer?.disconnect();
    this.observer = null;
    this.root = null;
  }
}

export const bridgeEvents = new BridgeEventTarget();
