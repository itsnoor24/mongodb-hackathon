import { MongoClient } from "mongodb";
import { config } from "../src/config.js";
import { backfillNodeEmbeddingInputs, ensureNodeEmbeddingIndex, nodeSearchPipeline } from "../src/streams/embeddings.js";

async function main() {
  const client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
    const db = client.db(config.dbName);
    if (process.argv[2] === "search") {
      const streamId = process.argv[3];
      const query = process.argv.slice(4).join(" ");
      if (!streamId) throw new Error("Usage: npm run nodes:embed -- search STREAM_ID QUERY");
      const results = await db.collection("stream_nodes").aggregate(nodeSearchPipeline(query, streamId)).toArray();
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    const backfill = await backfillNodeEmbeddingInputs(db);
    const index = await ensureNodeEmbeddingIndex(db);
    console.log(JSON.stringify({ ...backfill, index: config.nodeEmbeddingIndex, model: config.nodeEmbeddingModel, ...index }));
    console.log("Atlas generates and updates vectors asynchronously. Confirm the index is READY before semantic search.");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
