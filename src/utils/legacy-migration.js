/** Convert the legacy newline blacklist into structured disabled site rules. */
export function legacyBlacklistToSiteRules(blacklist) {
  if (typeof blacklist !== 'string') {
    return [];
  }
  return blacklist
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((pattern) => ({ pattern, enabled: false, speed: null }));
}
