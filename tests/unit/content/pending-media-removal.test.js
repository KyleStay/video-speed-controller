describe('pending media removal', () => {
  it('releases unloaded media removed after the attachment fallback has expired', async () => {
    vi.useFakeTimers();
    const extension = new window.VSC_controller.constructor();
    extension.logger = window.VSC.logger;
    const doc = document.implementation.createHTMLDocument('unloaded media');
    const video = doc.createElement('video');
    doc.body.append(video);
    const removeListener = vi.spyOn(video, 'removeEventListener');
    const observer = new window.VSC.VideoMutationObserver(
      { settings: {} },
      vi.fn(),
      extension.onVideoRemoved.bind(extension)
    );
    try {
      extension.deferVideoAttachment(video, doc.body);
      await vi.advanceTimersByTimeAsync(1600);
      expect(extension.pendingVideoElements.has(video)).toBe(true);
      expect(video.vsc).toBeUndefined();
      video.remove();
      observer.processMutations([
        { type: 'childList', target: doc.body, addedNodes: [], removedNodes: [video] },
      ]);
      expect(extension.pendingVideoElements.size).toBe(0);
      expect(extension.pendingVideoAttachments.has(video)).toBe(false);
      for (const event of ['loadeddata', 'canplay', 'play']) {
        expect(removeListener).toHaveBeenCalledWith(event, expect.any(Function));
      }
    } finally {
      extension.clearPendingVideoAttachment(video);
      observer.stop();
      vi.useRealTimers();
    }
  });
});
