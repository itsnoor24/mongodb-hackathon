import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { streamLiveParsedOutput } from "../src/streams/replay.js";

async function main() {
  const conversation = process.argv.includes("--conversation");
  const output = process.argv.includes("--with-output");
  if (output && !conversation) throw new Error("Output replay requires the conversation fixture");
  let expectedText = "", parsedFixture: unknown;
  if (output) {
    const source = JSON.parse(await readFile(new URL("../examples/conversation-output.json", import.meta.url), "utf8"));
    const { renderMessage } = await import("../examples/replay-conversation.mjs");
    expectedText = source.messages.map(renderMessage).join("");
    parsedFixture = JSON.parse(await readFile(new URL("../examples/conversation-parsed.json", import.meta.url), "utf8"));
  }
  let id = process.argv.slice(2).find(argument => !argument.startsWith("--"));
  if (!id) {
    const response = await fetch(`http://localhost:${config.port}/api/streams`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentApiKey}` },
      body: JSON.stringify({ label: output ? "Conversation input → streamed node output" : conversation ? "Full conversation replay" : "Mock terminal · checkout incident triage", parserMode: output ? "fixture" : "local" }),
    });
    if (!response.ok) throw new Error(await response.text());
    id = (await response.json() as { stream: { _id: string } }).stream._id;
  }
  console.log(`Watch the demo: http://localhost:5173/?stream=${encodeURIComponent(id)}`);
  const consumer = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./consume-text.ts", import.meta.url)), id], {
    stdio: ["pipe", "inherit", "inherit"], windowsHide: true,
  });
  const producer = spawn(process.execPath, [fileURLToPath(new URL(conversation ? "../examples/replay-conversation.mjs" : "../examples/mock-agent.mjs", import.meta.url))], {
    stdio: ["ignore", "pipe", "inherit"], windowsHide: true,
  });
  // The exact same stdout goes to the terminal and the real ingestion client.
  producer.stdout.pipe(process.stdout);
  producer.stdout.pipe(consumer.stdin);
  const ended = (child: ChildProcess) => new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Demo subprocess exited with code ${code}`)));
  });
  const inputDone = Promise.all([ended(producer), ended(consumer)]).then(() => {});
  const abort = new AbortController();
  process.on("message", message => {
    if (message && typeof message === "object" && "type" in message && message.type === "restart") {
      if (process.connected) process.disconnect();
      abort.abort(new Error("Demo restarted"));
      if (producer.exitCode === null) producer.kill();
      if (consumer.exitCode === null) consumer.kill();
    }
  });
  // Avoid an unhandled rejection if database connection setup fails first.
  void inputDone.catch(() => {});
  const client = output ? new MongoClient(config.mongoUri) : undefined;
  try {
    if (client) {
      await client.connect();
      console.log("Emitting precomputed nodes as their evidence arrives in Atlas...");
      const count = await streamLiveParsedOutput(client, client.db(config.dbName), id, expectedText, parsedFixture, {
        inputDone, signal: abort.signal,
        onNode: (id, count, total) => { console.log(`Live Atlas node ${count}/${total}: ${id}`); },
      });
      console.log(`Demo complete: ${count} nodes emitted alongside input. http://localhost:5173/?stream=${encodeURIComponent(id)}`);
    } else { await inputDone; }
  } finally {
    if (producer.exitCode === null) producer.kill();
    if (consumer.exitCode === null) consumer.kill();
    await inputDone.catch(() => {});
    await client?.close();
    if (process.connected) process.disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
