# Sentinel

The UI is a passive text-stream observer. See [text stream setup and API](docs/text-streams.md).

Parsed nodes support [Atlas-managed Voyage embeddings and semantic retrieval](docs/node-embeddings.md). Run `npm run nodes:embed` once to backfill existing node text and create the embedding index.

[Behavior monitors](docs/behavior-monitors.md) save phrase/status or semantic searches and identify ordered activity sequences as nodes arrive. Run `npm run demo:behaviors` for a missing-file → retry → recovery example.

The observer records agent output in **MongoDB Atlas** and displays inferred activity and behavior matches. The earlier Phase 1 gateway APIs are retained for the original audit prototype.

## Stack

| Layer | Path |
| --- | --- |
| UI (React + TS) | `web/` — stream observer |
| API (Node + TS) | `api/` — Express gateway, SSE, change streams |
| Data | Atlas collections: `agents`, `policies`, `runs`, `audit_events`, `demo_records` |
| Setup / seed | `api/scripts/setup-seed.ts`, `api/scripts/verify-atlas.ts` |

## Quick start

1. Copy `api/.env.example` to `api/.env` and configure the Atlas URI and server-side keys.
2. Install: `npm ci`
3. Atlas setup + fixtures: `npm run seed` (also creates collections, validators, and indexes)
4. Verify sandbox: `npm run verify-atlas`
5. Dev servers: `npm run dev` → UI [http://localhost:5173](http://localhost:5173), API `:3001`
6. Click **Start / restart streaming demo**, or run `npm run demo:pipeline` in another terminal. Enter the observer key when prompted in the UI.

## Environment

See `api/.env.example` and `web/.env.example` for:

- `MONGODB_URI`, `MONGODB_DB`
- `SENTINEL_AGENT_KEY`, `SENTINEL_REVIEWER_KEY`
- `GITHUB_TOKEN`, `GITHUB_DEMO_REPO`, `GITHUB_ALLOWED_OWNER`

The API reads `api/.env` first, with legacy root `.env` as a fallback. Never put Atlas credentials or GitHub tokens in `VITE_*` variables. Environment files are Git-ignored. The legacy GitHub integration requires an Issues read/write token and repository access.

Phase 1 acceptance and team handoff: [docs/phase-1-handoff.md](docs/phase-1-handoff.md).

## Legacy Phase 1 API surface

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

`sentinel-vertical-tree.html` is the visual reference for the earlier Phase 1 prototype.
