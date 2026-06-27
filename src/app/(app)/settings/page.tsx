"use client";

import dynamic from "next/dynamic";

// The settings surface is a dedicated full-page view with a left nav (Conductor
// parity). Rendered client-only: it depends on browser-only hooks/state.
const SettingsShell = dynamic(
  () => import("@/components/settings/SettingsShell").then((m) => m.SettingsShell),
  { ssr: false }
);

export default function SettingsPage() {
  return <SettingsShell />;
}
