# Live behavior monitors

Behavior monitors are saved searches over observed activity nodes. They can identify a single signal such as a file-not-found failure or an ordered sequence such as failure, retry, then recovery. Matches retain the contributing node IDs, labels, exact evidence quotes, and source observation times so they can be inspected in the activity diagram.

## Use the UI

1. Open an observer stream and enter the reviewer access key in the search panel. The same in-memory key authorizes monitor management; it is not stored with a monitor.
2. Expand **Behavior monitors → Create a monitor**.
3. Choose a preset or write your own steps. Each step has a query and an optional node-status constraint.
4. Select phrase/status matching or semantic matching. Add more steps for an ordered sequence and set a time window.
5. Choose **All streams, including new ones** to reuse the monitor in future demos, or restrict it to the selected stream.
6. Save the monitor. The **Live behavior matches** feed updates every two seconds. Select a contributing node to reveal its activity box and source inspector.

Saved monitors run on the API server, even when the browser is closed. They stop when the API process stops and resume from saved definitions when it restarts. You can disable, enable, delete, or recheck a monitor from the UI. Deleting a definition retains its historical match records.

## Matching modes

### Phrase/status signals

The worker checks node changes about once a second. Terms are literal, case-insensitive substrings of the node's short label or source evidence. Use `|` for alternatives. No regular expression or source code is executed.

For example, use `ENOENT | file not found | no such file` and require status **Failed**. A completed node quoting a missing-file error does not satisfy that status constraint. Summaries are excluded from phrase matching so “recovered after a retry” does not itself become another retry event.

These checks do not wait for an embedding or make model requests. Detection typically takes one worker polling cycle after a node is committed, plus the UI polling interval. They detect evidence in emitted nodes, not raw text that has not yet been parsed.

### Semantic candidates

Describe a behavior in natural language, such as “Reading a file fails because the file does not exist.” Atlas Vector Search returns candidate nodes, and the monitor applies the configured similarity threshold and status filters.

Semantic checks share one server-side query queue, spaced at least 22 seconds apart by default. Every step consumes a query slot. They wait for asynchronously generated embeddings and are not immediate or exhaustive. Manual UI searches share the deployment's model quotas. More monitors and more steps increase the time to a semantic match.

Results are cached by node-content fingerprint; changed node text queues another check. Unchanged input gets up to three settling passes to allow for indexing lag, then stays quiet until the input changes or **Recheck** is selected. Cached scores are discarded for a node whose text changes. Similarity is a retrieval score, not the probability that a behavior actually happened.

`BEHAVIOR_SEMANTIC_INTERVAL_MS` controls queue spacing (default `22000`). Only reduce it if the deployment's query quota supports the higher rate. Failed checks remain visible and can be requeued. See [embedding setup and quotas](node-embeddings.md).

## Ordered sequences

Each step must match a distinct node in the same stream. Source evidence must end at a strictly increasing raw-text sequence number. Nodes whose evidence ends in the same raw frame cannot establish a reliable order and do not satisfy consecutive steps. Source chunk timestamps define the window; node snapshots' update timestamps are a fallback when the original chunk is unavailable.

The default window is five minutes. Matching requires chronological order within that window; it does not prove causation or require an ancestor/descendant relationship. A sequence such as failure → retry is reported once for a given set of node IDs, even as the worker polls again. A new incident represented by new IDs can generate a new match. Repeated events overwritten into one node ID cannot establish a multi-node sequence.

## Demo

```sh
npm run demo:behaviors
```

This prepares four reusable phrase/status monitors without overwriting existing settings: file not found, missing file then retry, permission denied, and failure then recovery. It creates a labeled synthetic stream and emits a mock missing-file error, a retry, and a successful lookup over several seconds. No actual filesystem failure or external tool execution occurs. The normal live parser replay writes the nodes and embedding inputs while text is arriving; the independent behavior worker detects the signals.

The development acceptance run detected all three applicable signals and also verified one stream-scoped semantic missing-file rule through Atlas Vector Search.

## Storage and limits

- `behavior_rules`: saved definitions and enable/disable state.
- `behavior_checks`: cached semantic step results, fingerprints, retry state, and errors.
- `behavior_matches`: deduplicated match history with node evidence snapshots.

The prototype supports up to 100 saved rules and five steps per rule. It evaluates the latest 1,000 node snapshots, requests the top 100 semantic candidates per step, and reports up to 20 latest chains per rule per pass. The UI displays the latest 50 match records for the selected stream. Enabling a monitor also evaluates recent existing nodes, so initial matches may refer to activity that preceded monitor creation.

## API and tests

All monitor endpoints require a reviewer or agent Bearer credential:

- `GET /api/behaviors?streamId=...`: applicable rules, semantic-check state, and worker health.
- `POST /api/behaviors`: save `{name, mode, steps, threshold, withinSeconds, enabled, streamId?}`. Omit `streamId` for all streams.
- `PATCH /api/behaviors/:id`: change `{enabled}`.
- `POST /api/behaviors/:id/recheck`: clear semantic check caches and queue fresh checks.
- `DELETE /api/behaviors/:id`: remove a monitor.
- `GET /api/behaviors/matches?streamId=...`: read the match feed.

`npm run test:streams` includes behavior validation, false-positive controls, ordered/windowed sequences, stream isolation, stale semantic-cache rejection, authentication, and deduplication checks. Set `STREAM_TEST_ATLAS=1` for the live persistence checks.
