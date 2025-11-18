import { useEffect, useCallback } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { useAsyncAction, useToastQueue, usePagedQuery } from "./hooks";
import { fetchMetadataGraphQL } from "./api";

vi.mock("./api", () => ({
  fetchMetadataGraphQL: vi.fn(),
}));

const fetchMetadataGraphQLMock = fetchMetadataGraphQL as unknown as Mock;

function ToastHookHarness({ onReady }: { onReady: (api: ReturnType<typeof useToastQueue>) => void }) {
  const api = useToastQueue();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return (
    <div>
      {api.toasts.map((toast) => (
        <span key={toast.id}>{toast.title}</span>
      ))}
    </div>
  );
}

function AsyncActionHarness({ fn }: { fn: (payload: string) => Promise<unknown> }) {
  const action = useAsyncAction(fn);
  return (
    <div>
      <span data-testid="state">{action.state}</span>
      {action.error ? <span data-testid="error">{action.error.message}</span> : null}
      <button
        data-testid="run"
        type="button"
        onClick={() => {
          action.run("input").catch(() => {
            // errors exercised via exposed state
          });
        }}
      >
        Run
      </button>
    </div>
  );
}

function PagedQueryHarness() {
  const selectConnection = useCallback(
    (payload: { testConnection?: { nodes?: string[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } }) =>
      payload.testConnection,
    [],
  );
  const paged = usePagedQuery<string>({
    metadataEndpoint: "/graphql",
    token: "token",
    query: "TestQuery",
    selectConnection,
  });
  return (
    <div>
      <span data-testid="paged-state">{paged.loading ? "loading" : "idle"}</span>
      {paged.error ? <span data-testid="paged-error">{paged.error}</span> : null}
      <ul>
        {paged.items.map((item, index) => (
          <li key={`${item}-${index}`} data-testid="paged-item">
            {item}
          </li>
        ))}
      </ul>
      <button type="button" data-testid="next-page" onClick={() => paged.fetchNext()}>
        Next page
      </button>
    </div>
  );
}

beforeEach(() => {
  fetchMetadataGraphQLMock.mockReset();
});

describe("metadata hooks", () => {
  it("queues and auto-dismisses toasts", async () => {
    let apiRef: ReturnType<typeof useToastQueue> | null = null;
    render(<ToastHookHarness onReady={(api) => { apiRef = api; }} />);
    await waitFor(() => expect(apiRef).not.toBeNull());
    act(() => {
      apiRef!.pushToast({ title: "Hello toast", durationMs: 10 });
    });
    expect(screen.getByText("Hello toast")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await waitFor(() => expect(screen.queryByText("Hello toast")).not.toBeInTheDocument());
  });

  it("reports async action success", async () => {
    const fn = vi.fn().mockImplementation(
      (value: string) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(`${value}-ok`), 0);
        }),
    );
    render(<AsyncActionHarness fn={fn} />);
    expect(screen.getByTestId("state").textContent).toBe("idle");
    act(() => {
      screen.getByTestId("run").click();
    });
    expect(screen.getByTestId("state").textContent).toBe("pending");
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("success"));
    expect(screen.queryByTestId("error")).toBeNull();
  });

  it("surfaces async action errors", async () => {
    const fn = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("boom")), 0);
        }),
    );
    render(<AsyncActionHarness fn={fn} />);
    act(() => {
      screen.getByTestId("run").click();
    });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("boom");
  });

  it("paginates via usePagedQuery", async () => {
    fetchMetadataGraphQLMock
      .mockResolvedValueOnce({ testConnection: { nodes: ["dataset-a"], pageInfo: { hasNextPage: true, endCursor: "cursor-a" } } })
      .mockResolvedValueOnce({ testConnection: { nodes: ["dataset-b"], pageInfo: { hasNextPage: false, endCursor: null } } });
    render(<PagedQueryHarness />);
    await waitFor(() => expect(screen.getAllByTestId("paged-item")).toHaveLength(1));
    act(() => {
      screen.getByTestId("next-page").click();
    });
    await waitFor(() => expect(screen.getAllByTestId("paged-item")).toHaveLength(2));
    expect(fetchMetadataGraphQLMock).toHaveBeenCalledTimes(2);
  });

  it("reports paged query errors", async () => {
    fetchMetadataGraphQLMock.mockRejectedValueOnce(new Error("connection failed"));
    render(<PagedQueryHarness />);
    await waitFor(() => expect(screen.getByTestId("paged-error")).toHaveTextContent("connection failed"));
    expect(screen.queryAllByTestId("paged-item")).toHaveLength(0);
  });
});
