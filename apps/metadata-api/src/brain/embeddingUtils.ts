import type { EmbeddingProvider } from "./types.js";
import { VECTOR_DIMENSION } from "./vectorIndexStore.js";

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
