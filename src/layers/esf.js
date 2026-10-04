// ESF — External Signal Fabric.
// The newsroom fact-checking desk. Every piece of outside information arrives stamped with where it
// came from, when, and how reliable it is — so later, "why did you act on that?" has a real answer.
import { createHash } from 'node:crypto';

const RELIABILITY = Object.freeze({ VERIFIED: 'verified', CORROBORATED: 'corroborated', SINGLE_SOURCE: 'single-source', UNVERIFIED: 'unverified' });
export { RELIABILITY };

/** Wrap an external signal in a provenance envelope. The payload is tamper-evident via its hash. */
export function stamp({ payload, source, reliability = RELIABILITY.SINGLE_SOURCE, fetchedAt = new Date().toISOString() }) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {
    payload,
    provenance: { source, reliability, fetchedAt, hash },
    trusted: reliability === RELIABILITY.VERIFIED || reliability === RELIABILITY.CORROBORATED,
  };
}

/** A Dot should refuse to act on low-trust signals for high-stakes decisions. */
export function trustworthyFor(signal, band) {
  if (band === 'critical' || band === 'high') return signal.provenance.reliability === RELIABILITY.VERIFIED || signal.provenance.reliability === RELIABILITY.CORROBORATED;
  return signal.provenance.reliability !== RELIABILITY.UNVERIFIED;
}
