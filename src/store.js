// Tiny zero-dependency persistence. In-memory by default; set SPINE_DATA_DIR to persist to JSON.
// In production you would back ARS + the AGS log with Postgres; the interface below is all the
// rest of SPINE-dots depends on, so swapping the store out is a one-file change.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.SPINE_DATA_DIR || null;
const file = (name) => (DIR ? join(DIR, `${name}.json`) : null);
const mem = new Map(); // in-memory cache so state survives across calls even without a data dir

function load(name, fallback) {
  if (mem.has(name)) return mem.get(name);
  const f = file(name);
  if (f && existsSync(f)) { try { const v = JSON.parse(readFileSync(f, 'utf8')); mem.set(name, v); return v; } catch { /* ignore */ } }
  mem.set(name, fallback);
  return fallback;
}
function persist(name, value) {
  mem.set(name, value);
  const f = file(name);
  if (!f) return;
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(f, JSON.stringify(value, null, 2)); } catch { /* ignore */ }
}

/** A durable append-only list (used by the AGS hash-chained log). */
export function appendLog(name, entry) {
  const log = load(name, []);
  log.push(entry);
  persist(name, log);
  return log;
}
export function readLog(name) { return load(name, []); }

/** Monotonic sequence (fixes C14 — ids must not be derived from array length). */
export function nextSeq(name) {
  const key = `${name}-seq`;
  const current = load(key, 0);
  const next = current + 1;
  persist(key, next);
  return next;
}

/** A durable keyed collection (used by ARS registry and DCS handover records). */
export function collection(name) {
  const data = load(name, {});
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; persist(name, data); return v; },
    all: () => Object.values(data),
    has: (k) => Object.prototype.hasOwnProperty.call(data, k),
  };
}
