import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Db, MongoClient } from "mongodb";
import { validateNodes } from "./parser.js";
import type { TextChunk, TextStream, StoredNode } from "./store.js";
import { nodeEmbeddingFields } from "./embeddings.js";

/** Determine when prerecorded nodes become eligible, without exposing future evidence. */
export function planLiveReplay(text: string, fixture: unknown) {
  const nodes = validateNodes(fixture, text, []);
  const planned = new Map<string, (typeof nodes)[number] & { readyAfter: number }>();
  function visit(node: (typeof nodes)[number]): (typeof nodes)[number] & { readyAfter: number } {
    const existing = planned.get(node.id);
    if (existing) return existing;
    const parent = node.parentId ? visit(nodes.find(parent => parent.id === node.parentId)!) : undefined;
    const result = { ...node, readyAfter: Math.max(text.indexOf(node.evidence) + node.evidence.length, parent?.readyAfter ?? 0) };
    planned.set(node.id, result);
    return result;
  }
  nodes.forEach(visit);
  return [...planned.values()].sort((a, b) => a.readyAfter - b.readyAfter);
}

/** Follow committed input frames and publish eligible fixture output before upload EOF. */
export async function streamLiveParsedOutput(client: MongoClient, db: Db, streamId: string, expectedText: string, fixture: unknown,
  options: { inputDone: Promise<void>; signal?: AbortSignal; timeoutMs?: number; onNode?: (id: string, count: number, total: number) => void | Promise<void> }) {
  let inputEnded = false, inputFailed = false;
  let inputError: unknown;
  // Attach both handlers immediately, including when fixture validation fails below.
  void options.inputDone.then(() => { inputEnded = true; }, error => { inputFailed = true; inputError = error; inputEnded = true; });
  const plan = planLiveReplay(expectedText, fixture);
  const streams = db.collection<TextStream>("text_streams");
  const owner = randomUUID();
  const claimed = await streams.findOneAndUpdate({ _id: streamId, parserMode: "fixture", $or: [
    { parseUntil: { $exists: false } }, { parseUntil: { $lt: new Date() } },
  ] }, { $set: { parseOwner: owner, parseUntil: new Date(Date.now() + 90000), parserStatus: "parsing", parsedBy: "assistant-authored-demo" }, $unset: { parserError: "" } }, { returnDocument: "after" });
  if (!claimed) throw new Error("Live replay requires a fixture-mode stream without an active parser");
  const heartbeat = setInterval(() => {
    void streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parseUntil: new Date(Date.now() + 90000) } }).catch(() => {});
  }, 20000);
  const session = client.startSession();
  const chunks: TextChunk[] = [];
  const emitted = new Set<string>();
  let after = 0, receivedText = "";
  const deadline = Date.now() + (options.timeoutMs ?? 120000);
  try {
    while (true) {
      options.signal?.throwIfAborted();
      if (inputFailed) throw inputError;
      if (Date.now() > deadline) throw new Error("Live replay timed out; committed text and nodes are retained");
      const incoming = await db.collection<TextChunk>("text_chunks").find({ streamId, sequence: { $gt: after } }).sort({ sequence: 1 }).limit(200).toArray();
      chunks.push(...incoming);
      receivedText += incoming.map(chunk => chunk.text).join("");
      after = incoming.at(-1)?.sequence ?? after;
      if (!expectedText.startsWith(receivedText)) throw new Error("Arriving text differs from the conversation fixture");
      const eligible = plan.filter(node => node.readyAfter <= receivedText.length);
      for (const node of prepareReplay(chunks, { nodes: eligible })) {
        if (emitted.has(node.id)) continue;
        await session.withTransaction(async () => {
          const current = await streams.findOne({ _id: streamId, parseOwner: owner, parseUntil: { $gt: new Date() } }, { session });
          if (!current) throw new Error("Live replay lease expired");
          await db.collection<StoredNode>("stream_nodes").updateOne({ _id: `${streamId}:${node.id}` }, { $set: {
            ...node, ...nodeEmbeddingFields(node), streamId, model: "assistant-authored-demo", inferred: true, updatedAt: new Date(),
          } }, { upsert: true, session });
          await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { updatedAt: new Date() } }, { session });
        });
        emitted.add(node.id);
        await options.onNode?.(node.id, emitted.size, plan.length);
      }
      const current = await streams.findOne({ _id: streamId, parseOwner: owner });
      if (!current) throw new Error("Live replay lease lost");
      const uploading = current.uploadUntil && current.uploadUntil > new Date();
      if (inputEnded && !uploading && after >= current.sequence) {
        if (receivedText !== expectedText || emitted.size !== plan.length) throw new Error("Input ended before all expected text and node evidence arrived");
        await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parsedThrough: after, parserStatus: "idle", updatedAt: new Date() } });
        return emitted.size;
      }
      await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parsedThrough: after } });
      await setTimeout(100, undefined, { signal: options.signal });
    }
  } catch (error) {
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parserStatus: "failed", parserError: error instanceof Error ? error.message : "Live replay failed" } });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await session.endSession();
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $unset: { parseOwner: "", parseUntil: "" } });
  }
}

export function prepareReplay(chunks: TextChunk[], fixture: unknown) {
  const text = chunks.map(chunk => chunk.text).join("");
  const nodes = validateNodes(fixture, text, []);
  let offset = 0;
  const ranges = chunks.map(chunk => {
    const range = { start: offset, end: offset + chunk.text.length, sequence: chunk.sequence };
    offset = range.end;
    return range;
  });
  // Emit parents first, even if a fixture happens to list its children first.
  const ordered: typeof nodes = [];
  const seen = new Set<string>();
  function visit(node: (typeof nodes)[number]) {
    if (seen.has(node.id)) return;
    if (node.parentId) visit(nodes.find(parent => parent.id === node.parentId)!);
    seen.add(node.id); ordered.push(node);
  }
  nodes.forEach(visit);
  return ordered.map(node => {
    const start = text.indexOf(node.evidence);
    const end = start + node.evidence.length;
    return { ...node,
      fromSequence: ranges.find(range => range.end > start)!.sequence,
      throughSequence: ranges.find(range => range.end >= end)!.sequence,
    };
  });
}

/** Replay precomputed output, committing each node separately so readers see growth. */
export async function streamParsedOutput(client: MongoClient, db: Db, streamId: string, fixture: unknown,
  options: { delayMs?: number; onNode?: (id: string, count: number, total: number) => void | Promise<void> } = {}) {
  const delayMs = options.delayMs ?? 750;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10000) throw new Error("Invalid replay delay");
  const streams = db.collection<TextStream>("text_streams");
  const source = await streams.findOne({ _id: streamId });
  if (!source) throw new Error("Stream not found. Replay the input first.");
  const chunks = await db.collection<TextChunk>("text_chunks").find({ streamId }).sort({ sequence: 1 }).toArray();
  const plan = prepareReplay(chunks, fixture);
  const owner = randomUUID();
  const now = new Date();
  const claimed = await streams.findOneAndUpdate({ _id: streamId, sequence: source.sequence, $and: [
    { $or: [{ uploadUntil: { $exists: false } }, { uploadUntil: { $lt: now } }] },
    { $or: [{ parseUntil: { $exists: false } }, { parseUntil: { $lt: now } }] },
  ] }, { $set: { parseOwner: owner, parseUntil: new Date(Date.now() + 90000), parserStatus: "parsing", parsedBy: "assistant-authored-demo" }, $unset: { parserError: "" } }, { returnDocument: "after" });
  if (!claimed) throw new Error("Input changed or an upload/parser is active; retry when it finishes");
  const heartbeat = setInterval(() => {
    void streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parseUntil: new Date(Date.now() + 90000) } }).catch(() => {});
  }, 20000);
  const session = client.startSession();
  try {
    for (let index = 0; index < plan.length; index++) {
      const node = plan[index];
      await session.withTransaction(async () => {
        const current = await streams.findOne({ _id: streamId, parseOwner: owner, parseUntil: { $gt: new Date() } }, { session });
        if (!current || current.sequence !== source.sequence || (current.uploadUntil && current.uploadUntil > new Date())) {
          throw new Error("Input changed or replay lease expired; saved nodes are retained");
        }
        await db.collection<StoredNode>("stream_nodes").updateOne({ _id: `${streamId}:${node.id}` }, { $set: {
          ...node, ...nodeEmbeddingFields(node), streamId, model: "assistant-authored-demo", inferred: true, updatedAt: new Date(),
        } }, { upsert: true, session });
        await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { updatedAt: new Date() } }, { session });
      });
      await options.onNode?.(node.id, index + 1, plan.length);
      if (index < plan.length - 1 && delayMs) await setTimeout(delayMs);
    }
    const completed = await streams.updateOne({ _id: streamId, parseOwner: owner, sequence: source.sequence }, {
      $set: { parsedThrough: chunks.at(-1)?.sequence ?? 0, parserStatus: "idle", updatedAt: new Date() },
    });
    if (!completed.matchedCount) throw new Error("Input changed before replay completion; saved nodes are retained");
    return plan.length;
  } catch (error) {
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $set: { parserStatus: "failed", parserError: error instanceof Error ? error.message : "Output replay failed" } });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await session.endSession();
    await streams.updateOne({ _id: streamId, parseOwner: owner }, { $unset: { parseOwner: "", parseUntil: "" } });
  }
}
