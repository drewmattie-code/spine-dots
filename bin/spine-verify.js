#!/usr/bin/env node
// Standalone audit verifier CLI.  Usage: spine-verify <audit-export.json>
// Exits 0 if the bundle verifies (signatures + hash chain + Merkle anchors), 1 if not.
import { readFileSync } from 'node:fs';
import { verifyExport } from '../src/audit/verify.js';

const file = process.argv[2];
if (!file) { console.error('usage: spine-verify <audit-export.json>'); process.exit(2); }
let bundle;
try { bundle = JSON.parse(readFileSync(file, 'utf8')); }
catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }

const r = verifyExport(bundle);
if (r.ok) {
  console.log(`OK — ${r.entries} entries, ${r.anchors} anchor(s) verified against the public key.`);
  process.exit(0);
}
console.error(`FAIL — ${r.why}${r.brokenAt != null ? ` at entry ${r.brokenAt}` : ''}${r.brokenAnchor != null ? ` at anchor ${r.brokenAnchor}` : ''}`);
process.exit(1);
