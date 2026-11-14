import { useEffect, useRef, useState, type FormEvent } from "react";

interface SearchResult { id: string; label: string; summary: string; score: number }

export function NodeSearch({ streamId, onReveal }: { streamId: string; onReveal: (id: string) => void }) {
  const [query, setQuery] = useState("");
  // Supplied by the user; never bundled, logged, or persisted to browser storage.
  const [accessKey, setAccessKey] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    request.current?.abort(); request.current = null;
    setQuery(""); setSubmittedQuery(""); setResults(null); setError(null); setLoading(false);
    return () => { const previous = request.current; request.current = null; previous?.abort(); };
  }, [streamId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text || !streamId || !accessKey) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null); setResults(null); setSubmittedQuery(text);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 35000);
    try {
      const parameters = new URLSearchParams({ q: text, limit: "5" });
      const response = await fetch(`/api/streams/${encodeURIComponent(streamId)}/search?${parameters}`, {
        headers: { Authorization: `Bearer ${accessKey}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? "The access key was not accepted."
        : response.status === 429 ? "Search is busy. Please wait a moment and try again."
        : "Vector search is temporarily unavailable. The index may still be updating; try again shortly.");
      const data = await response.json() as { nodes: SearchResult[] };
      if (!Array.isArray(data.nodes)) throw new Error("Search returned an unexpected response.");
      if (request.current === controller) setResults(data.nodes);
    } catch (error) {
      if (request.current !== controller || (controller.signal.aborted && !timedOut)) return;
      setError(timedOut ? "Search timed out. Please try again." : error instanceof Error ? error.message : "Search failed.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }

  function clear() {
    const previous = request.current; request.current = null; previous?.abort();
    setQuery(""); setSubmittedQuery(""); setResults(null); setError(null); setLoading(false);
    input.current?.focus();
  }

  return <section className="node-search" aria-labelledby="node-search-title">
    <h3 id="node-search-title">Search activity</h3>
    <p className="node-search__hint">Find related nodes by meaning in this stream.</p>
    <form onSubmit={event => void search(event)} aria-busy={loading}>
      <label className="node-search__label" htmlFor="node-search-key">Observer access key</label>
      <div className="node-search__controls">
        <input id="node-search-key" type="password" autoComplete="off" value={accessKey}
          onChange={event => setAccessKey(event.target.value)} placeholder="Enter your reviewer access key" maxLength={4096} required />
        {accessKey && <button className="btn btn--ghost" type="button" onClick={() => { clear(); setAccessKey(""); }}>Forget key</button>}
      </div>
      <p className="node-search__hint">Kept only in page memory. Use Forget key to clear it.</p>
      <label className="node-search__label" htmlFor="node-search-query">Describe what you’re looking for</label>
      <div className="node-search__controls">
        <input ref={input} id="node-search-query" type="search" value={query}
          onChange={event => setQuery(event.target.value)} maxLength={1000}
          placeholder="e.g. GitHub issue creation" disabled={!streamId} />
        <button className="btn node-search__submit" type="submit" disabled={!streamId || !query.trim() || !accessKey || loading}>{loading ? "Searching…" : "Search"}</button>
        {(query || results || error || loading) && <button className="btn btn--ghost" type="button" onClick={clear}>Clear</button>}
      </div>
    </form>
    {!streamId && <p className="node-search__hint">Select a stream to search its nodes.</p>}
    {loading && <p className="node-search__hint" role="status">Finding the closest nodes…</p>}
    {error && <p className="node-search__error" role="alert">{error}</p>}
    {results && <div className="node-search__results" aria-live="polite">
      <p className="node-search__result-count">{results.length} {results.length === 1 ? "result" : "results"} for “{submittedQuery}”</p>
      {results.length === 0 ? <p className="node-search__hint">No indexed nodes found in this stream. New nodes may still be indexing.</p>
        : <ol>{results.map(result => <li key={result.id}>
          <button type="button" className="node-search__result" onClick={() => onReveal(result.id)} aria-label={`Open node: ${result.label}`}>
            <span className="node-search__result-title">{result.label}</span>
            {Number.isFinite(result.score) && <small title="Semantic similarity, not a confidence or verification score">Similarity {result.score.toFixed(3)}</small>}
            <span className="node-search__result-summary">{result.summary}</span>
            <span className="node-search__open">Open node →</span>
          </button>
        </li>)}</ol>}
    </div>}
  </section>;
}
