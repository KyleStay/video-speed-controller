window.addEventListener(
  'message',
  (event) => {
    // This listener is bundled into the MAIN-world script on every page, so it
    // runs on non-Netflix sites too. Bail before touching event.data so an
    // arbitrary same-origin postMessage of a primitive (string/number/null)
    // can't throw a TypeError.
    if (event.origin !== 'https://www.netflix.com') {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== 'object' || data.action !== 'videospeed-seek' || !data.seekMs) {
      return;
    }

    // Netflix's internal player API shape can change or be unavailable before
    // the app finishes booting. Guard the whole access chain.
    try {
      const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      if (!videoPlayer) {
        return;
      }
      const playerSessionId = videoPlayer.getAllPlayerSessionIds()[0];
      const currentTime = videoPlayer.getCurrentTimeBySessionId(playerSessionId);
      videoPlayer.getVideoPlayerBySessionId(playerSessionId).seek(currentTime + data.seekMs);
    } catch {
      // Netflix API unavailable/changed — the handler's caller falls back to
      // video.currentTime seeking, so silently ignore here.
    }
  },
  false
);
