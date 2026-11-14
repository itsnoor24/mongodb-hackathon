import type { TreeNode } from "../types";

interface Props {
  tree: TreeNode;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
}

interface NodeViewProps {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  depth: number;
}

function NodeView({ node, selectedId, onSelect, depth }: NodeViewProps) {
  const isSelected =
    selectedId === node.id ||
    (node.actionId && selectedId === `action-${node.actionId}`) ||
    selectedId === node.actionId;

  const classNames = [
    "tree-node",
    `tree-node--${node.kind}`,
    node.denied ? "tree-node--denied" : "",
    isSelected ? "tree-node--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="tree-branch" style={{ marginLeft: depth * 12 }}>
      <button
        type="button"
        className={classNames}
        onClick={() => onSelect(node)}
        disabled={!node.actionId && node.kind !== "root"}
      >
        {node.kind === "decision" && <span className="diamond" aria-hidden />}
        <span className="tree-node__label">{node.label}</span>
        {node.sublabel && (
          <span className="tree-node__sub">{node.sublabel}</span>
        )}
      </button>
      {node.children.map((child: TreeNode) => (
        <NodeView
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function DecisionTree({ tree, selectedId, onSelect }: Props) {
  return (
    <div className="decision-tree" aria-label="Decision tree">
      <NodeView
        node={tree}
        selectedId={selectedId}
        onSelect={onSelect}
        depth={0}
      />
    </div>
  );
}