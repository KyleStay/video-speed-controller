// A tabs.sendMessage broadcast reaches every frame, but only the first reply
// reaches its callback. Collect the bridge's per-frame replies for one bounded
// window so a media-less parent cannot hide an embedded player's status.
export function sendTabCommand(tabId, message) {
  return new Promise((resolve, reject) => {
    const commandId = crypto.randomUUID();
    const replies = new Map();
    let firstReply;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', onPageHide);
      try {
        chrome.runtime.onMessage.removeListener(onReply);
      } catch {
        // The popup's extension context may already have been invalidated.
      }
    };
    const onPageHide = () => {
      cleanup();
      reject(new Error('Popup closed'));
    };
    const onReply = (request, sender) => {
      if (
        request?.type === 'VSC_FRAME_RESULT' &&
        request.commandId === commandId &&
        sender.id === chrome.runtime.id &&
        sender.tab?.id === tabId
      ) {
        replies.set(sender.frameId, request.response);
      }
    };

    try {
      chrome.runtime.onMessage.addListener(onReply);
      window.addEventListener('pagehide', onPageHide, { once: true });
      timer = setTimeout(() => {
        cleanup();
        const responses = replies.size ? [...replies.values()] : [firstReply];
        const successful = responses.filter(
          (response) =>
            response?.ok && Number.isInteger(response.mediaCount) && response.mediaCount >= 0
        );
        if (!successful.length) {
          resolve({ ok: false });
          return;
        }
        const mediaCount = successful.reduce((count, response) => count + response.mediaCount, 0);
        const speeds = [
          ...new Set(
            successful
              .flatMap(
                (response) =>
                  (Array.isArray(response.speeds) ? response.speeds : null) ||
                  (typeof response.currentSpeed === 'number' ? [response.currentSpeed] : [])
              )
              .filter(Number.isFinite)
          ),
        ];
        resolve({
          ok: true,
          mediaCount,
          speeds,
          currentSpeed: speeds.length === 1 ? speeds[0] : null,
        });
      }, 350); // Longer than the bridge's 250ms response deadline; no ongoing polling.
      chrome.tabs.sendMessage(tabId, { ...message, commandId }, (response) => {
        if (chrome.runtime.lastError) {
          const error = new Error(chrome.runtime.lastError.message);
          cleanup();
          reject(error);
          return;
        }
        firstReply = response;
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
