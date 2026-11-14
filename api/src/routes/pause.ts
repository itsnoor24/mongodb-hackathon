import { Router } from "express";
import { randomUUID } from "crypto";
import { getDb } from "../db/client.js";
import { appendAuditEvent } from "../db/audit.js";
import { assertReviewerAuth, AuthError } from "../auth/credentials.js";
import { COLLECTIONS } from "../db/schemas.js";
import type { RunDoc } from "../types.js";

export const pauseRouter = Router();

pauseRouter.post("/:runId/pause", async (req, res) => {
  try {
    assertReviewerAuth(req);
    const db = await getDb();
    const runId = req.params.runId;
    const now = new Date();
  const reviewerId =
      (req.headers["x-reviewer-id"] as string) ?? "reviewer";

    const result = await db.collection<RunDoc>(COLLECTIONS.runs).findOneAndUpdate(
      { _id: runId },
      {
        $set: {
          status: "paused",
          pausedBy: reviewerId,
          pausedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    await appendAuditEvent(db, {
      _id: randomUUID(),
      runId,
      type: "run.paused",
      actor: { kind: "reviewer", id: reviewerId },
      payload: { pausedAt: now.toISOString() },
    });

    await appendAuditEvent(db, {
      runId,
      type: "reviewer.intervention",
      actor: { kind: "reviewer", id: reviewerId },
      payload: { action: "pause" },
    });

    res.json({ run: result });
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(401).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "error" });
  }
});

pauseRouter.post("/:runId/resume", async (req, res) => {
  try {
    assertReviewerAuth(req);
    const db = await getDb();
    const runId = req.params.runId;
    const reviewerId =
      (req.headers["x-reviewer-id"] as string) ?? "reviewer";
    const now = new Date();

    const result = await db.collection<RunDoc>(COLLECTIONS.runs).findOneAndUpdate(
      { _id: runId },
      {
        $set: { status: "running", updatedAt: now },
        $unset: { pausedBy: "", pausedAt: "" },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    await appendAuditEvent(db, {
      runId,
      type: "run.resumed",
      actor: { kind: "reviewer", id: reviewerId },
    });

    res.json({ run: result });
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(401).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "error" });
  }
});