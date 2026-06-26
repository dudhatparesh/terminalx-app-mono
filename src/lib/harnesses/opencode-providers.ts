// OpenCode nested provider registry (issue #4, §5.2).
//
// The OpenCode harness `hostsProviders`: its tab opens a "Providers" picker
// modal mirroring Conductor's exactly. These are the canonical curated rows
// (do NOT invent ChatGPT/Gemini/Ollama as the canonical list); the full list
// is 96 upstream providers, fetched lazily by the picker's search / "View all".
//
// Client-safe (no Node built-ins) so the picker modal can import it directly.

export interface OpenCodeProviderEntry {
  id: string;
  label: string;
  /** brand icon key */
  icon: string;
}

export const FEATURED_OPENCODE_PROVIDERS: OpenCodeProviderEntry[] = [
  { id: "opencode-zen", label: "OpenCode Go / OpenCode Zen", icon: "opencode" },
  { id: "openai", label: "OpenAI", icon: "openai" },
  { id: "github-copilot", label: "GitHub Copilot / GitHub Models", icon: "github" },
  { id: "anthropic", label: "Anthropic", icon: "anthropic" },
  { id: "google", label: "Google", icon: "google" },
  { id: "vercel", label: "Vercel AI Gateway", icon: "vercel" },
  { id: "openrouter", label: "OpenRouter", icon: "openrouter" },
];

/** Total upstream provider count shown in the picker footer ("View all providers (96)"). */
export const TOTAL_OPENCODE_PROVIDERS = 96;
