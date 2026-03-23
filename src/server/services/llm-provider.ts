import { GeminiClient } from "./gemini-client.js";

export interface LlmProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  generateJson<T>(prompt: string): Promise<T>;
  generateText(prompt: string): Promise<string>;
}

class GeminiProvider implements LlmProvider {
  readonly providerName = "gemini";
  private readonly client = new GeminiClient();

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  generateJson<T>(prompt: string): Promise<T> {
    return this.client.generateJson<T>(prompt);
  }

  generateText(prompt: string): Promise<string> {
    return this.client.generateText(prompt);
  }
}

class NullProvider implements LlmProvider {
  readonly providerName = "none";

  isConfigured(): boolean {
    return false;
  }

  generateJson<T>(): Promise<T> {
    throw new Error("No LLM provider is configured.");
  }

  generateText(): Promise<string> {
    throw new Error("No LLM provider is configured.");
  }
}

export function createDefaultLlmProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  switch (provider) {
    case "gemini":
      return new GeminiProvider();
    default:
      return new NullProvider();
  }
}
