# Conductor-Parity — Implementation & Test Plan

How we build the 11 features (issues #2–#12), in what order, and how each is tested with
Playwright + unit tests, driven by parallel Claude Code subagents using a strict TDD order.

## 0. Status of inputs

- **Specs:** `docs/conductor-parity/designs/` — all grounded in the real Conductor screenshots
  (see each spec's "Conductor UI reference" section).
- **Issues:** #2–#12, deduplicated. Scope boundaries + cross-links added for the
  provider/harness cluster (#4→#8→#11) and the shared review-panel cluster (#2/#3/#6/#9).
- **Sandbox:** `.test-sandbox/sample-repo` — throwaway git repo (a `main` with an uncommitted
  edit + a `feature/sample-change` branch with a real diff) for exercising worktree/diff/PR/checks.

## 1. Per-feature pipeline (TDD — the 4 required steps)

Every feature runs this chain, **in its own git worktree** so parallel agents never collide:

1. **Write tests first** — Playwright e2e derived from the issue's acceptance criteria, plus
   Vitest unit tests for the lib/API layer. Committed **red**.
2. **Implement** the full feature against its corrected spec.
3. **Iterate to green** — run `npm test` (Vitest) + `npx playwright test`; feed failures back to
   the implementer; repeat until all pass. Hard gate: no feature is "done" with a red test.
4. **UI/UX polish** — a visual-review agent screenshots the feature (Playwright), checks it
   against the `web-design-guidelines` skill **and** the Conductor screenshots in
   `.context/attachments/`, then fixes styling until it matches the dark-theme shadcn look.

## 2. Build order (parallel **within** a wave, sequential **across** waves)

Dependencies make a naive "all 11 at once" unsafe. Each wave merges into an integration branch
`feat/conductor-parity` (never `main`) before the next wave builds on it.

| Wave  | Issues (parallel)                                                                                                       | Why this wave                 | Depends on                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| **1** | **#7** GitHub layer · **#2** Diff viewer · **#4** Provider/harness registry · **#10** Symlink · **#5** Workspace config | All independent; foundational | —                                        |
| **2** | **#3** PR review · **#6** Checks · **#8** Provider catalog · **#11** Model settings · **#12** Multi-workspace           | Build on Wave 1 primitives    | #2,#7 / #2,#7 / #4 / #4 / worktree infra |
| **3** | **#9** Archive & cleanup                                                                                                | Needs workspaces + merged PRs | #12,#3                                   |

Within Wave 1, **#2 builds the shared review-panel shell** (tabs: All files / Changes / Checks /
Review + status bar); #3 and #6 then add their tabs in Wave 2 rather than rebuilding the panel.

## 3. Playwright test strategy

- **Harness:** `@playwright/test` at repo root; `playwright.config.ts` boots the app
  (`npm run start`) with `TERMINUS_ROOT=.test-sandbox/sample-repo` and a known admin login.
- **Per feature:** `tests/e2e/<feature>.spec.ts` asserts the acceptance criteria as browser
  interactions (e.g. diff viewer: open session → Changes tab → assert `+N/-N` + side-by-side).
- **Auth:** a `global-setup` logs in once and reuses storage state.
- **Visual:** screenshot artifacts saved per feature for the Step-4 UI review.
- **Unit:** Vitest (already configured) for `src/lib/**` and route handlers.

## 4. Worktree isolation & merge policy

- Each feature: `git worktree add .test-sandbox/wt/<issue> -b feat/<issue>-<slug>` off the
  current integration branch. Agents run isolated; no cross-feature file conflicts.
- After Step-3 green + Step-4 polish, the wave's branches merge into `feat/conductor-parity`
  (conflicts resolved by a dedicated integration agent), tests re-run on the integrated branch.
- **Nothing merges to `main` automatically.** You review the integration branch (per wave or at
  the end) and merge yourself.

## 5. How Claude Code drives it

A Workflow fans out one pipeline per feature in the active wave (worktree-isolated). Each stage is
a subagent: `tests` → `implement` → `iterate` (loops on test output) → `ui-polish`. A final
integration agent merges the wave. Between waves, control returns here for your review.

## 6. Open decisions (gating the build fleet)

1. **Proving run first?** Recommend building **#10 (Symlink)** end-to-end through the full
   pipeline to validate the Playwright + worktree + Claude Code harness before fanning out all of
   Wave 1. (Cheap, self-contained.)
2. **Merge policy:** integration branch `feat/conductor-parity`, you review per wave — confirm.
3. **"Use Claude Code to test":** workflow subagents (already Claude) drive Playwright — vs.
   literally shelling out to the `claude` CLI inside each worktree. Recommend the former.

_Once these are answered, the build fleet launches Wave 1._
