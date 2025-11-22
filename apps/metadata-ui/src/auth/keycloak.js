import Keycloak from "keycloak-js";
const AUTO_ATTEMPTS_KEY = "kc:autoAttempts";
const LAST_ERROR_KEY = "kc:lastError";
const DEFAULT_LOGIN_SCOPE = "openid profile email nucleus-context";
const RAW_LOGIN_SCOPE = typeof import.meta.env.VITE_KC_SCOPE === "string" ? import.meta.env.VITE_KC_SCOPE : null;
const KEYCLOAK_LOGIN_SCOPE = RAW_LOGIN_SCOPE && RAW_LOGIN_SCOPE.trim().length > 0 ? RAW_LOGIN_SCOPE.trim() : DEFAULT_LOGIN_SCOPE;
if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info("[Keycloak] login scope", KEYCLOAK_LOGIN_SCOPE ?? "(default)");
}
if (typeof window !== "undefined") {
    window.__metadataLoginScope =
        KEYCLOAK_LOGIN_SCOPE ?? "";
}
const resolvedConfig = resolveKeycloakConfig();
const keycloakInitOptions = {
    onLoad: "check-sso",
    pkceMethod: "S256",
    responseMode: "fragment",
    promiseType: "native",
    flow: "standard",
};
export const kc = resolvedConfig ? new Keycloak(resolvedConfig) : null;
export const MAX_AUTO_ATTEMPTS = Number(import.meta.env.VITE_KC_MAX_AUTO_ATTEMPTS ?? 1);
let initPromise = null;
export function getAutoAttempts() {
    return readSessionNumber(AUTO_ATTEMPTS_KEY);
}
export function resetAutoAttempts() {
    if (typeof window === "undefined") {
        return;
    }
    window.sessionStorage.removeItem(AUTO_ATTEMPTS_KEY);
}
export function incrementAutoAttempts() {
    if (typeof window === "undefined") {
        return 0;
    }
    const next = getAutoAttempts() + 1;
    window.sessionStorage.setItem(AUTO_ATTEMPTS_KEY, String(next));
    return next;
}
export function getLastAuthError() {
    if (typeof window === "undefined") {
        return null;
    }
    const raw = window.sessionStorage.getItem(LAST_ERROR_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed && typeof parsed.message === "string") {
            return {
                message: parsed.message,
                code: "code" in parsed ? parsed.code : undefined,
                timestamp: "timestamp" in parsed ? parsed.timestamp : Date.now(),
            };
        }
    }
    catch {
        return {
            message: raw,
            timestamp: Date.now(),
        };
    }
    return null;
}
export function setLastAuthError(details) {
    if (typeof window === "undefined") {
        return;
    }
    if (!details) {
        window.sessionStorage.removeItem(LAST_ERROR_KEY);
        return;
    }
    const payload = {
        message: details.message,
        code: details.code,
        timestamp: details.timestamp ?? Date.now(),
    };
    window.sessionStorage.setItem(LAST_ERROR_KEY, JSON.stringify(payload));
}
export function captureKeycloakFragmentError() {
    if (typeof window === "undefined") {
        return null;
    }
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#")) {
        return null;
    }
    const params = new URLSearchParams(hash.slice(1));
    const error = params.get("error");
    if (!error) {
        return null;
    }
    const description = params.get("error_description");
    const message = describeAuthError(error, description);
    const payload = { message, code: error, timestamp: Date.now() };
    setLastAuthError(payload);
    stripHash();
    return payload;
}
export async function initKeycloak() {
    if (!kc || typeof window === "undefined") {
        return { authenticated: false };
    }
    if (!initPromise) {
        initPromise = kc
            .init({
            ...keycloakInitOptions,
            silentCheckSsoRedirectUri: buildSilentCheckUri(),
        })
            .catch((error) => {
            initPromise = null;
            throw error;
        });
    }
    const authenticated = await initPromise;
    if (authenticated) {
        resetAutoAttempts();
        setLastAuthError(null);
    }
    stripAuthCodeFragment();
    return { authenticated };
}
export function maybeAutoLogin() {
    if (!kc || typeof window === "undefined") {
        return null;
    }
    if (getLastAuthError()) {
        return null;
    }
    if (getAutoAttempts() >= MAX_AUTO_ATTEMPTS) {
        return null;
    }
    const attempt = incrementAutoAttempts();
    const redirectUri = buildRedirectUri();
    const options = {
        redirectUri,
        prompt: "login",
        responseMode: "fragment",
    };
    if (KEYCLOAK_LOGIN_SCOPE) {
        options.scope = KEYCLOAK_LOGIN_SCOPE;
    }
    kc.login(options);
    return attempt;
}
function buildSilentCheckUri() {
    if (typeof window === "undefined") {
        return undefined;
    }
    return new URL("/silent-check-sso.html", window.location.origin).toString();
}
function buildRedirectUri() {
    if (typeof window === "undefined") {
        return "";
    }
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search}`;
}
function stripAuthCodeFragment() {
    if (typeof window === "undefined") {
        return;
    }
    const hash = window.location.hash;
    if (!hash || !hash.includes("code=")) {
        return;
    }
    stripHash();
}
function stripHash() {
    if (typeof window === "undefined") {
        return;
    }
    if (!window.location.hash) {
        return;
    }
    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
}
function describeAuthError(code, description) {
    if (description && description.trim().length > 0) {
        return decodeURIComponent(description.replace(/\+/g, " "));
    }
    if (code === "login_required") {
        return "Your session expired. Sign in again to continue.";
    }
    if (code === "access_denied") {
        return "Access was denied. Try signing in again or contact an administrator.";
    }
    return code;
}
function readSessionNumber(key) {
    if (typeof window === "undefined") {
        return 0;
    }
    const raw = window.sessionStorage.getItem(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function resolveKeycloakConfig() {
    const url = stringEnv(import.meta.env.VITE_KC_URL) ?? stringEnv(import.meta.env.VITE_KEYCLOAK_BASE_URL);
    const realm = stringEnv(import.meta.env.VITE_KC_REALM) ?? stringEnv(import.meta.env.VITE_KEYCLOAK_REALM);
    const clientId = stringEnv(import.meta.env.VITE_KC_CLIENT) ?? stringEnv(import.meta.env.VITE_KEYCLOAK_CLIENT_ID);
    if (!url || !realm || !clientId) {
        return null;
    }
    const baseConfig = { url, realm, clientId };
    if (KEYCLOAK_LOGIN_SCOPE) {
        baseConfig.scope = KEYCLOAK_LOGIN_SCOPE;
    }
    return baseConfig;
}
function stringEnv(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
