// SPINE-dots public API. `import { handle, createMcpGateway, ... } from 'spine-dots'`.
export { handle } from './src/gateway.js';
export { createMcpGateway } from './src/mcp/gateway.js';

// Policy engine (declarative, safe)
export { evaluatePolicy, validatePolicy, DEFAULT_POLICY, STARTER_PACKS } from './src/policy/engine.js';
export { evalExpr, compile } from './src/policy/expr.js';

// Enforcement building blocks
export { classifyRecipient } from './src/egress.js';
export * as ars from './src/layers/ars.js';
export * as pds from './src/layers/pds.js';
export * as gds from './src/layers/gds.js';
export * as cri from './src/layers/cri.js';
export * as acs from './src/layers/acs.js';
export * as ags from './src/layers/ags.js';
export * as gate from './src/layers/gate.js';
export * as dcs from './src/layers/dcs.js';
export * as esf from './src/layers/esf.js';

// Vocabulary
export { Tier, Reversibility, Sensitivity, ToolClass, Decision } from './src/types.js';
