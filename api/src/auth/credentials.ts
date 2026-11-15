import { createHash, timingSafeEqual } from "crypto";
import { Request } from "express";
import { config } from "../config.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function getBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7);
}

export function assertAgentAuth(req: Request): void {
  const key = getBearer(req);
  if (!key || !safeEqual(hashApiKey(key), hashApiKey(config.agentApiKey))) {
    throw new AuthError("Invalid agent credential");
  }
}

export function assertReviewerAuth(req: Request): void {
  const key = getBearer(req);
  if (!key || !safeEqual(hashApiKey(key), hashApiKey(config.reviewerApiKey))) {
    throw new AuthError("Invalid reviewer credential");
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Read-only search accepts reviewer or agent credentials; ingestion remains agent-only. */
export function assertSearchAuth(req: Request): void {
  const key = getBearer(req);
  const digest = hashApiKey(key ?? "");
  const agent = safeEqual(digest, hashApiKey(config.agentApiKey));
  const reviewer = safeEqual(digest, hashApiKey(config.reviewerApiKey));
  if (!key || !(agent || reviewer)) throw new AuthError("Invalid search credential");
}
