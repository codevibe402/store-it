"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { queryClient } from "@/client/lib/queryClient";

export default function Providers({ children }: { children: ReactNode }) {
  // Use the globally optimized queryClient instance
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}