import { useEffect, useState, type FormEvent } from "react";

interface Step { query: string; status?: string }
interface Rule { _id: string; name: string; mode: "text" | "semantic"; steps: Step[]; enabled: boolean; streamId?: string; threshold: number; withinSeconds: number }
interface Match { _id: string; name: string; mode: string; detectedAt: string; nodes: { id: string; label: string; evidence: string; score: number }[] }
interface Check { behaviorId: string; step: number; checkedAt: string; error?: string }

const presets: { name: string; mode?: "text" | "semantic"; steps: Step[] }[] = [
  { name: "File not found", steps: [{ query: "ENOENT | file not found | no such file", status: "failed" }] },
  { name: "Missing file then retry", steps: [{ query: "ENOENT | file not found | no such file", status: "failed" }, { query: "retry | trying again | reattempt", status: "in_progress" }] },
  { name: "Permission denied", steps: [{ query: "EACCES | EPERM | permission denied | not authorized", status: "failed" }] },
  { name: "Failure then recovery", steps: [{ query: "failed | error | unsupported | denied", status: "failed" }, { query: "succeeded | passed | recovered | resolved | success", status: "completed" }] },
  { name: "Failure then recovery (semantic)", mode: "semantic", steps: [{ query: "An operation fails or encounters an error", status: "failed" }, { query: "The operation recovers from the failure and succeeds", status: "completed" }] },
];

export function BehaviorWatch({ streamId, accessKey, onRequestKey, onReveal }: { streamId: string; accessKey: string; onRequestKey: () => void; onReveal: (id: string) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [worker, setWorker] = useState<{ running: boolean; lastTickAt?: string; error?: string }>({ running: false });
  const [name, setName] = useState(presets[0].name);
  const [steps, setSteps] = useState<Step[]>(presets[0].steps);
  const [mode, setMode] = useState<"text" | "semantic">("text");
  const [scope, setScope] = useState("all");
  const [minutes, setMinutes] = useState(5);
  const [threshold, setThreshold] = useState(0.78);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setRules([]); setMatches([]); setChecks([]); setError(null);
    if (!accessKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const suffix = streamId ? `?streamId=${encodeURIComponent(streamId)}` : "";
        const options = { headers: { Authorization: `Bearer ${accessKey}` }, signal: abort.signal };
        const [rulesResponse, matchesResponse] = await Promise.all([
          fetch(`/api/behaviors${suffix}`, options),
          streamId ? fetch(`/api/behaviors/matches${suffix}`, options) : Promise.resolve(null),
        ]);
        if (!rulesResponse.ok || (matchesResponse && !matchesResponse.ok)) throw new Error("Cannot load monitors. Check the observer access key.");
        const data = await rulesResponse.json();
        const feed = matchesResponse ? await matchesResponse.json() : { matches: [] };
        if (!stopped) { setRules(data.rules); setChecks(data.checks); setWorker(data.worker); setMatches(feed.matches); setError(null); }
      } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : "Monitor connection failed"); }
      finally { if (!stopped) timer = setTimeout(poll, 2000); }
    }
    timer = setTimeout(() => { void poll(); }, 600);
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [streamId, accessKey, refresh]);

  async function mutate(path: string, method: string, body?: unknown) {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/behaviors${path}`, { method, headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Cannot update monitor");
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Monitor update failed"); }
    finally { setSaving(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void mutate("", "POST", { name, mode, steps, threshold, withinSeconds: minutes * 60, enabled: true, ...(scope === "stream" ? { streamId } : {}) });
  }

  return <section className="behavior-watch" aria-labelledby="behavior-title">
    <div className="behavior-watch__heading"><h3 id="behavior-title">Behavior monitors</h3><small>{accessKey && worker.running ? "Watching node updates" : "Observer access key required"}</small></div>
    <button type="button" className="btn btn--ghost" onClick={onRequestKey}>{accessKey ? "Change observer access key" : "Enter observer access key"}</button>
    <p className="node-search__hint">Save a signal or an ordered sequence. Matches show the observed evidence, not proof that an action occurred.</p>
    <details className="behavior-watch__editor"><summary>Create a monitor</summary>
      <div className="behavior-watch__presets">{presets.map(preset => <button type="button" className="btn btn--ghost" key={preset.name} onClick={() => { setName(preset.name); setSteps(preset.steps); setMode(preset.mode ?? "text"); }}>{preset.name}</button>)}</div>
      <form onSubmit={save}>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></label>
        <div className="behavior-watch__row">
          <label>Match by<select value={mode} onChange={event => setMode(event.target.value as "text" | "semantic")}><option value="text">Phrases + status (fast)</option><option value="semantic">Meaning (vector search)</option></select></label>
          <label>Scope<select value={scope} onChange={event => setScope(event.target.value)}><option value="all">All streams, including new ones</option><option value="stream" disabled={!streamId}>This stream</option></select></label>
        </div>
        {steps.map((step, index) => <fieldset key={index}><legend>Step {index + 1}</legend>
          <label>{mode === "text" ? "Phrases; separate alternatives with |" : "Describe the behavior"}<input value={step.query} onChange={event => setSteps(previous => previous.map((value, at) => at === index ? { ...value, query: event.target.value } : value))} maxLength={500} required /></label>
          <div className="behavior-watch__row"><label>Node status<select value={step.status ?? ""} onChange={event => setSteps(previous => previous.map((value, at) => at === index ? { query: value.query, ...(event.target.value ? { status: event.target.value } : {}) } : value))}>
            <option value="">Any status</option><option value="failed">Failed</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="unknown">Unknown</option>
          </select></label>{steps.length > 1 && <button type="button" className="btn btn--ghost" onClick={() => setSteps(previous => previous.filter((_, at) => at !== index))}>Remove step</button>}</div>
        </fieldset>)}
        {steps.length < 5 && <button type="button" className="btn btn--ghost" onClick={() => setSteps(previous => [...previous, { query: "" }])}>Add next step</button>}
        <div className="behavior-watch__row">
          {steps.length > 1 && <label>Within minutes<input type="number" min={1} max={1440} value={minutes} onChange={event => setMinutes(Number(event.target.value))} required /></label>}
          {mode === "semantic" && <label>Minimum similarity<input type="number" min={0} max={1} step={0.01} value={threshold} onChange={event => setThreshold(Number(event.target.value))} required /></label>}
        </div>
        <p className="node-search__hint">{mode === "text" ? "Checks labels and exact source quotes on new and changed nodes about once per second." : "Semantic checks wait for indexing and share a paced query queue. They are not instant; similarity is not confidence."}</p>
        <button type="submit" className="btn" disabled={!accessKey || saving || (scope === "stream" && !streamId)}>{saving ? "Saving…" : "Save and monitor"}</button>
      </form>
    </details>
    {error && <p role="alert" className="node-search__error">{error}</p>}
    {worker.error && accessKey && <p role="status" className="node-search__error">Monitor delayed: {worker.error}</p>}
    <ul className="behavior-watch__rules">{rules.map(rule => <li key={rule._id}><details><summary>{rule.name} <small>{rule.enabled ? "On" : "Off"} · {rule.mode === "text" ? "Phrase" : "Semantic"} · {rule.streamId ? "This stream" : "All streams"}</small></summary>
      <ol>{rule.steps.map((step, index) => <li key={index}>{step.query}{step.status ? ` · ${step.status}` : ""}</li>)}</ol>
      {rule.mode === "semantic" && <p className="node-search__hint">{checks.filter(check => check.behaviorId === rule._id).length}/{rule.steps.length} steps checked. {checks.some(check => check.behaviorId === rule._id && check.error) ? "A semantic check failed; retry after the index or query quota recovers." : "New or changed node text triggers another queued evaluation."}</p>}
      <div className="behavior-watch__row"><button type="button" className="btn btn--ghost" disabled={saving} onClick={() => void mutate(`/${rule._id}`, "PATCH", { enabled: !rule.enabled })}>{rule.enabled ? "Disable" : "Enable"}</button>
        {rule.mode === "semantic" && <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => void mutate(`/${rule._id}/recheck`, "POST")}>Recheck</button>}
        <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => void mutate(`/${rule._id}`, "DELETE")}>Delete</button></div>
    </details></li>)}</ul>
    <h4>Live behavior matches</h4>
    {!streamId ? <p className="node-search__hint">Select a stream to inspect its matches.</p> : matches.length === 0 ? <p className="node-search__hint">No behavior matches detected in this stream yet.</p>
      : <ol className="behavior-watch__matches">{matches.map(match => <li key={match._id}>
        <strong>{match.name}</strong><small>{new Date(match.detectedAt).toLocaleTimeString()} · {match.mode === "text" ? "Phrase/status match" : "Semantic candidate"}</small>
        <div className="behavior-watch__chain">{match.nodes.map((node, index) => <button type="button" key={node.id} onClick={() => onReveal(node.id)}>{index + 1}. {node.label}{match.mode === "semantic" ? ` (${node.score.toFixed(3)})` : ""}</button>)}</div>
        <details><summary>Matched evidence</summary>{match.nodes.map(node => <blockquote key={node.id}>{node.evidence}</blockquote>)}</details>
      </li>)}</ol>}
  </section>;
}
