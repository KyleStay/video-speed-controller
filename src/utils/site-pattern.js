/**
 * Site pattern matching utilities.
 *
 * Shared matching engine used by siteRules (structured array) and the legacy
 * blacklist (newline-separated string).  Pure ES module — no DOM dependencies.
 */

const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;
const escapeRegExp = (str) => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

/**
 * Compile a pattern string into a RegExp.
 *
 * Supports three forms:
 *   1. Regex notation:  /pattern/flags
 *   2. Domain literal:  youtube.com  →  hostname and subdomain match
 *   3. Substring:       any other string  →  escaped literal match
 *
 * @param {string} raw - Pattern string (trimmed)
 * @returns {RegExp|null} Compiled regex, or null if invalid
 */
function compilePattern(raw) {
  const pattern = raw.replace(regStrip, '');
  if (pattern.length === 0) {
    return null;
  }

  if (pattern.startsWith('/')) {
    try {
      const parts = pattern.split('/');
      if (parts.length < 3) {
        return null;
      }

      const hasFlags = regEndsWithFlags.test(pattern);
      const flags = hasFlags ? parts.pop() : '';
      const regex = parts.slice(1, hasFlags ? undefined : -1).join('/');

      if (!regex) {
        return null;
      }
      return new RegExp(regex, flags);
    } catch {
      return null;
    }
  }

  const escaped = escapeRegExp(pattern);
  const looksLikeDomain = pattern.includes('.') && !pattern.includes('/');

  if (looksLikeDomain) {
    return new RegExp(`(^|\\.)${escaped}$`, 'i');
  }
  return new RegExp(escaped);
}

/**
 * Match a URL against an array of site rule objects.
 * Returns the first rule whose pattern matches, or null.
 *
 * @param {Array<{pattern: string}>} rules - Rule objects (must have a `pattern` field)
 * @param {string} href - URL to test
 * @returns {Object|null} First matching rule, or null
 */
export function matchSiteRule(rules, href) {
  if (!rules || !rules.length) {
    return null;
  }

  for (const rule of rules) {
    const pattern = (rule.pattern || '').replace(regStrip, '');
    let target = href;
    if (!pattern.startsWith('/') && pattern.includes('.') && !pattern.includes('/')) {
      try {
        const url = new URL(href);
        const port = url.port || { 'http:': '80', 'https:': '443' }[url.protocol];
        target = pattern.includes(':') && port ? `${url.hostname}:${port}` : url.hostname;
      } catch {
        continue;
      }
    }
    const regexp = compilePattern(pattern);
    if (regexp && regexp.test(target)) {
      return rule;
    }
  }

  return null;
}

/**
 * Backward-compatible wrapper: check a legacy newline-separated blacklist string.
 *
 * @param {string} blacklist - Newline-separated pattern string
 * @param {string} href - URL to test
 * @returns {boolean} true if any pattern matches
 */
// Expose on window.VSC for page-context consumers (settings.js).
window.VSC = window.VSC || {};
window.VSC.matchSiteRule = matchSiteRule;

export function isBlacklisted(blacklist, href) {
  if (!blacklist) {
    return false;
  }

  const rules = blacklist
    .split('\n')
    .map((line) => ({ pattern: line.replace(regStrip, '') }))
    .filter((r) => r.pattern.length > 0);

  return matchSiteRule(rules, href) !== null;
}
