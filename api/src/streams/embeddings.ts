import { createHash } from "node:crypto";
import { Db } from "mongodb";
import { config } from "../config.js";
import type { ParsedNode } from "./parser.js";
import type { StoredNode } from "./store.js";

/** Keep the embedding input deterministic and independent of storage/provenance fields. */
export function nodeEmbeddingFields(node: Pick<ParsedNode, "label" | "summary" | "evidence">) {
  const embeddingText = `Label: ${node.label}\nSummary: ${node.summary}\nEvidence: ${node.evidence}`;
  return { embeddingText, embeddingTextHash: createHash("sha256").update(embeddingText).digest("hex") };
}

export function nodeEmbeddingIndexDefinition() {
  return { fields: [
    { type: "autoEmbed", modality: "text", path: "embeddingText", model: config.nodeEmbeddingModel },
    { type: "filter", path: "streamId" },
  ] };
}

export async function ensureNodeEmbeddingIndex(db: Db) {
  const collection = db.collection("stream_nodes");
  type IndexState = { name: string; status?: string; queryable?: boolean; latestDefinition?: { fields?: { path: string; type: string; model?: string }[] } };
  const existing = (await collection.listSearchIndexes(config.nodeEmbeddingIndex).toArray())[0] as IndexState | undefined;
  if (existing) {
    const field = existing.latestDefinition?.fields?.find((field: { path: string }) => field.path === "embeddingText");
    const filter = existing.latestDefinition?.fields?.find((field: { path: string }) => field.path === "streamId");
    if (field?.type !== "autoEmbed" || field.model !== config.nodeEmbeddingModel || filter?.type !== "filter") {
      throw new Error("Existing embedding index differs from the configured definition; use a new NODE_EMBEDDING_INDEX name or update the index explicitly");
    }
    return { created: false, status: existing.status, queryable: existing.queryable };
  }
  await collection.createSearchIndex({ name: config.nodeEmbeddingIndex, type: "vectorSearch", definition: nodeEmbeddingIndexDefinition() });
  return { created: true, status: "BUILDING", queryable: false };
}

/** Compare source fields during updates so a concurrent node edit cannot get stale input. */
export async function backfillNodeEmbeddingInputs(db: Db) {
  const collection = db.collection<StoredNode>("stream_nodes");
  let examined = 0, modified = 0;
  for await (const node of collection.find({}, { projection: { _id: 1, label: 1, summary: 1, evidence: 1 } })) {
    const result = await collection.updateOne({ _id: node._id, label: node.label, summary: node.summary, evidence: node.evidence }, { $set: nodeEmbeddingFields(node) });
    examined++; modified += result.modifiedCount;
  }
  return { examined, modified };
}

export function nodeSearchPipeline(query: string, streamId: string, limit = 5) {
  if (typeof query !== "string" || !query.trim() || query.length > 1000) throw new Error("q must contain 1–1000 characters");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be 1–20");
  return [
    { $vectorSearch: { index: config.nodeEmbeddingIndex, path: "embeddingText", query: { text: query.trim() }, filter: { streamId }, numCandidates: limit * 20, limit } },
    { $project: { _id: 0, id: 1, parentId: 1, streamId: 1, label: 1, summary: 1, kind: 1, status: 1, evidence: 1, score: { $meta: "vectorSearchScore" } } },
  ];
}
