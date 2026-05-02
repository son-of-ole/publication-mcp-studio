import {
  createLocalPublicationPlatform,
  createNeonPublicationPlatform,
  createSupabasePublicationPlatform,
  getAvailablePublicationPlatformAdapters,
  getLocalPublicationPlatformOptionsFromEnv,
  getNeonPublicationPlatformOptionsFromEnv,
  getSupabasePublicationPlatformOptionsFromEnv,
  hasNeonPublicationPlatformConfig,
  hasSupabasePublicationPlatformConfig,
  resolvePublicationPlatformAdapterName,
  type PublicationPlatformFactoryRegistry,
} from '@publication-mcp-studio/platform'
import { createExpressLocalPublicationAdminAuthStore, createExpressSupabasePublicationAdminAuthStore } from './publication-admin-express.js'

export * from '@publication-mcp-studio/platform'

export function createPublicationPlatformRegistry(
  env: Record<string, string | undefined> = process.env
): PublicationPlatformFactoryRegistry {
  const localOptions = getLocalPublicationPlatformOptionsFromEnv(env)
  const neonOptions = getNeonPublicationPlatformOptionsFromEnv(env)
  const supabaseOptions = getSupabasePublicationPlatformOptionsFromEnv()

  return {
    local: () =>
      createLocalPublicationPlatform({
        ...localOptions,
        adminAuthStore: createExpressLocalPublicationAdminAuthStore({
          adminEmail: localOptions.adminEmail,
          adminPassword: localOptions.adminPassword,
        }),
      }),
    neon: () =>
      createNeonPublicationPlatform({
        ...neonOptions,
        adminAuthStore: createExpressLocalPublicationAdminAuthStore({
          adminEmail: neonOptions.adminEmail,
          adminPassword: neonOptions.adminPassword,
        }),
      }),
    supabase: () =>
      createSupabasePublicationPlatform({
        ...supabaseOptions,
        adminAuthStore: createExpressSupabasePublicationAdminAuthStore(),
      }),
  }
}

let _platformInstance: ReturnType<ReturnType<typeof createPublicationPlatformRegistry>[string]> | null = null

export function getPublicationPlatform(registry = createPublicationPlatformRegistry(process.env)) {
  const adapterName = resolvePublicationPlatformAdapterName(process.env, registry)
  return registry[adapterName]()
}

export {
  getAvailablePublicationPlatformAdapters,
  getLocalPublicationPlatformOptionsFromEnv,
  getNeonPublicationPlatformOptionsFromEnv,
  getSupabasePublicationPlatformOptionsFromEnv,
  hasNeonPublicationPlatformConfig,
  hasSupabasePublicationPlatformConfig,
  resolvePublicationPlatformAdapterName,
}
