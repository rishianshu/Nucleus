import { getPrismaClient } from "../prismaClient.js";
import { PrismaIndexProfileStore } from "./indexProfileStore.js";
import { PrismaVectorIndexStore } from "./vectorIndexStore.js";
import type {
  BrainVectorSearch,
  BrainVectorSearchHit,
  EmbeddingProvider,
  IndexProfileStore,
  VectorIndexStore,
} from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

export class BrainVectorSearchService implements BrainVectorSearch {
  private readonly profileStore: IndexProfileStore;
  private readonly vectorStore: VectorIndexStore;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(options: {
    embeddingProvider: EmbeddingProvider;
    resolvePrisma?: () => Promise<PrismaClientInstance>;
    profileStore?: IndexProfileStore;
    vectorStore?: VectorIndexStore;
  }) {
    const resolvePrisma = options.resolvePrisma ?? getPrismaClient;
    this.embeddingProvider = options.embeddingProvider;
    this.profileStore = options.profileStore ?? new PrismaIndexProfileStore(resolvePrisma);
    this.vectorStore = options.vectorStore ?? new PrismaVectorIndexStore(resolvePrisma);
  }

  async search(args: {
    profileId: string;
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyIn?: string[];
    profileKindIn?: string[];
  }): Promise<BrainVectorSearchHit[]> {
    const baseProfile = await this.profileStore.getProfile(args.profileId);
    if (!baseProfile) {
      throw new Error(`Index profile not found: ${args.profileId}`);
    }
    let targetProfiles = [baseProfile];
    if (args.profileKindIn && args.profileKindIn.length > 0) {
      const allowed = new Set(args.profileKindIn);
      const allProfiles = await this.profileStore.listProfiles();
      targetProfiles = allProfiles.filter((profile) => allowed.has(profile.profileKind));
      if (!targetProfiles.find((profile) => profile.id === baseProfile.id)) {
        targetProfiles.push(baseProfile);
      }
    }
    const combinedResults: BrainVectorSearchHit[] = [];
    const embeddings = await Promise.all(
      targetProfiles.map(async (profile) => {
        const [vector] = await this.embeddingProvider.embedText(profile.embeddingModel, [args.queryText]);
        return { profile, vector } as const;
      }),
    );
    for (const { profile, vector } of embeddings) {
      if (!vector) {
        continue;
      }
      const results = await this.vectorStore.query({
        profileId: profile.id,
        queryEmbedding: vector,
        topK: args.topK,
        filter: {
          tenantId: args.tenantId,
          projectKeyIn: args.projectKeyIn,
          profileKindIn: args.profileKindIn,
        },
      });
      combinedResults.push(
        ...results.map((result) => ({
          nodeId: result.nodeId,
          score: result.score,
          profileId: profile.id,
          profileKind: (result.metadata?.profileKind as string | undefined) ?? profile.profileKind,
          projectKey: (result.metadata?.projectKey as string | null | undefined) ?? null,
          sourceSystem: (result.metadata?.sourceSystem as string | null | undefined) ?? null,
          tenantId: (result.metadata?.tenantId as string | null | undefined) ?? null,
          metadata: result.metadata ?? null,
        })),
      );
    }
    combinedResults.sort((a, b) => b.score - a.score);
    return combinedResults.slice(0, args.topK);
  }
}
