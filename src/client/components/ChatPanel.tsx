import { useMemo, useState } from "react";
import type { QueryResponse } from "@shared/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sql?: string | null;
  engine?: string;
  rowCount?: number;
  rejected?: boolean;
  planSteps?: string[];
  status?: string | null;
};

type ChatPanelProps = {
  messages: ChatMessage[];
  loading: boolean;
  streamStatus: string | null;
  suggestions: string[];
  latestResult: QueryResponse | null;
  onSend: (question: string) => void;
};

export function ChatPanel({
  messages,
  loading,
  streamStatus,
  suggestions,
  latestResult,
  onSend
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, 4),
    [suggestions]
  );

  const handleSubmit = () => {
    if (!draft.trim() || loading) {
      return;
    }
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <p className="eyebrow">Chat with Graph</p>
        <h2>Dodge AI</h2>
        <p className="chat-subtitle">Order-to-Cash graph agent</p>
      </div>

      <div className="chat-suggestions">
        {visibleSuggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-pill"
            onClick={() => onSend(suggestion)}
            disabled={loading}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="chat-messages">
        {streamStatus && <div className="stream-status">{streamStatus}</div>}
        {messages.map((message, index) => (
          <article
            key={`${message.role}-${index}`}
            className={`message-card ${message.role === "user" ? "user-message" : ""}`}
          >
            <div className="message-meta">
              <span>{message.role === "assistant" ? "Dodge AI" : "You"}</span>
              {message.engine && <span>{message.engine}</span>}
              {typeof message.rowCount === "number" && (
                <span>{message.rowCount} row(s)</span>
              )}
            </div>
            <p>{message.content}</p>
            {message.planSteps && message.planSteps.length > 0 && (
              <div className="plan-steps">
                {message.planSteps.map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
            )}
            {message.sql && (
              <details className="sql-block">
                <summary>SQL used</summary>
                <pre>{message.sql}</pre>
              </details>
            )}
          </article>
        ))}
        {loading && <div className="loading-line">Running dataset query...</div>}
      </div>

      <div className="evidence-panel">
        <div className="evidence-header">
          <span className="status-dot" />
          <span>Latest data evidence</span>
        </div>
        {latestResult && latestResult.rows.length > 0 ? (
          <>
            <div className="evidence-meta">
              <span>{latestResult.intent}</span>
              <span>{latestResult.rows.length} row(s)</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {latestResult.columns.slice(0, 5).map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestResult.rows.slice(0, 5).map((row, index) => (
                    <tr key={index}>
                      {latestResult.columns.slice(0, 5).map((column) => (
                        <td key={column}>{String(row[column] ?? "n/a")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="evidence-empty">
            Query results will appear here after a dataset-backed response.
          </p>
        )}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Ask about orders, deliveries, billings, journal entries, or payments"
          rows={3}
        />
        <button type="button" onClick={handleSubmit} disabled={loading}>
          Send
        </button>
      </div>
    </aside>
  );
}
