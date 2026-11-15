import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { config } from "../src/config.js";
import { validateNodes } from "../src/streams/parser.js";
import type { TextStream, TextChunk, StoredNode } from "../src/streams/store.js";
import { streamParsedOutput } from "../src/streams/replay.js";
import { nodeEmbeddingFields } from "../src/streams/embeddings.js";

/** Load the assistant-authored example output; this does not run a local model. */
async function main() {
  const streamId = process.argv[2];
  if (!streamId) throw new Error("Usage: npm run demo:parsed -- STREAM_ID");
  const fixture = JSON.parse(await readFile(new URL("../examples/conversation-parsed.json", import.meta.url), "utf8"));
  const client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
    const db = client.db(config.dbName);
    if (process.argv.includes("--stream")) {
      const count = await streamParsedOutput(client, db, streamId, fixture, {
        onNode: (id, count, total) => { console.log(`Atlas node ${count}/${total}: ${id}`); },
      });
      console.log(`Streamed ${count} assistant-authored output nodes to Atlas.`);
      return;
    }
    const session = client.startSession();
    let count = 0;
    try {
      await session.withTransaction(async () => {
        const streams = db.collection<TextStream>("text_streams");
        const stream = await streams.findOne({ _id: streamId }, { session });
        if (!stream) throw new Error("Stream not found. Run demo:conversation first.");
        if ((stream.uploadUntil && stream.uploadUntil > new Date()) || (stream.parseUntil && stream.parseUntil > new Date())) {
          throw new Error("Wait for the active upload or parser to finish");
        }
        const chunks = await db.collection<TextChunk>("text_chunks").find({ streamId }, { session }).sort({ sequence: 1 }).toArray();
        const text = chunks.map(chunk => chunk.text).join("");
        const nodes = validateNodes(fixture, text, []);
        const offsets: { start: number; end: number; sequence: number }[] = [];
        let offset = 0;
        for (const chunk of chunks) {
          offsets.push({ start: offset, end: offset + chunk.text.length, sequence: chunk.sequence });
          offset += chunk.text.length;
        }
        for (const node of nodes) {
          const start = text.indexOf(node.evidence);
          const end = start + node.evidence.length;
          const fromSequence = offsets.find(chunk => chunk.end > start)!.sequence;
          const throughSequence = offsets.find(chunk => chunk.end >= end)!.sequence;
          await db.collection<StoredNode>("stream_nodes").updateOne({ _id: `${streamId}:${node.id}` }, { $set: {
            ...node, ...nodeEmbeddingFields(node), streamId, fromSequence, throughSequence,
            model: "assistant-authored-demo", inferred: true, updatedAt: new Date(),
          } }, { upsert: true, session });
        }
        await streams.updateOne({ _id: streamId }, {
          $set: { parsedThrough: chunks.at(-1)?.sequence ?? 0, parserStatus: "idle", parsedBy: "assistant-authored-demo", updatedAt: new Date() },
          $unset: { parserError: "" },
        }, { session });
        count = nodes.length;
      });
    } finally { await session.endSession(); }
    console.log(`Loaded ${count} validated, assistant-authored nodes with exact evidence ranges.`);
    console.log(`View: http://localhost:5173/?stream=${encodeURIComponent(streamId)}`);
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
