import NodeSqlParser from "node-sql-parser";
import type { AST, Select } from "node-sql-parser";
import type { JsonValue } from "../../shared/types.js";
import {
  RESTRICTED_COLUMN_NAMES,
  type SemanticCatalog
} from "../storage/semantic-layer.js";
import type { DataModel } from "./data-model.js";
import {
  DATA_EXFILTRATION_PATTERNS,
  FORBIDDEN_SQL,
  GOVERNANCE_SUMMARY,
  maskSensitiveValue,
  PRIVACY_SENSITIVE_PROMPT_PATTERNS,
  SENSITIVE_COLUMNS,
  type GuardrailDecision
} from "./governance.js";

const { Parser } = NodeSqlParser;
const parser = new Parser();

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
  "outbound delivery",
  "receivable",
  "fulfillment"
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
  "write me",
  "essay",
  "song",
  "startup idea"
];

const BULK_EXPORT_PATTERNS = [
  /\b(comprehensive|complete|full|entire|whole)\s+(overview|list|table|dump|extract)\b/i,
  /\b(all|every|entirety of)\s+(customers|addresses|contacts|rows|records)\b/i,
  /\btabular overview\b/i
];

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
  notes: string[];
  sources: string[];
  declaredLimit: number | null;
  restrictedColumns: string[];
}

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

  if (
    DATA_EXFILTRATION_PATTERNS.some((pattern) => pattern.test(question)) ||
    BULK_EXPORT_PATTERNS.some((pattern) => pattern.test(question))
  ) {
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
    `Query policy ${GOVERNANCE_SUMMARY.policyVersion} is enforcing curated-source and AST-validated read-only constraints.`
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
  semanticCatalog: SemanticCatalog,
  options?: { maxRows?: number }
): SqlValidationResult {
  const normalized = normalizeSql(sql);
  const notes: string[] = [];

  if (!normalized) {
    return {
      valid: false,
      reason: "No SQL was generated.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  if (FORBIDDEN_SQL.test(normalized)) {
    return {
      valid: false,
      reason: "Only read-only SQL is allowed.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  if (!/^(with|select)\b/i.test(normalized)) {
    return {
      valid: false,
      reason: "SQL must start with SELECT or WITH.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  if (normalized.includes(";")) {
    return {
      valid: false,
      reason: "Multiple SQL statements are not allowed.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  let ast: AST | AST[];
  try {
    ast = parser.astify(normalized, { database: "sqlite" });
  } catch (error) {
    return {
      valid: false,
      reason:
        error instanceof Error ? `SQL could not be parsed safely. ${error.message}` : "SQL could not be parsed safely.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    return {
      valid: false,
      reason: "Exactly one SQL statement is allowed.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  const statement = statements[0];
  if (statement.type !== "select") {
    return {
      valid: false,
      reason: "Only SELECT statements are allowed.",
      notes,
      sources: [],
      declaredLimit: null,
      restrictedColumns: []
    };
  }

  const context: ValidationContext = {
    semanticCatalog,
    sourceNames: new Set<string>(),
    restrictedColumns: new Set<string>(),
    declaredLimit: extractLimitValue(statement),
    notes,
    cteNames: new Set<string>()
  };

  try {
    validateSelectStatement(statement, context);
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "SQL validation failed.",
      notes,
      sources: Array.from(context.sourceNames),
      declaredLimit: context.declaredLimit,
      restrictedColumns: Array.from(context.restrictedColumns)
    };
  }

  if (context.restrictedColumns.size > 0) {
    const restrictedColumns = Array.from(context.restrictedColumns).sort();
    return {
      valid: false,
      reason: `Query references restricted columns: ${restrictedColumns.join(", ")}.`,
      notes,
      sources: Array.from(context.sourceNames),
      declaredLimit: context.declaredLimit,
      restrictedColumns
    };
  }

  if (options?.maxRows && context.declaredLimit !== null && context.declaredLimit > options.maxRows) {
    return {
      valid: false,
      reason: `Query limit ${context.declaredLimit} exceeds the policy maximum of ${options.maxRows}.`,
      notes,
      sources: Array.from(context.sourceNames),
      declaredLimit: context.declaredLimit,
      restrictedColumns: []
    };
  }

  notes.push(
    `Validated curated-source allowlist across: ${Array.from(context.sourceNames).join(", ")}.`
  );

  return {
    valid: true,
    notes,
    sources: Array.from(context.sourceNames),
    declaredLimit: context.declaredLimit,
    restrictedColumns: []
  };
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
    const intersectingColumns = columns.filter(
      (column) => SENSITIVE_COLUMNS.has(column) || RESTRICTED_COLUMN_NAMES.has(column)
    );
    if (intersectingColumns.length > 0) {
      sanitizedRows = truncatedRows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            SENSITIVE_COLUMNS.has(key) || RESTRICTED_COLUMN_NAMES.has(key)
              ? maskSensitiveValue(key, value)
              : value
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

type ValidationContext = {
  semanticCatalog: SemanticCatalog;
  sourceNames: Set<string>;
  restrictedColumns: Set<string>;
  declaredLimit: number | null;
  notes: string[];
  cteNames: Set<string>;
};

function validateSelectStatement(
  select: Select,
  context: ValidationContext,
  inheritedCtes?: Set<string>
): void {
  const cteNames = new Set(inheritedCtes ?? []);
  if (select.with) {
    for (const cte of select.with) {
      const cteName = cte.name.value;
      cteNames.add(cteName);
      context.cteNames.add(cteName);
      validateSelectStatement(cte.stmt.ast, context, cteNames);
    }
  }

  const scopeSources = buildScopeSources(select, context, cteNames);
  if (scopeSources.curatedSources.size === 0 && scopeSources.cteSources.size === 0) {
    throw new Error(
      "Query must reference at least one curated semantic-layer source."
    );
  }
  for (const column of select.columns ?? []) {
    const expression = typeof column === "object" && "expr" in column ? column.expr : column;
    if (isSelectStar(expression)) {
      throw new Error(
        "SELECT * is not allowed. Queries must project explicit columns."
      );
    }
    inspectExpression(expression, scopeSources, context);
  }

  inspectExpression(select.where, scopeSources, context);
  inspectExpression(select.groupby?.columns, scopeSources, context);
  inspectExpression(select.having, scopeSources, context);
  inspectExpression(select.orderby, scopeSources, context);
  inspectExpression(select.window, scopeSources, context);
  inspectExpression(select._orderby, scopeSources, context);

  if (select._next) {
    validateSelectStatement(select._next, context, cteNames);
  }
}

function buildScopeSources(
  select: Select,
  context: ValidationContext,
  cteNames: Set<string>
): ScopeSources {
  const aliasToSource = new Map<string, string>();
  const curatedSources = new Set<string>();
  const cteSources = new Set<string>(cteNames);

  const fromItems = Array.isArray(select.from) ? select.from : [];
  for (const item of fromItems) {
    if ("expr" in item && item.expr?.ast) {
      validateSelectStatement(item.expr.ast, context, cteNames);
      if (item.as) {
        aliasToSource.set(item.as, item.as);
        cteSources.add(item.as);
      }
      continue;
    }

    if (!("table" in item) || !item.table) {
      continue;
    }

    const sourceName = item.table;
    const alias = item.as ?? sourceName;
    aliasToSource.set(alias, sourceName);
    aliasToSource.set(sourceName, sourceName);

    if (cteNames.has(sourceName)) {
      cteSources.add(sourceName);
      continue;
    }

    if (!(sourceName in context.semanticCatalog)) {
      throw new Error(
        `Query references non-curated source ${sourceName}. Only curated semantic-layer views are allowed.`
      );
    }

    curatedSources.add(sourceName);
    context.sourceNames.add(sourceName);
  }

  return { aliasToSource, curatedSources, cteSources };
}

type ScopeSources = {
  aliasToSource: Map<string, string>;
  curatedSources: Set<string>;
  cteSources: Set<string>;
};

function inspectExpression(
  value: unknown,
  scopeSources: ScopeSources,
  context: ValidationContext
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      inspectExpression(item, scopeSources, context);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const node = value as Record<string, unknown>;
  if (node.type === "column_ref") {
    validateColumnReference(node, scopeSources, context);
    return;
  }

  for (const [key, nested] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "tableList" ||
      key === "columnList" ||
      key === "type"
    ) {
      continue;
    }
    inspectExpression(nested, scopeSources, context);
  }
}

function validateColumnReference(
  node: Record<string, unknown>,
  scopeSources: ScopeSources,
  context: ValidationContext
): void {
  const tableName =
    typeof node.table === "string" && node.table.trim() ? node.table : null;
  const columnName = extractColumnName(node.column);

  if (!columnName || columnName === "*") {
    throw new Error(
      "SELECT * is not allowed. Queries must project explicit columns."
    );
  }

  let resolvedSource: string | null = null;
  if (tableName) {
    resolvedSource = scopeSources.aliasToSource.get(tableName) ?? tableName;
  } else if (scopeSources.curatedSources.size === 1 && scopeSources.cteSources.size === 0) {
    resolvedSource = Array.from(scopeSources.curatedSources)[0];
  } else {
    const matchingSources = Array.from(scopeSources.curatedSources).filter((sourceName) =>
      context.semanticCatalog[sourceName].columns.includes(columnName)
    );
    if (matchingSources.length === 1) {
      resolvedSource = matchingSources[0];
    }
  }

  if (resolvedSource && scopeSources.cteSources.has(resolvedSource)) {
    return;
  }

  if (resolvedSource) {
    const source = context.semanticCatalog[resolvedSource];
    if (!source) {
      throw new Error(
        `Query references non-curated source ${resolvedSource}. Only curated semantic-layer views are allowed.`
      );
    }

    if (!source.columns.includes(columnName)) {
      throw new Error(
        `Column ${columnName} is not available on curated source ${resolvedSource}.`
      );
    }
  } else if (scopeSources.cteSources.size === 0) {
    throw new Error(
      `Column ${columnName} could not be resolved against the curated semantic layer.`
    );
  }

  if (RESTRICTED_COLUMN_NAMES.has(columnName)) {
    context.restrictedColumns.add(columnName);
  }
}

function extractColumnName(column: unknown): string | null {
  if (typeof column === "string") {
    return column;
  }

  if (
    column &&
    typeof column === "object" &&
    "expr" in column &&
    column.expr &&
    typeof column.expr === "object" &&
    "value" in column.expr &&
    typeof column.expr.value === "string"
  ) {
    return column.expr.value;
  }

  return null;
}

function isSelectStar(expression: unknown): boolean {
  if (!expression || typeof expression !== "object") {
    return false;
  }

  const node = expression as Record<string, unknown>;
  if (node.type === "star") {
    return true;
  }

  return node.type === "column_ref" && extractColumnName(node.column) === "*";
}

function extractLimitValue(select: Select): number | null {
  const limits = select.limit?.value;
  if (!limits || limits.length === 0) {
    return select._next ? extractLimitValue(select._next) : null;
  }

  const candidate = limits[0];
  if (!candidate || typeof candidate.value !== "number") {
    return null;
  }

  return candidate.value;
}

function extractSqlLimit(sql: string): number | null {
  const match = sql.match(/\blimit\s+(\d+)\b/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
