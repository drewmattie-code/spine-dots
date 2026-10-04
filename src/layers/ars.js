// ARS — Agent Registry Spine.
// The master list of every Dot: who owns it, whether it's approved, its tier, its granted
// tool classes, its data clearance, its egress scope, and its version. PDS and AGS both read
// from this one list. A Dot that is not registered (or not approved) cannot act.
import { collection } from '../store.js';
import { Tier, Sensitivity, ToolClass } from '../types.js';

const dots = collection('ars');

/** Register or update a Dot. Returns the stored record. */
export function register(dot) {
  const record = {
    id: dot.id,
    name: dot.name ?? dot.id,
    owner: dot.owner ?? 'unknown',
    approved: dot.approved ?? false,
    tier: dot.tier ?? Tier.SANDBOX,
    version: dot.version ?? '0.1.0',
    toolClasses: dot.toolClasses ?? [ToolClass.READ],     // which tool classes this Dot may use
    clearance: dot.clearance ?? Sensitivity.INTERNAL,     // max data sensitivity it may see
    egressScope: dot.egressScope ?? 'internal-only',      // 'internal-only' | 'external-allowed'
    registeredAt: dots.get(dot.id)?.registeredAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return dots.set(dot.id, record);
}

export function lookup(dotId) { return dots.get(dotId); }
export function list() { return dots.all(); }
export function isRunnable(dotId) {
  const d = dots.get(dotId);
  return !!(d && d.approved);
}
export function setTier(dotId, tier) {
  const d = dots.get(dotId);
  if (!d) throw new Error(`ARS: unknown Dot ${dotId}`);
  d.tier = tier; d.updatedAt = new Date().toISOString();
  return dots.set(dotId, d);
}
