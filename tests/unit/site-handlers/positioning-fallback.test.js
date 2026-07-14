/**
 * R5: site handlers must never return a null/unusable insertion point, which
 * would silently drop the controller. They fall back to the media's own parent
 * when there is no ancestor to anchor to.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

describe('site handler positioning fallbacks', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  describe('NetflixHandler.getControllerPosition', () => {
    it('inserts before the grandparent when one exists', () => {
      const handler = new window.VSC.NetflixHandler();
      const grandparent = document.createElement('div');
      const parent = document.createElement('div');
      grandparent.appendChild(parent);

      const pos = handler.getControllerPosition(parent, document.createElement('video'));
      expect(pos.insertionPoint).toBe(grandparent);
      expect(pos.insertionMethod).toBe('beforeParent');
    });

    it('falls back to the parent when there is no grandparent', () => {
      const handler = new window.VSC.NetflixHandler();
      const parent = document.createElement('div'); // detached → no parentElement

      const pos = handler.getControllerPosition(parent, document.createElement('video'));
      expect(pos.insertionPoint).toBe(parent);
      expect(pos.insertionMethod).toBe('firstChild');
    });
  });

  describe('YouTubeHandler.getControllerPosition', () => {
    it('falls back to the parent when there is no parentElement', () => {
      const handler = new window.VSC.YouTubeHandler();
      const parent = document.createElement('div'); // detached → no parentElement

      const pos = handler.getControllerPosition(parent, document.createElement('video'));
      expect(pos.insertionPoint).toBe(parent);
      expect(pos.targetParent).toBe(parent);
    });
  });
});
