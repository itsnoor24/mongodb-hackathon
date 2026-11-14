import { buildReplayProposals } from "./replay.js";
import type { ToolCallRequest } from "../types.js";

/**
 * Deterministic proposal list. Live runs do not use this: startDemoRun calls
 * runLiveAgent when replay is false, so each model turn can see the gateway result.
 */
export async function proposeToolCalls(runId: string): Promise<ToolCallRequest[]> {
  return buildReplayProposals(runId);
}