import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../../e2e/fixture-server.js';

describe('browser fixture server', () => {
  it('parses ordinary, open-ended, and suffix byte ranges', () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-16', 100)).toEqual({ start: 84, end: 99 });
    expect(parseByteRange('bytes=100-101', 100)).toBe(false);
  });
});
