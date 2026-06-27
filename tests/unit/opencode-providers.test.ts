import { describe, it, expect } from "vitest";
import {
  FEATURED_OPENCODE_PROVIDERS,
  TOTAL_OPENCODE_PROVIDERS,
} from "@/lib/harnesses/opencode-providers";

describe("opencode featured providers", () => {
  it("lists exactly the 7 canonical Conductor rows by their exact labels", () => {
    expect(FEATURED_OPENCODE_PROVIDERS.map((p) => p.label)).toEqual([
      "OpenCode Go / OpenCode Zen",
      "OpenAI",
      "GitHub Copilot / GitHub Models",
      "Anthropic",
      "Google",
      "Vercel AI Gateway",
      "OpenRouter",
    ]);
  });

  it("does NOT invent ChatGPT/Gemini/Ollama as canonical rows", () => {
    const labels = FEATURED_OPENCODE_PROVIDERS.map((p) => p.label.toLowerCase());
    expect(labels.some((l) => l.includes("chatgpt"))).toBe(false);
    expect(labels.some((l) => l.includes("gemini"))).toBe(false);
    expect(labels.some((l) => l.includes("ollama"))).toBe(false);
  });

  it("reports the 96-provider upstream total for the footer", () => {
    expect(TOTAL_OPENCODE_PROVIDERS).toBe(96);
  });

  it("gives each featured row a stable id + brand icon", () => {
    for (const p of FEATURED_OPENCODE_PROVIDERS) {
      expect(p.id).toBeTruthy();
      expect(p.icon).toBeTruthy();
    }
  });
});
