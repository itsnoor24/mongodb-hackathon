import type { PolicyDoc, PolicyRule } from "../types.js";

export interface PolicyDecision {
  allowed: boolean;
  policyId: string;
  policyVersion: number;
  matchedRule: PolicyRule | null;
  reason: string;
  resourceKey: string;
}

function matchPattern(pattern: string, resource: string): boolean {
  const escaped = pattern.split("*").map((part) =>
    part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join(".*");
  return new RegExp(`^${escaped}$`).test(resource);
}

export function evaluatePolicy(
  policy: PolicyDoc,
  tool: string,
  resourceKey: string,
): PolicyDecision {
  const rules = [...policy.rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  let matched: PolicyRule | null = null;
  for (const rule of rules) {
    if (rule.tool !== tool) continue;
    if (!matchPattern(rule.resourcePattern, resourceKey)) continue;
    matched = rule;
    break;
  }

  if (!matched) {
    return {
      allowed: false,
      policyId: policy._id,
      policyVersion: policy.version,
      matchedRule: null,
      reason: "No matching rule — default deny",
      resourceKey,
    };
  }

  if (matched.effect === "deny") {
    return {
      allowed: false,
      policyId: policy._id,
      policyVersion: policy.version,
      matchedRule: matched,
      reason: `Explicit deny on ${matched.resourcePattern}`,
      resourceKey,
    };
  }

  return {
    allowed: true,
    policyId: policy._id,
    policyVersion: policy.version,
    matchedRule: matched,
    reason: `Allow via rule ${matched.resourcePattern}`,
    resourceKey,
  };
}

export function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/token|secret|password|prompt/i.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 200) + "…[truncated]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function resourceKeyForTool(
  tool: string,
  args: Record<string, unknown>,
): string {
  if (tool === "atlas.read") {
    const id = args.recordId ?? args.id;
    return `demo_records/${String(id)}`;
  }
  if (tool === "github.issue.create") {
    const owner = String(args.owner ?? "");
    const repo = String(args.repo ?? "");
    return `github:${owner}/${repo}`;
  }
  return `tool:${tool}`;
}
