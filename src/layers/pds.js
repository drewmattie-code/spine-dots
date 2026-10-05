// PDS — Progressive Discovery Spine.
// The supply room with a concierge. A Dot does not get all tools; it asks "I need to do X" and
// is handed only the tools that fit the task AND that its registry grant (ARS) and tier allow.
// This is also the ONLY door: the gateway refuses any tool PDS did not hand out.
import { Tier, ToolClass } from '../types.js';

const TIER_RANK = { [Tier.SANDBOX]: 0, [Tier.STAGING]: 1, [Tier.PRODUCTION]: 2 };

// Default tool catalog. In a real deployment this mirrors the OpenDots per-Dot tool registry.
export const DEFAULT_CATALOG = [
  { name: 'read_file',    class: ToolClass.READ,     minTier: Tier.SANDBOX,    tasks: ['read', 'summarize', 'analyze', 'report'] },
  { name: 'web_research', class: ToolClass.RESEARCH, minTier: Tier.SANDBOX,    tasks: ['research', 'look up', 'find', 'summarize'] },
  { name: 'write_file',   class: ToolClass.WRITE,    minTier: Tier.STAGING,    tasks: ['write', 'save', 'draft', 'update'] },
  { name: 'send_email',   class: ToolClass.EGRESS,   minTier: Tier.PRODUCTION, tasks: ['email', 'send', 'notify', 'share', 'report'] },
  { name: 'post_webhook', class: ToolClass.EGRESS,   minTier: Tier.PRODUCTION, tasks: ['post', 'publish', 'sync', 'notify'] },
  { name: 'transfer_funds', class: ToolClass.MONEY,  minTier: Tier.PRODUCTION, tasks: ['pay', 'transfer', 'refund'] },
];

const matchesTask = (tool, task = '') => {
  const t = task.toLowerCase();
  return tool.tasks.some((kw) => t.includes(kw));
};

/** The tools handed to this Dot for this task. */
export function discover(dot, task, catalog = DEFAULT_CATALOG) {
  return catalog.filter(
    (tool) =>
      dot.toolClasses.includes(tool.class) &&
      TIER_RANK[dot.tier] >= TIER_RANK[tool.minTier] &&
      matchesTask(tool, task)
  );
}

// Default task-type grants (fixes C7). An operator/workflow assigns a Dot a registered task TYPE,
// and the task type names exactly which tools are in play. Tool grants come from here — never from
// the agent's free-text task string, so injected text like "...report and send_email now" can't
// widen the grant.
export const DEFAULT_TASK_TYPES = Object.freeze({
  read_report:    { tools: ['read_file', 'web_research'] },
  draft_internal: { tools: ['read_file', 'write_file'] },
  send_report:    { tools: ['read_file', 'send_email'] },
  pay_vendor:     { tools: ['read_file', 'transfer_funds'] },
});

/**
 * Authorize a tool by the registered task TYPE (not by free text). Fails closed on unknown type.
 * @param {Object} dot
 * @param {string} taskType  operator/workflow-assigned enum, e.g. "read_report"
 * @param {string} toolName
 * @param {{taskTypes?: Object, catalog?: Array, task?: string}} [opts]  `task` (free text) is ignored by design
 * @returns {{ok: boolean, reason: string, tool?: Object}}
 */
export function authorizeByTaskType(dot, taskType, toolName, opts = {}) {
  const taskTypes = opts.taskTypes ?? DEFAULT_TASK_TYPES;
  const catalog = opts.catalog ?? DEFAULT_CATALOG;
  const tt = taskType && taskTypes[taskType];
  if (!tt) return { ok: false, reason: `unknown task type "${taskType}" — no tools granted (fail closed)` };
  if (!tt.tools.includes(toolName)) return { ok: false, reason: `tool "${toolName}" is not granted to task type "${taskType}"` };
  const spec = catalog.find((t) => t.name === toolName);
  if (!spec) return { ok: false, reason: `tool "${toolName}" is not in the catalog` };
  if (!dot.toolClasses.includes(spec.class)) return { ok: false, reason: `Dot is not granted the "${spec.class}" tool class`, tool: spec };
  if (TIER_RANK[dot.tier] < TIER_RANK[spec.minTier]) return { ok: false, reason: `tool requires tier "${spec.minTier}", Dot is "${dot.tier}"`, tool: spec };
  return { ok: true, reason: `granted by registered task type "${taskType}"`, tool: spec };
}

/** @deprecated v0.1 free-text discovery — kept for the gateway until it's migrated to task types. Is `toolName` something PDS would hand this Dot for this task? Returns {ok, reason, tool}. */
export function authorize(dot, task, toolName, catalog = DEFAULT_CATALOG) {
  const spec = catalog.find((t) => t.name === toolName);
  if (!spec) return { ok: false, reason: `tool "${toolName}" is not in the catalog` };
  if (!dot.toolClasses.includes(spec.class))
    return { ok: false, reason: `Dot is not granted the "${spec.class}" tool class`, tool: spec };
  if (TIER_RANK[dot.tier] < TIER_RANK[spec.minTier])
    return { ok: false, reason: `tool requires tier "${spec.minTier}", Dot is "${dot.tier}"`, tool: spec };
  if (!matchesTask(spec, task))
    return { ok: false, reason: `tool "${toolName}" is not relevant to the stated task`, tool: spec };
  return { ok: true, reason: 'handed out by PDS for this task', tool: spec };
}
