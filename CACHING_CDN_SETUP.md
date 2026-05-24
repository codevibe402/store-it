# CDN & Caching Setup Checklist

## AWS Setup (Prerequisite)

### Create CloudFront Distribution
- [ ] Go to AWS Console → CloudFront
- [ ] Click "Create Distribution"
- [ ] **Origin Settings:**
  - [ ] Domain: `your-bucket.s3.us-east-1.amazonaws.com`
  - [ ] Origin name: `S3-StoreIt`
  - [ ] S3 Bucket Access: `Yes use OAI`
- [ ] **Cache Behavior:**
  - [ ] Viewer Protocol: `HTTPS only`
  - [ ] Allowed Methods: `GET, HEAD, OPTIONS`
  - [ ] Cache Policy: `Managed-CachingOptimized`
  - [ ] Origin Request Policy: `Managed-CORS-S3Origin`
- [ ] Click "Create Distribution"
- [ ] **Wait 5-10 minutes** for deployment
- [ ] Copy CloudFront Domain Name (e.g., `d123abc.cloudfront.net`)

### Update S3 Bucket Policy
- [ ] Go to S3 → Your Bucket → Permissions
- [ ] Add policy allowing CloudFront OAI access:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity/YOUR-OAI-ID"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket/*"
    }
  ]
}
```

## Local Setup

### 1. Environment Variables
- [ ] Open `.env.local`
- [ ] Add these variables:
```bash
# CloudFront Domain (from AWS setup above)
NEXT_PUBLIC_CLOUDFRONT_DOMAIN=d123abc.cloudfront.net

# Existing AWS variables (update if needed)
AWS_BUCKET_NAME=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### 2. Code Changes
- [ ] **Created new files:**
  - [ ] `lib/cdn.ts` - CDN configuration
  - [ ] `lib/queryClient.ts` - React Query optimization

- [ ] **Updated files:**
  - [ ] `app/api/files/[id]/download/route.ts` - CloudFront support
  - [ ] `app/api/files/fetch/route.ts` - Cache headers
  - [ ] `app/api/folders/route.ts` - Cache headers
  - [ ] `app/api/search/route.ts` - Cache headers
  - [ ] `components/ui/providers.tsx` - React Query config

## Verification Steps

### 1. Test CloudFront Download
```bash
# 1. Start your dev server
npm run dev

# 2. Upload a test file via dashboard
# 3. Click download
# 4. Check Network tab in Chrome DevTools:
#    - URL should show CloudFront domain (if enabled)
#    - Cache-Control header: "public, max-age=86400"
```

### 2. Test API Caching
```bash
# In browser console:
fetch('/api/files/fetch')
  .then(r => {
    console.log('Cache-Control:', r.headers.get('Cache-Control'));
    return r.json();
  });
```

Expected output:
```
Cache-Control: public, s-maxage=300, stale-while-revalidate=600
```

### 3. Test React Query
```bash
# Open browser DevTools → React Query DevTools
# Check that:
# - Queries have 5min staleTime
# - Mutations retry on failure
# - No unnecessary refetches
```

## Performance Monitoring

### CloudWatch (AWS Console)
- [ ] Monitor "Bytes downloaded" metrics
- [ ] Monitor cache hit ratio (aim for 80%+)
- [ ] Check for any 4xx/5xx errors

### Network Tab Analysis
- [ ] Before: Direct S3 downloads ~500ms
- [ ] After: CloudFront downloads ~100-200ms (depending on region)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CloudFront returns 403 | Check S3 bucket policy and OAI permissions |
| Files not cached | Verify `Cache-Control` headers in response |
| React Query not caching | Check browser DevTools for React Query DevTools extension |
| Presigned URLs still used | Ensure `NEXT_PUBLIC_CLOUDFRONT_DOMAIN` is set |

## Next Steps (Not Implemented Yet)

- [ ] Add Redis for database query caching (medium priority)
- [ ] Implement ISR for dashboard pages (medium priority)
- [ ] Add static asset optimization (low priority)
