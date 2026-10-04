// CRI — Composite Risk Index.
// A credit score that shows its work. Not one mystery number: the parts that made it. Scores an
// action 0-100 from tool class, data sensitivity, reversibility, external egress, and blast radius.
import { ToolClass, Sensitivity, Reversibility, isExternal } from '../types.js';

const TOOL_WEIGHT = {
  [ToolClass.READ]: 2, [ToolClass.RESEARCH]: 6, [ToolClass.WRITE]: 15,
  [ToolClass.EGRESS]: 30, [ToolClass.MONEY]: 40, [ToolClass.ADMIN]: 35,
};
const SENS_WEIGHT = {
  [Sensitivity.PUBLIC]: 0, [Sensitivity.INTERNAL]: 8, [Sensitivity.CONFIDENTIAL]: 22, [Sensitivity.RESTRICTED]: 35,
};
const REV_WEIGHT = {
  [Reversibility.REVERSIBLE]: 0, [Reversibility.PARTIAL]: 8, [Reversibility.IRREVERSIBLE]: 20,
};

const band = (score) => (score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 20 ? 'medium' : 'low');

/**
 * @param {{toolClass:string, sensitivity:string, reversibility:string, recipient?:string, blastRadius?:number}} a
 * @returns {{score:number, band:string, factors:{name:string, points:number}[]}}
 */
export function score(a) {
  const factors = [];
  const add = (name, points) => { if (points) factors.push({ name, points }); };

  add(`tool class: ${a.toolClass}`, TOOL_WEIGHT[a.toolClass] ?? 10);
  add(`data sensitivity: ${a.sensitivity}`, SENS_WEIGHT[a.sensitivity] ?? 0);
  add(`reversibility: ${a.reversibility}`, REV_WEIGHT[a.reversibility] ?? 0);
  if (a.recipient && isExternal(a.recipient)) add('external egress (leaves the org)', 18);
  if (a.blastRadius && a.blastRadius > 1) add(`blast radius x${a.blastRadius}`, Math.min(15, a.blastRadius * 2));

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return { score, band: band(score), factors };
}
