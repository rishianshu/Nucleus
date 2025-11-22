import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useCallback } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAsyncAction, useToastQueue, usePagedQuery } from "./hooks";
import { fetchMetadataGraphQL } from "./api";
vi.mock("./api", () => ({
    fetchMetadataGraphQL: vi.fn(),
}));
const fetchMetadataGraphQLMock = fetchMetadataGraphQL;
function ToastHookHarness({ onReady }) {
    const api = useToastQueue();
    useEffect(() => {
        onReady(api);
    }, [api, onReady]);
    return (_jsx("div", { children: api.toasts.map((toast) => (_jsx("span", { children: toast.title }, toast.id))) }));
}
function AsyncActionHarness({ fn }) {
    const action = useAsyncAction(fn);
    return (_jsxs("div", { children: [_jsx("span", { "data-testid": "state", children: action.state }), action.error ? _jsx("span", { "data-testid": "error", children: action.error.message }) : null, _jsx("button", { "data-testid": "run", type: "button", onClick: () => {
                    action.run("input").catch(() => {
                        // errors exercised via exposed state
                    });
                }, children: "Run" })] }));
}
function PagedQueryHarness() {
    const selectConnection = useCallback((payload) => payload.testConnection, []);
    const paged = usePagedQuery({
        metadataEndpoint: "/graphql",
        token: "token",
        query: "TestQuery",
        selectConnection,
    });
    return (_jsxs("div", { children: [_jsx("span", { "data-testid": "paged-state", children: paged.loading ? "loading" : "idle" }), paged.error ? _jsx("span", { "data-testid": "paged-error", children: paged.error }) : null, _jsx("ul", { children: paged.items.map((item, index) => (_jsx("li", { "data-testid": "paged-item", children: item }, `${item}-${index}`))) }), _jsx("button", { type: "button", "data-testid": "next-page", onClick: () => paged.fetchNext(), children: "Next page" })] }));
}
beforeEach(() => {
    fetchMetadataGraphQLMock.mockReset();
});
describe("metadata hooks", () => {
    it("queues and auto-dismisses toasts", async () => {
        let apiRef = null;
        render(_jsx(ToastHookHarness, { onReady: (api) => { apiRef = api; } }));
        await waitFor(() => expect(apiRef).not.toBeNull());
        act(() => {
            apiRef.pushToast({ title: "Hello toast", durationMs: 10 });
        });
        expect(screen.getByText("Hello toast")).toBeInTheDocument();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        await waitFor(() => expect(screen.queryByText("Hello toast")).not.toBeInTheDocument());
    });
    it("reports async action success", async () => {
        const fn = vi.fn().mockImplementation((value) => new Promise((resolve) => {
            setTimeout(() => resolve(`${value}-ok`), 0);
        }));
        render(_jsx(AsyncActionHarness, { fn: fn }));
        expect(screen.getByTestId("state").textContent).toBe("idle");
        act(() => {
            screen.getByTestId("run").click();
        });
        expect(screen.getByTestId("state").textContent).toBe("pending");
        await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("success"));
        expect(screen.queryByTestId("error")).toBeNull();
    });
    it("surfaces async action errors", async () => {
        const fn = vi.fn().mockImplementation(() => new Promise((_, reject) => {
            setTimeout(() => reject(new Error("boom")), 0);
        }));
        render(_jsx(AsyncActionHarness, { fn: fn }));
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
        render(_jsx(PagedQueryHarness, {}));
        await waitFor(() => expect(screen.getAllByTestId("paged-item")).toHaveLength(1));
        act(() => {
            screen.getByTestId("next-page").click();
        });
        await waitFor(() => expect(screen.getAllByTestId("paged-item")).toHaveLength(2));
        expect(fetchMetadataGraphQLMock).toHaveBeenCalledTimes(2);
    });
    it("reports paged query errors", async () => {
        fetchMetadataGraphQLMock.mockRejectedValueOnce(new Error("connection failed"));
        render(_jsx(PagedQueryHarness, {}));
        await waitFor(() => expect(screen.getByTestId("paged-error")).toHaveTextContent("connection failed"));
        expect(screen.queryAllByTestId("paged-item")).toHaveLength(0);
    });
});
