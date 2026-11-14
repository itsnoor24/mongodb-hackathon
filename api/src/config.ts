import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve from the module so source, compiled API, and npm workspaces agree.
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
// Retain root .env compatibility; api/.env takes precedence.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional("PORT", "3001")),
  mongoUri: optional("MONGODB_URI", ""),
  dbName: optional("MONGODB_DB", "sentinel"),
  agentApiKey: optional("SENTINEL_AGENT_KEY", "demo-agent-key-change-me"),
  reviewerApiKey: optional("SENTINEL_REVIEWER_KEY", "demo-reviewer-key-change-me"),
  githubToken: optional("GITHUB_TOKEN", ""),
  githubOwner: optional("GITHUB_DEMO_OWNER", ""),
  githubRepo: optional("GITHUB_DEMO_REPO", ""),
  githubAllowedOwner: optional("GITHUB_ALLOWED_OWNER", ""),
  githubRequirePrivate: optional("GITHUB_REQUIRE_PRIVATE", "true") !== "false",
  modelProvider: optional("MODEL_PROVIDER", "deterministic"),
  openaiApiKey: optional("OPENAI_API_KEY", ""),
  openaiModel: optional("OPENAI_MODEL", "gpt-4o-mini"),
  demoRunId: optional("DEMO_RUN_ID", "demo-run-001"),
  demoAgentId: optional("DEMO_AGENT_ID", "demo-agent-001"),
  ollamaUrl: optional("OLLAMA_URL", "http://127.0.0.1:11434"),
  ollamaModel: optional("OLLAMA_MODEL", ""),
  nodeEmbeddingModel: optional("NODE_EMBEDDING_MODEL", "voyage-4-lite"),
  nodeEmbeddingIndex: optional("NODE_EMBEDDING_INDEX", "stream_nodes_semantic"),
  behaviorSemanticIntervalMs: Math.min(600000, Math.max(1000, Number(optional("BEHAVIOR_SEMANTIC_INTERVAL_MS", "22000")) || 22000)),
};

export function assertMongoConfigured(): void {
  if (!config.mongoUri) {
    throw new Error(
      "MONGODB_URI is not set. Add the Atlas connection string to api/.env",
    );
  }
}
