// GDS — Grounded Data Spine.
// The official company dictionary + a locked records room. One agreed definition of things, and
// a Dot can only pull the specific fields it is cleared to see. Returns the data it IS allowed,
// with over-clearance fields redacted (and names them, so the gateway can explain the redaction).
import { Sensitivity } from '../types.js';

const RANK = { [Sensitivity.PUBLIC]: 0, [Sensitivity.INTERNAL]: 1, [Sensitivity.CONFIDENTIAL]: 2, [Sensitivity.RESTRICTED]: 3 };

// Canonical definitions — the one shared dictionary (sample).
export const DEFINITIONS = Object.freeze({
  revenue: 'Recognized revenue per GAAP for the period; excludes bookings and pipeline.',
  active_customer: 'An account with >=1 paid transaction in the trailing 90 days.',
  payroll: 'Gross compensation records for employees for a pay period.',
});

// Data catalog: per dataset, the sensitivity of each field + the dataset max.
export const DEFAULT_DATASETS = {
  'payroll.csv': {
    sensitivity: Sensitivity.RESTRICTED,
    fields: {
      employee_name: Sensitivity.CONFIDENTIAL,
      department: Sensitivity.INTERNAL,
      headcount: Sensitivity.INTERNAL,
      salary: Sensitivity.RESTRICTED,
      ssn: Sensitivity.RESTRICTED,
    },
  },
  'q3_summary.csv': {
    sensitivity: Sensitivity.INTERNAL,
    fields: { department: Sensitivity.INTERNAL, headcount: Sensitivity.INTERNAL, budget_variance: Sensitivity.INTERNAL },
  },
};

export function define(term) { return DEFINITIONS[term] ?? null; }

/** Resolve a Dot's access to datasets. Returns {granted:[{dataset,fields}], redacted:[{dataset,field,sensitivity}], denied:[]}. */
export function access(dot, datasets = [], catalog = DEFAULT_DATASETS) {
  const clearance = RANK[dot.clearance] ?? 0;
  const granted = [], redacted = [], denied = [];
  for (const name of datasets) {
    const spec = catalog[name];
    if (!spec) { denied.push({ dataset: name, reason: 'unknown dataset' }); continue; }
    const fields = [];
    for (const [field, sens] of Object.entries(spec.fields)) {
      if (RANK[sens] <= clearance) fields.push(field);
      else redacted.push({ dataset: name, field, sensitivity: sens });
    }
    granted.push({ dataset: name, sensitivity: spec.sensitivity, fields });
  }
  return { granted, redacted, denied };
}

/** Highest sensitivity actually touched by this access (for CRI). */
export function peakSensitivity(datasets = [], catalog = DEFAULT_DATASETS) {
  let peak = Sensitivity.PUBLIC;
  for (const name of datasets) {
    const s = catalog[name]?.sensitivity;
    if (s && RANK[s] > RANK[peak]) peak = s;
  }
  return peak;
}
