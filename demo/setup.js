// Demo setup: register the Finance Dot and promote it to production through the Spine Gate.
// Also defines the risky action used by the side-by-side demo + the tests.
import * as ars from '../src/layers/ars.js';
import * as dcs from '../src/layers/dcs.js';
import * as gate from '../src/layers/gate.js';
import { Tier, Sensitivity, ToolClass } from '../src/types.js';

export const FINANCE_DOT_ID = 'finance-dot';

export function setupFinanceDot() {
  // A clean handover record (no half-finished work) so the Dot can pass the Gate's clean-memory check.
  dcs.update(FINANCE_DOT_ID, { open: [], done: ['reconciled Q3 ledger'], notes: 'quarter closed' });

  // Register in the sandbox with an explicit, named grant. Note egress scope = internal-only.
  ars.register({
    id: FINANCE_DOT_ID,
    name: 'Finance Dot',
    owner: 'cfo@acme.corp',
    tier: Tier.SANDBOX,
    approved: false,
    version: '1.0.0',
    toolClasses: [ToolClass.READ, ToolClass.RESEARCH, ToolClass.WRITE, ToolClass.EGRESS],
    clearance: Sensitivity.CONFIDENTIAL,   // may see names/departments, NOT salary/ssn (restricted)
    egressScope: 'internal-only',          // the Gate only cleared it to email INSIDE the org
  });

  // Promote sandbox -> production through the Spine Gate.
  const promotion = gate.promote(FINANCE_DOT_ID, Tier.PRODUCTION);
  return { dot: ars.lookup(FINANCE_DOT_ID), promotion };
}

// The action under test: email the Q3 payroll summary to an outside vendor.
export const RISKY_ACTION = {
  dotId: FINANCE_DOT_ID,
  task: 'email the Q3 payroll summary to the vendor',
  tool: 'send_email',
  recipient: 'accounts@vendor-supplier.com',
  datasets: ['payroll.csv'],
  args: { subject: 'Q3 payroll summary', body: '(attached)' },
};
