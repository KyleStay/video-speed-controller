/* global __VSC_BROWSER__ */

// WebKit accepts requested rates without a general maximum. Actual decoding
// remains media/device dependent; reading playbackRate is not a throughput test.
export const SAFARI_SPEED_REQUESTS =
  typeof __VSC_BROWSER__ !== 'undefined' && __VSC_BROWSER__ === 'safari';

export const SPEED_LIMITS = Object.freeze({
  MIN: 0.07,
  // AVPlayer transports rates as Float. Prevent finite JS doubles overflowing
  // that native type; this is a numeric bound, not a decoding-speed claim.
  MAX: SAFARI_SPEED_REQUESTS ? 3.4028234663852886e38 : 16,
});

export function speedRangeDescription() {
  return SAFARI_SPEED_REQUESTS ? 'at least 0.07×' : 'between 0.07× and 16×';
}
