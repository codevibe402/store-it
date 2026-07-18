"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "./EmptyState";
import { formatBytes } from "./utils";
import { staggerContainer, riseItem } from "./motionVariants";
import shared from "./PageShared.module.css";
import styles from "./TrashPage.module.css";

type RecycleFile = {
  _id: string;
  filename: string;
  deletedAt: string;
  size?: number;
};

export default function TrashPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  const { data: recycleFiles = [] } = useQuery<RecycleFile[]>({
    queryKey: ["recycle", user?.userId],
    queryFn: async () => {
      const res = await fetch(`/api/recycle/${user?.userId}`);
      if (!res.ok) return [];
      const d = await res.json();
      return d.files || [];
    },
    enabled: !!user?.userId,
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

  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Discard tray</div>
        <h1 className={shared.pageTitle}>Trash</h1>
        <p className={shared.pageDesc}>Deleted files sit here for 30 days before they&apos;re shredded for good.</p>
      </div>

      {recycleFiles.length === 0 ? (
        <EmptyState
          icon={<Trash2 strokeWidth={1.3} />}
          title="The tray is empty"
          description="Delete a file from anywhere in your archive and it'll show up here first."
        />
      ) : (
        <motion.div className={shared.fileList} initial="hidden" animate="show" variants={staggerContainer(0.04, reduceMotion)}>
          {recycleFiles.map((f) => (
            <motion.div key={f._id} className={styles.row} variants={riseItem(reduceMotion)}>
              <div className={styles.icon}>
                <Trash2 />
              </div>
              <div className={styles.meta}>
                <div className={styles.name}>{f.filename}</div>
                <div className={styles.sub}>
                  {f.size !== undefined ? `${formatBytes(f.size)} · ` : ""}Deleted {new Date(f.deletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.restore} onClick={() => handleRestore(f._id)}>
                  Restore
                </button>
                <button type="button" className={styles.destroy} onClick={() => handleDelete(f._id)}>
                  Delete forever
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
