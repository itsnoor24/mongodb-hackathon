# Sentinel

Sentinel turns a live agent log into a record of what the agent was doing. The raw transcript stays. Next to it, an activity tree shows each observed step, and behavior monitors flag sequences you care about while the run is still going.


## The problem

**AI agents are doing more. Understanding what they did is getting harder.**

- **Unstructured execution logs.** Plans, tool calls, errors, and status updates are buried in continuous streams of text.
- **No clear picture of agent activity.** It's difficult to reconstruct what happened, in what order, and where things went wrong.
- **Important patterns go unnoticed.** Failures, retries, and recoveries can be scattered across hundreds of log lines.

Agents generate logs. But logs don't tell the whole story.

## The solution

**From raw agent logs to observable behavior.**

1. **Capture.** Stream agent output into MongoDB Atlas in real time. Any agent's printed output is saved as it arrives, before it is summarized.
2. **Reconstruct.** Parse logs into an interactive activity tree, with source-linked evidence. Each step has a label, a status, and a quote copied from the transcript.
3. **Understand.** Generate searchable embeddings using Atlas Vector Search. Atlas embeds each step, so related activity can be found by meaning.
4. **Detect.** Monitor ordered behavior patterns and flag matches. A monitor can be one signal, such as a missing file, or a sequence, such as a failure followed by a retry and a recovery.

One transcript. Every observed step. Searchable and traceable.

## Stack

| | |
| --- | --- |
| Interface | React, TypeScript, Vite |
| API | Node.js, Express, TypeScript |
| Database | MongoDB Atlas |
| Search | Atlas Vector Search with Voyage embeddings (`voyage-4-lite`) |
| Optional parsing | A local Ollama model. The bundled demo does not need one. |

Requires Node.js 22 or newer.

## Run it

1. Copy `api/.env.example` to `api/.env` and set `MONGODB_URI`, `SENTINEL_AGENT_KEY`, and `SENTINEL_REVIEWER_KEY`.
2. `npm ci`
3. `npm run seed`
4. `npm run nodes:embed` once per Atlas cluster, then wait until the vector index is queryable.
5. `npm run dev`
6. Open [http://localhost:5173](http://localhost:5173), enter the reviewer key, and start the streaming demo.

API health check: [http://localhost:3001/api/health](http://localhost:3001/api/health).

To watch a real command instead of the demo:

```sh
your-agent-command | npm run consume-text
```

Other scripts: `npm run demo:pipeline` (the full recorded conversation), `npm run demo:behaviors` (a missing-file, retry, and recovery example), `npm run test:streams`.


