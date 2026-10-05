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
    if (urls.some((u) => recipient.startsWith(u))) return 'internal';
    const host = domainOf(recipient);
    return host && isAllowedDomain(host, domains) ? 'internal' : 'external';
  }
  const domain = domainOf(recipient);
  if (!domain) return 'external'; // fail closed on unknown/malformed
  return isAllowedDomain(domain, domains) ? 'internal' : 'external';
}
