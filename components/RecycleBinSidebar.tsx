"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";

type RecycleFile = {
  _id: string;
  filename: string;
  deletedAt: string;
};

export default function RecycleBinSidebar() {
  const { user } = useAuth();

  const { data: recycleFiles = [], refetch } = useQuery<RecycleFile[]>({
    queryKey: ["recycle", user?.userId],
    queryFn: async () => {
      const res = await fetch(`/api/recycle/${user?.userId}`);
      if (!res.ok) return [];
      const d = await res.json();
      return d.files || [];
    },
    enabled: !!user?.userId,
  });

  useEffect(() => {
    refetch();
  }, [user?.userId]);

  const handleRestore = async (fileId: string) => {
    if (!user?.userId) return;
    await fetch(`/api/recycle/${user.userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    refetch();
  };

  const handleDelete = async (fileId: string) => {
    if (!user?.userId) return;
    await fetch(`/api/recycle/${user.userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    refetch();
  };

  if (!user) return null;

  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-700 bg-slate-900 p-4 pt-6">
      <h3 className="mb-4 text-sm font-medium text-slate-400">Recycle Bin ({recycleFiles.length})</h3>
      {recycleFiles.length === 0 ? (
        <p className="text-xs text-slate-500">Empty</p>
      ) : (
        <ul className="space-y-2">
          {recycleFiles.map((f) => (
            <li key={f._id} className="flex items-center justify-between rounded bg-slate-800 p-2 text-xs">
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
  );
}