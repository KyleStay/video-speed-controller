/**
 * Blacklist checking utility
 * Works in both content script and test contexts
 */

/**
 * Check if URL matches blacklist patterns
 * @param {string} blacklist - Newline separated list of patterns
 * @param {string} href - URL to check
 * @returns {boolean} Whether URL is blacklisted
 */
export function isBlacklisted(blacklist, href) {
  if (!blacklist) {
    return false;
  }

  const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
  const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

  const escapeRegExp = (str) => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

  for (const rawMatch of blacklist.split('\n')) {
    const match = rawMatch.replace(regStrip, '');
    if (match.length === 0) {
      continue;
    }

    let regexp;
    let target = href;
    if (match.startsWith('/')) {
      try {
        const parts = match.split('/');
        if (parts.length < 3) {
          continue;
        }

        const hasFlags = regEndsWithFlags.test(match);
        const flags = hasFlags ? parts.pop() : '';
        const regex = parts.slice(1, hasFlags ? undefined : -1).join('/');

        if (!regex) {
          continue;
        }
        regexp = new RegExp(regex, flags);
      } catch {
        continue;
      }
    } else {
      const escapedMatch = escapeRegExp(match);
      const looksLikeDomain = match.includes('.') && !match.includes('/');

      if (looksLikeDomain) {
        try {
          const url = new URL(href);
          const port = url.port || { 'http:': '80', 'https:': '443' }[url.protocol];
          target = match.includes(':') && port ? `${url.hostname}:${port}` : url.hostname;
        } catch {
          continue;
        }
        regexp = new RegExp(`(^|\\.)${escapedMatch}$`, 'i');
      } else {
        regexp = new RegExp(escapedMatch);
      }
    }

    if (regexp.test(target)) {
      return true;
    }
  }

  return false;
}
