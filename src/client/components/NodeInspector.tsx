import type { NodeDetailsPayload } from "@shared/types";

type NodeInspectorProps = {
  details: NodeDetailsPayload | null;
  onExpand: () => void;
  onClose: () => void;
};

export function NodeInspector({
  details,
  onExpand,
  onClose
}: NodeInspectorProps) {
  if (!details) {
    return null;
  }

  const metadataEntries = Object.entries(details.node.metadata).slice(0, 14);

  return (
    <aside className="node-inspector">
      <div className="inspector-header">
        <div>
          <p className="eyebrow">{details.node.kind}</p>
          <h3>{details.node.label}</h3>
        </div>
        <div className="inspector-actions">
          {details.expansion.nodes.length > 0 && (
            <button type="button" className="expand-button" onClick={onExpand}>
              Expand Node
            </button>
          )}
          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <p className="inspector-summary">{details.node.summary}</p>
      <p className="inspector-hint">
        Click empty graph space to dismiss this panel.
      </p>

      <div className="inspector-stats">
        <span>{details.neighbors.length} neighbors</span>
        <span>{details.expansion.nodes.length} hidden nodes</span>
      </div>

      <dl className="metadata-grid">
        {metadataEntries.map(([key, value]) => (
          <div key={key} className="metadata-row">
            <dt>{humanizeKey(key)}</dt>
            <dd>{String(value ?? "n/a")}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function humanizeKey(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
