# Sentinel

On the `steffen/text-stream-local-llm` branch, the default UI is the passive text-stream observer. See [text stream setup and API](docs/text-streams.md). The Phase 1 replay console is available at `/?mode=replay`.

Parsed nodes support [Atlas-managed Voyage embeddings and semantic retrieval](docs/node-embeddings.md). Run `npm run nodes:embed` once to backfill existing node text and create the embedding index.

Use-case-agnostic **agent audit console** for the MongoDB hackathon track **Agents You Can Audit**. Agents propose tool calls; Sentinel authenticates the agent, evaluates policy before dispatch, persists evidence in **MongoDB Atlas**, and lets a reviewer pause a run and inspect the decision tree.

## Stack

| Layer | Path |
| --- | --- |
| UI (React + TS) | `web/` — layout from `sentinel-vertical-tree.html` |
| API (Node + TS) | `api/` — Express gateway, SSE, change streams |
| Data | Atlas collections: `agents`, `policies`, `runs`, `audit_events`, `demo_records` |
| Setup / seed | `api/scripts/setup-seed.ts`, `api/scripts/verify-atlas.ts` |

## Quick start

1. Copy `api/.env.example` to `api/.env` and `web/.env.example` to `web/.env`. Fill Atlas URI, GitHub demo owner/repo, and server-side token in `api/.env`. Match the reviewer key in both files.
2. Install: `npm ci`
3. Atlas setup + fixtures: `npm run seed` (also creates collections, validators, and indexes)
4. Verify sandbox: `npm run verify-atlas`
5. Dev servers: `npm run dev` → UI [http://localhost:5173](http://localhost:5173), API `:3001`
6. Click **Re-run demo (replay)**, or run `npm run verify-demo` in another terminal. Each replay creates one real synthetic GitHub issue in the configured repo.

## Environment

See `api/.env.example` and `web/.env.example` for:

- `MONGODB_URI`, `MONGODB_DB`
- `SENTINEL_AGENT_KEY`, `SENTINEL_REVIEWER_KEY`
- `GITHUB_TOKEN`, `GITHUB_DEMO_REPO`, `GITHUB_ALLOWED_OWNER`
- `VITE_REVIEWER_KEY` (browser pause button)

The API reads `api/.env` first, with legacy root `.env` as a fallback. Vite reads `web/.env`; never put Atlas credentials or GitHub tokens in `VITE_*` variables. Environment files are Git-ignored. The GitHub token needs Issues read/write and repository access. Private repositories are required by default; `GITHUB_REQUIRE_PRIVATE=false` explicitly permits synthetic demos in a public repository.

Phase 1 acceptance and team handoff: [docs/phase-1-handoff.md](docs/phase-1-handoff.md).

## Demo walkthrough

1. **Replay run** — Header shows **Replay mode**. Tree loads: Atlas read (allowed → verified), public GitHub write (denied → never dispatched), private repo write (allowed → verified after read-back).
2. **Policy denial** — Red callout links to the denied node; inspector shows rule, redacted input, and **Never dispatched** (GitHub adapter not called for the public target).
3. **Pause** — **Pause run** (reviewer bearer token) writes `run.paused` + `reviewer.intervention` to `audit_events`.
4. **Queued write** — **Attempt queued write** hits the real gateway; while paused, dispatch is blocked with reason `run_paused`.
5. **Live updates** — `audit_events` change stream → SSE (`/api/events/stream`); refresh rebuilds the same run from Atlas (dedupe by event `_id`).

## API surface

- `GET /api/runs/demo` — current demo run + events
- `GET /api/events/stream?runId=` — SSE audit feed
- `POST /api/runs/:id/pause` — reviewer auth
- `POST /api/gateway/invoke` — agent tool proposal through gateway
- `POST /api/gateway/queued-write/:runId` — console queued write
- `POST /api/gateway/demo/start` — deterministic replay through gateway

## Implementation map

```
api/src/db/schemas.ts      # $jsonSchema validators
api/scripts/setup-seed.ts  # collections, indexes, seed
api/src/gateway/gateway.ts # authz → log → dispatch boundary
api/src/gateway/policy.ts  # rule matching, redaction
api/src/tools/*.ts         # Atlas read, GitHub issue + verify
api/src/agent/replay.ts    # deterministic proposals
api/src/sse/audit-stream.ts
web/src/App.tsx            # console shell
web/src/styles/sentinel.css
```

## Atlas verification

`npm run verify-atlas` checks connect, validator rejection, insert, and change stream. If you see **not authorized**, the sandbox may block `collMod`, change streams, or `createCollection` — note that in your hackathon submission.

## Note on prototype file

`sentinel-vertical-tree.html` is the visual reference (shared CSS with the React app). The live console replaces hard-coded states with API + SSE data.
