# Conductor Parity — Design Specs & Issues

This directory tracks the effort to bring TerminalX toward feature parity with
[Conductor](https://conductor.build), plus support for **custom AI providers**
(e.g. [Open Code](https://www.conductor.build/docs/reference/harnesses/opencode)).

The specs here were produced by a multi-agent design pass. Each maps to a GitHub
issue. The PR-review and custom-providers tracks have multi-file specs in their
own subfolders.

## Features → Issues → Specs

| #   | Feature                                                                      | Issue                                                           | Design spec                                       | Effort |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- | ------ |
| 1   | Diff Viewer UI                                                               | [#2](https://github.com/manish05/terminalx-app-mono/issues/2)   | `designs/diff-viewer.spec.md`                     | Medium |
| 2   | PR Creation & Review                                                         | [#3](https://github.com/manish05/terminalx-app-mono/issues/3)   | `designs/pr-review/`                              | Large  |
| 3   | Custom AI Providers (Open Code)                                              | [#4](https://github.com/manish05/terminalx-app-mono/issues/4)   | `designs/custom-providers/`                       | Large  |
| 4   | Workspace Config (setup/run scripts)                                         | [#5](https://github.com/manish05/terminalx-app-mono/issues/5)   | `designs/workspace-config.spec.md`                | Medium |
| 5   | Checks / Status Dashboard                                                    | [#6](https://github.com/manish05/terminalx-app-mono/issues/6)   | `designs/checks-dashboard.spec.md`                | Medium |
| 6   | GitHub Integration Layer                                                     | [#7](https://github.com/manish05/terminalx-app-mono/issues/7)   | `designs/github-integration.spec.md`              | Medium |
| 7   | Extended Providers (OpenAI/Copilot/Google/OpenRouter/Vercel AI Gateway — 96) | [#8](https://github.com/manish05/terminalx-app-mono/issues/8)   | `designs/extended-session-types.spec.md`          | Large  |
| 8   | Archive & Cleanup                                                            | [#9](https://github.com/manish05/terminalx-app-mono/issues/9)   | `research/worktree-architecture-analysis.md`      | Medium |
| 9   | Symlink Worktrees                                                            | [#10](https://github.com/manish05/terminalx-app-mono/issues/10) | `research/worktree-architecture-analysis.md`      | Small  |
| 10  | Models & harness settings page                                               | [#11](https://github.com/manish05/terminalx-app-mono/issues/11) | `.context/issues/06-model-settings-page.md`       | Medium |
| 11  | Named workspaces + sidebar                                                   | [#12](https://github.com/manish05/terminalx-app-mono/issues/12) | `.context/issues/07-multi-workspace-isolation.md` | Large  |

> **Note:** Issues #2–#10 were first drafted blind (text-only). After reviewing the
> Conductor screenshots in `.context/attachments/`, #4 and #8 were corrected to match the
> real Harnesses/OpenCode UI and provider list, and #11–#12 were added for the Models
> settings page and workspace sidebar that the screenshots revealed.

## Suggested build order

1. **#7 GitHub Integration** — unblocks PR review and the checks dashboard.
2. **#2 Diff Viewer** — foundational review surface, no dependencies.
3. **#4 Custom Providers** — refactor `ai-sessions.ts` into a provider registry; ship Open Code.
4. **#3 PR Review** — builds on #2 + #7.
5. **#6 Checks Dashboard** — builds on #7.
6. **#8 Extended Providers** — builds on #4.
7. **#10 Symlink Worktrees** / **#5 Workspace Config** / **#9 Archive** — independent, parallelizable.

## Layout

- `designs/` — implementation specs (data models, APIs, components, examples).
- `research/` — analysis of the current codebase, Conductor's architecture, and worktree internals.

## Notes / gaps

- The **workspace-config** design agent died mid-run (socket error); `workspace-config.spec.md`
  is a draft and should be expanded before implementation.
- The **archive-cleanup** spec was not written to its own file; relevant content is in
  `research/worktree-architecture-analysis.md` and issue #9. Worth promoting to a full spec.
