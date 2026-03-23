import type { JsonValue } from "../../shared/types.js";
import type { DataModel } from "./data-model.js";
import {
  DATA_EXFILTRATION_PATTERNS,
  FORBIDDEN_SQL,
  GOVERNANCE_SUMMARY,
  maskSensitiveValue,
  PRIVACY_SENSITIVE_PROMPT_PATTERNS,
  SELECT_STAR_SQL,
  SENSITIVE_COLUMNS,
  type GuardrailDecision
} from "./governance.js";

const DOMAIN_KEYWORDS = [
  "order",
  "sales order",
  "delivery",
  "billing",
  "invoice",
  "journal",
  "accounting",
  "payment",
  "customer",
  "product",
  "plant",
  "address",
  "flow",
  "document",
  "revenue",
  "billing document",
  "outbound delivery"
];

const OFF_TOPIC_KEYWORDS = [
  "weather",
  "recipe",
  "poem",
  "story",
  "joke",
  "movie",
  "politics",
  "stock market",
  "sports",
  "vacation",
  "translate",
  "write me"
];

export function evaluateQuestionDomain(
  question: string,
  model: DataModel
): GuardrailDecision {
  const normalized = question.trim().toLowerCase();
  const notes: string[] = [];
  const mentionsKnownId = extractKnownIds(question, model).length > 0;
  const mentionsDomainKeyword = DOMAIN_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
  const looksOffTopic =
    OFF_TOPIC_KEYWORDS.some((keyword) => normalized.includes(keyword)) &&
    !mentionsDomainKeyword &&
    !mentionsKnownId;

  if (looksOffTopic) {
    return {
      allowed: false,
      reason:
        "This system is designed to answer questions related to the provided order-to-cash dataset only.",
      notes: [
        "Rejected the prompt because it does not target the order-to-cash business domain."
      ],
      maxRows: 0,
      redactSensitiveFields: true
    };
  }

  if (!mentionsDomainKeyword && !mentionsKnownId) {
    return {
      allowed: false,
      reason:
        "This system is designed to answer questions related to the provided dataset only.",
      notes: [
        "The question did not reference known domain entities or business identifiers."
      ],
      maxRows: 0,
      redactSensitiveFields: true
    };
  }

  if (DATA_EXFILTRATION_PATTERNS.some((pattern) => pattern.test(question))) {
    return {
      allowed: false,
      reason:
        "This system does not allow bulk export or full-dataset extraction requests.",
      notes: [
        "Blocked a bulk-extraction style prompt to protect the dataset from mass export behavior."
      ],
      maxRows: 0,
      redactSensitiveFields: true
    };
  }

  const privacySensitive = PRIVACY_SENSITIVE_PROMPT_PATTERNS.some((pattern) =>
    pattern.test(question)
  );
  if (privacySensitive) {
    notes.push(
      "Privacy-aware mode is active for this prompt because it references address or contact-like data."
    );
  }

  notes.push(
    `Query policy ${GOVERNANCE_SUMMARY.policyVersion} is enforcing curated-source and read-only constraints.`
  );

  return {
    allowed: true,
    notes,
    maxRows: privacySensitive ? 20 : 50,
    redactSensitiveFields: privacySensitive
  };
}

export function extractKnownIds(question: string, model: DataModel): string[] {
  const tokens = question.match(/\b[A-Za-z0-9]{4,}\b/g) ?? [];
  return Array.from(
    new Set(tokens.filter((token) => model.lookup.genericIds.has(token)))
  );
}

export function normalizeSql(sql: string): string {
  return sql
    .replace(/```sql/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/;+\s*$/, "");
}

export function validateReadOnlySql(
  sql: string,
  options?: { maxRows?: number }
): { valid: boolean; reason?: string; notes: string[] } {
  const normalized = normalizeSql(sql);
  const notes: string[] = [];

  if (!normalized) {
    return { valid: false, reason: "No SQL was generated.", notes };
  }

  if (FORBIDDEN_SQL.test(normalized)) {
    return {
      valid: false,
      reason: "Only read-only SQL is allowed.",
      notes
    };
  }

  if (!/^(with|select)\b/i.test(normalized)) {
    return {
      valid: false,
      reason: "SQL must start with SELECT or WITH.",
      notes
    };
  }

  if (normalized.includes(";")) {
    return {
      valid: false,
      reason: "Multiple SQL statements are not allowed.",
      notes
    };
  }

  if (SELECT_STAR_SQL.test(normalized)) {
    return {
      valid: false,
      reason: "SELECT * is not allowed. Queries must project explicit columns.",
      notes
    };
  }

  const sources = extractReferencedSources(normalized);
  const cteNames = extractCteNames(normalized);
  const disallowedSources = sources.filter(
    (source) =>
      !GOVERNANCE_SUMMARY.curatedQuerySources.includes(source) &&
      !cteNames.has(source)
  );
  if (disallowedSources.length > 0) {
    return {
      valid: false,
      reason: `Query references non-curated sources: ${disallowedSources.join(", ")}.`,
      notes
    };
  }

  const declaredLimit = extractSqlLimit(normalized);
  if (options?.maxRows && declaredLimit !== null && declaredLimit > options.maxRows) {
    return {
      valid: false,
      reason: `Query limit ${declaredLimit} exceeds the policy maximum of ${options.maxRows}.`,
      notes
    };
  }

  notes.push(
    `Validated curated-source allowlist across: ${sources.length > 0 ? sources.join(", ") : "no explicit sources detected"}.`
  );
  return { valid: true, notes };
}

export function ensureLimit(sql: string, limit = 50): string {
  const normalized = normalizeSql(sql);
  const declaredLimit = extractSqlLimit(normalized);
  if (declaredLimit !== null && declaredLimit <= limit) {
    return normalized;
  }

  if (declaredLimit !== null && declaredLimit > limit) {
    return normalized.replace(/\blimit\s+\d+\b/i, `LIMIT ${limit}`);
  }

  return `${normalized}\nLIMIT ${limit}`;
}

export function sanitizeQueryResult(
  columns: string[],
  rows: Array<Record<string, JsonValue>>,
  decision: GuardrailDecision
): {
  columns: string[];
  rows: Array<Record<string, JsonValue>>;
  notes: string[];
} {
  const notes: string[] = [];
  const truncatedRows = rows.slice(0, decision.maxRows);

  let sanitizedRows = truncatedRows;
  if (rows.length > truncatedRows.length) {
    notes.push(
      `Trimmed the result set from ${rows.length} to ${truncatedRows.length} rows to honor the policy row limit.`
    );
  }

  if (decision.redactSensitiveFields) {
    const intersectingColumns = columns.filter((column) =>
      SENSITIVE_COLUMNS.has(column)
    );
    if (intersectingColumns.length > 0) {
      sanitizedRows = truncatedRows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            SENSITIVE_COLUMNS.has(key) ? maskSensitiveValue(key, value) : value
          ])
        )
      );
      notes.push(
        `Redacted sensitive fields in the result set: ${intersectingColumns.join(", ")}.`
      );
    }
  }

  return {
    columns,
    rows: sanitizedRows,
    notes
  };
}

function extractReferencedSources(sql: string): string[] {
  const sources = new Set<string>();
  const regex = /\b(?:from|join)\s+([a-zA-Z_][\w]*)/gi;
  for (const match of sql.matchAll(regex)) {
    const source = match[1];
    if (source && !source.startsWith("select")) {
      sources.add(source);
    }
  }
  return Array.from(sources);
}

function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const cteRegex = /([a-zA-Z_][\w]*)\s+as\s*\(/gi;
  for (const match of sql.matchAll(cteRegex)) {
    names.add(match[1]);
  }
  return names;
}

function extractSqlLimit(sql: string): number | null {
  const match = sql.match(/\blimit\s+(\d+)\b/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
