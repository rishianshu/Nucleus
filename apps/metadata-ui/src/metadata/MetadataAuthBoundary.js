import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useAuth } from "../auth/AuthProvider";
const BRAND_NAME = import.meta.env.VITE_APP_BRAND ?? "Nucleus Metadata Console";
const REQUESTED_TENANT = import.meta.env.VITE_METADATA_TENANT_ID ?? "dev";
const REQUESTED_PROJECT = import.meta.env.VITE_METADATA_DEFAULT_PROJECT ?? "global";
export function MetadataAuthBoundary({ children }) {
    const auth = useAuth();
    const isLoadingPhase = auth.phase === "boot" ||
        auth.phase === "checking" ||
        auth.phase === "authenticating" ||
        (auth.phase === "anonymous" && auth.autoAttempts < auth.maxAutoAttempts && !auth.error);
    if (isLoadingPhase) {
        return _jsx(AuthLoading, { phase: auth.phase, attempt: auth.autoAttempts });
    }
    const shouldGate = !auth.hasKeycloak || auth.phase === "error" || (auth.phase === "anonymous" && auth.autoAttempts >= auth.maxAutoAttempts);
    if (shouldGate) {
        return (_jsx(MetadataAuthGate, { brandName: BRAND_NAME, phase: auth.phase, hasKeycloak: auth.hasKeycloak, onSignIn: () => auth.login(), autoAttempts: auth.autoAttempts, maxAutoAttempts: auth.maxAutoAttempts, error: auth.error, tenantId: auth.user?.tenantId ?? REQUESTED_TENANT, projectId: auth.user?.projectId ?? REQUESTED_PROJECT }));
    }
    return _jsx(_Fragment, { children: children });
}
function MetadataAuthGate({ brandName, phase, hasKeycloak, onSignIn, autoAttempts, maxAutoAttempts, error, tenantId, projectId, }) {
    const attemptsLeft = Math.max(0, maxAutoAttempts - autoAttempts);
    const showTroubleshooting = phase === "error" || Boolean(error);
    const tenantDisplay = tenantId ?? "unknown tenant";
    const projectDisplay = projectId ?? "unknown project";
    return (_jsx("div", { className: "flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-8 text-slate-50", children: _jsxs("div", { className: "w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-10 shadow-2xl shadow-slate-900/60 backdrop-blur", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-wide text-slate-400", children: brandName }), _jsx("h1", { className: "mt-3 text-3xl font-semibold text-white", children: "Launch the metadata workspace" }), _jsx("p", { className: "mt-3 text-sm text-slate-300", children: "Authenticate via Keycloak so we can load tenants, projects, and endpoint permissions." }), _jsxs("p", { className: "mt-3 text-xs text-slate-500", children: ["Requesting tenant ", _jsx("span", { className: "font-semibold text-slate-300", children: tenantDisplay }), " ", projectDisplay ? (_jsxs(_Fragment, { children: [" ", "\u2022 project ", _jsx("span", { className: "font-semibold text-slate-300", children: projectDisplay })] })) : null] }), !hasKeycloak ? (_jsx("div", { className: "mt-6 rounded-2xl border border-amber-500/60 bg-amber-500/10 p-4 text-sm text-amber-200", children: "Missing `VITE_KEYCLOAK_*` env vars. Update your metadata designer `.env` and restart `pnpm dev`." })) : (_jsx("button", { type: "button", onClick: onSignIn, disabled: phase === "authenticating", className: "mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-white/95 px-6 py-3 text-base font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70", children: phase === "authenticating" ? "Opening Keycloak…" : "Continue with Keycloak" })), _jsxs("p", { className: "mt-3 text-xs text-slate-500", children: ["Auto-login attempts used: ", autoAttempts, "/", maxAutoAttempts, " ", attemptsLeft === 0 ? "— click above to retry." : null] }), showTroubleshooting ? (_jsxs("div", { className: "mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left text-sm", children: [_jsx("p", { className: "font-semibold text-slate-200", children: "Troubleshooting" }), _jsx("p", { className: "mt-1 text-slate-400", children: error?.message ?? "Unknown error" }), error?.timestamp ? (_jsxs("p", { className: "mt-2 text-xs text-slate-500", children: ["Last event: ", formatTimestamp(error.timestamp)] })) : null] })) : null] }) }));
}
function AuthLoading({ phase, attempt }) {
    const message = phase === "authenticating" ? "Opening Keycloak…" : "Checking your session…";
    return (_jsx("div", { className: "flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-300", children: _jsxs("div", { className: "rounded-3xl border border-slate-800 bg-slate-900/70 px-8 py-6 text-center shadow-lg", children: [_jsx("p", { className: "text-sm", children: message }), attempt > 0 ? _jsxs("p", { className: "mt-2 text-xs text-slate-500", children: ["Auto-login attempts: ", attempt] }) : null] }) }));
}
function formatTimestamp(timestamp) {
    try {
        return new Date(timestamp).toLocaleString();
    }
    catch {
        return "";
    }
}
