import {
  getPublicationMediaBucketName,
  hasPublicationS3MediaStorageConfig,
  resolvePublicationMediaStorageDriver,
  getPublicationPlatform,
} from './publication-platform'

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
  const platform = getPublicationPlatform()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const neonDatabaseUrl =
    process.env.NEON_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    ''
  const adminEmail = process.env.PUBLICATION_ADMIN_EMAIL?.trim() || ''
  const adminPassword = process.env.PUBLICATION_ADMIN_PASSWORD || ''
  const mediaStorageDriver = resolvePublicationMediaStorageDriver(process.env)
  const mediaStorageBucket = getPublicationMediaBucketName(process.env)
  const publicationSecret = process.env.PUBLICATION_API_SECRET?.trim() || ''
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    ''
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY?.trim() || ''

  checks.push({
    key: 'platform_adapter',
    label: 'Persistence adapter',
    status: platform.kind === 'local' ? 'warn' : 'pass',
    detail:
      platform.kind === 'supabase'
        ? 'Supabase adapter is active.'
        : platform.kind === 'neon'
          ? 'Neon Postgres adapter is active.'
          : 'Local filesystem adapter is active. This is excellent for local development, but production should use a shared backend adapter.',
  })

  if (platform.kind === 'supabase') {
    checks.push(checkRequired('supabase_url', 'Supabase URL', supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is configured.'))
    checks.push(checkRequired('supabase_anon', 'Supabase anon key', anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is configured.'))
    checks.push(checkRequired('supabase_service', 'Supabase service role key', serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is configured.'))
  } else if (platform.kind === 'neon') {
    checks.push(
      checkRequired(
        'neon_database_url',
        'Neon database URL',
        neonDatabaseUrl,
        'A Neon/Postgres connection string is configured.'
      )
    )
    checks.push({
      key: 'neon_media_storage',
      label: 'Media storage',
      status: mediaStorageDriver === 's3' && hasPublicationS3MediaStorageConfig(process.env) ? 'pass' : 'warn',
      detail:
        mediaStorageDriver === 's3' && hasPublicationS3MediaStorageConfig(process.env)
          ? `Shared S3-compatible media storage is configured using bucket "${mediaStorageBucket}".`
          : 'The Neon adapter stores media files on the local filesystem under public/__publication-local. Configure shared S3-compatible media storage before multi-instance production use.',
    })
  } else {
    checks.push({
      key: 'local_adapter',
      label: 'Local adapter persistence',
      status: 'pass',
      detail: 'A local persisted adapter is available, so the app can boot without external infrastructure.',
    })
  }

  if (platform.adminAuthStore.kind === 'local') {
    checks.push(
      adminEmail && adminPassword
        ? {
            key: 'admin_credentials',
            label: 'Admin credentials',
            status: 'pass',
            detail: 'PUBLICATION_ADMIN_EMAIL and PUBLICATION_ADMIN_PASSWORD are configured for admin sign-in.',
          }
        : {
            key: 'admin_credentials',
            label: 'Admin credentials',
            status: platform.kind === 'local' ? 'warn' : 'warn',
            detail:
              'Admin auth is using the local credential flow. Set PUBLICATION_ADMIN_EMAIL and PUBLICATION_ADMIN_PASSWORD before production use.',
          }
    )
  }

  checks.push(
    publicationSecret
      ? {
          key: 'publication_secret',
          label: 'Publication API secret',
          status: 'pass',
          detail: 'PUBLICATION_API_SECRET is configured for signed tokens.',
        }
      : {
          key: 'publication_secret',
          label: 'Publication API secret',
          status: platform.kind === 'local' ? 'warn' : 'fail',
          detail:
            platform.kind === 'local'
              ? 'A local fallback signing secret is active. Set PUBLICATION_API_SECRET before production use.'
              : 'Publication API secret is missing.',
        }
  )
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
