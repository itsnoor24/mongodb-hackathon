import { useEffect, useRef, useState } from "react";
import { ActivityDiagram, type ActivityNode } from "./ActivityDiagram";

import { BehaviorWatch } from "./BehaviorWatch";

interface Stream { _id: string; label: string; sequence: number; parsedThrough: number; receiving: boolean; parserStatus: string; parserError?: string; parsedBy?: string; parserMode?: "local" | "fixture" }
interface Chunk { _id: string; sequence: number; text: string }

export function StreamConsole() {
  const [streamId, setStreamId] = useState(new URLSearchParams(location.search).get("stream") ?? "");
  const [streams, setStreams] = useState<Stream[]>([]);
  const [stream, setStream] = useState<Stream | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [nodes, setNodes] = useState<ActivityNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const transcriptRef = useRef<HTMLPreElement>(null);
  const transcript = chunks.map(chunk => chunk.text).join("");

  useEffect(() => {
    const pane = transcriptRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    const pane = transcriptRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => { pane.scrollTop = pane.scrollHeight; });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const [focusRequest, setFocusRequest] = useState<{ id: string; requestId: number }>();
  const [observerKey, setObserverKey] = useState("");
  const [startingDemo, setStartingDemo] = useState(false);
  const [keyPrompt, setKeyPrompt] = useState<"demo" | "monitor" | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/streams");
        if (!response.ok) throw new Error("Cannot load stream list");
        const data = await response.json() as { streams: Stream[] };
        if (!stopped) setStreams(data.streams);
      } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : "Connection failed"); }
      finally { if (!stopped) timer = setTimeout(poll, 3000); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    setChunks([]); setNodes([]); setStream(null); setFocusRequest(undefined); cursor.current = 0;
    if (!streamId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/streams/${encodeURIComponent(streamId)}?after=${cursor.current}`, { signal: abort.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "Stream not found" : "Cannot load stream");
        const data = await response.json() as { stream: Stream; chunks: Chunk[]; nodes: ActivityNode[]; nextAfter: number };
        if (stopped) return;
        cursor.current = data.nextAfter;
        setStream(data.stream); setNodes(data.nodes); setError(null);
        setChunks(previous => {
          const byId = new Map(previous.map(chunk => [chunk._id, chunk]));
          for (const chunk of data.chunks) byId.set(chunk._id, chunk);
          return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
        });
      } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : "Connection failed"); }
      finally { if (!stopped) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [streamId]);

  function selectStream(id: string) {
    setFocusRequest(undefined);
    setStreamId(id);
    const url = new URL(location.href); url.searchParams.set("stream", id);
    history.replaceState(null, "", url);
  }
  async function startDemo() {
    if (!observerKey) { setKeyPrompt("demo"); return; }
    setStartingDemo(true); setDemoError(null);
    try {
      const response = await fetch("/api/streams/demo/start", { method: "POST", headers: { Authorization: `Bearer ${observerKey}` } });
      const data = await response.json() as { stream?: Stream; error?: string };
      if (!response.ok || !data.stream) throw new Error(data.error ?? "Could not start demo");
      setKeyPrompt(null);
      setStreams(previous => [data.stream!, ...previous.filter(item => item._id !== data.stream!._id)]);
      selectStream(data.stream._id);
    } catch (error) { setDemoError(error instanceof Error ? error.message : "Could not start demo"); }
    finally { setStartingDemo(false); }
  }
  return <div className="sentinel-app">
    <header className="top-bar"><span className="top-bar__title">Sentinel / Stream observer</span></header>
    <section className="run-hero"><div>
      <p className="run-hero__kicker">OBSERVE AGENT OUTPUT</p>
      <h1 className="run-hero__heading">{stream?.label ?? "Waiting for a text stream"}</h1>
      <button type="button" className="btn btn--ghost" disabled={startingDemo} onClick={() => void startDemo()}>{startingDemo ? "Starting…" : "Start / restart streaming demo"}</button>
      {keyPrompt && <form className="demo-key-form" onSubmit={event => { event.preventDefault(); if (keyPrompt === "demo") void startDemo(); else setKeyPrompt(null); }}>
        <label htmlFor="demo-observer-key">Observer access key</label>
        <div className="demo-key-form__controls">
          <input id="demo-observer-key" type="password" autoComplete="off" autoFocus value={observerKey} onChange={event => setObserverKey(event.target.value)} placeholder="Enter your reviewer access key" maxLength={4096} required />
          <button className="btn btn--ghost" type="submit" disabled={startingDemo}>{keyPrompt === "demo" ? "Start demo" : "Use key"}</button>
          <button className="btn btn--ghost" type="button" onClick={() => setKeyPrompt(null)}>Cancel</button>
        </div>
        <p className="stream-disclaimer">Use SENTINEL_REVIEWER_KEY from api/.env. The key stays in page memory.</p>
      </form>}
      <p className="run-hero__sub">{stream ? `${stream.sequence} raw chunks · ${stream.parsedThrough} parsed · ${stream.receiving ? "Receiving" : "Waiting for input"}` : "Pipe a command’s output into the text consumer to begin."}</p>
      {stream?.parsedBy && <p className="stream-disclaimer">Parser: {stream.parsedBy}</p>}
      {stream?.parserStatus === "parsing" && <p className="stream-disclaimer" role="status">Receiving parsed output · {nodes.length} nodes saved</p>}
    </div><label className="stream-picker">Stream<select value={streamId} onChange={event => selectStream(event.target.value)}>
      <option value="">Select a stream</option>
      {streamId && !streams.some(s => s._id === streamId) && <option value={streamId}>{streamId}</option>}
      {streams.map(s => <option key={s._id} value={s._id}>{s.label} · {s._id.slice(0, 8)}</option>)}
    </select></label></section>
    {error && <p className="banner banner--error" role="alert">{error}</p>}
    {demoError && <p className="banner banner--error" role="alert">{demoError}</p>}
    {stream?.parserStatus === "failed" && <p className="banner banner--error" role="alert">Parsing failed: {stream.parserError}. Raw text is saved; retry parsing through the API.</p>}
    {stream?.parserStatus === "disabled" && <p className="banner banner--info">{stream.parserMode === "fixture" ? "Demo replay: loading input before parsed output arrives." : "Raw capture active. Set OLLAMA_MODEL in api/.env to enable local parsing."}</p>}
    <main className="stream-layout">
      <section className="stream-pane"><h2 className="pane-label">Raw transcript</h2>
        <p className="stream-disclaimer" id="transcript-help">Following live output — 8 lines tall by default. Drag the bottom-right corner down to show more history.</p>
        <pre ref={transcriptRef} className="stream-transcript" tabIndex={0} role="region" aria-label="Live raw transcript" aria-describedby="transcript-help">{transcript || "No text received yet."}</pre>
      </section>
      <section className="stream-pane"><h2 className="pane-label">Observed activity</h2>
        <p className="stream-disclaimer">Model-inferred summaries from agent output.</p>
        <BehaviorWatch streamId={streamId} accessKey={observerKey} onRequestKey={() => setKeyPrompt("monitor")} onReveal={id => setFocusRequest(previous => ({ id, requestId: (previous?.requestId ?? 0) + 1 }))} />
        {nodes.length ? <ActivityDiagram key={streamId} nodes={nodes} focusRequest={focusRequest} /> : <p>No parsed nodes yet.</p>}
      </section>
    </main>
  </div>;
}
