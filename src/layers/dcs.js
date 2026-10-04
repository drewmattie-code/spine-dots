// DCS — Durable Context Spine.
// The shift-handover log. When one agent "shift" ends and the next begins, it reads a written record
// of what's done, what's open, and where things stand — instead of walking in with amnesia.
// In OpenDots this maps onto durable Threads + per-Dot workspace memory; here it's a durable record.
import { collection } from '../store.js';

const records = collection('dcs');

export function handover(dotId) {
  return records.get(dotId) ?? { dotId, open: [], done: [], notes: '', updatedAt: null };
}

export function update(dotId, patch) {
  const cur = handover(dotId);
  const next = {
    dotId,
    open: patch.open ?? cur.open,
    done: patch.done ?? cur.done,
    notes: patch.notes ?? cur.notes,
    updatedAt: new Date().toISOString(),
  };
  return records.set(dotId, next);
}

/** Memory is "clean" for Gate purposes when it carries no half-finished, unexplained open items. */
export function isClean(dotId) {
  const h = handover(dotId);
  return h.open.length === 0;
}
