import type { EmbeddingProvider } from "./types.js";
import { DeterministicFakeEmbeddingProvider, HashingEmbeddingProvider, OllamaEmbeddingProvider } from "./embeddingUtils.js";

export function makeEmbeddingProvider(): EmbeddingProvider {
  const provider = (process.env.BRAIN_EMBEDDING_PROVIDER || "").toLowerCase();
  switch (provider) {
    case "ollama":
      return new OllamaEmbeddingProvider();
    case "hash":
      return new HashingEmbeddingProvider();
    case "deterministic":
    default:
      return new DeterministicFakeEmbeddingProvider();
  }
}
