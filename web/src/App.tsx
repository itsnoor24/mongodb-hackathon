import { useMemo, useState } from "react";
import { Inspector } from "./components/Inspector";
import { PolicyCallout } from "./components/PolicyCallout";
import { RunHeader } from "./components/RunHeader";
import { VerticalAuditTree } from "./components/VerticalAuditTree";
import { useRunData } from "./hooks/useRunData";
import { buildPrototypeFlow } from "./lib/buildPrototypeFlow";
import { buildInspector } from "./lib/inspector";
import { findDenialActionId } from "./lib/buildTree";

const DEMO_RUN_ID = "demo-run-001";
const REVIEWER_KEY = import.meta.env.VITE_REVIEWER_KEY ?? "demo-reviewer-key-change-me";

export default function App() {
  const { run, events, loading, error, reload, setRun } =
    useRunData(DEMO_RUN_ID);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flow = useMemo(() => buildPrototypeFlow(events), [events]);
  const denialId =
    flow.denialActionId ?? findDenialActionId(events);
  const effectiveSelection = selectedActionId ?? denialId;

  const inspector = useMemo(
    () => buildInspector(run, events, effectiveSelection),
    [run, events, effectiveSelection],
  );

  async function pauseRun() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/runs/${DEMO_RUN_ID}/pause`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEWER_KEY}`,
          "X-Reviewer-Id": "demo-reviewer",
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { run: typeof run };
      setRun(data.run);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Pause failed");
    } finally {
      setBusy(false);
    }
  }

  async function resumeRun() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/runs/${DEMO_RUN_ID}/resume`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEWER_KEY}`,
          "X-Reviewer-Id": "demo-reviewer",
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { run: typeof run };
      setRun(data.run);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setBusy(false);
    }
  }

  async function attemptQueuedWrite() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/gateway/queued-write/${DEMO_RUN_ID}`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const data = (await res.json()) as {
        detail?: string;
        blocked?: boolean;
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      setNotice(
        data.blocked
          ? `Blocked: ${data.detail ?? "Dispatch prevented"}`
          : data.detail ?? "Write processed",
      );
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Queued write failed");
    } finally {
      setBusy(false);
    }
  }

  async function startDemo(replay: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/gateway/demo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replay }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? (replay ? "Replay failed" : "Live agent failed"));
      }
      setSelectedActionId(null);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Demo failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sentinel-app">
      <RunHeader
        run={run}
        busy={busy}
        onPause={() => void pauseRun()}
        onResume={() => void resumeRun()}
      />

      {loading && <p className="banner banner--info">Loading run from Atlas…</p>}
      {error && <p className="banner banner--error">{error}</p>}
      {notice && <p className="banner banner--info">{notice}</p>}

      <main className="sentinel-canvas">
        <section className="canvas-pane canvas-pane--tree">
          <VerticalAuditTree
            flow={flow}
            selectedActionId={effectiveSelection}
            onSelect={setSelectedActionId}
            onQueuedWrite={() => void attemptQueuedWrite()}
            busy={busy}
          />

          <PolicyCallout
            title="Policy denial"
            message={flow.denialSubtitle}
            onJump={
              denialId ? () => setSelectedActionId(denialId) : undefined
            }
          />

          <div className="demo-controls">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void startDemo(true)}
            >
              Re-run demo (replay)
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void startDemo(false)}
            >
              Run live agent
            </button>
          </div>
        </section>
        <section className="canvas-pane canvas-pane--inspector">
          <Inspector model={inspector} />
        </section>
      </main>
    </div>
  );
}
