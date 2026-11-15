import { Db } from "mongodb";
import { validateBehavior, type BehaviorRule } from "./matcher.js";

export async function seedBehaviorPresets(db: Db) {
  const definitions = [
    { id: "file-missing", name: "File not found", steps: [{ query: "ENOENT | file not found | no such file", status: "failed" }] },
    { id: "file-retry", name: "Missing file then retry", steps: [{ query: "ENOENT | file not found | no such file", status: "failed" }, { query: "retry | trying again | reattempt", status: "in_progress" }] },
    { id: "permission-denied", name: "Permission denied", steps: [{ query: "EACCES | EPERM | permission denied | not authorized", status: "failed" }] },
    { id: "failure-recovery", name: "Failure then recovery", steps: [{ query: "failed | error | unsupported | denied", status: "failed" }, { query: "succeeded | passed | recovered | resolved | success", status: "completed" }] },
    { id: "failure-recovery-semantic", name: "Failure then recovery (semantic)", mode: "semantic", steps: [{ query: "An operation fails or encounters an error", status: "failed" }, { query: "The operation recovers from the failure and succeeds", status: "completed" }] },
  ];
  for (const definition of definitions) {
    const rule: BehaviorRule = { ...validateBehavior({ ...definition, mode: definition.mode ?? "text" }), _id: `preset-${definition.id}`, createdAt: new Date(), updatedAt: new Date() };
    await db.collection<BehaviorRule>("behavior_rules").updateOne({ _id: rule._id }, { $setOnInsert: rule }, { upsert: true });
  }
  return definitions.length;
}
