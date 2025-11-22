import { describe, expect, it } from "vitest";
import { resolveKbLabel, resolveKbValue, humanizeKbIdentifier } from "@metadata/client";
describe("knowledge base label helpers", () => {
    it("resolves canonical node types to friendly labels", () => {
        expect(resolveKbLabel("catalog.dataset")).toBe("Datasets");
        expect(resolveKbLabel("doc.page")).toBe("Doc pages");
    });
    it("falls back to humanized identifiers for unknown values", () => {
        expect(resolveKbLabel("custom.widget")).toBe("Custom Widget");
        expect(humanizeKbIdentifier("team_analytics")).toBe("Team Analytics");
    });
    it("maps friendly labels back to canonical values", () => {
        expect(resolveKbValue("Datasets")).toBe("catalog.dataset");
        expect(resolveKbValue("Documented by")).toBe("DOCUMENTED_BY");
        expect(resolveKbValue("Unknown Label")).toBeNull();
    });
});
