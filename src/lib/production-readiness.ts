import { getPublicationServiceClient } from '@/lib/publication-db'

export type ReadinessCheck = {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export type ProductionReadinessReport = {
  ready: boolean
  summary: {
    pass: number
    warn: number
    fail: number
  }
  environment: {
    nodeEnv: string
    vercelEnv: string
  }
  checks: ReadinessCheck[]
}

export async function getProductionReadinessReport(): Promise<ProductionReadinessReport> {
  const checks: ReadinessCheck[] = []
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const publicationSecret = process.env.PUBLICATION_API_SECRET?.trim() || ''
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    ''
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY?.trim() || ''

  checks.push(checkRequired('supabase_url', 'Supabase URL', supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is configured.'))
  checks.push(checkRequired('supabase_anon', 'Supabase anon key', anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is configured.'))
  checks.push(checkRequired('supabase_service', 'Supabase service role key', serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is configured.'))
  checks.push(checkRequired('publication_secret', 'Publication API secret', publicationSecret, 'PUBLICATION_API_SECRET is configured for signed tokens.'))
  checks.push(
    siteUrl
      ? {
          key: 'site_url',
          label: 'Canonical site URL',
          status: siteUrl.startsWith('https://') ? 'pass' : 'warn',
          detail: siteUrl.startsWith('https://')
            ? `NEXT_PUBLIC_SITE_URL resolves to ${siteUrl}.`
            : `NEXT_PUBLIC_SITE_URL should use https in production. Current value: ${siteUrl}`,
        }
      : {
          key: 'site_url',
          label: 'Canonical site URL',
          status: 'fail',
          detail: 'Set NEXT_PUBLIC_SITE_URL to your production Vercel domain or custom domain.',
        }
  )
  checks.push(
    openRouterKey
      ? {
          key: 'openrouter_key',
          label: 'OpenRouter key',
          status: 'pass',
          detail: 'OPENROUTER_API_KEY is configured for publication drafting.',
        }
      : {
          key: 'openrouter_key',
          label: 'OpenRouter key',
          status: 'warn',
          detail: 'OPENROUTER_API_KEY is not configured, so AI drafting will be unavailable in production.',
        }
  )

  if (anonKey && serviceRoleKey) {
    checks.push({
      key: 'service_vs_anon',
      label: 'Service key separation',
      status: anonKey === serviceRoleKey ? 'fail' : 'pass',
      detail:
        anonKey === serviceRoleKey
          ? 'SUPABASE_SERVICE_ROLE_KEY must not match the public anon key.'
          : 'Service role key is distinct from the public anon key.',
    })
  }

  if (supabaseUrl && serviceRoleKey) {
    const supabase = getPublicationServiceClient()
    checks.push(await checkTableExists(supabase, 'articles', 'Articles table'))
    checks.push(await checkTableExists(supabase, 'publication_api_audit_log', 'Publication audit log table'))
    checks.push(await checkTableExists(supabase, 'publication_api_tokens', 'Publication token inventory table'))
    checks.push(await checkTableExists(supabase, 'publication_article_versions', 'Publication article versions table'))
    checks.push(await checkStorageBucket(supabase, 'article-assets'))
  }

  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1
      return acc
    },
    { pass: 0, warn: 0, fail: 0 }
  )

  return {
    ready: summary.fail === 0,
    summary,
    environment: {
      nodeEnv: process.env.NODE_ENV || 'unknown',
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
    },
    checks,
  }
}

function checkRequired(key: string, label: string, value: string, successDetail: string): ReadinessCheck {
  return value
    ? {
        key,
        label,
        status: 'pass',
        detail: successDetail,
      }
    : {
        key,
        label,
        status: 'fail',
        detail: `${label} is missing.`,
      }
}

async function checkTableExists(
  supabase: ReturnType<typeof getPublicationServiceClient>,
  tableName: string,
  label: string
): Promise<ReadinessCheck> {
  const { error } = await supabase.from(tableName).select('*', { head: true, count: 'exact' }).limit(1)

  if (error) {
    return {
      key: tableName,
      label,
      status: 'fail',
      detail: `Missing or inaccessible table "${tableName}": ${error.message}`,
    }
  }

  return {
    key: tableName,
    label,
    status: 'pass',
    detail: `Table "${tableName}" is available.`,
  }
}

async function checkStorageBucket(
  supabase: ReturnType<typeof getPublicationServiceClient>,
  bucketName: string
): Promise<ReadinessCheck> {
  const { data, error } = await supabase.storage.listBuckets()

  if (error) {
    return {
      key: 'storage_bucket',
      label: 'Article asset bucket',
      status: 'warn',
      detail: `Could not verify storage bucket availability: ${error.message}`,
    }
  }

  const bucketExists = (data ?? []).some((bucket) => bucket.name === bucketName || bucket.id === bucketName)

  return {
    key: 'storage_bucket',
    label: 'Article asset bucket',
    status: bucketExists ? 'pass' : 'fail',
    detail: bucketExists
      ? `Storage bucket "${bucketName}" is available.`
      : `Storage bucket "${bucketName}" is missing.`,
  }
}
