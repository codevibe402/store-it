"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

type RecycleFile = {
  _id: string;
  filename: string;
  deletedAt: string;
};

export default function RecycleBinSidebar() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [recycleFiles, setRecycleFiles] = useState<RecycleFile[]>([]);

  useEffect(() => {
    if (!user?.userId) return;
    fetch(`/api/recycle/${user.userId}`)
      .then((r) => r.json())
      .then((d) => setRecycleFiles(d.files || []))
      .catch(() => {});
  }, [user?.userId, isOpen]);

  const handleRestore = async (fileId: string) => {
    if (!user?.userId) return;
    await fetch(`/api/recycle/${user.userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    setRecycleFiles(recycleFiles.filter((f) => f._id !== fileId));
  };

  const handleDelete = async (fileId: string) => {
    if (!user?.userId) return;
    await fetch(`/api/recycle/${user.userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    setRecycleFiles(recycleFiles.filter((f) => f._id !== fileId));
  };

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
        aria-label="Toggle recycle bin"
      >
        <span>🗑</span>
        Recycle Bin ({recycleFiles.length})
      </button>

      {isOpen && (
        <div className="fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-slate-700 bg-slate-900 p-4 pt-16">
          <h3 className="mb-4 text-sm font-medium text-slate-400">Recycle Bin</h3>
          {recycleFiles.length === 0 ? (
            <p className="text-xs text-slate-500">Empty</p>
          ) : (
            <ul className="space-y-2">
              {recycleFiles.map((f) => (
                <li key={f._id} className="flex items-center justify-between rounded bg-slate-800 p-2 text-xs">
                  <span className="truncate text-slate-200">{f.filename}</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleRestore(f._id)} className="text-green-400 hover:text-green-300">
                      ↺
                    </button>
                    <button onClick={() => handleDelete(f._id)} className="text-red-400 hover:text-red-300">
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}