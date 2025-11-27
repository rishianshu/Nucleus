import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_WORK_ITEM_DETAIL_QUERY } from "../metadata/queries";
import type { CdmWorkItemDetail } from "../metadata/types";

type CdmWorkItemDetailViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

type DetailResponse = {
  cdmWorkItem: CdmWorkItemDetail | null;
};

export function CdmWorkItemDetailView({ metadataEndpoint, authToken }: CdmWorkItemDetailViewProps) {
  const { cdmId } = useParams<{ cdmId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CdmWorkItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    async function load() {
      if (!metadataEndpoint || !cdmId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMetadataGraphQL<DetailResponse>(
          metadataEndpoint,
          CDM_WORK_ITEM_DETAIL_QUERY,
          { cdmId },
          undefined,
          { token: authToken ?? undefined },
        );
        if (!aborted) {
          setDetail(data.cdmWorkItem ?? null);
        }
      } catch (err) {
        if (!aborted) {
          setError((err as Error).message);
        }
      } finally {
        if (!aborted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      aborted = true;
    };
  }, [metadataEndpoint, authToken, cdmId]);

  if (!metadataEndpoint) {
    return <div className="text-sm text-rose-500">Metadata endpoint not configured.</div>;
  }
  if (!cdmId) {
    return <div className="text-sm text-slate-500">Select a work item from the list.</div>;
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Loading work item…</div>;
  }
  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-500">{error}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
        >
          Back
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Work item not found.</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
        >
          Back
        </button>
      </div>
    );
  }

  const { item, comments, worklogs } = detail;

  return (
    <div data-testid="cdm-work-detail" className="space-y-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
      >
        Back to list
      </button>
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">{item.sourceSystem}</p>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{item.summary}</h2>
            <p className="text-sm text-slate-500">{item.sourceIssueKey}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Status: {item.status ?? "—"}</p>
            <p className="text-slate-500">Priority: {item.priority ?? "—"}</p>
            <p className="text-slate-500">Project: {item.projectCdmId}</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Reporter</dt>
            <dd className="text-slate-900 dark:text-slate-100">{item.reporter?.displayName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Assignee</dt>
            <dd className="text-slate-900 dark:text-slate-100">{item.assignee?.displayName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Created</dt>
            <dd>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Updated</dt>
            <dd>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Closed</dt>
            <dd>{item.closedAt ? new Date(item.closedAt).toLocaleString() : "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <header className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-800">
            Comments ({comments.length})
          </header>
          {comments.length === 0 ? (
            <p className="text-sm text-slate-500">No comments recorded.</p>
          ) : (
            <ul className="space-y-4">
              {comments.map((comment) => (
                <li key={comment.cdmId} className="rounded-2xl border border-slate-100 p-3 dark:border-slate-800">
                  <div className="text-sm text-slate-900 dark:text-slate-100">{comment.body}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {comment.author?.displayName ?? "Unknown"} · {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <header className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-800">
            Worklogs ({worklogs.length})
          </header>
          {worklogs.length === 0 ? (
            <p className="text-sm text-slate-500">No worklogs recorded.</p>
          ) : (
            <ul className="space-y-4">
              {worklogs.map((log) => (
                <li key={log.cdmId} className="rounded-2xl border border-slate-100 p-3 dark:border-slate-800">
                  <div className="text-sm text-slate-900 dark:text-slate-100">
                    {log.timeSpentSeconds ? formatDuration(log.timeSpentSeconds) : "—"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {log.author?.displayName ?? "Unknown"} · {log.startedAt ? new Date(log.startedAt).toLocaleString() : "—"}
                  </div>
                  {log.comment ? <p className="mt-2 text-sm text-slate-600">{log.comment}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}
