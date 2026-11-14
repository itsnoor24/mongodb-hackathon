import { Router } from "express";
import { getDb } from "../db/client.js";
import { assertAgentAuth, AuthError } from "../auth/credentials.js";
import { processToolCall } from "../gateway/gateway.js";
import { config } from "../config.js";
import { queuedWriteActionId } from "../agent/replay.js";
import type { ToolCallRequest } from "../types.js";
import { startDemoRun } from "../agent/demo-run.js";

export const gatewayRouter = Router();

gatewayRouter.post("/invoke", async (req, res) => {
  try {
    assertAgentAuth(req);
    const body = req.body as ToolCallRequest;
    const db = await getDb();
    const result = await processToolCall(db, config.demoAgentId, body);
    res.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(401).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

gatewayRouter.post("/queued-write/:runId", async (req, res) => {
  try {
    const db = await getDb();
    const runId = req.params.runId;
    const actionId = queuedWriteActionId(runId);
    const parent = req.body?.parentActionId as string | undefined;
    const proposal: ToolCallRequest = {
      runId,
      actionId,
      parentActionId: parent ?? `action-write-private-${runId}`,
      tool: "github.issue.create",
      arguments: {
        owner: config.githubAllowedOwner || config.githubOwner,
        repo: config.githubRepo,
        title: "[Sentinel] Queued write after pause attempt",
        body: "Reviewer-triggered queued write — should block while paused",
      },
      rationale: "Queued write from audit console",
    };
    const result = await processToolCall(db, config.demoAgentId, proposal);
    res.json({ ...result, blocked: !result.allowed || result.executionOutcome === "never_dispatched" });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

gatewayRouter.post("/demo/start", async (req, res) => {
  try {
    const db = await getDb();
    const replay = req.body?.replay !== false;
    const runId = await startDemoRun(db, { replay });
    res.json({ runId, replay });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "error" });
  }
});