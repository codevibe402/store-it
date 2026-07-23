"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

type DashboardData = {
  files: FileType[];
  folders: FolderType[];
  pendingFiles: FileType[];
};

export function useDashboard() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: isLoading, error } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
    staleTime: 0,
  });

  const files = dashboard?.files ?? [];
  const folders = dashboard?.folders ?? [];
  const pendingFiles = dashboard?.pendingFiles ?? [];

  const uploadedFiles = files.filter((f) => f.status === "uploaded");

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["dashboard"] });

  return {
    files,
    folders,
    pendingFiles,
    uploadedFiles,
    isLoading,
    error,
    isAuthenticated,
    refetch,
  };
}