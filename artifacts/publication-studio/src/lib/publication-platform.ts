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
import { createNextLocalPublicationAdminAuthStore, createNextSupabasePublicationAdminAuthStore } from './publication-platform-next-auth'

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
        adminAuthStore: createNextLocalPublicationAdminAuthStore({
          adminEmail: localOptions.adminEmail,
          adminPassword: localOptions.adminPassword,
        }),
      }),
    neon: () =>
      createNeonPublicationPlatform({
        ...neonOptions,
        adminAuthStore: createNextLocalPublicationAdminAuthStore({
          adminEmail: neonOptions.adminEmail,
          adminPassword: neonOptions.adminPassword,
        }),
      }),
    supabase: () =>
      createSupabasePublicationPlatform({
        ...supabaseOptions,
        adminAuthStore: createNextSupabasePublicationAdminAuthStore(),
      }),
  }
}

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
