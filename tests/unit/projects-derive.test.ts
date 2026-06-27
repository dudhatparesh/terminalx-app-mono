import { describe, it, expect } from "vitest";
import {
  deriveWorkspaceStatus,
  toWorkspaceView,
  sessionsForProject,
  toProjectView,
  defaultProjectName,
  type WorkspaceSessionLike,
} from "@/lib/projects/derive";
import { statusIcon, formatDiffStat } from "@/types/project";
import type { Project } from "@/types/project";

function session(name: string, repoRoot: string, branch: string): WorkspaceSessionLike {
  return { name, worktree: { repoRoot, path: `/wt/${name}`, branch } };
}

describe("deriveWorkspaceStatus (corrected model)", () => {
  it("is loading until a diff stat resolves", () => {
    expect(deriveWorkspaceStatus({})).toBe("loading");
    expect(deriveWorkspaceStatus({ loading: true, diffStat: { additions: 1, deletions: 0 } })).toBe(
      "loading"
    );
  });

  it("a merged PR yields merged (purple icon)", () => {
    expect(
      deriveWorkspaceStatus({ diffStat: { additions: 5, deletions: 1 }, prStatus: "merged" })
    ).toBe("merged");
  });

  it("an open/draft PR yields open", () => {
    expect(
      deriveWorkspaceStatus({ diffStat: { additions: 5, deletions: 1 }, prStatus: "open" })
    ).toBe("open");
    expect(
      deriveWorkspaceStatus({ diffStat: { additions: 5, deletions: 1 }, prStatus: "draft" })
    ).toBe("open");
  });

  it("no PR (or a closed one) falls back to in-progress (branch icon)", () => {
    expect(deriveWorkspaceStatus({ diffStat: { additions: 0, deletions: 0 } })).toBe("in-progress");
    expect(
      deriveWorkspaceStatus({ diffStat: { additions: 1, deletions: 1 }, prStatus: "closed" })
    ).toBe("in-progress");
  });
});

describe("statusIcon", () => {
  it("maps each status to a glyph kind", () => {
    expect(statusIcon("loading")).toBe("spinner");
    expect(statusIcon("merged")).toBe("pr-merged");
    expect(statusIcon("open")).toBe("pr-open");
    expect(statusIcon("in-progress")).toBe("branch");
  });
});

describe("formatDiffStat", () => {
  it("renders +N −N and omits zeros", () => {
    expect(formatDiffStat({ additions: 32, deletions: 79 })).toBe("+32 −79");
    expect(formatDiffStat({ additions: 0, deletions: 19 })).toBe("−19");
    expect(formatDiffStat({ additions: 5, deletions: 0 })).toBe("+5");
    expect(formatDiffStat({ additions: 0, deletions: 0 })).toBe("");
  });
});

describe("toWorkspaceView", () => {
  it("projects a session + resolved data, branch is the display name", () => {
    const view = toWorkspaceView(session("s1", "/repo", "feat/x"), {
      diffStat: { additions: 3, deletions: 2 },
      prStatus: "merged",
      prNumber: 42,
    });
    expect(view).toMatchObject({
      sessionName: "s1",
      branch: "feat/x",
      path: "/wt/s1",
      diffStat: { additions: 3, deletions: 2 },
      status: "merged",
      prNumber: 42,
    });
  });

  it("carries collapsed/archived flags through", () => {
    const s: WorkspaceSessionLike = { ...session("s2", "/repo", "feat/y"), collapsed: true };
    const view = toWorkspaceView(s, { diffStat: { additions: 0, deletions: 0 } });
    expect(view.collapsed).toBe(true);
  });
});

describe("sessionsForProject", () => {
  it("groups only sessions whose worktree.repoRoot matches", () => {
    const sessions = [
      session("a", "/repoA", "b1"),
      session("b", "/repoB", "b2"),
      session("c", "/repoA", "b3"),
      { name: "no-wt" } as WorkspaceSessionLike, // no worktree → excluded
    ];
    const proj: Pick<Project, "repoRoot"> = { repoRoot: "/repoA" };
    const out = sessionsForProject(proj, sessions);
    expect(out.map((s) => s.name)).toEqual(["a", "c"]);
  });
});

describe("toProjectView", () => {
  it("attaches workspaces under the project", () => {
    const proj: Project = {
      id: "1",
      repoRoot: "/repoA",
      name: "repoA",
      createdAt: new Date().toISOString(),
    };
    const ws = toWorkspaceView(session("a", "/repoA", "b1"), {
      diffStat: { additions: 1, deletions: 0 },
    });
    const view = toProjectView(proj, [ws]);
    expect(view.id).toBe("1");
    expect(view.workspaces).toHaveLength(1);
    expect(view.workspaces[0]?.sessionName).toBe("a");
  });
});

describe("defaultProjectName", () => {
  it("uses the repo directory basename", () => {
    expect(defaultProjectName("/Users/me/code/terminalx-app-mono")).toBe("terminalx-app-mono");
    expect(defaultProjectName("/Users/me/code/terminalx-app-mono/")).toBe("terminalx-app-mono");
    expect(defaultProjectName("repo")).toBe("repo");
  });
});
