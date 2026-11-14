import { Router } from "express";
import { randomUUID } from "node:crypto";
import { assertAgentAuth, assertSearchAuth, AuthError } from "../auth/credentials.js";
import { getDb } from "../db/client.js";
import { frameText, StreamInputError } from "../streams/framing.js";
import { initializeStreams, createStream, appendChunk, parseAvailable, type TextStream, type TextChunk, type StoredNode } from "../streams/store.js";
import { nodeSearchPipeline } from "../streams/embeddings.js";

export const streamsRouter = Router();
let initialization: Promise<void> | undefined;
async function database() {
  const db = await getDb();
  initialization ??= initializeStreams(db).catch(error => { initialization = undefined; throw error; });
  await initialization;
  return db;
}

function publicStream(stream: TextStream) {
  const { uploadOwner, uploadUntil, parseOwner, parseUntil, ...view } = stream;
  return { ...view, receiving: !!uploadUntil && uploadUntil > new Date() };
}

streamsRouter.post("/", async (req, res) => {
  try {
    assertAgentAuth(req);
    const label = req.body?.label ?? "Agent output";
    const parserMode = req.body?.parserMode ?? "local";
    if (!["local", "fixture"].includes(parserMode)) { res.status(400).json({ error: "parserMode must be local or fixture" }); return; }
    if (typeof label !== "string" || !label.trim() || label.length > 200) { res.status(400).json({ error: "label must be 1–200 characters" }); return; }
    res.status(201).json({ stream: publicStream(await createStream(await database(), label, parserMode)) });
  } catch (error) {
    res.status(error instanceof AuthError ? 401 : 500).json({ error: error instanceof Error ? error.message : "Create failed" });
  }
});

streamsRouter.get("/", async (_req, res) => {
  try {
    const streams = await (await database()).collection<TextStream>("text_streams").find().sort({ createdAt: -1 }).limit(20).toArray();
    res.json({ streams: streams.map(publicStream) });
  } catch { res.status(500).json({ error: "Cannot load text streams" }); }
});

streamsRouter.get("/:id", async (req, res) => {
  try {
    const after = Number(req.query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) { res.status(400).json({ error: "after must be a nonnegative integer" }); return; }
    const db = await database();
    const stream = await db.collection<TextStream>("text_streams").findOne({ _id: req.params.id });
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const [chunks, nodes] = await Promise.all([
      db.collection<TextChunk>("text_chunks").find({ streamId: stream._id, sequence: { $gt: after } }).sort({ sequence: 1 }).limit(200).toArray(),
      db.collection<StoredNode>("stream_nodes").find({ streamId: stream._id }).sort({ throughSequence: 1, id: 1 }).limit(130).toArray(),
    ]);
    res.json({ stream: publicStream(stream), chunks, nodes, nextAfter: chunks.at(-1)?.sequence ?? after });
  } catch { res.status(500).json({ error: "Cannot load text stream" }); }
});

streamsRouter.get("/:id/search", async (req, res) => {
  let pipeline;
  try {
    assertSearchAuth(req);
    pipeline = nodeSearchPipeline(req.query.q as string, req.params.id, Number(req.query.limit ?? 5));
  }
  catch (error) { res.status(error instanceof AuthError ? 401 : 400).json({ error: error instanceof Error ? error.message : "Invalid search" }); return; }
  try {
    const nodes = await (await database()).collection("stream_nodes").aggregate(pipeline, { maxTimeMS: 30000 }).toArray();
    res.json({ nodes });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Semantic search unavailable" });
  }
});

streamsRouter.post("/:id/text", async (req, res) => {
  let acceptedChunks = 0;
  let release: (() => Promise<void>) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    assertAgentAuth(req);
    if (!req.is("text/plain") || (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity")) {
      res.status(415).json({ error: "Send uncompressed UTF-8 text/plain" }); return;
    }
    const db = await database();
    const streams = db.collection<TextStream>("text_streams");
    const id = req.params.id;
    if (!await streams.findOne({ _id: id })) { res.status(404).json({ error: "Stream not found" }); return; }
    const owner = randomUUID();
    const stream = await streams.findOneAndUpdate({ _id: id, $or: [{ uploadUntil: { $exists: false } }, { uploadUntil: { $lt: new Date() } }] }, {
      $set: { uploadOwner: owner, uploadUntil: new Date(Date.now() + 90000) },
    }, { returnDocument: "after" });
    if (!stream) { res.status(409).json({ error: "This stream already has an active upload" }); return; }
    release = async () => { await streams.updateOne({ _id: id, uploadOwner: owner }, { $unset: { uploadOwner: "", uploadUntil: "" } }); };
    heartbeat = setInterval(() => {
      void streams.updateOne({ _id: id, uploadOwner: owner }, { $set: { uploadUntil: new Date(Date.now() + 90000) } }).catch(() => {});
    }, 20000);
    let sinceParse = 0;
    let autoParseFailed = false;
    for await (const text of frameText(req)) {
      if (acceptedChunks >= 4096) throw new StreamInputError("Upload exceeds 4096 frames; append with a new request");
      await appendChunk(db, id, text, owner);
      acceptedChunks++;
      sinceParse += text.length;
      if (sinceParse >= 2048 && !autoParseFailed) {
        await parseAvailable(db, id);
        autoParseFailed = (await streams.findOne({ _id: id }))?.parserStatus === "failed";
        sinceParse = 0;
      }
    }
    // Drain remaining parse batches, stopping on failure so capture is still acknowledged.
    while (!autoParseFailed) {
      const before = await streams.findOne({ _id: id });
      await parseAvailable(db, id);
      const after = await streams.findOne({ _id: id });
      autoParseFailed = after?.parserStatus === "failed";
      if (!after || after.parsedThrough === before?.parsedThrough || after.parsedThrough >= after.sequence) break;
    }
    clearInterval(heartbeat);
    await release();
    release = undefined;
    const updated = await streams.findOne({ _id: id });
    res.status(201).json({ acceptedChunks, stream: publicStream(updated!) });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof StreamInputError ? 413 : error instanceof TypeError ? 400 : 500;
    if (!res.destroyed) res.status(status).json({ error: error instanceof Error ? error.message : "Upload failed", acceptedChunks, partial: acceptedChunks > 0 });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await release?.().catch(() => {});
  }
});

streamsRouter.post("/:id/parse", async (req, res) => {
  try {
    assertAgentAuth(req);
    const db = await database();
    const streams = db.collection<TextStream>("text_streams");
    if (!await streams.findOne({ _id: req.params.id })) { res.status(404).json({ error: "Stream not found" }); return; }
    await parseAvailable(db, req.params.id);
    res.json({ stream: publicStream((await streams.findOne({ _id: req.params.id }))!) });
  } catch (error) {
    res.status(error instanceof AuthError ? 401 : 500).json({ error: error instanceof Error ? error.message : "Parse failed" });
  }
});
