"use client";

import ArchiveShell from "@/components/archive/ArchiveShell";
import RequireAuth from "@/components/RequireAuth";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <ArchiveShell />
    </RequireAuth>
  );
}
