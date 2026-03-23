import type { SearchResult } from "@shared/types";

type SearchPanelProps = {
  query: string;
  loading: boolean;
  results: SearchResult[];
  onQueryChange: (value: string) => void;
  onSelect: (nodeId: string) => void;
};

export function SearchPanel({
  query,
  loading,
  results,
  onQueryChange,
  onSelect
}: SearchPanelProps) {
  return (
    <div className="search-panel">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search by document ID, customer, product, or plant"
      />
      {query.trim().length > 1 && (
        <div className="search-results">
          {loading ? (
            <div className="search-empty">Searching graph...</div>
          ) : results.length > 0 ? (
            results.map((result) => (
              <button
                key={result.nodeId}
                type="button"
                className="search-result"
                onClick={() => onSelect(result.nodeId)}
              >
                <strong>{result.label}</strong>
                <span>
                  {result.kind} - {result.reason}
                </span>
              </button>
            ))
          ) : (
            <div className="search-empty">No matching graph nodes found.</div>
          )}
        </div>
      )}
    </div>
  );
}
