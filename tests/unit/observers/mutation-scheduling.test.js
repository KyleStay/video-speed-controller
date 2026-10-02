describe('bounded mutation work', () => {
  let observer;
  let callbacks;
  let found;
  let removed;

  beforeEach(() => {
    callbacks = [];
    vi.stubGlobal('requestIdleCallback', (callback) => callbacks.push(callback));
    found = vi.fn();
    removed = vi.fn();
    observer = new window.VSC.VideoMutationObserver({ settings: {} }, found, removed);
  });

  afterEach(() => {
    observer.stop();
    vi.unstubAllGlobals();
  });

  const record = (node, added = true) => ({
    type: 'childList',
    target: document.body,
    addedNodes: added ? [node] : [],
    removedNodes: added ? [] : [node],
  });
  const drain = () => {
    let runs = 0;
    while (callbacks.length) {
      callbacks.shift()();
      if (++runs > 100) {
        throw new Error('Mutation queue did not settle');
      }
    }
    return runs;
  };

  it('yields within a large subtree and still reaches its last media', () => {
    const root = document.createElement('div');
    for (let i = 0; i < 1400; i++) {
      root.append(document.createElement('span'));
    }
    const video = document.createElement('video');
    root.append(video);
    observer.scheduleMutationProcessing([
      record(root),
      { type: 'attributes', target: root, attributeName: 'class' },
    ]);
    callbacks.shift()();
    expect(observer.pendingMutations).toHaveLength(0);
    expect(observer.pendingAttributeTargets.size).toBe(0);
    expect(found).not.toHaveBeenCalled();
    expect(observer.getPendingWorkCount()).toBeGreaterThan(0);
    expect(drain()).toBeGreaterThan(1);
    expect(found).toHaveBeenCalledExactlyOnceWith(video, root);
    expect(observer.getPendingWorkCount()).toBe(0);
  });

  it('coalesces attribute records and overlapping subtrees without dropping removals', () => {
    const root = document.createElement('div');
    const inner = document.createElement('section');
    const video = document.createElement('video');
    inner.append(video);
    root.append(inner);
    const visibility = vi.spyOn(observer, 'handleVisibilityChanges');
    const attr = { type: 'attributes', target: root, attributeName: 'class' };
    observer.scheduleMutationProcessing([
      record(root),
      record(inner),
      attr,
      attr,
      record(video, false),
    ]);
    drain();
    expect(found).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledExactlyOnceWith(video);
    expect(visibility).toHaveBeenCalledTimes(1);
    expect(observer.mutationStats.coalesced).toBe(1);
  });

  it('continues a yielded walker after newer overlapping work covers its next node', () => {
    const root = document.createElement('div');
    const first = document.createElement('section');
    const covered = document.createElement('section');
    const last = document.createElement('video');
    root.append(first, covered, last);
    const job = observer.createWalk(root, document.body, true);
    observer.stepWalk(job);
    observer.stepWalk(job);
    expect(job.next).toBe(covered);
    observer.scannedAdded.add(covered);
    while (observer.stepWalk(job)) {
      // Drain the already-created synchronous walker.
    }
    expect(found).toHaveBeenCalledExactlyOnceWith(last, root);
  });

  it('continues after one site callback throws and drops pending work on stop', () => {
    const root = document.createElement('div');
    const first = document.createElement('video');
    const second = document.createElement('video');
    root.append(first, second);
    found.mockImplementationOnce(() => {
      throw new Error('hostile player');
    });
    observer.scheduleMutationProcessing([record(root)]);
    drain();
    expect(found).toHaveBeenCalledTimes(2);
    observer.scheduleMutationProcessing([record(root)]);
    observer.stop();
    expect(observer.getPendingWorkCount()).toBe(0);
    callbacks.shift()();
    expect(found).toHaveBeenCalledTimes(2);
  });

  it('keeps connected media moved inside shadow DOM', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    shadow.append(video);
    document.body.append(host);
    observer.processMutations([record(video, false)]);
    expect(removed).not.toHaveBeenCalled();
    host.remove();
  });
});
