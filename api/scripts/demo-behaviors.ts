import { Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { config } from "../src/config.js";
import { createStream, initializeStreams } from "../src/streams/store.js";
import { streamLiveParsedOutput } from "../src/streams/replay.js";
import { seedBehaviorPresets } from "../src/behaviors/presets.js";
import { initializeBehaviors } from "../src/behaviors/worker.js";

async function main() {
  const client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
    const db = client.db(config.dbName);
    await initializeStreams(db); await initializeBehaviors(db);
    console.log(`Prepared ${await seedBehaviorPresets(db)} global phrase/status monitors (existing settings preserved).`);
    const stream = await createStream(db, "Mock behavior: file missing → retry → recovery", "fixture");
    console.log(`Watch: http://localhost:5173/?stream=${stream._id}`);
    const lines = [
      "[mock:error] ENOENT: no such file or directory '/tmp/agent-input.txt'\n",
      "[mock:retry] Trying again with './fixtures/input.txt'\n",
      "[mock:ok] Input loaded successfully. All events in this demo are simulated.\n",
    ];
    const fixture = { nodes: [
      { id: "read-failed", parentId: null, label: "Read file failed", kind: "error", status: "failed", summary: "Simulated read failed because the input file was missing.", evidence: "ENOENT: no such file or directory '/tmp/agent-input.txt'" },
      { id: "retry", parentId: "read-failed", label: "Retry input lookup", kind: "tool_call", status: "in_progress", summary: "The simulated agent retries using a fixture path.", evidence: "Trying again with './fixtures/input.txt'" },
      { id: "recovered", parentId: "retry", label: "Input lookup recovered", kind: "tool_result", status: "completed", summary: "The simulated lookup reports success after a retry.", evidence: "Input loaded successfully." },
    ] };
    const body = Readable.from((async function* () {
      for (const line of lines) { process.stdout.write(line); yield line; await setTimeout(2500); }
    })());
    const inputDone = fetch(`http://localhost:${config.port}/api/streams/${stream._id}/text`, {
      method: "POST", headers: { Authorization: `Bearer ${config.agentApiKey}`, "Content-Type": "text/plain; charset=utf-8" }, body: body as unknown as BodyInit, duplex: "half",
    } as RequestInit & { duplex: string }).then(async response => { if (!response.ok) throw new Error(await response.text()); });
    await streamLiveParsedOutput(client, db, stream._id, lines.join(""), fixture, { inputDone, onNode: id => { console.log(`Saved observed node: ${id}`); } });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const matches = await db.collection("behavior_matches").find({ streamId: stream._id }).toArray();
      if (matches.some(match => match.behaviorId === "preset-file-retry") && matches.some(match => match.behaviorId === "preset-failure-recovery")) {
        console.log(`Detected behaviors: ${matches.map(match => match.name).join(", ")}`);
        return;
      }
      await setTimeout(300);
    }
    throw new Error("Behavior matches did not arrive; check that the API monitoring worker is running");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
