import type { ChatMessage } from "../../shared/types.js";
import { buildTargetedSchemaSummary } from "../storage/semantic-layer.js";
import type { DataModel } from "./data-model.js";
import type { LlmProvider } from "./llm-provider.js";
import { evaluateQuestionDomain } from "./guardrails.js";

export interface QuestionAssessment {
  allowed: boolean;
  reason?: string;
  notes: string[];
  maxRows: number;
  redactSensitiveFields: boolean;
  intentHint?: string;
  engine: "deterministic" | "llm";
}

type ClassificationResult = {
  decision: "allow" | "reject";
  intent: string;
  risk: "standard" | "sensitive" | "bulk";
  reason?: string;
  notes?: string[];
};

export async function assessQuestion(
  question: string,
  conversation: ChatMessage[],
  model: DataModel,
  llmProvider: LlmProvider
): Promise<QuestionAssessment> {
  const deterministic = evaluateQuestionDomain(question, model);
  if (!deterministic.allowed || !llmProvider.isConfigured()) {
    return {
      ...deterministic,
      engine: "deterministic"
    };
  }

  try {
    const prompt = [
      "You are a guardrail classifier for an order-to-cash analytics assistant.",
      "Allow only questions grounded in the provided business dataset domain.",
      "Reject general knowledge, creative writing, and full-dataset extraction requests.",
      "Treat address/contact data as privacy-sensitive.",
      'Return strict JSON: {"decision":"allow|reject","intent":"short-intent","risk":"standard|sensitive|bulk","reason":"optional","notes":["optional"]}',
      "",
      buildTargetedSchemaSummary(question, model.semanticCatalog),
      "",
      "Recent conversation:",
      conversation
        .slice(-4)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n"),
      "",
      `Question: ${question}`
    ].join("\n");

    const result = await llmProvider.generateJson<ClassificationResult>(prompt);
    if (result.decision === "reject") {
      return {
        allowed: false,
        reason:
          result.reason ??
          "This system is designed to answer questions related to the provided dataset only.",
        notes: [
          ...(deterministic.notes ?? []),
          ...(result.notes ?? []),
          "The LLM safety router rejected the prompt after reviewing intent and extraction risk."
        ],
        maxRows: 0,
        redactSensitiveFields: true,
        intentHint: result.intent,
        engine: "llm"
      };
    }

    const sensitive = result.risk === "sensitive";
    const bulk = result.risk === "bulk";
    if (bulk) {
      return {
        allowed: false,
        reason:
          result.reason ??
          "This system does not allow bulk export or full-dataset extraction requests.",
        notes: [
          ...(deterministic.notes ?? []),
          ...(result.notes ?? []),
          "The LLM safety router marked the prompt as bulk extraction."
        ],
        maxRows: 0,
        redactSensitiveFields: true,
        intentHint: result.intent,
        engine: "llm"
      };
    }

    return {
      allowed: true,
      reason: result.reason,
      notes: [
        ...deterministic.notes,
        ...(result.notes ?? []),
        `The LLM safety router classified the request as ${result.risk}.`
      ],
      maxRows: sensitive ? Math.min(deterministic.maxRows, 20) : deterministic.maxRows,
      redactSensitiveFields:
        deterministic.redactSensitiveFields || sensitive,
      intentHint: result.intent,
      engine: "llm"
    };
  } catch {
    return {
      ...deterministic,
      engine: "deterministic"
    };
  }
}
