# Text stream observer

This branch observes an agent's emitted text. The console contains a raw transcript and a graph of model-inferred activity. It does not invoke the gateway, dispatch tools, or pause the source agent.

## Capture a command's output

For the complete input-to-output demo, run `npm run demo:pipeline`. It creates a fresh stream and replays exported conversation entries while a concurrent worker follows the committed Atlas input frames. A precomputed `conversation-parsed.json` node becomes eligible as soon as its evidence quote and its ancestors' evidence have arrived. Nodes are committed individually before input EOF, so the transcript and tree grow together. Open the printed URL to watch both. This is deterministic replay of assistant-authored output, not live LLM inference. The worker holds a parser lease, checks that the received text is an exact prefix of the fixture, retains committed nodes on failure, and reports an error if input ends early. All writes still maintain embedding input for Atlas Automated Embedding.

You can also enter the observer access key in the UI and select **Start / restart streaming demo**. Each start creates and opens a fresh stream. Restarting an active replay stops its producer and consumer first; the partial earlier stream remains available. The server launches only the bundled fixture runner and hides its Windows process window.

For a repeatable mock terminal demo, run `npm run demo:text` while the app is running. It prints a new observer URL, then pipes synthetic incident-triage output into the actual consumer, one line every 1.2 seconds. The mock does not execute tool calls or create GitHub issues.

Run `npm run demo:conversation` to replay every entry in `api/examples/conversation-output.json` through the same consumer. It emits message content and question options with role/ID headers in delayed text chunks, including the exported application-context entries. The JSON envelope and duplicated clarification transport wrappers are not repeated in the text. A new stream labeled **Full conversation replay** is created on each run.

`api/examples/conversation-parsed.json` contains an assistant-authored example parse of that input, matching the node schema. After replay finishes, run `npm run demo:parsed -- STREAM_ID` to validate every evidence quote against the saved transcript and load the nodes into the tree. This command does not invoke Ollama: it records `assistant-authored-demo` as the parser, keeps summaries marked as inferred, and links each quote to its raw chunk range. It refuses to load while an upload or parser is active. The source ends with the plan to export the whole conversation, so that task is correctly left in progress in the example output.

Start the app with `npm run dev`, then pipe UTF-8 stdout to the consumer from another terminal:

```sh
your-agent-command | npm run consume-text
```

For a quick PowerShell example:

```powershell
'Example transcript: planning a lookup, then drafting a response.' | npm.cmd run consume-text
```

The consumer creates a stream and prints its ID and observer URL to stderr. Pass the ID to append another upload to the same stream:

```sh
your-agent-command | npm run consume-text -- STREAM_ID
```

Only stdout is consumed. Redirect stderr into stdout if it is also part of the intended transcript. No particular chat format or agent SDK is required. The API saves raw frames as they arrive; it does not wait for the whole upload.

## Generic HTTP interface

Use `Authorization: Bearer <SENTINEL_AGENT_KEY>` for write requests. The key lives in `api/.env` and stays server-side in the consumer.

1. `POST /api/streams` with JSON `{ "label": "My agent" }` creates a stream and returns `stream._id`.
2. `POST /api/streams/:id/text` accepts a streaming UTF-8 `text/plain` body, including chunked transfer encoding. Successful EOF returns the number of persisted frames. Further uploads append to the same ID.
3. `GET /api/streams` lists the latest 20 streams.
4. `GET /api/streams/:id?after=0` returns stream metadata, parsed node snapshots, and up to 200 raw chunks in sequence order. Use `nextAfter` for the next page. The observer polls this endpoint every second.
5. `POST /api/streams/:id/parse` retries one pending parser batch without resubmitting text. Repeat until `parsedThrough` catches up to `sequence`.

One writer may upload to a given stream at a time; a concurrent writer receives HTTP 409. Upload leases expire after a disconnected worker stops renewing them. Each upload is limited to 1 MiB and 4096 frames; use another upload to append more. This first consumer sends one upload per invocation.

Writes have append semantics. Do not blindly retry an interrupted whole upload, since it can duplicate already saved text. Inspect saved chunks first. An aborted connection retains committed frames, but its incomplete buffered tail may be missing. Request EOF ends an upload, not the observed agent run.

## Optional local LLM parsing

Raw capture works without an LLM. To enable inference, start a local Ollama server with an installed model and configure:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<installed-model-name>
```

Restart the API after editing its environment. No model is downloaded automatically. The adapter uses Ollama's [chat endpoint](https://docs.ollama.com/api/chat) with a [structured-output schema](https://docs.ollama.com/capabilities/structured-outputs), temperature zero, no tools, and a 30-second request timeout. The URL must use a loopback host.

Parsing runs after roughly 2048 newly received characters and drains remaining batches at EOF. Each batch contains at most eight raw frames, plus existing node summaries for continuity. A slow local model applies backpressure to the upload. A parser failure is recorded on the stream and stops automatic parsing for that upload; raw capture continues. The retry endpoint processes saved text without uploading it again.

The model returns stable node IDs, parent IDs, labels, activity kinds, statuses, summaries, and exact evidence quotes. Runtime validation rejects unsupported statuses, missing evidence, duplicate IDs, unknown parents, and cycles before writing nodes. Nodes are marked `inferred: true`, include the model name and source sequence range, and are summaries of observed statements. A completion statement is not independent proof that a tool executed.

The initial parser context is limited to 100 known nodes; hitting that limit preserves raw text and records a parser error. Node snapshots are retryable upserts, not an immutable revision history. These limits make this an initial ingestion/parser interface rather than a long-running production worker.

## Atlas storage and checks

Parsed nodes now include embedding input maintained by all node-writing paths. Atlas generates their Voyage vectors automatically through the managed index. See [node embeddings setup and semantic queries](node-embeddings.md).

New collections are created lazily on first use, with indexes for ordered chunks and unique node IDs:

- `text_streams`: label, upload lease, sequence, parser checkpoint/status/error.
- `text_chunks`: original text frames with stream ID and sequence.
- `stream_nodes`: latest validated model-inferred nodes with raw-text provenance.

Existing Phase 1 runs and policies are not reseeded or modified by capture.

```sh
npm run test:streams
npm run build
```

Set `STREAM_TEST_ATLAS=1` to include the isolated Atlas integration test. In PowerShell:

```powershell
$env:STREAM_TEST_ATLAS = '1'
npm.cmd run test:streams
```

Tests cover UTF-8 boundaries, final-line flushing, byte limits, schema validation, evidence, parent cycles, the Ollama request contract, persistence before upload EOF, concurrent writers, and failed-parser recovery. The integration test uses a mock local model and deletes its own Atlas probe records. A real installed model must still be checked on the target machine.
