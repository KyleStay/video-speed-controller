/* global __VSC_BROWSER__ */

export const SAFARI_SPEED_REQUESTS =
  typeof __VSC_BROWSER__ !== 'undefined' && __VSC_BROWSER__ === 'safari';

// A product request range, not a guarantee of source/device decoding capacity.
export const SPEED_LIMITS = Object.freeze({ MIN: 0.07, MAX: 16 });

export function speedRangeDescription() {
  return 'between 0.07× and 16×';
}

// Preserve old Safari preferences while lowering unsupported absolute requests.
// Relative adjustments, seek intervals and frame rates are different units.
export function normalizeSpeedSetting(key, value) {
  const bound = (rate) =>
    Number.isFinite(rate) && rate > SPEED_LIMITS.MAX ? SPEED_LIMITS.MAX : rate;
  if (key === 'lastSpeed' || key === 'siteDefaultSpeed') {
    return bound(value);
  }
  if (key === 'keyBindings' && Array.isArray(value)) {
    return value.map((binding) =>
      binding && ['fast', 'reset'].includes(binding.action)
        ? { ...binding, value: bound(binding.value) }
        : binding
    );
  }
  if (key === 'siteRules' && Array.isArray(value)) {
    return value.map((rule) =>
      rule && typeof rule === 'object' ? { ...rule, speed: bound(rule.speed) } : rule
    );
  }
  return value;
}
