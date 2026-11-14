import { buildReplayProposals } from "./replay.js";
import type { ToolCallRequest } from "../types.js";
import { config } from "../config.js";

/**
 * Pluggable model adapter. MVP uses deterministic replay proposals;
 * set MODEL_PROVIDER=openai to extend with live model output later.
 */
export async function proposeToolCalls(runId: string): Promise<ToolCallRequest[]> {
  if (config.modelProvider === "deterministic" || !config.openaiApiKey) {
    return buildReplayProposals(runId);
  }
  // Future: call OpenAI with tools schema, return proposals (still via gateway).
  return buildReplayProposals(runId);
}