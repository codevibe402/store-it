/**
 * CDN & Caching Configuration
 * 
 * Hybrid Caching Strategy:
 * ────────────────────────
 * 1. Regular downloads (authenticated users):
 *    - Uses CloudFront URLs from generateFileUrl()
 *    - Cached for 24 hours (cacheTTL.files)
 *    - Best for: Frequently accessed files
 *
 * 2. Shared files (with expiration):
 *    - Uses S3 presigned URLs (7-day default expiration)
 *    - CloudFront caches them for the presigned URL's lifetime
 *    - Automatically expires when presigned URL expires
 *    - Best for: Time-limited access, sharing
 *
 * 3. File versions (with expiration):
 *    - Uses S3 presigned URLs (10-minute expiration)
 *    - CloudFront caches them for the presigned URL's lifetime
 *    - Best for: Version control, audit trails
 *
 * Environment Variables:
 * ─────────────────────
 * NEXT_PUBLIC_CLOUDFRONT_DOMAIN: Your CloudFront distribution domain
 *                                If not set, falls back to S3 direct access
 * AWS_BUCKET_NAME:              S3 bucket name
 * AWS_REGION:                   AWS region (e.g., eu-north-1)
 */

export const CDN_CONFIG = {
  // CloudFront domain - if not set, falls back to S3 direct
  domain: process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN || process.env.AWS_BUCKET_NAME,
  
  // Determines if we're using CloudFront
  useCloudFront: !!process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN,
  
  // Cache durations (in seconds)
  cacheTTL: {
    files: 86400,           // 24 hours for user files (regular downloads)
    metadata: 300,          // 5 minutes for file metadata
    folders: 600,           // 10 minutes for folder structure
    search: 60,             // 1 minute for search results
  },
};

/**
 * Generate CloudFront URL for a file
 * @param storageUrl - S3 object key (path in bucket)
 * @returns Full CloudFront or S3 URL
 * 
 * Usage:
 * - For regular user downloads: generateFileUrl(file.storageUrl)
 * - CloudFront automatically caches this for 24 hours
 * - Users get the same URL every time (cache-friendly)
 */
export function generateFileUrl(storageUrl: string): string {
  if (!CDN_CONFIG.useCloudFront) {
    // Fallback to S3 direct access (not recommended for production)
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${storageUrl}`;
  }
  
  return `https://${CDN_CONFIG.domain}/${storageUrl}`;
}

/**
 * Get cache control headers for API responses
 * @param type - Type of resource (files, folders, search, etc)
 * @returns Cache-Control header value
 * 
 * Usage:
 * - response.headers.set('Cache-Control', getCacheControlHeader('files'));
 * - Tells CloudFront and browsers how long to cache the content
 * - s-maxage: CloudFront cache time
 * - stale-while-revalidate: Serve stale content while revalidating in background
 */
export function getCacheControlHeader(type: 'files' | 'folders' | 'search' | 'metadata' | 'static'): string {
  const ttl = CDN_CONFIG.cacheTTL[type as keyof typeof CDN_CONFIG.cacheTTL];
  
  // Format: public cache, max-age, stale-while-revalidate for background refresh
  return `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`;
}
