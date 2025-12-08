import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getPrismaClient } from "./prismaClient.js";

type AuthSession = {
  id: string;
  endpointId: string;
  state: string;
  createdAt: string;
  settings: OneDriveAuthSettings;
};

type StoredToken = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  tenant?: string | null;
  scopes?: string[];
};

const sessionStore: Map<string, AuthSession> = new Map();

const AUTHORIZE_URL =
  process.env.ONEDRIVE_OAUTH_AUTHORIZE_URL ?? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL =
  process.env.ONEDRIVE_OAUTH_TOKEN_URL ?? "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const CLIENT_ID = process.env.ONEDRIVE_OAUTH_CLIENT_ID ?? "stub-client-id";
const CLIENT_SECRET = process.env.ONEDRIVE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.METADATA_ONEDRIVE_OAUTH_REDIRECT ??
  (process.env.METADATA_API_EXTERNAL_URL
    ? `${process.env.METADATA_API_EXTERNAL_URL.replace(/\/$/, "")}/auth/onedrive/callback`
    : "http://localhost:4011/auth/onedrive/callback");

export type OneDriveAuthSession = {
  authSessionId: string;
  authUrl: string;
  state: string;
};

export type OneDriveAuthSettings = {
  clientId: string;
  clientSecret?: string | null;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
};

function deriveOneDriveAuthSettings(parameters?: Record<string, unknown> | null): OneDriveAuthSettings {
  const clientId =
    (parameters?.client_id as string | undefined)?.trim() ||
    (parameters?.clientId as string | undefined)?.trim() ||
    CLIENT_ID;
  const clientSecret =
    (parameters?.client_secret as string | undefined)?.trim() ||
    (parameters?.clientSecret as string | undefined)?.trim() ||
    CLIENT_SECRET;
  const tenant =
    (parameters?.tenant_id as string | undefined)?.trim() || (parameters?.tenantId as string | undefined)?.trim();
  const baseAuthorize =
    (parameters?.authorize_url as string | undefined)?.trim() ||
    (parameters?.authorizeUrl as string | undefined)?.trim() ||
    AUTHORIZE_URL;
  const baseToken =
    (parameters?.token_url as string | undefined)?.trim() ||
    (parameters?.tokenUrl as string | undefined)?.trim() ||
    TOKEN_URL;
  const authorizeUrl =
    tenant && baseAuthorize.includes("login.microsoftonline.com")
      ? baseAuthorize.replace("/common/", `/${tenant}/`).replace("/common", `/${tenant}`)
      : baseAuthorize;
  const tokenUrl =
    tenant && baseToken.includes("login.microsoftonline.com")
      ? baseToken.replace("/common/", `/${tenant}/`).replace("/common", `/${tenant}`)
      : baseToken;
  const redirectUri =
    (parameters?.redirect_uri as string | undefined)?.trim() ||
    (parameters?.redirectUri as string | undefined)?.trim() ||
    REDIRECT_URI;
  return { clientId, clientSecret, authorizeUrl, tokenUrl, redirectUri };
}

export async function startOneDriveAuth(
  endpointId: string,
  parameters?: Record<string, unknown> | null,
): Promise<OneDriveAuthSession> {
  const settings = deriveOneDriveAuthSettings(parameters);
  const state = randomUUID();
  const session: AuthSession = {
    id: state,
    state,
    endpointId,
    createdAt: new Date().toISOString(),
    settings,
  };
  sessionStore.set(state, session);
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: "offline_access Files.Read.All",
    state,
  });
  return {
    authSessionId: state,
    authUrl: `${settings.authorizeUrl}?${params.toString()}`,
    state,
  };
}

export async function completeOneDriveAuthCallback(
  state: string,
  code: string | null,
): Promise<{ ok: boolean; endpointId?: string }> {
  const session = sessionStore.get(state);
  if (!session) {
    return { ok: false };
  }
  sessionStore.delete(state);
  if (!code) {
    return { ok: false, endpointId: session.endpointId };
  }
  const tokens = await readTokenFile();
  const exchanged = await exchangeOneDriveCode(code, session.settings);
  const tokenPayload: StoredToken =
    exchanged ??
    {
      access_token: `mock-access-${code}`,
      refresh_token: `mock-refresh-${code}`,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ["Files.Read.All"],
    };
  tokens[session.endpointId] = tokenPayload;
  await writeTokenFile(tokens);
  return { ok: true, endpointId: session.endpointId };
}

async function readTokenFile(): Promise<Record<string, StoredToken>> {
  try {
    const raw = await fs.readFile(resolveTokenStorePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeTokenFile(tokens: Record<string, StoredToken>): Promise<void> {
  const target = resolveTokenStorePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(tokens, null, 2), "utf-8");
}

export async function getOneDriveDelegatedToken(endpointId: string): Promise<StoredToken | null> {
  const tokens = await readTokenFile();
  return tokens[endpointId] ?? null;
}

function resolveTokenStorePath(): string {
  return (
    process.env.METADATA_ONEDRIVE_TOKEN_FILE ??
    path.join(process.cwd(), "apps", "metadata-api", "metadata", "onedrive_tokens.json")
  );
}

function normalizePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function exchangeOneDriveCode(code: string, settings: OneDriveAuthSettings): Promise<StoredToken | null> {
  if (!settings.clientSecret) {
    return null;
  }
  try {
    const body = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: settings.redirectUri,
      grant_type: "authorization_code",
      scope: "offline_access Files.Read.All",
    });
    const resp = await fetch(settings.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      return null;
    }
    const payload = (await resp.json()) as Record<string, unknown>;
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : null;
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : null;
    if (!accessToken || !refreshToken) {
      return null;
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 3600);
    const scopes =
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter((entry) => entry.trim().length > 0)
        : Array.isArray(payload.scope)
          ? payload.scope.filter((entry): entry is string => typeof entry === "string")
          : undefined;
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + Math.max(1, expiresIn) * 1000).toISOString(),
      tenant: typeof payload.tenant === "string" ? payload.tenant : null,
      scopes,
    };
  } catch {
    return null;
  }
}

export async function markOneDriveEndpointDelegatedConnected(endpointId: string): Promise<void> {
  try {
    const prisma = await getPrismaClient();
    const endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) {
      return;
    }
    const config = normalizePayload(endpoint.config) ?? {};
    const parameters = normalizePayload(config.parameters) ?? {};
    parameters.delegated_connected = true;
    config.parameters = parameters;
    await prisma.metadataEndpoint.update({
      where: { id: endpointId },
      data: { config },
    });
  } catch {
    // Best-effort status update; ignore persistence failures.
  }
}
