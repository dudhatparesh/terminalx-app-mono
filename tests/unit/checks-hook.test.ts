// Adaptive-polling cadence for the Checks client hook (issue #6, §4.2). Only the
// pure `pollIntervalMs` is exercised here; the React effects are covered by e2e.
import { describe, it, expect } from "vitest";
import { pollIntervalMs } from "@/hooks/useChecks";

describe("pollIntervalMs (§4.2 adaptive cadence)", () => {
  it("polls fast (15s) while pending", () => {
    expect(pollIntervalMs("pending")).toBe(15_000);
  });
  it("polls slow (60s) when settled", () => {
    expect(pollIntervalMs("success")).toBe(60_000);
    expect(pollIntervalMs("failure")).toBe(60_000);
    expect(pollIntervalMs("none")).toBe(60_000);
  });
  it("backs off (30s) on error", () => {
    expect(pollIntervalMs("error")).toBe(30_000);
  });
  it("does not poll for static states", () => {
    expect(pollIntervalMs("no-repo")).toBeNull();
    expect(pollIntervalMs("no-pr")).toBeNull();
    expect(pollIntervalMs(undefined)).toBeNull();
  });
});
