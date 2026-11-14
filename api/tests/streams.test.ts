import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import express from "express";
import { frameText } from "../src/streams/framing.js";
import { parseText, validateNodes, type ParsedNode } from "../src/streams/parser.js";
import { config } from "../src/config.js";
import { streamsRouter } from "../src/routes/streams.js";
import { getDb, closeDb } from "../src/db/client.js";
import { MongoClient } from "mongodb";
import { prepareReplay, streamParsedOutput, planLiveReplay, streamLiveParsedOutput } from "../src/streams/replay.js";
import { appendChunk, createStream, type TextChunk } from "../src/streams/store.js";
import { nodeEmbeddingFields, nodeSearchPipeline } from "../src/streams/embeddings.js";
import { assertSearchAuth, assertAgentAuth, AuthError } from "../src/auth/credentials.js";
import type { Request } from "express";

async function collect(source: AsyncIterable<Uint8Array>, size?: number) {
  const frames: string[] = [];
  for await (const text of frameText(source, size)) frames.push(text);
  return frames;
}
async function* buffers(text: string) {
  for (const byte of Buffer.from(text)) yield Buffer.from([byte]);
}
const node: ParsedNode = { id: "read", parentId: null, label: "Read record", kind: "tool_call", status: "in_progress", summary: "The agent says it is reading a record.", evidence: "Reading record" };

test("embedding input changes with semantic content and ignores storage metadata", () => {
  const original = nodeEmbeddingFields(node);
  assert(original.embeddingText.includes(node.label));
  assert(original.embeddingText.includes(node.summary));
  assert(original.embeddingText.includes(node.evidence));
  assert.equal(original.embeddingTextHash, nodeEmbeddingFields({ ...node, model: "another-parser" } as any).embeddingTextHash);
  for (const field of ["label", "summary", "evidence"]) {
    assert.notEqual(original.embeddingTextHash, nodeEmbeddingFields({ ...node, [field]: "Changed" }).embeddingTextHash);
  }
});

test("semantic queries stay scoped to a stream and validate input before model calls", () => {
  const pipeline = nodeSearchPipeline("  issue creation  ", "stream-a", 3);
  assert.deepEqual(pipeline[0].$vectorSearch?.query, { text: "issue creation" });
  assert.deepEqual(pipeline[0].$vectorSearch?.filter, { streamId: "stream-a" });
  assert.equal(pipeline[0].$vectorSearch?.numCandidates, 60);
  assert.throws(() => nodeSearchPipeline("", "stream-a"));
  assert.throws(() => nodeSearchPipeline("x".repeat(1001), "stream-a"));
  assert.throws(() => nodeSearchPipeline("x", "stream-a", 21));
});

test("search accepts reviewer access without granting agent write access", () => {
  const requestFor = (key: string) => ({ headers: { authorization: `Bearer ${key}` } }) as Request;
  assert.doesNotThrow(() => assertSearchAuth(requestFor(config.reviewerApiKey)));
  assert.doesNotThrow(() => assertSearchAuth(requestFor(config.agentApiKey)));
  assert.throws(() => assertSearchAuth(requestFor("wrong-key")), AuthError);
  assert.throws(() => assertSearchAuth({ headers: {} } as Request), AuthError);
  if (config.reviewerApiKey !== config.agentApiKey) {
    assert.throws(() => assertAgentAuth(requestFor(config.reviewerApiKey)), AuthError);
  }
});

test("frames preserve split UTF-8, CRLF, empty lines, and final unterminated text", async () => {
  const text = "Reading record 🐈\r\n\nRésumé: done";
  const result = await collect(buffers(text), 8);
  assert.equal(result.join(""), text);
  assert(result.every(frame => frame.length <= 8 && !/[\uD800-\uDBFF]$/.test(frame)));
});

test("frames reject invalid UTF-8 and uploads over the byte limit", async () => {
  await assert.rejects(collect((async function* () { yield Buffer.from([0xff]); })()));
  await assert.rejects(collect((async function* () { yield Buffer.alloc(1024 * 1024 + 1); })()), /1 MiB/);
});

test("parser accepts updates but rejects fabricated evidence, cycles, and duplicate ids", () => {
  assert.deepEqual(validateNodes({ nodes: [node] }, "Reading record", []), [node]);
  assert.throws(() => validateNodes({ nodes: [node] }, "Something else", []), /evidence/);
  assert.throws(() => validateNodes({ nodes: [node, node] }, "Reading record", []), /unique/);
  assert.throws(() => validateNodes({ nodes: [{ ...node, parentId: "read" }] }, "Reading record", []), /cycle/);
  assert.throws(() => validateNodes({ nodes: [{ ...node, parentId: "missing" }] }, "Reading record", []), /parent/);
  assert.throws(() => validateNodes({ nodes: [{ ...node, status: "verified" }] }, "Reading record", []), /status/);
});

test("output replay orders parents before children and locates evidence across chunk boundaries", () => {
  const chunks: TextChunk[] = [
    { _id: "a", streamId: "test", sequence: 1, text: "Reading ", ts: new Date() },
    { _id: "b", streamId: "test", sequence: 2, text: "record. Done", ts: new Date() },
  ];
  const child = { ...node, id: "result", parentId: node.id, kind: "tool_result", evidence: "Done" };
  const plan = prepareReplay(chunks, { nodes: [child, node] });
  assert.deepEqual(plan.map(n => n.id), ["read", "result"]);
  assert.equal(plan[0].fromSequence, 1);
  assert.equal(plan[0].throughSequence, 2);
  assert.throws(() => prepareReplay(chunks, { nodes: [{ ...node, evidence: "missing" }] }), /evidence/);
});

test("live replay gates a child on both its own evidence and its parent's evidence", () => {
  const child = { ...node, id: "child", parentId: node.id, evidence: "Done" };
  const plan = planLiveReplay("Done. Reading record", { nodes: [child, node] });
  assert.deepEqual(plan.map(n => n.id), ["read", "child"]);
  assert.equal(plan[0].readyAfter, "Done. Reading record".length);
  assert.equal(plan[1].readyAfter, plan[0].readyAfter);
});

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function shutdown(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test("local parser sends a JSON schema without tools and validates the returned content", async () => {
  let received: any;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: { content: JSON.stringify({ nodes: [node] }) } }));
  });
  const url = await listen(server);
  try {
    assert.deepEqual(await parseText("Reading record", [], { url, model: "test-local" }), [node]);
    assert.equal(received.stream, false);
    assert.equal(received.format.type, "object");
    assert.equal(received.tools, undefined);
    await assert.rejects(parseText("Reading record", [], { url: "https://example.com", model: "test" }), /loopback/);
  } finally { await shutdown(server); }
});

test("Atlas: live text is durable before EOF, writers are serialized, and parser failures retain raw text", { skip: process.env.STREAM_TEST_ATLAS !== "1", timeout: 30000 }, async () => {
  const app = express(); app.use(express.json()); app.use("/api/streams", streamsRouter);
  const server = createServer(app);
  const base = await listen(server);
  const prior = { model: config.ollamaModel, url: config.ollamaUrl };
  config.ollamaModel = "";
  const headers = { Authorization: `Bearer ${config.agentApiKey}` };
  const db = await getDb();
  let id = "";
  let validParser = false;
  const model = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: { content: validParser ? JSON.stringify({ nodes: [node] }) : "not JSON" } }));
  });
  try {
    assert.equal((await fetch(`${base}/api/streams`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    const created = await fetch(`${base}/api/streams`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ label: "integration probe" }) });
    assert.equal(created.status, 201);
    id = (await created.json() as any).stream._id;
    const endpoint = `${base}/api/streams/${id}`;
    assert.equal((await fetch(`${endpoint}/text`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 415);
    const upload = request(`${endpoint}/text`, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" } });
    const uploaded = new Promise<number>( (resolve, reject) => { upload.on("response", res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); }); upload.on("error", reject); });
    upload.write("Reading record\n");
    const deadline = Date.now() + 6000;
    while (!await db.collection("text_chunks").findOne({ streamId: id })) {
      assert(Date.now() < deadline, "First frame should persist before upload ends");
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal((await fetch(`${endpoint}/text`, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "concurrent" })).status, 409);
    upload.end("Done 🐈");
    assert.equal(await uploaded, 201);
    let view = await (await fetch(endpoint)).json() as any;
    assert.equal(view.chunks.map((c: any) => c.text).join(""), "Reading record\nDone 🐈");
    assert.equal(view.stream.parserStatus, "disabled");
    // A disconnected producer keeps committed frames and releases its writer lease.
    const interrupted = request(`${endpoint}/text`, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" } });
    interrupted.on("error", () => {});
    interrupted.write("Interrupted frame\n");
    const abortDeadline = Date.now() + 6000;
    while (await db.collection("text_chunks").countDocuments({ streamId: id }) < 3) {
      assert(Date.now() < abortDeadline);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    interrupted.destroy();
    while (true) {
      view = await (await fetch(endpoint)).json() as any;
      if (!view.stream.receiving) break;
      assert(Date.now() < abortDeadline);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal((await fetch(`${endpoint}/text`, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "Resumed\n" })).status, 201);
    config.ollamaModel = "test-local"; config.ollamaUrl = await listen(model);
    await fetch(`${endpoint}/parse`, { method: "POST", headers });
    view = await (await fetch(endpoint)).json() as any;
    assert.equal(view.stream.parserStatus, "failed");
    assert.equal(view.stream.parsedThrough, 0);
    assert.equal(view.chunks.length, 4);
    validParser = true;
    await fetch(`${endpoint}/parse`, { method: "POST", headers });
    view = await (await fetch(endpoint)).json() as any;
    assert.equal(view.stream.parserStatus, "idle");
    assert.equal(view.stream.parsedThrough, 4);
    assert.equal(view.nodes[0].id, "read");
    assert.equal(view.nodes[0].inferred, true);
    assert.deepEqual({ embeddingText: view.nodes[0].embeddingText, embeddingTextHash: view.nodes[0].embeddingTextHash }, nodeEmbeddingFields(node));
    assert.equal((await fetch(`${endpoint}/search?q=record`)).status, 401);
    assert.equal((await fetch(`${endpoint}/search?q=`, { headers: { Authorization: `Bearer ${config.reviewerApiKey}` } })).status, 400);
    const page = await (await fetch(`${endpoint}?after=1`)).json() as any;
    assert.equal(page.chunks.length, 3);
    assert.equal(page.nextAfter, 4);
  } finally {
    config.ollamaModel = prior.model; config.ollamaUrl = prior.url;
    if (id) {
      await db.collection("text_chunks").deleteMany({ streamId: id });
      await db.collection("stream_nodes").deleteMany({ streamId: id });
      await db.collection("text_streams").deleteOne({ _id: id } as any);
    }
    await shutdown(server);
    if (model.listening) await shutdown(model);
    await closeDb();
  }
});

test("Atlas: output nodes commit incrementally, reject concurrent replay, and upsert on retry", { skip: process.env.STREAM_TEST_ATLAS !== "1", timeout: 30000 }, async () => {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  const stream = await createStream(db, "output replay integration probe", "fixture");
  const fixture = { nodes: [node, { ...node, id: "result", parentId: node.id, kind: "tool_result", evidence: "Done" }] };
  try {
    await db.collection("text_chunks").insertOne({ _id: `${stream._id}:1`, streamId: stream._id, sequence: 1, text: "Reading record. Done", ts: new Date() });
    await db.collection("text_streams").updateOne({ _id: stream._id } as any, { $set: { sequence: 1 } });
    const observed: number[] = [];
    await streamParsedOutput(client, db, stream._id, fixture, { delayMs: 0, onNode: async (_id, count) => {
      observed.push(await db.collection("stream_nodes").countDocuments({ streamId: stream._id }));
      const current = await db.collection("text_streams").findOne({ _id: stream._id } as any);
      assert.equal(current?.parserStatus, "parsing");
      assert.equal(current?.parsedThrough, 0);
      if (count === 1) await assert.rejects(streamParsedOutput(client, db, stream._id, fixture, { delayMs: 0 }), /active/);
    } });
    assert.deepEqual(observed, [1, 2]);
    const final = await db.collection("text_streams").findOne({ _id: stream._id } as any);
    assert.equal(final?.parsedThrough, 1);
    assert.equal(final?.parserStatus, "idle");
    assert.equal(final?.parseOwner, undefined);
    await streamParsedOutput(client, db, stream._id, fixture, { delayMs: 0 });
    assert.equal(await db.collection("stream_nodes").countDocuments({ streamId: stream._id }), 2);
    const embedded = await db.collection("stream_nodes").findOne({ streamId: stream._id, id: node.id });
    assert.equal(embedded?.embeddingTextHash, nodeEmbeddingFields(node).embeddingTextHash);
    const changed = { ...node, summary: "A newly updated summary." };
    await streamParsedOutput(client, db, stream._id, { nodes: [changed, fixture.nodes[1]] }, { delayMs: 0 });
    const updated = await db.collection("stream_nodes").findOne({ streamId: stream._id, id: node.id });
    assert.equal(updated?.embeddingTextHash, nodeEmbeddingFields(changed).embeddingTextHash);
  } finally {
    await db.collection("stream_nodes").deleteMany({ streamId: stream._id });
    await db.collection("text_chunks").deleteMany({ streamId: stream._id });
    await db.collection("text_streams").deleteOne({ _id: stream._id } as any);
    await client.close();
  }
});

test("Atlas: live replay emits nodes before input EOF and retains committed nodes on truncated input", { skip: process.env.STREAM_TEST_ATLAS !== "1", timeout: 30000 }, async () => {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  const ids: string[] = [];
  const fixture = { nodes: [node, { ...node, id: "result", parentId: node.id, kind: "tool_result", evidence: "Done" }] };
  const expected = "Reading record. Done";
  let finishInput!: () => void;
  const inputDone = new Promise<void>(resolve => { finishInput = resolve; });
  try {
    const stream = await createStream(db, "live output replay probe", "fixture");
    ids.push(stream._id);
    await db.collection("text_streams").updateOne({ _id: stream._id } as any, { $set: { uploadOwner: "test-writer", uploadUntil: new Date(Date.now() + 90000) } });
    await appendChunk(db, stream._id, "Reading record. ", "test-writer");
    let firstNode!: () => void, failFirst!: (error: unknown) => void;
    const firstOutput = new Promise<void>((resolve, reject) => { firstNode = resolve; failFirst = reject; });
    const replay = streamLiveParsedOutput(client, db, stream._id, expected, fixture, {
      inputDone, timeoutMs: 10000,
      onNode: async (_id, count) => {
        if (count === 1) {
          const current = await db.collection("text_streams").findOne({ _id: stream._id } as any);
          assert(current?.uploadUntil > new Date(), "Input upload must still be active when the first node commits");
          assert.equal(await db.collection("text_chunks").countDocuments({ streamId: stream._id }), 1);
          assert.equal(await db.collection("stream_nodes").countDocuments({ streamId: stream._id }), 1);
          firstNode();
        }
      },
    });
    void replay.then(() => failFirst(new Error("Replay ended before the test supplied EOF")), failFirst);
    await firstOutput;
    assert.equal(await db.collection("stream_nodes").countDocuments({ streamId: stream._id, id: "result" }), 0, "Future evidence must not be emitted early");
    await appendChunk(db, stream._id, "Done", "test-writer");
    await db.collection("text_streams").updateOne({ _id: stream._id } as any, { $unset: { uploadOwner: "", uploadUntil: "" } });
    finishInput();
    assert.equal(await replay, 2);
    const final = await db.collection("text_streams").findOne({ _id: stream._id } as any);
    assert.equal(final?.parsedThrough, 2);
    assert.equal(final?.parserStatus, "idle");
    assert.equal(final?.parseOwner, undefined);
    const child = await db.collection("stream_nodes").findOne({ streamId: stream._id, id: "result" });
    assert.equal(child?.fromSequence, 2);
    assert.equal(child?.throughSequence, 2);
    assert(child?.embeddingTextHash);

    const truncated = await createStream(db, "truncated live replay probe", "fixture");
    ids.push(truncated._id);
    await db.collection("text_chunks").insertOne({ _id: `${truncated._id}:1`, streamId: truncated._id, sequence: 1, text: "Reading record. ", ts: new Date() });
    await db.collection("text_streams").updateOne({ _id: truncated._id } as any, { $set: { sequence: 1 } });
    await assert.rejects(streamLiveParsedOutput(client, db, truncated._id, expected, fixture, { inputDone: Promise.resolve() }), /Input ended/);
    assert.equal(await db.collection("stream_nodes").countDocuments({ streamId: truncated._id }), 1);
    const failed = await db.collection("text_streams").findOne({ _id: truncated._id } as any);
    assert.equal(failed?.parserStatus, "failed");
    assert.equal(failed?.parseOwner, undefined);
  } finally {
    finishInput();
    await db.collection("stream_nodes").deleteMany({ streamId: { $in: ids } });
    await db.collection("text_chunks").deleteMany({ streamId: { $in: ids } });
    await db.collection("text_streams").deleteMany({ _id: { $in: ids } } as any);
    await client.close();
  }
});
