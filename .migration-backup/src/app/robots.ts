import type { MetadataRoute } from 'next'

const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.example'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/admin/', '/api/'],
      },
    ],
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
    host: PUBLIC_SITE_URL,
  }
}
