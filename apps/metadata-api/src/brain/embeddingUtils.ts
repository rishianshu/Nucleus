import type { EmbeddingProvider } from "./types.js";

const VECTOR_DIMENSION = 1536;

export function buildOneHotVector(position = 0, magnitude = 1): number[] {
  const vector = new Array<number>(VECTOR_DIMENSION).fill(0);
  const normalized = Math.max(0, Math.min(VECTOR_DIMENSION - 1, Math.floor(position)));
  vector[normalized] = Number.isFinite(magnitude) ? magnitude : 0;
  return vector;
}

export function hashTextToVector(text: string): number[] {
  const seed = Array.from(text ?? "")
    .map((char) => char.charCodeAt(0))
    .reduce((acc, code) => acc + code, 0);
  return buildOneHotVector(seed % VECTOR_DIMENSION, 1);
}

export class HashingEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly resolver: (text: string) => number[] = hashTextToVector) {}

  async embedText(_model: string, texts: string[]): Promise<number[][]> {
    return texts.map((value) => this.resolver(value));
  }
}

export class DeterministicFakeEmbeddingProvider extends HashingEmbeddingProvider {
  constructor(resolver: (text: string) => number[] = hashTextToVector) {
    super(resolver);
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    private readonly model = process.env.OLLAMA_MODEL || "all-minilm",
  ) {}

  async embedText(_model: string, texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vector = await this.fetchEmbedding(text);
      results.push(normalizeVector(vector));
    }
    return results;
  }

  private async fetchEmbedding(text: string): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ollama embeddings failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { embedding: number[] };
    if (!json?.embedding || !Array.isArray(json.embedding)) {
      throw new Error("ollama embeddings response missing embedding");
    }
    return json.embedding.map((v) => (Number.isFinite(v) ? Number(v) : 0));
  }
}

function normalizeVector(vector: number[]): number[] {
  if (vector.length === VECTOR_DIMENSION) {
    return vector.map((v) => (Number.isFinite(v) ? Number(v) : 0));
  }
  // Pad or truncate to fit expected dimension
  const out = new Array<number>(VECTOR_DIMENSION).fill(0);
  for (let i = 0; i < Math.min(VECTOR_DIMENSION, vector.length); i += 1) {
    out[i] = Number.isFinite(vector[i]) ? Number(vector[i]) : 0;
  }
  return out;
}
