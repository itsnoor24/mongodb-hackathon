import { randomUUID } from "node:crypto";
import { Db } from "mongodb";
import { config } from "../config.js";
import { parseText, type ParsedNode } from "./parser.js";
import { nodeEmbeddingFields } from "./embeddings.js";

export interface TextStream {
  _id: string; label: string; createdAt: Date; updatedAt: Date;
  sequence: number; parsedThrough: number;
  parserStatus: "disabled" | "idle" | "parsing" | "failed";
  parserError?: string;
  parsedBy?: string;
  parserMode?: "local" | "fixture";
  uploadOwner?: string; uploadUntil?: Date;
  parseOwner?: string; parseUntil?: Date;
}
export interface TextChunk { _id: string; streamId: string; sequence: number; text: string; ts: Date }
export interface StoredNode extends ParsedNode { _id: string; streamId: string; fromSequence: number; throughSequence: number; model: string; inferred: boolean; updatedAt: Date; embeddingText?: string; embeddingTextHash?: string }

export async function initializeStreams(db: Db) {
  await db.collection("text_streams").createIndex({ createdAt: -1 });
  await db.collection("text_chunks").createIndex({ streamId: 1, sequence: 1 }, { unique: true });
  await db.collection("stream_nodes").createIndex({ streamId: 1, id: 1 }, { unique: true });
}

export async function createStream(db: Db, label: string, parserMode: "local" | "fixture" = "local") {
  const stream: TextStream = { _id: randomUUID(), label, createdAt: new Date(), updatedAt: new Date(), sequence: 0, parsedThrough: 0, parserMode, parserStatus: config.ollamaModel && parserMode === "local" ? "idle" : "disabled" };
  await db.collection<TextStream>("text_streams").insertOne(stream);
  return stream;
}

export async function appendChunk(db: Db, streamId: string, text: string, owner: string) {
  const stream = await db.collection<TextStream>("text_streams").findOneAndUpdate(
    { _id: streamId, uploadOwner: owner, uploadUntil: { $gt: new Date() } },
    { $inc: { sequence: 1 }, $set: { updatedAt: new Date() } }, { returnDocument: "after" },
  );
  if (!stream) throw new Error("Upload lease expired");
  const chunk: TextChunk = { _id: `${streamId}:${stream.sequence}`, streamId, sequence: stream.sequence, text, ts: new Date() };
  await db.collection<TextChunk>("text_chunks").insertOne(chunk);
  return chunk;
}

/** One bounded batch, with a cross-process lease. Raw text survives all parse failures. */
export async function parseAvailable(db: Db, streamId: string) {
  if (!config.ollamaModel) return;
  const streams = db.collection<TextStream>("text_streams");
  const owner = randomUUID();
  const stream = await streams.findOneAndUpdate({ _id: streamId, parserMode: { $ne: "fixture" }, $or: [{ parseUntil: { $exists: false } }, { parseUntil: { $lt: new Date() } }] }, {
    $set: { parseOwner: owner, parseUntil: new Date(Date.now() + 60000), parserStatus: "parsing" },
  }, { returnDocument: "after" });
  if (!stream) return;
  try {
    const chunks = await db.collection<TextChunk>("text_chunks").find({ streamId, sequence: { $gt: stream.parsedThrough } }).sort({ sequence: 1 }).limit(8).toArray();
    if (!chunks.length) { await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parserStatus: "idle" } }); return; }
    const stored = await db.collection<StoredNode>("stream_nodes").find({ streamId }).limit(101).toArray();
    if (stored.length > 100) throw new Error("Parser context limit reached (100 nodes)");
    const known = stored.map(({ id, parentId, label, kind, status, summary, evidence }) => ({ id, parentId, label, kind, status, summary, evidence }));
    const nodes = await parseText(chunks.map(chunk => chunk.text).join(""), known, { url: config.ollamaUrl, model: config.ollamaModel });
    const throughSequence = chunks[chunks.length - 1].sequence;
    for (const node of nodes) {
      await db.collection<StoredNode>("stream_nodes").updateOne({ _id: `${streamId}:${node.id}` }, { $set: { ...node, ...nodeEmbeddingFields(node), streamId, fromSequence: chunks[0].sequence, throughSequence, model: config.ollamaModel, inferred: true, updatedAt: new Date() } }, { upsert: true });
    }
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parsedThrough: throughSequence, parserStatus: "idle", parsedBy: config.ollamaModel }, $unset: { parserError: "" } });
  } catch (error) {
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parserStatus: "failed", parserError: error instanceof Error ? error.message : "Parsing failed" } });
  } finally {
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $unset: { parseOwner: "", parseUntil: "" } });
  }
}
