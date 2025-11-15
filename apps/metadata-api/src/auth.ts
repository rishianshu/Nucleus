import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

export type AuthContext = {
  tenantId: string;
  projectId: string;
  roles: string[];
  subject: string;
};

const KEYCLOAK_BASE =
  process.env.KEYCLOAK_BASE_URL ?? process.env.VITE_KEYCLOAK_BASE_URL ?? "http://localhost:8081";
const KEYCLOAK_REALM =
  process.env.KEYCLOAK_REALM ?? process.env.VITE_KEYCLOAK_REALM ?? "nucleus";
const DEFAULT_ISSUER = `${KEYCLOAK_BASE.replace(/\/$/, "")}/realms/${KEYCLOAK_REALM}`;
const DEFAULT_JWKS_URL = `${DEFAULT_ISSUER}/protocol/openid-connect/certs`;
const expectedIssuer = process.env.KEYCLOAK_EXPECTED_ISSUER ?? DEFAULT_ISSUER;
const expectedAudience =
  process.env.KEYCLOAK_AUDIENCE ??
  process.env.KEYCLOAK_CLIENT_ID ??
  process.env.VITE_KEYCLOAK_CLIENT_ID ??
  null;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const url = process.env.KEYCLOAK_JWKS_URL ?? DEFAULT_JWKS_URL;
    if (!url) {
      return null;
    }
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export async function authenticateRequest(authorizationHeader?: string | null): Promise<AuthContext> {
  const jwkSet = getJwks();
  if (!jwkSet || !authorizationHeader) {
    if (!jwkSet && process.env.METADATA_AUTH_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.warn("[metadata-auth] JWKS not configured", process.env.KEYCLOAK_JWKS_URL ?? DEFAULT_JWKS_URL);
    }
    return buildAnonymousContext();
  }
  if (process.env.METADATA_AUTH_DEBUG === "1") {
    // eslint-disable-next-line no-console
    console.info("[metadata-auth] incoming header", authorizationHeader.slice(0, 16));
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if ((scheme ?? "").toLowerCase() !== "bearer" || !token) {
    return buildAnonymousContext();
  }
  try {
    const decoded = decodeJwt(token);
    const verifyOptions: {
      issuer?: string;
      audience?: string;
    } = {
      issuer: expectedIssuer || undefined,
    };
    if (expectedAudience && decoded.aud) {
      verifyOptions.audience = expectedAudience;
    }
    const result = await jwtVerify(token, jwkSet, verifyOptions);
    const payload = result.payload as Record<string, unknown>;
    const tenantId = stringClaim(payload["tenant_id"]) ?? process.env.TENANT_ID ?? "dev";
    const projectId = stringClaim(payload["project_id"]) ?? process.env.METADATA_DEFAULT_PROJECT ?? "global";
    let roles = deriveRoles(payload);
    const scopeRoles = deriveRolesFromScope(payload);
    if (scopeRoles.length > 0) {
      roles = Array.from(new Set([...roles, ...scopeRoles]));
    }
    const subject = stringClaim(payload["sub"]) ?? "anonymous";
    if (process.env.METADATA_AUTH_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.info("[metadata-auth]", { subject, roles, scope: payload["scope"] ?? null });
    }
    return { tenantId, projectId, roles, subject };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Token verification failed", error);
    return buildAnonymousContext();
  }
}

function buildAnonymousContext(): AuthContext {
  return {
    tenantId: process.env.TENANT_ID ?? "dev",
    projectId: process.env.METADATA_DEFAULT_PROJECT ?? "global",
    roles: [],
    subject: "anonymous",
  };
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function arrayClaim(value: unknown): string[] | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return null;
}

function deriveRoles(payload: Record<string, unknown>): string[] {
  const directRoles = arrayClaim(payload["roles"]) ?? [];
  const realmAccess = payload["realm_access"];
  const realmRoles = arrayClaim((realmAccess as Record<string, unknown> | undefined)?.roles) ?? [];
  const resourceAccess = payload["resource_access"];
  const resourceRoles: string[] = [];
  if (resourceAccess && typeof resourceAccess === "object") {
    Object.values(resourceAccess as Record<string, { roles?: unknown }>).forEach((entry) => {
      const roles = arrayClaim(entry?.roles);
      if (roles) {
        resourceRoles.push(...roles);
      }
    });
  }
  const combined = [...directRoles, ...realmRoles, ...resourceRoles];
  return Array.from(new Set(combined.map((role) => role.toLowerCase())));
}

function deriveRolesFromScope(payload: Record<string, unknown>): string[] {
  const scope = stringClaim(payload["scope"]);
  if (!scope) {
    return [];
  }
  const scopes = scope.split(" ").map((entry) => entry.trim());
  if (scopes.includes("nucleus-context")) {
    return ["writer"];
  }
  return [];
}
