import type { PrototypeFlow } from "../lib/buildPrototypeFlow";

interface Props {
  flow: PrototypeFlow;
  selectedActionId: string | null;
  onSelect: (actionId: string) => void;
  onQueuedWrite: () => void;
  busy: boolean;
}

function FlowCardButton({
  card,
  selected,
  onSelect,
}: {
  card: { actionId: string; title: string; meta: string; variant: string };
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const selectable = !card.actionId.includes("queued");
  return (
    <button
      type="button"
      className={`flow-card flow-card--${card.variant} ${
        selected ? "flow-card--selected" : ""
      }`}
      onClick={() => selectable && onSelect(card.actionId)}
      disabled={!selectable}
    >
      <span className="flow-card__title">{card.title}</span>
      <span className="flow-card__meta">{card.meta}</span>
    </button>
  );
}

export function VerticalAuditTree({
  flow,
  selectedActionId,
  onSelect,
  onQueuedWrite,
  busy,
}: Props) {
  return (
    <div className="v-tree">
      <h2 className="pane-label">Action decision tree</h2>

      <div className="v-tree__flow">
        <div className="v-tree__start-dot" aria-hidden />

        {flow.read && (
          <>
            <div className="v-tree__stem" />
            <FlowCardButton
              card={flow.read}
              selected={selectedActionId === flow.read.actionId}
              onSelect={onSelect}
            />
          </>
        )}

        <div className="v-tree__stem v-tree__stem--labeled">
          <span className="v-tree__edge-label">Write request</span>
        </div>

        <div className="v-tree__decision-wrap">
          <div className="v-tree__decision" aria-label="Target allowed?">
            <span className="v-tree__diamond" aria-hidden />
            <span className="v-tree__decision-text">Target allowed?</span>
          </div>
          <div className="v-tree__chips">
            <span className="v-tree__chip v-tree__chip--allow">Allow</span>
            <span className="v-tree__chip v-tree__chip--deny">Deny</span>
          </div>
        </div>

        <div className="v-tree__fork">
          <div className="v-tree__fork-col v-tree__fork-col--allow">
            <div className="v-tree__fork-stem v-tree__fork-stem--allow" />
            {flow.privateWrite ? (
              <FlowCardButton
                card={flow.privateWrite}
                selected={selectedActionId === flow.privateWrite.actionId}
                onSelect={onSelect}
              />
            ) : (
              <div className="flow-card flow-card--allow flow-card--placeholder">
                <span className="flow-card__title">Create private issue</span>
                <span className="flow-card__meta">✓ Verified · GitHub</span>
              </div>
            )}
            {flow.queuedFollowUp && (
              <div className="flow-card flow-card--queued" aria-disabled>
                <span className="flow-card__title">
                  {flow.queuedFollowUp.title}
                </span>
                <span className="flow-card__meta">{flow.queuedFollowUp.meta}</span>
              </div>
            )}
          </div>

          <div className="v-tree__fork-col v-tree__fork-col--deny">
            <div className="v-tree__fork-stem v-tree__fork-stem--deny" />
            <div className="v-tree__deny-row">
              {flow.publicDeny ? (
                <FlowCardButton
                  card={flow.publicDeny}
                  selected={selectedActionId === flow.publicDeny.actionId}
                  onSelect={onSelect}
                />
              ) : (
                <div className="flow-card flow-card--deny flow-card--placeholder">
                  <span className="flow-card__title">Block public write</span>
                  <span className="flow-card__meta">× Never dispatched</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn--queued-inline"
                disabled={busy}
                onClick={onQueuedWrite}
              >
                Attempt queued write
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}