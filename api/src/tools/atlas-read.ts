import { Db } from "mongodb";
import { COLLECTIONS } from "../db/schemas.js";
import type { DemoRecordDoc } from "../types.js";

export async function atlasReadRecord(
  db: Db,
  recordId: string,
): Promise<DemoRecordDoc> {
  const doc = await db
    .collection<DemoRecordDoc>(COLLECTIONS.demo_records)
    .findOne({ _id: recordId });
  if (!doc) throw new Error(`Record not found: ${recordId}`);
  return doc;
}