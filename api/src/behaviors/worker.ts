import { Db } from "mongodb";
import { config } from "../config.js";
import { createHash } from "node:crypto";
import { getDb } from "../db/client.js";
import type { StoredNode, TextChunk } from "../streams/store.js";
import { behaviorFingerprint, matchBehavior, textHash, type BehaviorRule, type BehaviorCheck, type BehaviorMatch, type ObservedNode } from "./matcher.js";

export const behaviorRuntime: { running: boolean; matcherRevision: string; lastTickAt?: Date; error?: string; nextSemanticAt?: Date } = { running: false, matcherRevision: "source-evidence-v2" };
let initialization: Promise<void> | undefined;
export async function initializeBehaviors(db: Db) {
  initialization ??= Promise.all([
    db.collection("behavior_rules").createIndex({ enabled: 1, streamId: 1 }),
    db.collection("behavior_matches").createIndex({ streamId: 1, detectedAt: -1 }),
    db.collection("behavior_checks").createIndex({ behaviorId: 1 }),
  ]).then(() => {}).catch(error => { initialization = undefined; throw error; });
  await initialization;
}

export function semanticBehaviorPipeline(rule: BehaviorRule, step: number) {
  return [
    { $vectorSearch: { index: config.nodeEmbeddingIndex, path: "embeddingText", query: { text: rule.steps[step].query },
      ...(rule.streamId ? { filter: { streamId: rule.streamId } } : {}), numCandidates: 2000, limit: 100 } },
    { $project: { _id: 1, embeddingTextHash: 1, score: { $meta: "vectorSearchScore" } } },
  ];
}

export async function recordBehaviorMatches(db: Db, rules: BehaviorRule[], nodes: ObservedNode[], checks: BehaviorCheck[]) {
  const matches = rules.flatMap(rule => matchBehavior(rule, nodes, checks.filter(check => check.behaviorId === rule._id)));
  if (!matches.length) return 0;
  const result = await db.collection<BehaviorMatch>("behavior_matches").bulkWrite(matches.map(match => ({ updateOne: {
    filter: { _id: match._id }, update: { $setOnInsert: match }, upsert: true,
  } })), { ordered: false });
  return result.upsertedCount;
}

/** Phrase checks run independently of the slower, rate-limited semantic queue. */
export function startBehaviorWorker() {
  if (behaviorRuntime.running) return;
  behaviorRuntime.running = true;
  let semanticBusy = false;
  let nextSemantic = 0;
  let lastJob = "";
  let lastEvaluation = "";
  async function tick() {
    try {
      const db = await getDb(); await initializeBehaviors(db);
      const rules = await db.collection<BehaviorRule>("behavior_rules").find({ enabled: true }).sort({ _id: 1 }).limit(100).toArray();
      if (rules.length) {
        const saved = await db.collection<StoredNode>("stream_nodes").find().sort({ updatedAt: -1 }).limit(1000).toArray();
        const chunks = await db.collection<TextChunk>("text_chunks").find({ streamId: { $in: [...new Set(saved.map(node => node.streamId))] }, sequence: { $in: [...new Set(saved.map(node => node.throughSequence))] } }, { projection: { streamId: 1, sequence: 1, ts: 1 } }).toArray();
        const times = new Map(chunks.map(chunk => [`${chunk.streamId}:${chunk.sequence}`, chunk.ts]));
        const nodes: ObservedNode[] = saved.map(node => ({ ...node, observedAt: times.get(`${node.streamId}:${node.throughSequence}`) ?? node.updatedAt }));
        const checks = await db.collection<BehaviorCheck>("behavior_checks").find({ behaviorId: { $in: rules.map(rule => rule._id) } }).toArray();
        const evaluation = createHash("sha256").update(JSON.stringify([
          rules.map(rule => [rule._id, rule.updatedAt]),
          nodes.map(node => [node._id, textHash(node), node.status, node.throughSequence, node.observedAt]),
          checks.map(check => [check._id, check.checkedAt]),
        ])).digest("hex");
        if (evaluation !== lastEvaluation) { await recordBehaviorMatches(db, rules, nodes, checks); lastEvaluation = evaluation; }
        if (!semanticBusy && Date.now() >= nextSemantic) {
          const jobs = rules.filter(rule => rule.mode === "semantic").flatMap(rule => rule.steps.map((_, step) => ({ rule, step, id: `${rule._id}:${step}` })));
          const start = Math.max(0, jobs.findIndex(job => job.id === lastJob) + 1);
          for (let offset = 0; offset < jobs.length; offset++) {
            const job = jobs[(start + offset) % jobs.length];
            const relevant = saved.filter(node => !job.rule.streamId || node.streamId === job.rule.streamId);
            if (!relevant.length) continue;
            const fingerprint = behaviorFingerprint(relevant);
            const previous = checks.find(check => check._id === job.id);
            const changed = previous?.fingerprint !== fingerprint;
            if (previous && !changed && (previous.attempts >= 3 || previous.nextRetryAt.getTime() > Date.now())) continue;
            semanticBusy = true; lastJob = job.id;
            // Keep the immediate detector ticking while a vector query is in flight.
            void (async () => {
              const checkedAt = new Date();
              const state: BehaviorCheck = { _id: job.id, behaviorId: job.rule._id, step: job.step, fingerprint, hits: [], attempts: changed ? 1 : previous!.attempts + 1, checkedAt, nextRetryAt: new Date(Date.now() + 30000) };
              try {
                const results = await db.collection("stream_nodes").aggregate(semanticBehaviorPipeline(job.rule, job.step), { maxTimeMS: 15000 }).toArray();
                state.hits = results.map(result => ({ nodeKey: String(result._id), textHash: result.embeddingTextHash, score: result.score })).filter(hit => typeof hit.textHash === "string" && Number.isFinite(hit.score));
              } catch (error) { state.error = error instanceof Error ? error.message : "Semantic check failed"; }
              await db.collection<BehaviorCheck>("behavior_checks").replaceOne({ _id: job.id }, state, { upsert: true });
            })().catch(error => { behaviorRuntime.error = error.message; }).finally(() => {
              semanticBusy = false; nextSemantic = Date.now() + config.behaviorSemanticIntervalMs;
              behaviorRuntime.nextSemanticAt = new Date(nextSemantic);
            });
            break;
          }
        }
      }
      behaviorRuntime.lastTickAt = new Date(); delete behaviorRuntime.error;
    } catch (error) { behaviorRuntime.error = error instanceof Error ? error.message : "Behavior monitor failed"; }
    const timer = setTimeout(() => { void tick(); }, 1000); timer.unref();
  }
  void tick();
}
