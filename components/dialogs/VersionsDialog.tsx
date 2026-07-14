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
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 fade-in" onClick={() => setVersionTarget(null)}>
      <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm slide-up" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[1.05rem] font-semibold text-[#e8eaf0] mb-2">Version history</h3>
        <p className="text-[0.82rem] text-[#6b7280] mb-4">Every saved version of {versionTarget.filename} is visible here.</p>
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          {versionsLoading ? (
            <div className="text-xs text-[#6b7280] py-4">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="text-xs text-[#6b7280] py-4">No versions recorded yet.</div>
          ) : (
            versions.map((version) => (
              <button
                key={version.id}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                  version.isCurrent
                    ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                    : "border-gray-600 bg-transparent text-gray-400 hover:bg-[#13161e]"
                )}
                onClick={() => onOpenVersion(version)}
              >
                v{version.version}
                <span className="text-xs text-[#6b7280] ml-auto">
                  {version.isCurrent ? "Current" : new Date(version.uploadedAt).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </div>
        <button
          className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
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