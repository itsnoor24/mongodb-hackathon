import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { validateBehavior, matchBehavior, textHash, type BehaviorRule, type ObservedNode, type BehaviorCheck } from "../src/behaviors/matcher.js";
import { recordBehaviorMatches, semanticBehaviorPipeline } from "../src/behaviors/worker.js";
import { config } from "../src/config.js";
import express from "express";
import { createServer } from "node:http";
import { behaviorsRouter } from "../src/routes/behaviors.js";

const rule = (steps = [{ query: "ENOENT | file not found", status: "failed" }], extra = {}): BehaviorRule => ({
  ...validateBehavior({ name: "Missing file", mode: "text", steps, withinSeconds: 5, ...extra }), _id: "rule", createdAt: new Date(), updatedAt: new Date(),
});
const node = (id: string, text: string, status = "failed", sequence = 1, streamId = "stream", seconds = sequence): ObservedNode => ({
  _id: `${streamId}:${id}`, streamId, id, parentId: null, label: id, summary: text, evidence: text, kind: "error", status: status as ObservedNode["status"],
  fromSequence: sequence, throughSequence: sequence, model: "test", inferred: true, updatedAt: new Date(seconds * 1000), observedAt: new Date(seconds * 1000),
});

test("behavior definitions validate steps, literal alternatives, statuses, thresholds, and windows", () => {
  assert.equal(rule().steps.length, 1);
  for (const invalid of [{ steps: [] }, { steps: [{ query: "x | " }] }, { threshold: 2 }, { withinSeconds: 0 }, { steps: [{ query: "x", status: "verified" }] }]) {
    assert.throws(() => rule(undefined, invalid));
  }
});

test("file-failure signals require both a phrase and the requested node status", () => {
  assert.equal(matchBehavior(rule(), [node("failure", "ENOENT: missing input")]).length, 1);
  assert.equal(matchBehavior(rule(), [node("quote", "ENOENT: missing input", "completed")]).length, 0);
  assert.equal(matchBehavior(rule(), [node("other", "Network timeout")]).length, 0);
  assert.equal(matchBehavior(rule(undefined, { enabled: false }), [node("failure", "ENOENT")]).length, 0);
});

test("multi-step behaviors require ordered, distinct nodes in one stream and inside the time window", () => {
  const behavior = rule([{ query: "ENOENT", status: "failed" }, { query: "retry", status: "in_progress" }]);
  const first = node("missing", "ENOENT");
  const retry = node("retry", "retry", "in_progress", 2);
  assert.equal(matchBehavior(behavior, [first, retry]).length, 1);
  assert.equal(matchBehavior(behavior, [first, { ...retry, streamId: "other" }]).length, 0);
  assert.equal(matchBehavior(behavior, [first, { ...retry, throughSequence: 0 }]).length, 0);
  assert.equal(matchBehavior(behavior, [first, { ...retry, throughSequence: 1 }]).length, 0);
  assert.equal(matchBehavior(behavior, [first, { ...retry, observedAt: new Date(100000) }]).length, 0);
});

test("a recovery summary mentioning a previous retry does not count as another retry", () => {
  const behavior = rule([{ query: "ENOENT", status: "failed" }, { query: "retry" }]);
  const first = node("missing", "ENOENT");
  const retry = node("retry", "retry with alternate path", "in_progress", 2);
  const recovered = { ...node("recovered", "Successfully read input", "completed", 3), summary: "Success after a retry" };
  const matches = matchBehavior(behavior, [first, retry, recovered]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].nodes.at(-1)?.id, "retry");
});

test("semantic candidates require sufficient similarity, the correct rule, and the current node revision", () => {
  const behavior = rule([{ query: "fails because a file is missing", status: "failed" }], { mode: "semantic", threshold: 0.8 });
  const source = node("missing", "No such file");
  const check: BehaviorCheck = { _id: "rule:0", behaviorId: "rule", step: 0, fingerprint: "test", hits: [{ nodeKey: source._id, textHash: textHash(source), score: 0.9 }], attempts: 1, checkedAt: new Date(), nextRetryAt: new Date() };
  assert.equal(matchBehavior(behavior, [source], [check]).length, 1);
  assert.equal(matchBehavior(behavior, [{ ...source, summary: "Now recovered" }], [check]).length, 0);
  assert.equal(matchBehavior(behavior, [source], [{ ...check, behaviorId: "different" }]).length, 0);
  assert.equal(matchBehavior({ ...behavior, threshold: 0.95 }, [source], [check]).length, 0);
  assert.deepEqual(semanticBehaviorPipeline({ ...behavior, streamId: "selected" }, 0)[0].$vectorSearch?.filter, { streamId: "selected" });
});

test("match ids deduplicate repeated checks but preserve separate incidents", () => {
  const behavior = rule();
  const source = node("missing", "ENOENT");
  assert.equal(matchBehavior(behavior, [source])[0]._id, matchBehavior(behavior, [source])[0]._id);
  assert.notEqual(matchBehavior(behavior, [source])[0]._id, matchBehavior(behavior, [node("missing-again", "ENOENT")])[0]._id);
});

test("behavior management requires observer auth and rejects invalid definitions before database work", async () => {
  const app = express(); app.use(express.json()); app.use("/api/behaviors", behaviorsRouter);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/behaviors`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const headers = { Authorization: `Bearer ${config.reviewerApiKey}`, "Content-Type": "application/json" };
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "invalid", mode: "text", steps: [] }) })).status, 400);
    assert.equal((await fetch(`${base}/example`, { method: "PATCH", headers, body: JSON.stringify({ enabled: "yes" }) })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("Atlas: behavior alerts persist once and retain matched evidence", { skip: process.env.STREAM_TEST_ATLAS !== "1" }, async () => {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  const behavior = { ...rule(), _id: `test-${randomUUID()}` };
  const source = node("missing", "ENOENT: input.txt");
  try {
    assert.equal(await recordBehaviorMatches(db, [behavior], [source], []), 1);
    assert.equal(await recordBehaviorMatches(db, [behavior], [source], []), 0);
    const saved = await db.collection("behavior_matches").findOne({ behaviorId: behavior._id });
    assert.equal(saved?.nodes[0].evidence, "ENOENT: input.txt");
    assert.equal(saved?.streamId, "stream");
  } finally {
    await db.collection("behavior_matches").deleteMany({ behaviorId: behavior._id });
    await client.close();
  }
});
