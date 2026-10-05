// Egress classification (fixes C5). A recipient is INTERNAL only if it canonically matches an
// org-owned allowlist of domains / URL prefixes; everything else — including unknown, malformed,
// lookalike and subdomain-spoof recipients — is EXTERNAL. Default external, fail closed.
// This replaces v0.1's `isExternal` regex, which counted any string containing "corp"/"acme" as
// internal (so attacker@corp.evil.com and any webhook URL were treated as inside the org).

/** The host/domain of a recipient (email or URL), lowercased and trailing-dot-stripped, or null. */
function domainOf(recipient) {
  if (typeof recipient !== 'string' || !recipient) return null;
  if (recipient.includes('://')) {
    try { return new URL(recipient).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  }
  if (recipient.includes('@')) {
    const d = recipient.split('@').pop().trim().toLowerCase().replace(/\.$/, '');
    return d || null;
  }
  return null;
}

/** True if `domain` is exactly an allowlisted domain or a subdomain of one. */
function isAllowedDomain(domain, domains = []) {
  return domains.some((a) => {
    const base = String(a).toLowerCase().replace(/\.$/, '');
    return domain === base || domain.endsWith('.' + base);
  });
}

/**
 * Classify an egress recipient against the org allowlist.
 * @param {string} recipient  an email address or URL
 * @param {{domains?: string[], urls?: string[]}} [allowlist]
 * @returns {'internal'|'external'}
 */
export function classifyRecipient(recipient, allowlist = {}) {
  const domains = allowlist.domains ?? [];
  const urls = allowlist.urls ?? [];
  if (typeof recipient === 'string' && recipient.includes('://')) {
    let u; try { u = new URL(recipient); } catch { return 'external'; }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (isAllowedDomain(host, domains)) return 'internal';
    // Match an allowlisted URL by parsed HOST + path prefix, never raw string prefix — otherwise
    // "https://hooks.acme.corp" would also approve "https://hooks.acme.corp.evil.com".
    for (const raw of urls) {
      let a; try { a = new URL(raw); } catch { continue; }
      const ahost = a.hostname.toLowerCase().replace(/\.$/, '');
      // path must match at a boundary — "/in" must not also match "/inbox-evil".
      const base = a.pathname.endsWith('/') ? a.pathname : a.pathname + '/';
      const pathOk = u.pathname === a.pathname || u.pathname.startsWith(base);
      if (host === ahost && pathOk) return 'internal';
    }
    return 'external';
  }
  const domain = domainOf(recipient);
  if (!domain) return 'external'; // fail closed on unknown/malformed
  return isAllowedDomain(domain, domains) ? 'internal' : 'external';
}
