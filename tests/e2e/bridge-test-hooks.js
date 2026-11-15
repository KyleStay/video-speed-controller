/** Test-only API wrapping, prepended to a disposable copy of the built bridge. */
export function installBridgeTestHooks() {
  const state = {
    dropChanges: false,
    holdNextRead: false,
    pendingRead: null,
    reads: 0,
  };
  const addListener = chrome.storage.onChanged.addListener.bind(chrome.storage.onChanged);
  chrome.storage.onChanged.addListener = (listener) =>
    addListener((changes, area) => {
      if (!state.dropChanges) {
        listener(changes, area);
      }
    });
  const get = chrome.storage.sync.get.bind(chrome.storage.sync);
  chrome.storage.sync.get = async (keys) => {
    state.reads++;
    const snapshot = await get(keys);
    if (!state.holdNextRead) {
      return snapshot;
    }
    state.holdNextRead = false;
    return new Promise((resolve) => {
      state.pendingRead = { snapshot, resolve };
    });
  };
  state.releaseRead = () => {
    const pending = state.pendingRead;
    state.pendingRead = null;
    pending?.resolve(pending.snapshot);
  };
  globalThis.__stayfastBridgeTest = state;
}
