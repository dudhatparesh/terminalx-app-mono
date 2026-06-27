"use client";

// Settings shell (issue #11, §4.1). Wraps the settings surface in User/Repo
// scope tabs + a left nav. The Models nav entry renders the new
// ModelsSettingsPage; every other entry renders the existing SettingsView
// content for now (sibling specs re-home those sections under their own nav
// keys — §4.4). Pure client component: no Node imports.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { SettingsScopeTabs } from "@/components/settings/SettingsScopeTabs";
import { SettingsNav, type SettingsNavKey } from "@/components/settings/SettingsNav";
import { ModelsSettingsPage } from "@/components/settings/ModelsSettingsPage";
import { SettingsView } from "@/components/settings/SettingsView";
import type { SettingsScope } from "@/lib/settings/types";

export function SettingsShell({ session }: { session?: string }) {
  const { user } = useAuth();
  const [scope, setScope] = useState<SettingsScope>("user");
  const [nav, setNav] = useState<SettingsNavKey>("models");
  const [repoAvailable, setRepoAvailable] = useState(false);

  // Probe repo context: a repo-scope GET 404s when no repo is resolvable.
  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setRepoAvailable(false);
      return;
    }
    fetch(`/api/settings?scope=repo&session=${encodeURIComponent(session)}`)
      .then((r) => {
        if (!cancelled) setRepoAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setRepoAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Fall back to User scope if Repo becomes unavailable.
  useEffect(() => {
    if (scope === "repo" && !repoAvailable) setScope("user");
  }, [scope, repoAvailable]);

  const isAdmin = user?.role === "admin";
  const repoReadOnly = scope === "repo" && !isAdmin;

  const onEditToml = useCallback(() => {
    // The in-app file editor is owned by the files surface; emit a navigation
    // intent the host app can pick up. No-op fallback keeps the shell standalone.
    window.dispatchEvent(
      new CustomEvent("terminalx:open-file", {
        detail: { path: ".terminalx/settings.toml" },
      })
    );
  }, []);

  return (
    <div className="h-full overflow-y-auto contain-scroll" data-testid="settings-shell">
      <div className="max-w-[860px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-[26px] font-bold tracking-tight text-[#e6f0e4]">Settings</h1>
        </div>

        <SettingsScopeTabs
          scope={scope}
          onScope={setScope}
          repoAvailable={repoAvailable}
          onEditToml={onEditToml}
        />

        <div className="flex gap-6">
          <aside className="w-40 shrink-0">
            <SettingsNav active={nav} onSelect={setNav} />
          </aside>

          <div className="min-w-0 flex-1">
            {nav === "models" ? (
              <ModelsSettingsPage scope={scope} session={session} readOnly={repoReadOnly} />
            ) : (
              // Sibling specs own these entries; until they land, the legacy
              // settings surface renders so nothing is lost.
              <div data-testid={`settings-content-${nav}`}>
                {/* hideModels: the shell renders ModelsSettingsPage itself under
                    the Models nav entry, so avoid a duplicate here. */}
                <SettingsView session={session} hideModels />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
