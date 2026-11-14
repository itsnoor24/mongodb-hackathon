import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";
import { config, assertMongoConfigured } from "../src/config.js";
import { COLLECTIONS } from "../src/db/schemas.js";

async function main(): Promise<void> {
  assertMongoConfigured();
  console.log("Connecting to Atlas...");
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  await db.command({ ping: 1 });
  console.log("✓ Ping succeeded");

  const invalid = {
    _id: randomUUID(),
    runId: "validation-test",
    // missing ts, type, actor — should fail
  };
  let validationFailed = false;
  try {
    await db.collection(COLLECTIONS.audit_events).insertOne(invalid);
  } catch (e) {
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
  await db.collection(COLLECTIONS.audit_events).insertOne(valid);
  console.log("✓ Valid test insert succeeded");

  const stream = db.collection(COLLECTIONS.audit_events).watch(
    [{ $match: { "fullDocument._id": testId } }],
    { fullDocument: "updateLookup" },
  );

  const received = await new Promise<boolean>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Change stream timeout")), 15000);
    stream.on("change", () => {
      clearTimeout(t);
      resolve(true);
    });
    // insert already happened; watch may miss it — insert another update
    db.collection(COLLECTIONS.audit_events)
      .updateOne({ _id: testId }, { $set: { "payload.seen": true } })
      .catch(reject);
  });

  await stream.close();
  await db.collection(COLLECTIONS.audit_events).deleteOne({ _id: testId });

  if (received) {
    console.log("✓ Change stream received update on audit_events");
  }

  await client.close();
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