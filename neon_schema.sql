-- Run this in your Neon SQL editor to set up the Publication MCP Studio schema.
-- This schema is plain Postgres and can also be used with a standard Postgres database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

CREATE TABLE IF NOT EXISTS public.publication_media_assets (
  path text PRIMARY KEY,
  bucket text NOT NULL,
  public_url text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'other')),
  article_slug text NOT NULL,
  embed_markdown text NOT NULL DEFAULT '',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_articles_modtime ON public.articles;
CREATE TRIGGER update_articles_modtime
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

DROP TRIGGER IF EXISTS update_publication_api_tokens_modtime ON public.publication_api_tokens;
CREATE TRIGGER update_publication_api_tokens_modtime
  BEFORE UPDATE ON public.publication_api_tokens
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

DROP TRIGGER IF EXISTS update_publication_media_assets_modtime ON public.publication_media_assets;
CREATE TRIGGER update_publication_media_assets_modtime
  BEFORE UPDATE ON public.publication_media_assets
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
