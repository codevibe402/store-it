"use client";

type VersionInfo = {
  id: string;
  version: number;
  uploadedAt: string;
  storageUrl: string;
  isCurrent: boolean;
};

type VersionsDialogProps = {
  versionTarget: any;
  versions: VersionInfo[];
  versionsLoading: boolean;
  setVersionTarget: (target: any) => void;
  onOpenVersion: (version: VersionInfo) => void;
};

export default function VersionsDialog({ versionTarget, versions, versionsLoading, setVersionTarget, onOpenVersion }: VersionsDialogProps) {
  if (!versionTarget) return null;

  return (
    <div className="fixed inset-0 bg-[rgba(10,13,11,0.7)] flex items-center justify-center z-50 fade-in" onClick={() => setVersionTarget(null)}>
      <div className="bg-[var(--panel,#1a1e28)] border border-[var(--line-strong,#252a38)] rounded-[2px] p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[var(--paper,#e8eaf0)] mb-2">Version history</h3>
        <p className="text-[0.82rem] text-[var(--sage,#6b7280)] mb-4">Every saved version of {versionTarget.filename} is visible here.</p>
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          {versionsLoading ? (
            <div className="text-xs text-[var(--sage,#6b7280)] py-4">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="text-xs text-[var(--sage,#6b7280)] py-4">No versions recorded yet.</div>
          ) : (
            versions.map((version) => (
              <button
                key={version.id}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-[2px] border transition",
                  version.isCurrent
                    ? "border-[var(--brass,#6c8eff)]/40 bg-[var(--brass,#6c8eff)]/10 text-[var(--brass-bright,#6c8eff)]"
                    : "border-[var(--line-strong,#4b5563)] bg-transparent text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#13161e)]"
                )}
                onClick={() => onOpenVersion(version)}
              >
                v{version.version}
                <span className="text-xs text-[var(--sage,#6b7280)] ml-auto">
                  {version.isCurrent ? "Current" : new Date(version.uploadedAt).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </div>
        <button
          className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-[2px] border border-[var(--line-strong,#4b5563)] text-[var(--paper-dim,#9ca3af)] hover:bg-[var(--panel-2,#1f2937)] hover:text-[var(--paper,#fff)]"
          onClick={() => setVersionTarget(null)}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}