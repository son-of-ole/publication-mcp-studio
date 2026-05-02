-- Run this in your Supabase SQL Editor to set up the Articles schema

-- 1. Create the `articles` table
CREATE TABLE IF NOT EXISTS public.articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  content_markdown text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  category text NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS category text NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS articles_category_idx ON public.articles (category);
CREATE INDEX IF NOT EXISTS articles_tags_gin_idx ON public.articles USING gin (tags);

-- 2. Turn on Row Level Security
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Public can read published articles
CREATE POLICY "Public can view published articles" 
  ON public.articles FOR SELECT 
  USING (status = 'published');

-- 4. Policy: Authenticated Admins have full access
CREATE POLICY "Admins have full access" 
  ON public.articles FOR ALL 
  USING (auth.role() = 'authenticated');

-- 5. Create storage bucket for images and PDFs
INSERT INTO storage.buckets (id, name, public) 
VALUES ('article-assets', 'article-assets', true);

-- 6. Storage Policies for `article-assets`
CREATE POLICY "Public can view article-assets" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'article-assets');

CREATE POLICY "Admins can upload article-assets" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'article-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can update article-assets" 
  ON storage.objects FOR UPDATE 
  USING (bucket_id = 'article-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can delete article-assets" 
  ON storage.objects FOR DELETE 
  USING (bucket_id = 'article-assets' AND auth.role() = 'authenticated');

-- 7. Add updated_at trigger
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

CREATE TRIGGER update_articles_modtime 
  BEFORE UPDATE ON public.articles 
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 8. Audit log for publication API and MCP activity
CREATE TABLE IF NOT EXISTS public.publication_api_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL,
  actor_label text NOT NULL,
  actor_type text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  route text NOT NULL,
  method text NOT NULL,
  article_id uuid NULL REFERENCES public.articles(id) ON DELETE SET NULL,
  article_slug text NULL,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.publication_api_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view publication audit log"
  ON public.publication_api_audit_log FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage publication audit log"
  ON public.publication_api_audit_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 9. Token inventory for signed publication API tokens
CREATE TABLE IF NOT EXISTS public.publication_api_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  token_type text NOT NULL DEFAULT 'signed',
  scopes text[] NOT NULL DEFAULT '{}',
  profile_id text NULL,
  profile_label text NULL,
  profile_enabled_skill_ids text[] NOT NULL DEFAULT '{}',
  token_enabled_skill_ids text[] NULL,
  allow_profile_skill_overrides boolean NOT NULL DEFAULT false,
  issued_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NULL,
  last_used_at timestamp with time zone NULL,
  last_used_route text NULL,
  last_used_method text NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.publication_api_tokens
  ADD COLUMN IF NOT EXISTS profile_id text NULL,
  ADD COLUMN IF NOT EXISTS profile_label text NULL,
  ADD COLUMN IF NOT EXISTS profile_enabled_skill_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS token_enabled_skill_ids text[] NULL,
  ADD COLUMN IF NOT EXISTS allow_profile_skill_overrides boolean NOT NULL DEFAULT false;

ALTER TABLE public.publication_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view publication token inventory"
  ON public.publication_api_tokens FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage publication token inventory"
  ON public.publication_api_tokens FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_publication_api_tokens_modtime
  BEFORE UPDATE ON public.publication_api_tokens
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- 10. Version snapshots for publication articles
CREATE TABLE IF NOT EXISTS public.publication_article_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  source_action text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  content_markdown text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  actor_label text NULL,
  actor_type text NULL,
  metadata jsonb NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(article_id, version_number)
);

ALTER TABLE public.publication_article_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view publication article versions"
  ON public.publication_article_versions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage publication article versions"
  ON public.publication_article_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
