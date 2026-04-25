import { createLocalPublicationPlatform } from './local'
import { getPublicationMediaStorageOptionsFromEnv } from './media-storage'
import { createNeonPublicationPlatform } from './neon'
import { createSupabasePublicationPlatform } from './supabase'
import { PublicationApiError } from './errors'
import type {
  LocalPublicationPlatformOptions,
  NeonPublicationPlatformOptions,
  PublicationPlatformFactoryRegistry,
  SupabasePublicationPlatformOptions,
} from './types'

export * from './errors'
export * from './media-storage'
export * from './token-scopes'
export * from './types'
export { createLocalPublicationPlatform } from './local'
export { createNeonPublicationPlatform } from './neon'
export { createSupabasePublicationPlatform } from './supabase'
export {
  createTemplatePublicationPlatform,
  createTemplatePublicationPlatformFactory,
} from './template'

type PublicationEnv = Record<string, string | undefined>

export function getLocalPublicationPlatformOptionsFromEnv(
  env: PublicationEnv = process.env
): LocalPublicationPlatformOptions {
  return {
    rootDir: env.PUBLICATION_LOCAL_ROOT_DIR?.trim() || undefined,
    seedDemoContent: env.PUBLICATION_LOCAL_SEED_DEMO_CONTENT?.trim()
      ? env.PUBLICATION_LOCAL_SEED_DEMO_CONTENT.trim().toLowerCase() !== 'false'
      : undefined,
    adminEmail: env.PUBLICATION_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    adminPassword: env.PUBLICATION_ADMIN_PASSWORD || undefined,
  }
}

export function getNeonPublicationPlatformOptionsFromEnv(
  env: PublicationEnv = process.env
): NeonPublicationPlatformOptions {
  return {
    ...getLocalPublicationPlatformOptionsFromEnv(env),
    databaseUrl:
      env.NEON_DATABASE_URL?.trim() ||
      env.DATABASE_URL?.trim() ||
      env.POSTGRES_URL?.trim() ||
      env.POSTGRES_PRISMA_URL?.trim() ||
      undefined,
    mediaStorage: getPublicationMediaStorageOptionsFromEnv(env),
  }
}

export function hasSupabasePublicationPlatformConfig(env: PublicationEnv = process.env) {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
      env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
}

export function hasNeonPublicationPlatformConfig(env: PublicationEnv = process.env) {
  const databaseUrl = getNeonPublicationPlatformOptionsFromEnv(env).databaseUrl
  return Boolean(databaseUrl && (/\.neon\.tech\b/i.test(databaseUrl) || env.NEON_DATABASE_URL?.trim()))
}

export function getSupabasePublicationPlatformOptionsFromEnv(): SupabasePublicationPlatformOptions {
  return {}
}

export function createPublicationPlatformRegistry(
  env: PublicationEnv = process.env
): PublicationPlatformFactoryRegistry {
  const localOptions = getLocalPublicationPlatformOptionsFromEnv(env)
  const neonOptions = getNeonPublicationPlatformOptionsFromEnv(env)
  const supabaseOptions = getSupabasePublicationPlatformOptionsFromEnv()

  return {
    local: () => createLocalPublicationPlatform(localOptions),
    neon: () => createNeonPublicationPlatform(neonOptions),
    supabase: () => createSupabasePublicationPlatform(supabaseOptions),
  }
}

export function getAvailablePublicationPlatformAdapters(
  registry = createPublicationPlatformRegistry()
) {
  return Object.keys(registry).sort()
}

export function resolvePublicationPlatformAdapterName(
  env: PublicationEnv = process.env,
  registry = createPublicationPlatformRegistry(env)
) {
  const requestedAdapter = env.PUBLICATION_PLATFORM_ADAPTER?.trim().toLowerCase()

  if (requestedAdapter) {
    if (!registry[requestedAdapter]) {
      throw new PublicationApiError(
        500,
        'platform_adapter_unknown',
        `Unknown publication platform adapter "${requestedAdapter}". Available adapters: ${getAvailablePublicationPlatformAdapters(registry).join(', ')}.`
      )
    }

    return requestedAdapter
  }

  if (hasSupabasePublicationPlatformConfig(env)) {
    return 'supabase'
  }

  if (hasNeonPublicationPlatformConfig(env)) {
    return 'neon'
  }

  return 'local'
}

export function getPublicationPlatform(registry = createPublicationPlatformRegistry(process.env)) {
  const adapterName = resolvePublicationPlatformAdapterName(process.env, registry)
  return registry[adapterName]()
}
