import type { DataModel } from "./data-model.js";

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

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|attach|detach|pragma|vacuum|create|replace|reindex|analyze)\b/i;

export function evaluateQuestionDomain(
  question: string,
  model: DataModel
): { allowed: boolean; reason?: string } {
  const normalized = question.trim().toLowerCase();
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
        "This system is designed to answer questions related to the provided order-to-cash dataset only."
    };
  }

  if (!mentionsDomainKeyword && !mentionsKnownId) {
    return {
      allowed: false,
      reason:
        "This system is designed to answer questions related to the provided dataset only."
    };
  }

  return { allowed: true };
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

export function validateReadOnlySql(sql: string): { valid: boolean; reason?: string } {
  const normalized = normalizeSql(sql);

  if (!normalized) {
    return { valid: false, reason: "No SQL was generated." };
  }

  if (FORBIDDEN_SQL.test(normalized)) {
    return {
      valid: false,
      reason: "Only read-only SQL is allowed."
    };
  }

  if (!/^(with|select)\b/i.test(normalized)) {
    return {
      valid: false,
      reason: "SQL must start with SELECT or WITH."
    };
  }

  if (normalized.includes(";")) {
    return {
      valid: false,
      reason: "Multiple SQL statements are not allowed."
    };
  }

  return { valid: true };
}

export function ensureLimit(sql: string, limit = 50): string {
  const normalized = normalizeSql(sql);
  if (/\blimit\s+\d+\b/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}\nLIMIT ${limit}`;
}
