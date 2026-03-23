import fs from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;

export function readJsonlDirectory(directoryPath: string): Row[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const files = fs
    .readdirSync(directoryPath)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  const rows: Row[] = [];
  for (const file of files) {
    const absolutePath = path.join(directoryPath, file);
    const lines = fs
      .readFileSync(absolutePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    for (const line of lines) {
      rows.push(JSON.parse(line) as Row);
    }
  }

  return rows;
}

export function formatTimeValue(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeTime = value as {
    hours?: number;
    minutes?: number;
    seconds?: number;
  };

  if (
    typeof maybeTime.hours !== "number" ||
    typeof maybeTime.minutes !== "number" ||
    typeof maybeTime.seconds !== "number"
  ) {
    return null;
  }

  return [maybeTime.hours, maybeTime.minutes, maybeTime.seconds]
    .map((segment) => String(segment).padStart(2, "0"))
    .join(":");
}

export function toDbValue(value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object") {
    const timeValue = formatTimeValue(value);
    return timeValue ?? JSON.stringify(value);
  }

  return String(value);
}

export function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  if (typeof value === "object") {
    const timeValue = formatTimeValue(value);
    return timeValue ?? JSON.stringify(value);
  }

  return String(value);
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const timeValue = formatTimeValue(value);
  return timeValue ?? JSON.stringify(value);
}

export function asNullableString(value: unknown): string | null {
  const stringValue = asString(value).trim();
  return stringValue ? stringValue : null;
}

export function asIntegerKey(value: unknown): string {
  const stringValue = asString(value).trim();
  if (!stringValue) {
    return "000000";
  }

  const numericValue = Number.parseInt(stringValue, 10);
  if (Number.isNaN(numericValue)) {
    return stringValue;
  }

  return String(numericValue).padStart(6, "0");
}

export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export function titleFromKey(input: string): string {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
