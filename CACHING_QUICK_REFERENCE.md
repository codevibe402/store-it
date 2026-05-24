## Quick Reference: How Caching Works in StoreIt

### 🌐 Architecture Overview

```
User Browser
    ↓
Next.js API Routes (with Cache-Control headers)
    ↓
CloudFront CDN (caches responses)
    ↓
AWS S3 (original source)
    ↓
MongoDB (database)
```

### 📊 Caching Layers

#### Layer 1: Browser Cache (via Cache-Control headers)
- **Who**: Your browser
- **Duration**: Based on `Cache-Control` header
- **What**: Static files, API responses
- **Example**:
  ```
  Cache-Control: public, s-maxage=300, stale-while-revalidate=600
  ```
  - Fresh for 5 minutes
  - Can serve stale data for 10 minutes

#### Layer 2: CloudFront CDN Cache (for file downloads)
- **Who**: AWS CloudFront
- **Duration**: 24 hours for files
- **What**: File downloads from S3
- **Example**: Download link redirects to `https://d123abc.cloudfront.net/file.pdf`
  - First request: CloudFront fetches from S3
  - Subsequent requests: CloudFront serves from cache
  - **Result**: 50-80% faster downloads

#### Layer 3: React Query Client-Side Cache
- **Who**: Browser application
- **Duration**: 
  - `staleTime`: 5 minutes (data considered fresh)
  - `gcTime`: 10 minutes (cached data lifetime)
- **What**: API response data
- **Behavior**:
  ```typescript
  // First request → Fetches from server
  useQuery({ queryKey: ['files'], queryFn: fetchFiles })
  
  // Second request (within 5 min) → Returns cached data instantly
  useQuery({ queryKey: ['files'], queryFn: fetchFiles })
  
  // After 10 min → Cache cleared, refetch required
  ```

#### Layer 4: MongoDB Database
- **Who**: Database server
- **Benefits**: Reduced query load due to upper caching layers
- **Result**: Fewer database queries = lower latency

---

### 🚀 Performance Flow

#### File Download Flow
```
User clicks download
    ↓
API generates CloudFront URL (via cdn.ts)
    ↓
Browser redirects to CloudFront
    ↓
CloudFront checks cache:
  ✓ Cache hit → Returns file (instant)
  ✗ Cache miss → Fetches from S3, caches, returns file
```

#### API List Request Flow
```
useQuery(['files'])
    ↓
React Query checks cache:
  ✓ Data fresh (< 5 min) → Returns cached data (instant)
  ✗ Data stale (> 5 min) → Fetches from /api/files/fetch
    ↓
Next.js API returns response with Cache-Control header
    ↓
Browser caches response for next 5 minutes
```

---

### 📈 Cache Hit Rates (Expected)

| Resource | Hit Rate | Speed Improvement |
|----------|----------|-------------------|
| File Downloads | 70-85% | 50-80% faster |
| API Responses | 75-90% | 60-90% faster |
| Repeated Searches | 40-60% | 70% faster |

---

### 🔧 Configuration Quick Reference

**File**: `lib/cdn.ts`
```typescript
export const CDN_CONFIG = {
  useCloudFront: true,
  cacheTTL: {
    files: 86400,      // 24 hours
    metadata: 300,     // 5 minutes
    folders: 600,      // 10 minutes
    search: 60,        // 1 minute
  },
};
```

**File**: `lib/queryClient.ts`
```typescript
staleTime: 5 * 60 * 1000,           // 5 minutes
gcTime: 10 * 60 * 1000,              // 10 minutes
retry: 2,                            // Retry failed requests 2x
refetchOnWindowFocus: false,         // Don't refetch on tab switch
```

---

### 🛠️ Adjusting Cache Durations

To change cache times, edit `lib/cdn.ts`:

```typescript
export const CDN_CONFIG = {
  cacheTTL: {
    files: 86400,      // Change this (in seconds)
    metadata: 300,     // 5 min → 10 min: change to 600
    folders: 600,
    search: 60,
  },
};
```

Then update React Query in `lib/queryClient.ts`:
```typescript
staleTime: 10 * 60 * 1000,  // Match your metadata cache time
```

---

### ✅ Monitor Caching Health

**Check Cache-Control Headers:**
```javascript
// Run in browser console
fetch('/api/files/fetch').then(r => 
  console.log('Cache:', r.headers.get('Cache-Control'))
);
```

**Expected Response:**
```
Cache: public, s-maxage=300, stale-while-revalidate=600
```

**Check CloudFront Stats:**
1. AWS Console → CloudFront → Distributions
2. Select your distribution
3. Check "Cache Statistics"
4. Look for "Cache Hit Rate" (target: 80%+)

---

### ⚠️ Cache Invalidation

If you need to clear cache:

**CloudFront Cache Invalidation:**
1. AWS Console → CloudFront
2. Select distribution
3. Invalidations tab → Create invalidation
4. Path: `/*` (all files) or specific path

**Browser Cache:**
- Hard refresh: `Ctrl+Shift+R` (Windows) / `Cmd+Shift+R` (Mac)

**React Query Cache:**
```typescript
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Clear all caches
queryClient.clear();

// Clear specific query
queryClient.invalidateQueries({ queryKey: ['files'] });
```
