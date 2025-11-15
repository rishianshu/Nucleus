import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "metadata", "store");
const RECORDS_FILE = "records.json";
const ENDPOINTS_FILE = "endpoints.json";
export class FileMetadataStore {
    rootDir;
    recordsFile;
    endpointsFile;
    constructor(options) {
        this.rootDir = options?.rootDir ?? DEFAULT_DATA_DIR;
        this.recordsFile = path.resolve(this.rootDir, options?.filename ?? RECORDS_FILE);
        this.endpointsFile = path.resolve(this.rootDir, ENDPOINTS_FILE);
    }
    async listRecords(domain, filter) {
        const records = await this.loadRecords();
        return records
            .filter((record) => record.domain === domain)
            .filter((record) => {
            if (filter?.projectId && record.projectId !== filter.projectId) {
                return false;
            }
            if (filter?.labels?.length) {
                const labels = record.labels ?? [];
                if (!filter.labels.every((label) => labels.includes(label))) {
                    return false;
                }
            }
            if (filter?.search) {
                const haystack = JSON.stringify(record.payload).toLowerCase();
                if (!haystack.includes(filter.search.toLowerCase())) {
                    return false;
                }
            }
            return true;
        })
            .slice(0, filter?.limit ?? Number.POSITIVE_INFINITY);
    }
    async getRecord(domain, id) {
        const records = await this.loadRecords();
        return records.find((record) => record.domain === domain && record.id === id) ?? null;
    }
    async upsertRecord(input) {
        const records = await this.loadRecords();
        let record = records.find((entry) => entry.domain === input.domain && entry.id === input.id);
        const now = new Date().toISOString();
        if (!record) {
            record = {
                id: input.id ?? cryptoRandomId(),
                projectId: input.projectId,
                domain: input.domain,
                labels: input.labels ?? [],
                payload: input.payload,
                createdAt: now,
                updatedAt: now,
            };
            records.push(record);
        }
        else {
            record.projectId = input.projectId;
            record.labels = input.labels ?? [];
            record.payload = input.payload;
            record.updatedAt = now;
        }
        await this.persistRecords(records);
        return record;
    }
    async deleteRecord(domain, id) {
        const records = await this.loadRecords();
        const next = records.filter((record) => !(record.domain === domain && record.id === id));
        await this.persistRecords(next);
    }
    async listDomains() {
        const records = await this.loadRecords();
        const domainMap = new Map();
        records.forEach((record) => {
            const entry = domainMap.get(record.domain) ?? {
                key: record.domain,
                title: record.domain,
                itemCount: 0,
            };
            entry.itemCount += 1;
            domainMap.set(record.domain, entry);
        });
        return Array.from(domainMap.values());
    }
    async listEndpoints(projectId) {
        const endpoints = await this.loadEndpoints();
        if (!projectId) {
            return endpoints;
        }
        return endpoints.filter((endpoint) => endpoint.projectId === projectId);
    }
    async registerEndpoint(endpoint) {
        const endpoints = await this.loadEndpoints();
        const existingIndex = endpoints.findIndex((entry) => entry.id === endpoint.id);
        if (existingIndex >= 0) {
            endpoints[existingIndex] = endpoint;
        }
        else {
            endpoints.push(endpoint);
        }
        await this.persistEndpoints(endpoints);
        return endpoint;
    }
    async loadRecords() {
        await ensureDir(this.rootDir);
        try {
            const contents = await readFile(this.recordsFile, "utf-8");
            const parsed = JSON.parse(contents);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (error) {
            if (isENOENT(error)) {
                await this.persistRecords([]);
                return [];
            }
            throw error;
        }
    }
    async persistRecords(records) {
        await ensureDir(this.rootDir);
        await writeFile(this.recordsFile, JSON.stringify(records, null, 2), "utf-8");
    }
    async loadEndpoints() {
        await ensureDir(this.rootDir);
        try {
            const contents = await readFile(this.endpointsFile, "utf-8");
            const parsed = JSON.parse(contents);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (error) {
            if (isENOENT(error)) {
                await this.persistEndpoints([]);
                return [];
            }
            throw error;
        }
    }
    async persistEndpoints(endpoints) {
        await ensureDir(this.rootDir);
        await writeFile(this.endpointsFile, JSON.stringify(endpoints, null, 2), "utf-8");
    }
}
export class PrismaMetadataStore {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listRecords(domain, filter) {
        const records = await this.prisma.metadataRecord.findMany({
            where: {
                domain,
                projectId: filter?.projectId,
                labels: filter?.labels?.length ? { hasEvery: filter.labels } : undefined,
            },
            orderBy: { createdAt: "desc" },
            take: filter?.limit,
        });
        return records.map((record) => mapPrismaRecord(record));
    }
    async getRecord(domain, id) {
        const record = await this.prisma.metadataRecord.findUnique({ where: { id } });
        if (!record || record.domain !== domain) {
            return null;
        }
        return mapPrismaRecord(record);
    }
    async upsertRecord(input) {
        if (input.id) {
            const upserted = await this.prisma.metadataRecord.upsert({
                where: { id: input.id },
                update: {
                    projectId: input.projectId,
                    domain: input.domain,
                    labels: input.labels ?? [],
                    payload: input.payload,
                },
                create: {
                    id: input.id,
                    projectId: input.projectId,
                    domain: input.domain,
                    labels: input.labels ?? [],
                    payload: input.payload,
                },
            });
            return mapPrismaRecord(upserted);
        }
        const created = await this.prisma.metadataRecord.create({
            data: {
                projectId: input.projectId,
                domain: input.domain,
                labels: input.labels ?? [],
                payload: input.payload,
            },
        });
        return mapPrismaRecord(created);
    }
    async deleteRecord(domain, id) {
        const record = await this.prisma.metadataRecord.findUnique({ where: { id } });
        if (!record || record.domain !== domain) {
            return;
        }
        await this.prisma.metadataRecord.delete({ where: { id } });
    }
    async listDomains() {
        const explicit = (await this.prisma.metadataDomain?.findMany?.()) ?? [];
        if (explicit.length > 0) {
            return explicit.map((domain) => ({
                key: domain.key,
                title: domain.title,
                description: domain.description ?? undefined,
                itemCount: domain.itemCount ?? 0,
            }));
        }
        if (typeof this.prisma.metadataRecord.groupBy === "function") {
            const aggregates = await this.prisma.metadataRecord.groupBy({
                by: ["domain"],
                _count: { domain: true },
            });
            return aggregates.map((entry) => ({
                key: entry.domain,
                title: entry.domain,
                itemCount: entry._count?.domain ?? 0,
            }));
        }
        const records = await this.prisma.metadataRecord.findMany({
            select: { domain: true },
        });
        const domainCounts = records.reduce((acc, record) => {
            acc[record.domain] = (acc[record.domain] ?? 0) + 1;
            return acc;
        }, {});
        return Object.entries(domainCounts).map(([key, count]) => ({
            key,
            title: key,
            itemCount: count,
        }));
    }
    async listEndpoints(projectId) {
        const endpoints = await this.prisma.metadataEndpoint.findMany({
            where: projectId ? { projectId } : undefined,
        });
        return endpoints.map(mapPrismaEndpoint);
    }
    async registerEndpoint(endpoint) {
        const endpointId = endpoint.id ?? cryptoRandomId();
        const result = await this.prisma.metadataEndpoint.upsert({
            where: { id: endpointId },
            update: {
                name: endpoint.name,
                description: endpoint.description ?? null,
                verb: endpoint.verb,
                url: endpoint.url,
                authPolicy: endpoint.authPolicy ?? null,
                projectId: endpoint.projectId ?? null,
                domain: endpoint.domain ?? null,
                labels: endpoint.domain ? [endpoint.domain] : [],
            },
            create: {
                id: endpointId,
                name: endpoint.name,
                description: endpoint.description ?? null,
                verb: endpoint.verb,
                url: endpoint.url,
                authPolicy: endpoint.authPolicy ?? null,
                projectId: endpoint.projectId ?? null,
                domain: endpoint.domain ?? null,
                labels: endpoint.domain ? [endpoint.domain] : [],
            },
        });
        return mapPrismaEndpoint(result);
    }
}
function mapPrismaRecord(record) {
    return {
        id: record.id,
        projectId: record.projectId,
        domain: record.domain,
        labels: record.labels ?? [],
        payload: record.payload,
        createdAt: (record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)).toISOString(),
        updatedAt: (record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt)).toISOString(),
    };
}
function mapPrismaEndpoint(endpoint) {
    return {
        id: endpoint.id,
        name: endpoint.name,
        description: endpoint.description ?? undefined,
        verb: endpoint.verb,
        url: endpoint.url,
        authPolicy: endpoint.authPolicy ?? undefined,
        projectId: endpoint.projectId ?? undefined,
        domain: endpoint.domain ?? undefined,
    };
}
function cryptoRandomId() {
    return Math.random().toString(36).slice(2, 10);
}
async function ensureDir(dir) {
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (error) {
        if (!isEEXIST(error)) {
            throw error;
        }
    }
}
function isENOENT(error) {
    return Boolean(error?.code === "ENOENT");
}
function isEEXIST(error) {
    return Boolean(error?.code === "EEXIST");
}
