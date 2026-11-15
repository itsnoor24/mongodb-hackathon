import { Router } from "express";
import { randomUUID } from "node:crypto";
import { assertSearchAuth, AuthError } from "../auth/credentials.js";
import { getDb } from "../db/client.js";
import { validateBehavior, BehaviorInputError, type BehaviorRule, type BehaviorMatch, type BehaviorCheck } from "../behaviors/matcher.js";
import { initializeBehaviors, behaviorRuntime } from "../behaviors/worker.js";

export const behaviorsRouter = Router();
behaviorsRouter.use((req, res, next) => {
  try { assertSearchAuth(req); next(); }
  catch (error) { res.status(error instanceof AuthError ? 401 : 500).json({ error: "Observer access key required" }); }
});

behaviorsRouter.get("/", async (req, res) => {
  try {
    const db = await getDb(); await initializeBehaviors(db);
    const scope = typeof req.query.streamId === "string" && req.query.streamId ? { $or: [{ streamId: { $exists: false } }, { streamId: req.query.streamId }] } : {};
    const rules = await db.collection<BehaviorRule>("behavior_rules").find(scope).sort({ createdAt: 1 }).limit(100).toArray();
    const checks = await db.collection<BehaviorCheck>("behavior_checks").find({ behaviorId: { $in: rules.map(rule => rule._id) } }).toArray();
    res.json({ rules, checks: checks.map(({ hits, ...check }) => check), worker: behaviorRuntime });
  } catch { res.status(500).json({ error: "Cannot load behavior monitors" }); }
});

behaviorsRouter.get("/matches", async (req, res) => {
  try {
    const db = await getDb();
    const scope = typeof req.query.streamId === "string" && req.query.streamId ? { streamId: req.query.streamId } : {};
    const matches = await db.collection<BehaviorMatch>("behavior_matches").find(scope).sort({ detectedAt: -1 }).limit(50).toArray();
    res.json({ matches });
  } catch { res.status(500).json({ error: "Cannot load behavior matches" }); }
});

behaviorsRouter.post("/", async (req, res) => {
  try {
    const input = validateBehavior(req.body);
    const db = await getDb(); await initializeBehaviors(db);
    if (await db.collection("behavior_rules").countDocuments() >= 100) { res.status(409).json({ error: "This prototype supports up to 100 saved monitors" }); return; }
    const rule: BehaviorRule = { ...input, _id: randomUUID(), createdAt: new Date(), updatedAt: new Date() };
    await db.collection<BehaviorRule>("behavior_rules").insertOne(rule);
    res.status(201).json({ rule });
  } catch (error) { res.status(error instanceof BehaviorInputError ? 400 : 500).json({ error: error instanceof Error ? error.message : "Cannot save behavior" }); }
});

behaviorsRouter.patch("/:id", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
  try {
    const rule = await (await getDb()).collection<BehaviorRule>("behavior_rules").findOneAndUpdate({ _id: req.params.id }, { $set: { enabled: req.body.enabled, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!rule) { res.status(404).json({ error: "Monitor not found" }); return; }
    res.json({ rule });
  } catch { res.status(500).json({ error: "Cannot update monitor" }); }
});

behaviorsRouter.post("/:id/recheck", async (req, res) => {
  try {
    await (await getDb()).collection<BehaviorCheck>("behavior_checks").deleteMany({ behaviorId: req.params.id });
    res.json({ queued: true });
  } catch { res.status(500).json({ error: "Cannot queue semantic recheck" }); }
});

behaviorsRouter.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    await db.collection<BehaviorRule>("behavior_rules").deleteOne({ _id: req.params.id });
    await db.collection<BehaviorCheck>("behavior_checks").deleteMany({ behaviorId: req.params.id });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: "Cannot delete monitor" }); }
});
