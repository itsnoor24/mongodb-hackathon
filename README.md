# Sentinel

Use-case-agnostic **agent audit console** for the MongoDB hackathon track **Agents You Can Audit**. Agents propose tool calls; Sentinel authenticates the agent, evaluates policy before dispatch, persists evidence in **MongoDB Atlas**, and lets a reviewer pause a run and inspect the decision tree.

## Stack

| Layer | Path |
| --- | --- |
| UI (React + TS) | `web/` — layout from `sentinel-vertical-tree.html` |
| API (Node + TS) | `api/` — Express gateway, SSE, change streams |
| Data | Atlas collections: `agents`, `policies`, `runs`, `audit_events`, `demo_records` |
| Setup / seed | `api/scripts/setup-seed.ts`, `api/scripts/verify-atlas.ts` |

## Quick start

1. Copy env: `cp .env.example .env` and fill `MONGODB_URI`, GitHub private demo repo, and tokens.
2. Install: `npm install`
3. Atlas setup + fixtures: `npm run setup && npm run seed`
4. Verify sandbox: `npm run verify-atlas`
5. Start demo run (replay): `curl -X POST http://localhost:3001/api/gateway/demo/start`
6. Dev servers: `npm run dev` → UI [http://localhost:5173](http://localhost:5173), API `:3001`

## Environment

See `.env.example` for:

- `MONGODB_URI`, `MONGODB_DB`
- `SENTINEL_AGENT_KEY`, `SENTINEL_REVIEWER_KEY`
- `GITHUB_TOKEN`, `GITHUB_DEMO_REPO`, `GITHUB_ALLOWED_OWNER`
- `VITE_REVIEWER_KEY` (browser pause button)

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