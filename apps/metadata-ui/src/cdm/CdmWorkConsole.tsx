import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import type { Role } from "../auth/AuthProvider";
import { CdmWorkListView } from "./CdmWorkListView";
import { CdmWorkItemDetailView } from "./CdmWorkItemDetailView";

type CdmWorkConsoleProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
};

export function CdmWorkConsole({ metadataEndpoint, authToken, projectSlug: _projectSlug, userRole }: CdmWorkConsoleProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useMemo(
    () => [
      { id: "items", label: "Work Items", href: "work/items" },
    ],
    [],
  );
  const activeTab = useMemo(() => {
    const match = tabs.find((tab) => location.pathname.includes(`/cdm/${tab.href}`));
    return match?.id ?? "items";
  }, [location.pathname, tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/60 dark:bg-slate-900/60">
      <header className="border-b border-slate-200 bg-white/80 px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">CDM</p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Work Explorer</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Read-only view of CDM work projects, items, comments, and worklogs.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(`/cdm/${tab.href}${location.search || ""}`)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
                  activeTab === tab.id
                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                    : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="work/items" replace />} />
          <Route
            path="work/items"
            element={<CdmWorkListView metadataEndpoint={metadataEndpoint} authToken={authToken} userRole={userRole} />}
          />
          <Route
            path="work/items/:cdmId"
            element={<CdmWorkItemDetailView metadataEndpoint={metadataEndpoint} authToken={authToken} />}
          />
          <Route path="*" element={<Navigate to="work/items" replace />} />
        </Routes>
      </main>
    </div>
  );
}
