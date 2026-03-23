export class GeminiClient {
  private readonly apiKey: string | null;
  private readonly model: string;

  constructor(apiKey = process.env.GEMINI_API_KEY ?? null) {
    this.apiKey = apiKey && apiKey !== "put-your-api-key-here" ? apiKey : null;
    this.model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generateJson<T>(prompt: string): Promise<T> {
    const text = await this.generate(prompt, "application/json");
    return parseJsonResponse<T>(text);
  }

  async generateText(prompt: string): Promise<string> {
    return this.generate(prompt, "text/plain");
  }

  private async generate(
    prompt: string,
    responseMimeType: "application/json" | "text/plain"
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: responseMimeType === "application/json" ? 0.1 : 0.2,
            responseMimeType
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    return text;
  }
}

function parseJsonResponse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? raw;
    return JSON.parse(fenced) as T;
  }
}
