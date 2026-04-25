import {
  createLocalPublicationPlatform,
  createNeonPublicationPlatform,
  createSupabasePublicationPlatform,
  resolvePublicationPlatformAdapterName,
  type AdminAuthStore,
  type PublicationPlatformFactoryRegistry,
} from '@publication-mcp-studio/platform'

function createHostAdminAuthStore(): AdminAuthStore {
  return {
    kind: 'local',
    async getCurrentUser() {
      return null
    },
    async signOut() {},
    async signInWithPassword() {
      throw new Error('Replace createHostAdminAuthStore with your host auth/session implementation.')
    },
  }
}

export function createHostPublicationPlatformRegistry(
  env: Record<string, string | undefined> = process.env
): PublicationPlatformFactoryRegistry {
  const adminAuthStore = createHostAdminAuthStore()
  const adapterName = resolvePublicationPlatformAdapterName(env)
  void adapterName

  return {
    local: () =>
      createLocalPublicationPlatform({
        rootDir: env.PUBLICATION_LOCAL_ROOT_DIR,
        seedDemoContent: env.PUBLICATION_LOCAL_SEED_DEMO_CONTENT !== 'false',
        adminAuthStore,
      }),
    neon: () =>
      createNeonPublicationPlatform({
        rootDir: env.PUBLICATION_LOCAL_ROOT_DIR,
        databaseUrl: env.NEON_DATABASE_URL || env.DATABASE_URL,
        adminAuthStore,
      }),
    supabase: () =>
      createSupabasePublicationPlatform({
        adminAuthStore,
      }),
  }
}
