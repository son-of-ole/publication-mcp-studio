import type { MetadataRoute } from 'next'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.example'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createServerSupabaseClient()
  const { data: articles } = await supabase
    .from('articles')
    .select('slug, updated_at, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: PUBLIC_SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${PUBLIC_SITE_URL}/publications`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ]

  const publicationRoutes: MetadataRoute.Sitemap =
    articles?.map((article) => ({
      url: `${PUBLIC_SITE_URL}/publications/${article.slug}`,
      lastModified: article.updated_at || article.created_at || new Date().toISOString(),
      changeFrequency: 'weekly',
      priority: 0.8,
    })) ?? []

  return [...staticRoutes, ...publicationRoutes]
}
