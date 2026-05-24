/**
 * React Query Configuration
 * Optimized for caching API responses and reducing server load
 */

import { QueryClient, DefaultOptions } from '@tanstack/react-query';
import { CDN_CONFIG } from '@/lib/cdn';

const queryConfig: DefaultOptions = {
  queries: {
    // How long data is considered fresh (no refetch)
    staleTime: CDN_CONFIG.cacheTTL.metadata * 1000, // 5 minutes
    
    // How long cached data persists after it becomes stale
    gcTime: 10 * 60 * 1000, // 10 minutes (was cacheTime)
    
    // Retry failed requests 2 times with exponential backoff
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    
    // Refetch when window regains focus
    refetchOnWindowFocus: false,
    
    // Don't refetch on mount if data is fresh
    refetchOnMount: false,
  },
  mutations: {
    // Retry mutations on failure
    retry: 1,
    retryDelay: 1000,
  },
};

export const queryClient = new QueryClient({
  defaultOptions: queryConfig,
});
