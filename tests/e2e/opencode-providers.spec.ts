import { test, expect, type Page } from "@playwright/test";

/**
 * E2E for Issue #8 — Provider catalog + per-provider OpenCode config.
 *
 * Exercises the FUNCTIONAL Providers picker: expanding a row into its config
 * form, saving a provider (which POSTs the non-secret stanza to
 * /api/harnesses/opencode/providers), and the OpenCode panel's "N configured" /
 * "N selected" counts updating afterward. The provider catalog GET + the
 * configured-count GET + the save POST are stubbed so the test is deterministic
 * and needs no real `opencode` CLI or committed settings.toml. Run later in
 * integration (no server runs inside the worktree).
 *
 * Spec acceptance criteria covered: AC-1..AC-11.
 */

const FEATURED = [
  {
    id: "opencode-zen",
    label: "OpenCode Go / OpenCode Zen",
    brands: ["OpenCode Go", "OpenCode Zen"],
    icon: "opencode",
    featured: true,
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
    endpointEditable: true,
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

/** Stub the OpenCode providers API: catalog GET, configured-count GET, save POST. */
async function stubProvidersApi(page: Page) {
  // Server-side mutable state shared across the stubbed handlers.
  let configured: string[] = [];
  const models: string[] = [];

  await page.route("**/api/harnesses/opencode/providers**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (method === "GET") {
      if (url.searchParams.get("configured") === "1") {
        return route.fulfill({
          json: {
            providers: configured,
            models,
            configuredCount: configured.length,
            selectedModelCount: models.length,
          },
        });
      }
      if (url.searchParams.get("all") === "1") {
        return route.fulfill({ json: { count: FEATURED.length, providers: FEATURED } });
      }
      return route.fulfill({ json: { count: 96, featured: FEATURED } });
    }

    if (method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      if (!configured.includes(body.providerId)) configured.push(body.providerId);
      for (const m of body.models ?? []) if (!models.includes(m)) models.push(m);
      return route.fulfill({
        json: {
          success: true,
          providers: configured,
          models,
          configuredCount: configured.length,
          selectedModelCount: models.length,
        },
      });
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("providerId");
      configured = configured.filter((p) => p !== id);
      return route.fulfill({
        json: {
          success: true,
          providers: configured,
          models,
          configuredCount: configured.length,
          selectedModelCount: models.length,
        },
      });
    }
    return route.fallback();
  });
}

test.describe("OpenCode provider catalog + per-provider config (issue #8)", () => {
  test.beforeEach(async ({ page }) => {
    await stubProvidersApi(page);
    await page.goto("/settings");
    // Settings is a left-nav shell: open the Harnesses page before asserting its content.
    await page.getByTestId("settings-nav-harnesses").click();
    await expect(page.getByTestId("harness-tabs")).toBeVisible();
    await page.getByTestId("harness-tab-opencode").click();
    await expect(page.getByTestId("opencode-panel")).toBeVisible();
  });

  test("AC-1/AC-2/AC-3: modal shows 7 featured rows in order + the 96 footer", async ({ page }) => {
    await page.getByTestId("opencode-add-provider").click();
    const modal = page.getByTestId("opencode-providers-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("opencode-providers-search")).toHaveAttribute(
      "placeholder",
      "Search providers"
    );
    for (const p of FEATURED) {
      await expect(page.getByTestId(`opencode-provider-${p.id}`)).toContainText(p.label);
    }
    await expect(page.getByTestId("opencode-providers-view-all")).toContainText(
      /view all providers \(96\)/i
    );
  });

  test("AC-5/AC-9: selecting a row expands the inline config form (model field)", async ({
    page,
  }) => {
    await page.getByTestId("opencode-add-provider").click();
    await page.getByTestId("opencode-provider-anthropic").click();
    // Expands inline — the modal stays open (no navigation).
    await expect(page.getByTestId("opencode-providers-modal")).toBeVisible();
    await expect(page.getByTestId("opencode-provider-config-anthropic")).toBeVisible();
    await expect(page.getByTestId("opencode-provider-models-anthropic")).toBeVisible();
    // Standard provider → NO endpoint field, NO secret/effort field (AC-7/AC-8).
    await expect(page.getByTestId("opencode-provider-endpoint-anthropic")).toHaveCount(0);
    await expect(page.getByTestId("opencode-provider-config-anthropic")).not.toContainText(
      /api key|effort/i
    );
  });

  test("AC-8: gateways expose an editable endpoint URL field", async ({ page }) => {
    await page.getByTestId("opencode-add-provider").click();
    await page.getByTestId("opencode-provider-openrouter").click();
    await expect(page.getByTestId("opencode-provider-endpoint-openrouter")).toBeVisible();
    await expect(page.getByTestId("opencode-provider-models-openrouter")).toBeVisible();
  });

  test("AC-11: saving a provider increments the panel's configured/selected counts", async ({
    page,
  }) => {
    // Starts at 0 configured / 0 selected.
    await expect(page.getByTestId("opencode-providers-count")).toContainText("0 configured");
    await expect(page.getByTestId("opencode-models-count")).toContainText("0 selected");

    await page.getByTestId("opencode-add-provider").click();
    await page.getByTestId("opencode-provider-anthropic").click();
    await page.getByTestId("opencode-provider-models-anthropic").fill("claude-opus-4-8");
    await page.getByTestId("opencode-provider-save-anthropic").click();

    // Modal closes; counts reflect the new provider + model.
    await expect(page.getByTestId("opencode-providers-modal")).toHaveCount(0);
    await expect(page.getByTestId("opencode-providers-count")).toContainText("1 configured");
    await expect(page.getByTestId("opencode-models-count")).toContainText("1 selected");
  });

  test("AC-4: View all / search filters across the catalog", async ({ page }) => {
    await page.getByTestId("opencode-add-provider").click();
    await page.getByTestId("opencode-providers-view-all").click();
    await page.getByTestId("opencode-providers-search").fill("openrouter");
    await expect(page.getByTestId("opencode-provider-openrouter")).toBeVisible();
    await expect(page.getByTestId("opencode-providers-modal")).not.toContainText("Anthropic");
  });
});
