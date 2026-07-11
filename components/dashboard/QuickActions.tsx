"use client";

import { useRouter } from "next/navigation";

type QuickActionsProps = {
  onSearch: () => void;
};

export default function QuickActions({ onSearch }: QuickActionsProps) {
  const router = useRouter();

  return (
    <div className="flex gap-2">
      <button
        className="rounded-lg border border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800"
        onClick={onSearch}
        aria-label="Search files"
      >
        <svg className="inline-block w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21L14.35 14.35" />
        </svg>
      </button>
      <button
        className="rounded-lg border border-gray-600 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:bg-gray-800"
        onClick={() => router.push("/all-files")}
        aria-label="View all files"
      >
        All files
      </button>
      <button
        className="rounded-lg border border-[#6c8eff]/30 bg-[#6c8eff1a] px-3 py-1.5 text-xs font-medium text-[#6c8eff] transition hover:bg-[#6c8eff25]"
        onClick={() => router.push("/sidebar")}
        aria-label="Browse by type"
      >
        Browse by type
      </button>
    </div>
  );
}