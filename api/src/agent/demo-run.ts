import { Db } from "mongodb";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { appendAuditEvent } from "../db/audit.js";
import { COLLECTIONS } from "../db/schemas.js";
import type { RunDoc } from "../types.js";
import { processToolCall } from "../gateway/gateway.js";
import { buildReplayProposals } from "./replay.js";
import { runLiveAgent } from "./live.js";
import { verifyGithubRepository } from "../tools/github-issue.js";

export async function startDemoRun(
  db: Db,
  options: { replay?: boolean } = {},
): Promise<string> {
  await verifyGithubRepository();
  const runId = config.demoRunId;
  const replay = options.replay ?? true;
  const now = new Date();

  await db.collection(COLLECTIONS.audit_events).deleteMany({ runId });

  const runs = db.collection<RunDoc>(COLLECTIONS.runs);
  await runs.updateOne(
    { _id: runId },
    {
      $set: {
        _id: runId,
        agentId: config.demoAgentId,
        initiator: "hackathon-reviewer@example.com",
        status: "running",
        replayMode: replay,
        updatedAt: now,
        createdAt: now,
      },
      $unset: { pausedBy: "", pausedAt: "" },
    },
    { upsert: true },
  );

  await appendAuditEvent(db, {
    _id: randomUUID(),
    runId,
    type: "run.started",
    actor: { kind: "system", id: "demo-orchestrator" },
    payload: { replayMode: replay, initiator: "hackathon-reviewer@example.com" },
  });

  try {
    if (replay) {
      const proposals = buildReplayProposals(runId);
      for (const proposal of proposals) {
        await processToolCall(db, config.demoAgentId, proposal);
      }
    } else {
      await runLiveAgent(db, runId);
    }
  } catch (error) {
    await runs.updateOne(
      { _id: runId },
      { $set: { status: "failed", updatedAt: new Date() } },
    );
    throw error;
  }

  await runs.updateOne(
    { _id: runId },
    { $set: { status: "completed", updatedAt: new Date() } },
  );

  return runId;
}
