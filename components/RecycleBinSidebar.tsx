"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";

type RecycleFile = {
  _id: string;
  filename: string;
  deletedAt: string;
  size?: number;
};

export default function RecycleBinSidebar() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const { data: recycleFiles = [] } = useQuery<RecycleFile[]>({
    queryKey: ["recycle", user?.userId],
    queryFn: async () => {
      const res = await fetch(`/api/recycle/${user?.userId}`);
      if (!res.ok) return [];
      const d = await res.json();
      return d.files || [];
    },
    enabled: !!user?.userId && isOpen,
  });

  const handleRestore = async (fileId: string) => {
    if (!user?.userId) return;
    try {
      const res = await fetch(`/api/recycle/${user.userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) throw new Error("Restore failed");
      queryClient.invalidateQueries({ queryKey: ["recycle", user.userId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {}
  };

  const handleDelete = async (fileId: string) => {
    if (!user?.userId) return;
    try {
      const res = await fetch(`/api/recycle/${user.userId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) throw new Error("Delete failed");
      queryClient.invalidateQueries({ queryKey: ["recycle", user.userId] });
    } catch {}
  };

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
        aria-label="Toggle recycle bin"
        title={`Recycle Bin (${recycleFiles.length})`}
      >
        <span>🗑</span>
      </button>

      {isOpen && (
        <aside className="fixed inset-y-0 left-0 z-40 mt-16 w-64 overflow-y-auto border-r border-slate-700 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-400">Recycle Bin</h3>
          {recycleFiles.length === 0 ? (
            <p className="text-xs text-slate-500">Empty</p>
          ) : (
            <ul className="space-y-2">
              {recycleFiles.map((f) => (
                <li key={f._id} className="flex items-center justify-between rounded bg-slate-800 px-2 py-1 text-xs">
                  <span className="truncate text-slate-200">{f.filename}</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleRestore(f._id)} className="text-green-400 hover:text-green-300" title="Restore">
                      ↺
                    </button>
                    <button onClick={() => handleDelete(f._id)} className="text-red-400 hover:text-red-300" title="Delete permanently">
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  );
}