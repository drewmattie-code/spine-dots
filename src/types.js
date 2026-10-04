// Shared vocabulary for SPINE-dots. Zero-dependency, JSDoc typedefs + enums.

/** Tiers a Dot can run at. The Spine Gate promotes sandbox -> production; higher tier = higher bar. */
export const Tier = Object.freeze({ SANDBOX: 'sandbox', STAGING: 'staging', PRODUCTION: 'production' });

/** How reversible an action is. Drives risk. */
export const Reversibility = Object.freeze({ REVERSIBLE: 'reversible', PARTIAL: 'partial', IRREVERSIBLE: 'irreversible' });

/** Data sensitivity classes (GDS). */
export const Sensitivity = Object.freeze({ PUBLIC: 'public', INTERNAL: 'internal', CONFIDENTIAL: 'confidential', RESTRICTED: 'restricted' });

/** Coarse tool classes used by CRI + PDS. */
export const ToolClass = Object.freeze({
  READ: 'read',            // read-only, local
  RESEARCH: 'research',    // read-only, external (web)
  WRITE: 'write',          // mutates internal state
  EGRESS: 'egress',        // sends data OUT of the org (email, webhook, post)
  MONEY: 'money',          // moves money
  ADMIN: 'admin',          // changes config / permissions / infra
});

/** The decision the gateway returns for an action. */
export const Decision = Object.freeze({ ALLOW: 'ALLOW', NEEDS_APPROVAL: 'NEEDS_APPROVAL', BLOCK: 'BLOCK' });

/**
 * @typedef {Object} Action        A single tool call a Dot wants to make.
 * @property {string} dotId        Which Dot is acting.
 * @property {string} task         Plain-language task the Dot is pursuing (drives PDS discovery).
 * @property {string} tool         Tool name being invoked.
 * @property {Object} args         Tool arguments (recipient, dataset, amount, ...).
 * @property {string[]} [datasets] Datasets the action reads (GDS scopes these).
 * @property {string} [recipient]  For egress tools: where data is going.
 */

/**
 * @typedef {Object} GatewayDecision
 * @property {string} decision     One of Decision.
 * @property {string[]} reasons    Human-readable reasons the decision was reached.
 * @property {Object} risk         CRI output {score, band, factors}.
 * @property {Object[]} objections ACS checker objections (empty if none / not run).
 * @property {Object} data         GDS result {granted, redacted[]}.
 * @property {string} logId        AGS audit-log entry id (hash-chained).
 * @property {Object} card         What an OpenDots approval card should render.
 */

export const isExternal = (recipient) =>
  typeof recipient === 'string' && /@/.test(recipient) && !/@(internal|acme|corp)\b/i.test(recipient);
