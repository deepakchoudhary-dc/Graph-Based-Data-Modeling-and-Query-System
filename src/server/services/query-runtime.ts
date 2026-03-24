import type {
  ChatMessage,
  JsonValue,
  QueryResponse
} from "../../shared/types.js";
import { executeQuery } from "../storage/persistent-database.js";
import { buildTargetedSchemaSummary } from "../storage/semantic-layer.js";
import type { DataModel } from "./data-model.js";
import {
  ensureLimit,
  sanitizeQueryResult,
  validateReadOnlySql
} from "./guardrails.js";
import { GOVERNANCE_SUMMARY } from "./governance.js";
import { createDefaultLlmProvider } from "./llm-provider.js";
import { assessQuestion } from "./question-classifier.js";
import {
  buildFocus,
  inferHighlights,
  nextSuggestions,
  planRuleQuestion,
  type QueryRows
} from "./rule-planner.js";

type GeminiPlan = {
  decision: "answer" | "reject";
  intent: string;
  sql: string;
  reason?: string;
};

type PlannedExecution =
  | {
      decision: "reject";
      reason?: string;
      intent: string;
      repairSteps: string[];
    }
  | {
      decision: "executed";
      plan: GeminiPlan;
      executed: {
        sql: string;
        columns: string[];
        rows: QueryRows;
      };
      repairSteps: string[];
    };

const llmProvider = createDefaultLlmProvider();

export async function streamAnswerQuestionAdvanced(
  model: DataModel,
  question: string,
  conversation: ChatMessage[],
  emit: (event: { type: string; payload: JsonValue }) => void
): Promise<QueryResponse> {
  emit({
    type: "status",
    payload: "Classifying the question against domain, privacy, and extraction guardrails."
  });

  const policy = await assessQuestion(question, conversation, model, llmProvider);
  if (!policy.allowed) {
    const rejected = buildRejectedResponse(model, policy.reason, policy.notes, "guardrail");
    emit({ type: "answer", payload: rejected.answer });
    emit({ type: "done", payload: rejected as unknown as JsonValue });
    return rejected;
  }

  const rulePlan = planRuleQuestion(question, model);
  if (rulePlan) {
    emit({
      type: "plan",
      payload: {
        engine: "rule",
        intent: rulePlan.intent,
        steps: rulePlan.planSteps
      } as unknown as JsonValue
    });

    const executed = executeValidatedSql(model, rulePlan.sql, policy.maxRows);
    const sanitized = sanitizeQueryResult(executed.columns, executed.rows, policy);
    const highlights =
      rulePlan.highlights?.(sanitized.rows) ?? inferHighlights(sanitized.rows, model);
    const response: QueryResponse = {
      rejected: false,
      answer: rulePlan.answer(sanitized.rows),
      sql: executed.sql,
      columns: sanitized.columns,
      rows: sanitized.rows,
      highlights,
      focus: buildFocus(model, highlights, question),
      intent: rulePlan.intent,
      engine: "rule",
      planSteps: [
        `Question assessment engine: ${policy.engine}.`,
        ...rulePlan.planSteps,
        ...sanitized.notes
      ],
      guardrailNotes: [...policy.notes, ...sanitized.notes],
      suggestions: nextSuggestions(model, question)
    };

    emit({ type: "sql", payload: executed.sql });
    emit({
      type: "rows",
      payload: {
        count: sanitized.rows.length,
        preview: sanitized.rows.slice(0, 5)
      } as unknown as JsonValue
    });
    emit({ type: "answer", payload: response.answer });
    emit({ type: "done", payload: response as unknown as JsonValue });
    return response;
  }

  if (!llmProvider.isConfigured()) {
    const rejected = buildRejectedResponse(
      model,
      "The built-in planners handle the core flow questions, but broader natural-language SQL generation requires a Gemini API key. Add your key to GEMINI_API_KEY to enable open-ended analyst queries.",
      policy.notes,
      "missing-llm-key"
    );
    emit({ type: "answer", payload: rejected.answer });
    emit({ type: "done", payload: rejected as unknown as JsonValue });
    return rejected;
  }

  emit({
    type: "status",
    payload: "Generating SQL against the persistent semantic layer."
  });
  const planned = await executeGeneratedPlan(model, question, conversation, policy.maxRows);
  if (planned.decision === "reject") {
    const rejected = buildRejectedResponse(
      model,
      planned.reason ??
        "This system is designed to answer questions related to the provided dataset only.",
      [...policy.notes, ...planned.repairSteps],
      planned.intent || "guardrail"
    );
    emit({ type: "answer", payload: rejected.answer });
    emit({ type: "done", payload: rejected as unknown as JsonValue });
    return rejected;
  }

  const sanitized = sanitizeQueryResult(
    planned.executed.columns,
    planned.executed.rows,
    policy
  );

  emit({ type: "sql", payload: planned.executed.sql });
  emit({
    type: "rows",
    payload: {
      count: sanitized.rows.length,
      preview: sanitized.rows.slice(0, 5)
    } as unknown as JsonValue
  });
  emit({
    type: "status",
    payload: "Summarizing only the validated SQL result rows."
  });

  const answer = await summarizeWithGemini(question, planned.executed.sql, sanitized.rows);
  const highlights = inferHighlights(sanitized.rows, model);
  const response: QueryResponse = {
    rejected: false,
    answer,
    sql: planned.executed.sql,
    columns: sanitized.columns,
    rows: sanitized.rows,
    highlights,
    focus: buildFocus(model, highlights, question),
    intent: planned.plan.intent || policy.intentHint || "gemini-sql",
    engine: "gemini",
    planSteps: [
      `Question assessment engine: ${policy.engine}.`,
      "Generated SQL against targeted semantic-layer context.",
      "Validated the generated SQL against the AST policy.",
      ...planned.repairSteps,
      "Executed the SQL against the persistent SQLite store.",
      "Summarized only the returned rows.",
      ...sanitized.notes
    ],
    guardrailNotes: [...policy.notes, ...sanitized.notes],
    suggestions: nextSuggestions(model, question)
  };

  emit({ type: "answer", payload: response.answer });
  emit({ type: "done", payload: response as unknown as JsonValue });
  return response;
}

export async function answerQuestionAdvanced(
  model: DataModel,
  question: string,
  conversation: ChatMessage[]
): Promise<QueryResponse> {
  const policy = await assessQuestion(question, conversation, model, llmProvider);
  if (!policy.allowed) {
    return buildRejectedResponse(model, policy.reason, policy.notes, "guardrail");
  }

  const rulePlan = planRuleQuestion(question, model);
  if (rulePlan) {
    const executed = executeValidatedSql(model, rulePlan.sql, policy.maxRows);
    const sanitized = sanitizeQueryResult(executed.columns, executed.rows, policy);
    const highlights =
      rulePlan.highlights?.(sanitized.rows) ?? inferHighlights(sanitized.rows, model);
    return {
      rejected: false,
      answer: rulePlan.answer(sanitized.rows),
      sql: executed.sql,
      columns: sanitized.columns,
      rows: sanitized.rows,
      highlights,
      focus: buildFocus(model, highlights, question),
      intent: rulePlan.intent,
      engine: "rule",
      planSteps: [
        `Question assessment engine: ${policy.engine}.`,
        ...rulePlan.planSteps,
        ...sanitized.notes
      ],
      guardrailNotes: [...policy.notes, ...sanitized.notes],
      suggestions: nextSuggestions(model, question)
    };
  }

  if (!llmProvider.isConfigured()) {
    return buildRejectedResponse(
      model,
      "The built-in planners handle the core flow questions, but broader natural-language SQL generation requires a Gemini API key. Add your key to GEMINI_API_KEY to enable open-ended analyst queries.",
      policy.notes,
      "missing-llm-key"
    );
  }

  try {
    const planned = await executeGeneratedPlan(
      model,
      question,
      conversation,
      policy.maxRows
    );
    if (planned.decision === "reject") {
      return buildRejectedResponse(
        model,
        planned.reason ??
          "This system is designed to answer questions related to the provided dataset only.",
        [...policy.notes, ...planned.repairSteps],
        planned.intent || "guardrail"
      );
    }

    const sanitized = sanitizeQueryResult(
      planned.executed.columns,
      planned.executed.rows,
      policy
    );
    const answer = await summarizeWithGemini(
      question,
      planned.executed.sql,
      sanitized.rows
    );
    const highlights = inferHighlights(sanitized.rows, model);

    return {
      rejected: false,
      answer,
      sql: planned.executed.sql,
      columns: sanitized.columns,
      rows: sanitized.rows,
      highlights,
      focus: buildFocus(model, highlights, question),
      intent: planned.plan.intent || policy.intentHint || "gemini-sql",
      engine: "gemini",
      planSteps: [
        `Question assessment engine: ${policy.engine}.`,
        "Generated SQL against targeted semantic-layer context.",
        "Validated the generated SQL against the AST policy.",
        ...planned.repairSteps,
        "Executed the SQL against the persistent SQLite store.",
        "Summarized only the returned rows.",
        ...sanitized.notes
      ],
      guardrailNotes: [...policy.notes, ...sanitized.notes],
      suggestions: nextSuggestions(model, question)
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unexpected query planning failure.";
    return {
      rejected: true,
      answer: `I could not safely answer that question. ${reason}`,
      sql: null,
      columns: [],
      rows: [],
      highlights: [],
      focus: null,
      intent: "query-error",
      engine: "guardrail",
      reason,
      planSteps: [
        "Generated SQL could not be validated or repaired safely before execution."
      ],
      guardrailNotes: policy.notes,
      suggestions: model.examplePrompts
    };
  }
}

async function executeGeneratedPlan(
  model: DataModel,
  question: string,
  conversation: ChatMessage[],
  maxRows: number
): Promise<PlannedExecution> {
  const repairSteps: string[] = [];
  const initialPlan = await generateGeminiPlan(model, question, conversation);
  if (initialPlan.decision === "reject") {
    return {
      decision: "reject",
      reason: initialPlan.reason,
      intent: initialPlan.intent || "guardrail",
      repairSteps
    };
  }

  try {
    return {
      decision: "executed",
      plan: initialPlan,
      executed: executeValidatedSql(model, initialPlan.sql, maxRows),
      repairSteps
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Generated SQL failed to execute.";
    repairSteps.push(
      `The first generated SQL failed validation or execution and triggered a repair pass: ${reason}`
    );
    const repairedPlan = await repairGeminiPlan(
      model,
      question,
      conversation,
      initialPlan.sql,
      reason
    );
    if (repairedPlan.decision === "reject") {
      return {
        decision: "reject",
        reason: repairedPlan.reason,
        intent: repairedPlan.intent || initialPlan.intent,
        repairSteps
      };
    }

    return {
      decision: "executed",
      plan: repairedPlan,
      executed: executeValidatedSql(model, repairedPlan.sql, maxRows),
      repairSteps
    };
  }
}

async function generateGeminiPlan(
  model: DataModel,
  question: string,
  conversation: ChatMessage[]
): Promise<GeminiPlan> {
  const prompt = [
    "You are planning a dataset-backed SQL query for an Order-to-Cash analytics system.",
    "Only answer questions grounded in the provided dataset schema.",
    "Reject requests that are off-topic, creative, or general knowledge.",
    `Use only read-only SQLite SQL against these curated sources: ${GOVERNANCE_SUMMARY.curatedQuerySources.join(", ")}.`,
    "Never use raw base tables.",
    "Never use SELECT *.",
    "Always add a LIMIT of 50 or less.",
    "Never reference restricted address or contact columns.",
    "",
    "Return strict JSON with this shape:",
    '{"decision":"answer|reject","intent":"short-intent","sql":"SELECT ...","reason":"optional"}',
    "",
    buildTargetedSchemaSummary(question, model.semanticCatalog),
    "",
    "Conversation context:",
    conversation
      .slice(-6)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n"),
    "",
    `Current question: ${question}`
  ].join("\n");

  const plan = await llmProvider.generateJson<GeminiPlan>(prompt);
  if (plan.decision === "answer") {
    const validation = validateReadOnlySql(plan.sql ?? "", model.semanticCatalog, {
      maxRows: 50
    });
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Generated SQL failed validation.");
    }
  }

  return plan;
}

async function repairGeminiPlan(
  model: DataModel,
  question: string,
  conversation: ChatMessage[],
  previousSql: string,
  failureReason: string
): Promise<GeminiPlan> {
  const prompt = [
    "You are repairing a failed SQLite query for an Order-to-Cash analytics system.",
    "Return a corrected read-only SQL query or reject if the question is out of domain.",
    `Use only curated sources: ${GOVERNANCE_SUMMARY.curatedQuerySources.join(", ")}.`,
    "Never use raw base tables.",
    "Never use SELECT *.",
    "Never reference restricted address or contact columns.",
    "Always add a LIMIT of 50 or less.",
    "",
    'Return strict JSON: {"decision":"answer|reject","intent":"short-intent","sql":"SELECT ...","reason":"optional"}',
    "",
    buildTargetedSchemaSummary(question, model.semanticCatalog),
    "",
    "Conversation context:",
    conversation
      .slice(-6)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n"),
    "",
    `Question: ${question}`,
    `Failed SQL: ${previousSql}`,
    `Failure: ${failureReason}`
  ].join("\n");

  const plan = await llmProvider.generateJson<GeminiPlan>(prompt);
  if (plan.decision === "answer") {
    const validation = validateReadOnlySql(plan.sql ?? "", model.semanticCatalog, {
      maxRows: 50
    });
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Repaired SQL failed validation.");
    }
  }

  return plan;
}

async function summarizeWithGemini(
  question: string,
  sql: string,
  rows: QueryRows
): Promise<string> {
  const prompt = [
    "You are summarizing the result of a dataset-backed SQL query for an Order-to-Cash analyst.",
    "Answer only from the provided rows.",
    "Do not invent facts or values that are not present.",
    "If rows are empty, clearly say no matching records were found.",
    "Keep the answer to 4 short sentences or fewer.",
    "",
    `Question: ${question}`,
    `SQL: ${sql}`,
    `Rows: ${JSON.stringify(rows.slice(0, 25))}`
  ].join("\n");

  return llmProvider.generateText(prompt);
}

function executeValidatedSql(
  model: DataModel,
  sql: string,
  maxRows: number
): {
  sql: string;
  columns: string[];
  rows: QueryRows;
} {
  const normalized = ensureLimit(sql, maxRows);
  const validation = validateReadOnlySql(normalized, model.semanticCatalog, {
    maxRows
  });
  if (!validation.valid) {
    throw new Error(validation.reason ?? "SQL validation failed.");
  }

  return executeQuery(model.db, normalized);
}

function buildRejectedResponse(
  model: DataModel,
  reason: string | undefined,
  notes: string[],
  intent: string
): QueryResponse {
  return {
    rejected: true,
    answer: reason ?? "This system is designed for dataset questions only.",
    sql: null,
    columns: [],
    rows: [],
    highlights: [],
    focus: null,
    intent,
    engine: "guardrail",
    reason,
    planSteps: ["The request was rejected before query execution."],
    guardrailNotes: notes,
    suggestions: model.examplePrompts
  };
}
