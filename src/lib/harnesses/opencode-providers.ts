// OpenCode nested provider registry (issue #4 §5.2, extended by issue #8 §3).
//
// The OpenCode harness `hostsProviders`: its tab opens a "Providers" picker
// modal mirroring Conductor's exactly. These are the canonical curated rows
// (do NOT invent ChatGPT/Gemini/Ollama as the canonical list); the full list
// is 96 upstream providers, fetched lazily by the picker's search / "View all".
//
// Issue #8 extends the base { id, label, icon } entry with the optional picker
// fields (brands/featured/endpointEditable/docsUrl) and adds the
// ConfiguredOpenCodeProvider record persisted when a user adds a provider.
//
// Client-safe (no Node built-ins) so the picker modal can import it directly.
// These are OpenCode's OWN providers — selecting one writes a stanza into
// OpenCode's config; TerminalX never speaks the provider's API.

export interface OpenCodeProviderEntry {
  /** OpenCode-config provider id (NOT a TerminalX SessionKind). */
  id: string;
  /** Brand-correct display name as shown in the picker. */
  label: string;
  /** Brand icon key resolved by the UI. */
  icon: string;
  /**
   * Some rows present two brands together; the search matches each so the UI
   * mirrors what the user sees in Conductor (e.g. ["OpenCode Go", "OpenCode
   * Zen"], ["GitHub Copilot", "GitHub Models"]). Defaults to [label] when omitted.
   */
  brands?: string[];
  /** True for the 7 curated featured rows; the 96-entry tail is featured:false. */
  featured?: boolean;
  /**
   * Whether OpenCode needs the user to supply an endpoint URL for this provider
   * (gateways like Vercel AI Gateway / OpenRouter). The value is written into
   * OpenCode's config, not consumed by TerminalX.
   */
  endpointEditable?: boolean;
  /** Docs link shown as "Docs ↗" next to the row. */
  docsUrl?: string;
}

export const FEATURED_OPENCODE_PROVIDERS: OpenCodeProviderEntry[] = [
  {
    id: "opencode-zen",
    label: "OpenCode Go / OpenCode Zen",
    brands: ["OpenCode Go", "OpenCode Zen"],
    icon: "opencode",
    featured: true,
    docsUrl: "https://opencode.ai/docs",
  },
  { id: "openai", label: "OpenAI", brands: ["OpenAI"], icon: "openai", featured: true },
  {
    id: "github-copilot",
    label: "GitHub Copilot / GitHub Models",
    brands: ["GitHub Copilot", "GitHub Models"],
    icon: "github",
    featured: true,
  },
  { id: "anthropic", label: "Anthropic", brands: ["Anthropic"], icon: "anthropic", featured: true },
  { id: "google", label: "Google", brands: ["Google"], icon: "google", featured: true },
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    brands: ["Vercel AI Gateway"],
    icon: "vercel",
    featured: true,
    endpointEditable: true, // gateway: OpenCode config takes a custom base URL
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    brands: ["OpenRouter"],
    icon: "openrouter",
    featured: true,
    endpointEditable: true,
  },
];

/** Total upstream provider count shown in the picker footer ("View all providers (96)"). */
export const TOTAL_OPENCODE_PROVIDERS = 96;

/**
 * The lazily-fetched "View all providers (96)" tail. The spec (§3.3) says the
 * full list is resolved server-side (via the `opencode` CLI's provider index).
 * Until that index is wired in integration, this deterministic, brand-correct
 * snapshot fills the catalog to TOTAL_OPENCODE_PROVIDERS so the picker's search
 * + "View all" behave as specified (filter across all 96). It is NOT a competing
 * TerminalX catalog — it is a placeholder for OpenCode's own list. No
 * chatgpt/gemini/ollama ids appear here (regression guard, AC-6).
 */
const TAIL_PROVIDER_LABELS: ReadonlyArray<string> = [
  "Amazon Bedrock",
  "Azure OpenAI",
  "Cerebras",
  "Cohere",
  "DeepInfra",
  "DeepSeek",
  "Fireworks AI",
  "Groq",
  "Hugging Face",
  "Hyperbolic",
  "LiteLLM",
  "LM Studio",
  "Mistral",
  "Moonshot",
  "Nebius",
  "Novita",
  "Ollama",
  "Perplexity",
  "Replicate",
  "SambaNova",
  "Together AI",
  "xAI",
  "AI21 Labs",
  "Anyscale",
  "Baseten",
  "Cloudflare Workers AI",
  "Databricks",
  "Featherless",
  "Friendli",
  "GitHub Models",
  "GMI Cloud",
  "Inception",
  "Inflection",
  "Kluster",
  "Lambda",
  "Llama API",
  "Mancer",
  "Modal",
  "NVIDIA NIM",
  "OctoAI",
  "OpenPipe",
  "Parasail",
  "Recursal",
  "Reka",
  "Requesty",
  "SiliconFlow",
  "Targon",
  "Vertex AI",
  "Voyage AI",
  "Writer",
  "ZeroOne",
  "Zhipu AI",
];

/** Slugify a tail label into a stable OpenCode-style provider id. */
function tailId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build the non-featured tail, padded to reach TOTAL_OPENCODE_PROVIDERS. */
function buildTail(): OpenCodeProviderEntry[] {
  const featuredCount = FEATURED_OPENCODE_PROVIDERS.length;
  const want = TOTAL_OPENCODE_PROVIDERS - featuredCount;
  const out: OpenCodeProviderEntry[] = [];
  for (let i = 0; i < want; i++) {
    const label = TAIL_PROVIDER_LABELS[i] ?? `Provider ${featuredCount + i + 1}`;
    out.push({ id: tailId(label), label, brands: [label], icon: "generic", featured: false });
  }
  return out;
}

const TAIL_PROVIDERS: OpenCodeProviderEntry[] = buildTail();

/** The full catalog: 7 featured + the tail, totalling TOTAL_OPENCODE_PROVIDERS. */
export const ALL_OPENCODE_PROVIDERS: OpenCodeProviderEntry[] = [
  ...FEATURED_OPENCODE_PROVIDERS,
  ...TAIL_PROVIDERS,
];

/** The 7 curated featured rows (the picker's initial view). */
export function featuredProviders(): OpenCodeProviderEntry[] {
  return FEATURED_OPENCODE_PROVIDERS;
}

/** Total upstream provider count shown in the footer (96). */
export function providerCount(): number {
  return TOTAL_OPENCODE_PROVIDERS;
}

/** Look up a single provider entry across the full catalog. */
export function getProviderEntry(id: string): OpenCodeProviderEntry | undefined {
  return ALL_OPENCODE_PROVIDERS.find((p) => p.id === id);
}

/**
 * Case-insensitive search across the FULL catalog by label + every brand (§5.2
 * AC-4). An empty query returns the whole catalog so "View all providers (96)"
 * lists everything.
 */
export function searchProviders(query: string): OpenCodeProviderEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_OPENCODE_PROVIDERS;
  return ALL_OPENCODE_PROVIDERS.filter((p) => {
    if (p.label.toLowerCase().includes(q)) return true;
    if (p.id.toLowerCase().includes(q)) return true;
    const brands = p.brands ?? [p.label];
    return brands.some((b) => b.toLowerCase().includes(q));
  });
}

/**
 * A provider the user added, recorded so OpenCode's config can be (re)written
 * and the "Providers · N configured" / "Models · N selected" counts rendered.
 * Carries NO secret and NO TerminalX credential ref — secrets live in OpenCode's
 * own config / `.env` (spec §3.4, §6).
 */
export interface ConfiguredOpenCodeProvider {
  /** OpenCode provider id this instance is based on (e.g. "anthropic"). */
  providerId: string;
  /** Optional endpoint for endpointEditable gateways (written into OpenCode config). */
  endpoint?: string;
  /** Models the user enabled for this provider (drives "Models · N selected"). */
  models?: string[];
  /** "user" or "repo" — which scope persisted this instance. */
  scope: "user" | "repo";
}
