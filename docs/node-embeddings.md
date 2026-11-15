# Parsed-node embeddings

Sentinel uses Atlas Automated Embedding with `voyage-4-lite`. No separate model API key or local embedding service is required for this Atlas-managed route. MongoDB hosts the Voyage model and generates vectors asynchronously when indexed text changes. See [Automated Embedding](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/) and [supported models and limits](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/).

## What is embedded

Every node written by local parsing, streaming output replay, or the parsed-demo loader includes:

```text
Label: <short node label>
Summary: <node summary>
Evidence: <exact source quote>
```

The combined text is stored as `embeddingText`, with a deterministic SHA-256 `embeddingTextHash`. Parser provenance and storage metadata are excluded, so updating them alone does not change the embedding input. Updating the label, summary, or evidence changes the input and Atlas regenerates its embedding.

The `stream_nodes_semantic` Vector Search index has an `autoEmbed` field on `embeddingText` and a filter field on `streamId`. Atlas stores generated vectors in its internal embedding collection; the source node contains the text and hash, not a manually populated vector array. Indexing is eventually consistent, so saving a node does not mean its vector is immediately queryable.

## Setup and backfill

```sh
npm run nodes:embed
```

This updates existing node inputs and creates the managed embedding index if needed. It verifies an existing index's model and filter definition instead of silently replacing it. Re-running the command is safe; unchanged inputs remain unchanged. New node writes already maintain the input fields automatically.

Optional `api/.env` configuration:

```dotenv
NODE_EMBEDDING_MODEL=voyage-4-lite
NODE_EMBEDDING_INDEX=stream_nodes_semantic
```

If changing the model, use a new index name or explicitly migrate the existing index. The setup command reports index status; wait for `READY` / `queryable: true` before testing retrieval. The index must be created once on each new deployment. Existing development deployments do not need to rerun setup for each demo replay.

## Semantic retrieval

```sh
npm run nodes:embed -- search STREAM_ID "GitHub issue creation and read-back verification"
```

This uses an Atlas-generated query embedding and pre-filters results to the specified stream. Results include node details and `vectorSearchScore`. The score measures semantic similarity, not truth or proof that an activity executed.

The corresponding API is `GET /api/streams/:id/search?q=...&limit=5`. Supply an agent or reviewer credential as a Bearer token; reviewer search access does not grant ingestion permissions. The route validates query size and result count before making a model-backed query. The normal observer reads do not generate query embeddings.

The observer UI includes **Search activity** for the selected stream. Enter the reviewer key from `SENTINEL_REVIEWER_KEY` in `api/.env`, type a natural-language query, and submit. The user-entered key stays in React page state, is sent only as the search Authorization header, and is not baked into the bundle or saved to browser storage. **Forget key** clears it. Searches run on explicit submission, not on each keystroke or polling tick. The results list shows the closest nodes and their similarity scores; choosing a result selects and reveals its activity box and source inspector in the diagram. Switching streams clears query results and cancels any pending search.

Free-cluster query limits can be low; refer to the linked model limits for the deployment's applicable quota. Embedding usage follows Atlas quotas and billing, including any remaining organization-level free token allocation.

## Validation performed

On the configured Sentinel cluster, the initial backfill prepared 50 nodes across the two saved conversation demos. The index reported READY and a vector search returned all 50 indexed nodes. A semantic search for GitHub issue creation ranked the issue #2 creation/read-back node first.

`npm run test:streams` covers deterministic input generation, changes to semantic fields, scoped query construction, and query validation. With `STREAM_TEST_ATLAS=1`, it also checks that parsed and replayed nodes persist their embedding input and refresh it when summaries change. These checks do not generate hosted query embeddings; the live semantic searches above were separate acceptance checks.
