import type { AnalyticsSummary } from "@shared/types";

type AnalyticsBoardProps = {
  analytics: AnalyticsSummary;
  onFocusNode: (nodeId: string) => void;
};

export function AnalyticsBoard({
  analytics,
  onFocusNode
}: AnalyticsBoardProps) {
  return (
    <section className="analytics-board">
      <div className="metric-grid">
        {analytics.metricCards.map((card) => (
          <article
            key={card.label}
            className={`metric-card metric-${card.tone}`}
          >
            <p className="metric-label">{card.label}</p>
            <strong>{card.value}</strong>
            <span>{card.detail}</span>
          </article>
        ))}
      </div>

      <div className="analytics-columns">
        <article className="analytics-card">
          <h3>Flow Health</h3>
          <div className="breakdown-list">
            {analytics.flowBreakdown.map((item) => (
              <div key={item.label} className="breakdown-row">
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="analytics-card">
          <h3>Top Products</h3>
          <div className="ranked-list">
            {analytics.topProducts.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ranked-row"
                onClick={() => onFocusNode(`product:${item.id}`)}
              >
                <span>{item.label}</span>
                <strong>{item.primaryMetric}</strong>
              </button>
            ))}
          </div>
        </article>

        <article className="analytics-card">
          <h3>Top Customers</h3>
          <div className="ranked-list">
            {analytics.topCustomers.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ranked-row"
                onClick={() => onFocusNode(`customer:${item.id}`)}
              >
                <span>{item.label}</span>
                <strong>{item.primaryMetric}</strong>
              </button>
            ))}
          </div>
        </article>

        <article className="analytics-card">
          <h3>Risk Spotlights</h3>
          <div className="spotlight-list">
            {analytics.riskSpotlights.map((spotlight) => (
              <button
                key={spotlight.title}
                type="button"
                className="spotlight-row"
                onClick={() => spotlight.nodeIds[0] && onFocusNode(spotlight.nodeIds[0])}
              >
                <strong>{spotlight.title}</strong>
                <span>{spotlight.detail}</span>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
