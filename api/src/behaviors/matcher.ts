import { createHash } from "node:crypto";
import type { StoredNode } from "../streams/store.js";
import { nodeEmbeddingFields } from "../streams/embeddings.js";

export interface BehaviorStep { query: string; status?: "failed" | "completed" | "in_progress" | "unknown" }
export interface BehaviorRule {
  _id: string; streamId?: string; name: string; mode: "text" | "semantic";
  steps: BehaviorStep[]; threshold: number; withinSeconds: number; enabled: boolean;
  createdAt: Date; updatedAt: Date;
}
export interface ObservedNode extends StoredNode { observedAt: Date }
export interface StepHit { nodeKey: string; textHash: string; score: number }
export interface BehaviorCheck {
  _id: string; behaviorId: string; step: number; fingerprint: string;
  hits: StepHit[]; attempts: number; checkedAt: Date; nextRetryAt: Date; error?: string;
}
export interface BehaviorMatch {
  _id: string; behaviorId: string; streamId: string; name: string; mode: string;
  detectedAt: Date; nodes: { id: string; label: string; evidence: string; score: number; observedAt: Date }[];
}

export class BehaviorInputError extends Error {}

export function validateBehavior(value: unknown): Omit<BehaviorRule, "_id" | "createdAt" | "updatedAt"> {
  const input = value as Partial<BehaviorRule> | null;
  if (!input || typeof input !== "object") throw new BehaviorInputError("Expected a behavior definition");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw new BehaviorInputError("Name must be 1–120 characters");
  if (input.mode !== "text" && input.mode !== "semantic") throw new BehaviorInputError("Choose phrase or semantic matching");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 5) throw new BehaviorInputError("Use 1–5 ordered steps");
  const steps = input.steps.map(step => {
    if (!step || typeof step.query !== "string" || !step.query.trim() || step.query.length > 500) throw new BehaviorInputError("Each step needs 1–500 characters");
    if (input.mode === "text" && step.query.split("|").some(term => !term.trim())) throw new BehaviorInputError("Phrase alternatives cannot be empty");
    if (step.status !== undefined && !["failed", "completed", "in_progress", "unknown"].includes(step.status)) throw new BehaviorInputError("Invalid step status");
    return { query: step.query.trim(), ...(step.status ? { status: step.status } : {}) };
  });
  const threshold = input.threshold ?? 0.78;
  const withinSeconds = input.withinSeconds ?? 300;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new BehaviorInputError("Similarity threshold must be 0–1");
  if (!Number.isInteger(withinSeconds) || withinSeconds < 1 || withinSeconds > 86400) throw new BehaviorInputError("Window must be 1–86400 seconds");
  if (input.streamId !== undefined && (typeof input.streamId !== "string" || !input.streamId.trim() || input.streamId.length > 200)) throw new BehaviorInputError("Invalid stream scope");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new BehaviorInputError("Invalid enabled flag");
  return { name: input.name.trim(), mode: input.mode, steps, threshold, withinSeconds, enabled: input.enabled ?? true, ...(input.streamId ? { streamId: input.streamId } : {}) };
}

export const textHash = (node: StoredNode) => node.embeddingTextHash ?? nodeEmbeddingFields(node).embeddingTextHash;
export function behaviorFingerprint(nodes: StoredNode[]) {
  return createHash("sha256").update(JSON.stringify(nodes.map(node => [node._id, textHash(node)]).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

export function matchBehavior(rule: BehaviorRule, nodes: ObservedNode[], checks: BehaviorCheck[] = []): BehaviorMatch[] {
  if (!rule.enabled) return [];
  const candidates = rule.steps.map((step, index) => {
    const scores = new Map((checks.find(check => check.behaviorId === rule._id && check.step === index)?.hits ?? []).map(hit => [hit.nodeKey, hit]));
    return nodes.filter(node => !rule.streamId || node.streamId === rule.streamId).flatMap(node => {
      if (step.status && node.status !== step.status) return [];
      if (rule.mode === "text") {
        // Summaries can mention past events ("recovered after a retry"). Exact
        // signals should be grounded in this activity's label or source quote.
        const text = `${node.label}\n${node.evidence}`.normalize("NFKC").toLowerCase();
        return step.query.split("|").some(term => text.includes(term.trim().normalize("NFKC").toLowerCase())) ? [{ node, score: 1 }] : [];
      }
      const hit = scores.get(node._id);
      return hit && hit.textHash === textHash(node) && hit.score >= rule.threshold ? [{ node, score: hit.score }] : [];
    }).sort((a, b) => b.node.observedAt.getTime() - a.node.observedAt.getTime() || b.node.throughSequence - a.node.throughSequence);
  });
  const matches: BehaviorMatch[] = [];
  for (const last of candidates.at(-1)!) {
    const chain = [last];
    const earliest = last.node.observedAt.getTime() - rule.withinSeconds * 1000;
    for (let step = candidates.length - 2; step >= 0; step--) {
      const next = chain[0];
      const previous = candidates[step].find(hit => hit.node.streamId === last.node.streamId
        && hit.node.throughSequence < next.node.throughSequence
        && hit.node.observedAt.getTime() >= earliest
        && hit.node.observedAt.getTime() <= next.node.observedAt.getTime());
      if (!previous) break;
      chain.unshift(previous);
    }
    if (chain.length !== rule.steps.length) continue;
    const id = createHash("sha256").update(JSON.stringify([rule._id, ...chain.map(hit => hit.node._id)])).digest("hex");
    matches.push({ _id: id, behaviorId: rule._id, streamId: last.node.streamId, name: rule.name, mode: rule.mode, detectedAt: new Date(),
      nodes: chain.map(({ node, score }) => ({ id: node.id, label: node.label, evidence: node.evidence, score, observedAt: node.observedAt })),
    });
    if (matches.length >= 20) break;
  }
  return matches;
}
