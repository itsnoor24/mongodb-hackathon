# Phase 1 environment handoff

Scope: initialize the existing replay console with Atlas and GitHub. Observer ingestion and LLM parsing are deferred. Pause behavior is outside this acceptance pass.

## Working environment

- Atlas organization: Claudia's Org - 2026-11-14.
- Project: Sentinel (`6af89b7c229d0de641bc8e4a`); free cluster: `sentinel`; database: `sentinel`.
- Database user: `sentinel-app`, scoped to this cluster with `readWrite` and `dbAdmin` on `sentinel`.
- Collections: `agents`, `policies`, `runs`, `audit_events`, `demo_records`.
- GitHub target: `itsnoor24/mongodb-hackathon`. The owner explicitly approved this PUBLIC repository for synthetic demo issues; local `GITHUB_REQUIRE_PRIVATE=false` records that choice.
- Local secrets are in ignored `api/.env`; browser reviewer key is in ignored `web/.env`. Secrets are not included in this handoff or pushed to GitHub.
- Atlas network access permits the current development computer's public IP. Teammates must add their own IP in Atlas; database permissions alone do not grant network access.

## Person 2: start the console

1. Use Node.js 22+ and run `npm ci` from the repo root.
2. Copy `api/.env.example` to `api/.env` and `web/.env.example` to `web/.env`. Obtain credentials through the team's secret-sharing channel. Set `MONGODB_URI`, `GITHUB_TOKEN`, `GITHUB_DEMO_OWNER`, `GITHUB_ALLOWED_OWNER`, and `GITHUB_DEMO_REPO`. The repo value is the name alone, not owner/name. The token needs repository access and Issues read/write.
3. If using the approved public demo repo, explicitly set `GITHUB_REQUIRE_PRIVATE=false`. For a private repo leave the default `true`.
4. Match `SENTINEL_REVIEWER_KEY` in `api/.env` with `VITE_REVIEWER_KEY` in `web/.env`.
5. Run `npm run seed`, then `npm run verify-atlas`.
6. Run `npm run dev`. Open http://localhost:5173; API health is http://localhost:3001/api/health.
7. Click **Re-run demo (replay)**. Each click resets the demo run's audit history and creates one real synthetic issue. Restart the API after editing its environment file.

On the original development computer, Node is available temporarily with this PowerShell command:

```powershell
$env:Path = "$env:TEMP\sentinel-node-fast\node-v24.11.1-win-x64;$env:Path"
npm.cmd run dev
```

## Person 3: acceptance checks

| Task | Check | Result on the configured environment |
| --- | --- | --- |
| A1 | `npm run seed` creates validators, indexes, and seed documents | Passed |
| A1 | `npm run verify-atlas` checks ping, policy BSON Int32 fields, allow/deny rules, invalid-event rejection, optional audit fields, and change streams | Passed |
| A2 | Real GitHub issue creation and read-back, with positive integer `payload.issueNumber` in Atlas | Passed: [synthetic issue #2](https://github.com/itsnoor24/mongodb-hackathon/issues/2) |
| A3 | Replay endpoint succeeds; persisted events rebuild read, denied-target, and configured-target tree branches with GitHub issue number | Passed through the same endpoint and tree projection used by the UI |

Run `npm run verify-demo` while the API is running for the complete acceptance check. It creates one additional synthetic issue and verifies the saved Atlas completion event. To inspect the latest replay without creating another issue, use `npm run verify-demo -w api -- --existing`.

In the browser, confirm the configured-target card shows the issue number, the disallowed target shows **Never dispatched**, and refresh reconstructs the run. Browser visual acceptance should be completed by Person 3; the automated checks exercise the replay endpoint and tree projection.

Fixes included: explicit BSON Int32 seed fields; omitted undefined optional audit fields; removed redundant invalid `_id` index declaration; initialized change-stream cursor before the verification write; exact repository allow rule precedes the wildcard deny rule; escaped and anchored wildcard matching; workspace environment loading; visible replay errors and no false verified label after a failed write.

The current card text still calls the configured branch “private issue” even when using the explicitly approved public demo target. Its actual destination is controlled by the environment and the allow policy. Person 2 can update presentation separately.
