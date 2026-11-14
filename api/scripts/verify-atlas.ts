import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";
import { config, assertMongoConfigured } from "../src/config.js";
import { COLLECTIONS } from "../src/db/schemas.js";
import assert from "node:assert/strict";
import { appendAuditEvent } from "../src/db/audit.js";
import { evaluatePolicy } from "../src/gateway/policy.js";
import type { PolicyDoc } from "../src/types.js";

async function main(): Promise<void> {
  assertMongoConfigured();
  console.log("Connecting to Atlas...");
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  await db.command({ ping: 1 });
  console.log("✓ Ping succeeded");

  const policy = await db.collection<PolicyDoc>(COLLECTIONS.policies).findOne({ _id: "policy-demo-v1" });
  assert(policy, "Run npm run seed before verification");
  const [bsonTypes] = await db.collection(COLLECTIONS.policies).aggregate([
    { $match: { _id: policy._id } },
    { $project: { version: { $type: "$version" }, priorities: { $map: { input: "$rules", as: "rule", in: { $type: "$$rule.priority" } } } } },
  ]).toArray();
  assert.equal(bsonTypes.version, "int");
  assert(bsonTypes.priorities.every((type: string) => type === "int"));
  const target = `github:${config.githubAllowedOwner || "PRIVATE_ORG"}/${config.githubRepo || "PRIVATE_REPO"}`;
  assert(evaluatePolicy(policy, "github.issue.create", target).allowed, "Configured demo target must be allowed");
  assert(!evaluatePolicy(policy, "github.issue.create", "github:example-org/public-demo-issues").allowed, "Public instruction target must be denied");
  console.log("✓ Policy Int32 types and allow/deny rules verified");

  const invalid = {
    _id: randomUUID(),
    runId: "validation-test",
    // missing ts, type, actor — should fail
  };
  let validationFailed = false;
  try {
    await db.collection(COLLECTIONS.audit_events).insertOne(invalid);
  } catch (e) {
    if (!(e instanceof Error) || !("code" in e) || e.code !== 121) throw e;
    validationFailed = true;
    console.log("✓ Invalid audit event rejected by validator");
  }
  if (!validationFailed) {
    console.error("✗ Validator did not reject invalid document — check validationLevel");
    process.exit(1);
  }

  const testId = randomUUID();
  const valid = {
    _id: testId,
    runId: "__verify__",
    ts: new Date(),
    type: "run.started",
    actor: { kind: "system", id: "verify-script" },
    payload: { note: "change-stream probe" },
  };
  await appendAuditEvent(db, { ...valid, type: "run.started", actor: { kind: "system", id: "verify-script" }, actionId: undefined });
  const persisted = await db.collection(COLLECTIONS.audit_events).findOne({ _id: testId });
  assert(persisted && !("actionId" in persisted) && !("parentActionId" in persisted));
  console.log("✓ Audit helper inserts successfully and omits undefined optional fields");

  const stream = db.collection(COLLECTIONS.audit_events).watch(
    [{ $match: { "fullDocument._id": testId } }],
    { fullDocument: "updateLookup", maxAwaitTimeMS: 1000 },
  );

  // Open the server cursor before writing the change being verified.
  await stream.tryNext();

  let received = false;
  try {
    await db.collection(COLLECTIONS.audit_events)
      .updateOne({ _id: testId }, { $set: { "payload.seen": true } });
    const deadline = Date.now() + 15000;
    while (!received && Date.now() < deadline) {
      received = (await stream.tryNext()) !== null;
    }
    if (!received) throw new Error("Change stream timeout");
  } finally {
    await stream.close();
    await db.collection(COLLECTIONS.audit_events).deleteOne({ _id: testId });
    await client.close();
  }

  if (received) {
    console.log("✓ Change stream received update on audit_events");
  }

  console.log("Atlas verification passed.");
}

main().catch((e) => {
  console.error("Atlas verification failed:", e.message);
  if (e.message?.includes("not authorized")) {
    console.error(
      "SANDBOX BLOCKER: Insufficient Atlas permissions (change streams or collection create).",
    );
  }
  process.exit(1);
});
