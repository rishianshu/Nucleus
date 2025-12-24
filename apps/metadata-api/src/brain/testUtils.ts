import type { EmbeddingProvider } from "./types.js";
import { buildOneHotVector, hashTextToVector } from "./embeddingUtils.js";
const VECTOR_DIMENSION = 1536;

export class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly resolver: (text: string) => number[]) {}

  async embedText(_model: string, texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.resolver(text));
  }
}

export { buildOneHotVector, hashTextToVector };

export function buildDenseVector(seed: number): number[] {
  return Array.from({ length: VECTOR_DIMENSION }, (_, idx) => Number(((seed + idx % 5) / (VECTOR_DIMENSION + idx + 1)).toFixed(6)));
}
