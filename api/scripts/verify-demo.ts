import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { config } from "../src/config.js";
import { verifyGithubRepository, githubVerifyIssue } from "../src/tools/github-issue.js";
import { listRunEvents } from "../src/db/audit.js";
import { buildPrototypeFlow } from "../../web/src/lib/buildPrototypeFlow.js";
import type { AuditEvent } from "../../web/src/types.js";

async function main() {
  await verifyGithubRepository();
  if (!process.argv.includes("--existing")) {
    // Use the same endpoint as the console button. Creates one synthetic GitHub issue.
    const res = await fetch(`http://localhost:${config.port}/api/gateway/demo/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replay: true }), signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Replay failed: ${await res.text()}`);
  }
  const client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
    const events = await listRunEvents(client.db(config.dbName), config.demoRunId);
    const read = `action-read-${config.demoRunId}`;
    const denied = `action-write-public-${config.demoRunId}`;
    const written = `action-write-private-${config.demoRunId}`;
    const completion = (id: string) => events.find(e => e.actionId === id && e.type === "action.completed");
    assert.equal(completion(read)?.payload?.executionOutcome, "verified");
    assert.equal(completion(denied)?.payload?.executionOutcome, "never_dispatched");
    assert(!events.some(e => e.actionId === denied && e.type === "action.dispatched"));
    const issue = completion(written);
    assert.equal(issue?.payload?.executionOutcome, "verified", JSON.stringify(issue?.payload));
    const issueNumber = issue?.payload?.issueNumber;
    assert(typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0, "Missing issueNumber on Atlas audit event");
    assert(await githubVerifyIssue(config.githubAllowedOwner || config.githubOwner, config.githubRepo, issueNumber));
    const flow = buildPrototypeFlow(JSON.parse(JSON.stringify(events)) as AuditEvent[]);
    assert(flow.read && flow.publicDeny && flow.privateWrite);
    assert(flow.privateWrite.meta.includes(`#${issueNumber}`));
    console.log(`Phase 1 replay verified: Atlas read, denied write never dispatched, GitHub issue #${issueNumber} read back and persisted in audit event; tree populated.`);
    console.log(issue?.payload?.url);
  } finally {
    await client.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
