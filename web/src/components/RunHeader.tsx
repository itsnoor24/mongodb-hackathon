import type { RunDoc } from "../types";
import { formatAgentLabel, formatRunNumber } from "../lib/buildPrototypeFlow";

interface Props {
  run: RunDoc | null;
  busy: boolean;
  onPause: () => void;
}

export function RunHeader({ run, busy, onPause }: Props) {
  const runNum = formatRunNumber(run?._id ?? "demo-run-001");
  const agent = formatAgentLabel(run?.agentId ?? "demo-agent-001");
  const status = run?.status ?? "running";
  const statusLabel =
    status === "running"
      ? "Running"
      : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <>
      <header className="top-bar">
        <div className="top-bar__left">
          <span className="top-bar__logo" aria-hidden>
            S
          </span>
          <span className="top-bar__title">Sentinel / Audit console</span>
        </div>
        <span className="top-bar__sandbox">Simulated Atlas sandbox</span>
      </header>

      <section className="run-hero">
        <div className="run-hero__meta">
          <p className="run-hero__kicker">
            AGENT {agent} / RUN {runNum}
          </p>
          <h1 className="run-hero__heading">
            {runNum} · Action audit
          </h1>
          <p className="run-hero__sub">
            Agent {agent.toLowerCase().replace("_", "-")} · 2 connected systems
            {run?.replayMode ? " · replay" : ""}
          </p>
        </div>
        <div className="run-hero__controls">
          <span className={`run-pill run-pill--${status}`}>
            <span className="run-pill__dot" aria-hidden />
            {statusLabel}
          </span>
          <button
            type="button"
            className="btn btn--pause"
            disabled={busy || status === "paused"}
            onClick={onPause}
          >
            Pause run
          </button>
        </div>
      </section>
    </>
  );
}