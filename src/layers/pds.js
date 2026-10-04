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

/** Is `toolName` something PDS would hand this Dot for this task? Returns {ok, reason, tool}. */
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
