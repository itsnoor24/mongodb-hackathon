import type { InspectorModel } from "../lib/inspector";

export function Inspector({ model }: { model: InspectorModel }) {
  return (
    <aside className="inspector" aria-label="Action inspector">
      <div className="inspector__head">
        <h2 className="pane-label">Action inspector</h2>
        <span className="inspector__code">{model.actionCode}</span>
      </div>
      <h3 className="inspector__headline">{model.headline}</h3>
      <p className="inspector__fn">{model.functionCall}</p>

      <dl className="inspector__grid">
        <div className="inspector__row">
          <dt>Actor</dt>
          <dd>{model.actor}</dd>
        </div>
        <div className="inspector__row">
          <dt>Authorization</dt>
          <dd>
            <span
              className={
                model.authorizationDenied
                  ? "inspector__pill inspector__pill--deny"
                  : "inspector__pill"
              }
            >
              {model.authorization}
            </span>
          </dd>
        </div>
        <div className="inspector__row">
          <dt>Rule</dt>
          <dd>
            <span className="inspector__rule-name">{model.rule}</span>
            <span className="inspector__rule-detail">{model.ruleDetail}</span>
          </dd>
        </div>
        <div className="inspector__row">
          <dt>Context</dt>
          <dd>{model.context}</dd>
        </div>
        <div className="inspector__row">
          <dt>Execution outcome</dt>
          <dd>{model.execution}</dd>
        </div>
      </dl>

      <div className="inspector__trace-box">
        <span className="inspector__trace-label">Event trace</span>
        <span className="inspector__trace-compact">{model.traceCompact}</span>
      </div>
    </aside>
  );
}