"use client";

type StorageCardProps = {
  fileCount: number;
};

export default function StorageCard({ fileCount }: StorageCardProps) {
  return (
    <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-4 sticky top-24">
      <div className="text-[0.85rem] text-[#e8eaf0] mb-2">Duplicate protection</div>
      <div className="text-[1.125rem] font-semibold text-[#fbbf24]">{fileCount} files watched</div>
    </div>
  );
}