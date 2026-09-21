describe('shadow media ratechange forwarding', () => {
  it('handles native shadow events once, preserves document capture, and cleans up on removal', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    root.append(video);
    const manager = new window.VSC.EventManager({ settings: {} }, null);
    const handleRateChange = vi.spyOn(manager, 'handleRateChange').mockImplementation(() => {});
    manager.setupRateChangeListener(document);
    const controller = Object.create(window.VSC.VideoController.prototype);
    Object.assign(controller, { video, actionHandler: { eventManager: manager } });
    video.vsc = controller;
    controller.setupEventHandlers();
    try {
      video.dispatchEvent(new Event('ratechange'));
      expect(handleRateChange).toHaveBeenCalledOnce();
      video.dispatchEvent(new Event('ratechange', { composed: true }));
      expect(handleRateChange).toHaveBeenCalledTimes(2);
      document.body.append(video);
      video.dispatchEvent(new Event('ratechange'));
      expect(handleRateChange).toHaveBeenCalledTimes(3);
      root.append(video);
      controller.remove();
      video.dispatchEvent(new Event('ratechange'));
      expect(handleRateChange).toHaveBeenCalledTimes(3);
    } finally {
      controller.remove();
      manager.cleanup();
      host.remove();
      video.remove();
    }
  });
});
