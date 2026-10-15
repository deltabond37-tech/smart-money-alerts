import { evaluateFilters, type FilterContext } from "./filter.js";
import { routeByScore, scoreEvent, type ScoreInput } from "./scorer.js";
import type { Decision, PositionEvent, Thresholds } from "./types.js";

/**
 * Full decision for one event: hard filters -> score -> route.
 * Score is always computed (even for filtered events) so the dashboard can audit it.
 */
export function decide(ev: PositionEvent, t: Thresholds, filterCtx: FilterContext, scoreInput: ScoreInput): Decision {
  const { score, components } = scoreEvent(ev, scoreInput, t);
  const f = evaluateFilters(ev, t, filterCtx);
  if (!f.pass) return { filtered: true, filterReason: f.reason, score, components, channel: null };
  const channel = routeByScore(score, t);
  if (!channel) return { filtered: true, filterReason: "below_score_threshold", score, components, channel: null };
  return { filtered: false, filterReason: null, score, components, channel };
}
