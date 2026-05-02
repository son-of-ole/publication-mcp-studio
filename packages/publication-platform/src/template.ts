import { PublicationApiError } from './errors'
import type { PublicationPlatform, PublicationPlatformFactory } from './types'

function notImplemented(adapterName: string, methodName: string): never {
  throw new PublicationApiError(
    501,
    'platform_adapter_not_implemented',
    `Adapter "${adapterName}" must implement "${methodName}" before it can be used.`
  )
}

export function createTemplatePublicationPlatform(adapterName = 'custom'): PublicationPlatform {
  return {
    kind: 'local',
    async ensureSchema() {
      return notImplemented(adapterName, 'ensureSchema')
    },
    publicationStore: {
      async listArticles() {
        return notImplemented(adapterName, 'publicationStore.listArticles')
      },
      async countArticles() {
        return notImplemented(adapterName, 'publicationStore.countArticles')
      },
      async getArticleByIdentifier() {
        return notImplemented(adapterName, 'publicationStore.getArticleByIdentifier')
      },
      async createArticle() {
        return notImplemented(adapterName, 'publicationStore.createArticle')
      },
      async updateArticle() {
        return notImplemented(adapterName, 'publicationStore.updateArticle')
      },
      async deleteArticle() {
        return notImplemented(adapterName, 'publicationStore.deleteArticle')
      },
    },
    versionStore: {
      async createVersion() {
        return notImplemented(adapterName, 'versionStore.createVersion')
      },
      async listVersions() {
        return notImplemented(adapterName, 'versionStore.listVersions')
      },
      async getVersion() {
        return notImplemented(adapterName, 'versionStore.getVersion')
      },
    },
    tokenStore: {
      async createTokenRecord() {
        return notImplemented(adapterName, 'tokenStore.createTokenRecord')
      },
      async listTokenRecords() {
        return notImplemented(adapterName, 'tokenStore.listTokenRecords')
      },
      async getTokenRecord() {
        return notImplemented(adapterName, 'tokenStore.getTokenRecord')
      },
      async revokeTokenRecord() {
        return notImplemented(adapterName, 'tokenStore.revokeTokenRecord')
      },
      async touchTokenRecord() {
        return notImplemented(adapterName, 'tokenStore.touchTokenRecord')
      },
    },
    auditStore: {
      async recordEvent() {
        return notImplemented(adapterName, 'auditStore.recordEvent')
      },
      async listEvents() {
        return notImplemented(adapterName, 'auditStore.listEvents')
      },
    },
    mediaStore: {
      async uploadMedia() {
        return notImplemented(adapterName, 'mediaStore.uploadMedia')
      },
      async listMedia() {
        return notImplemented(adapterName, 'mediaStore.listMedia')
      },
      async deleteMedia() {
        return notImplemented(adapterName, 'mediaStore.deleteMedia')
      },
    },
    adminAuthStore: {
      kind: 'local',
      async getCurrentUser() {
        return notImplemented(adapterName, 'adminAuthStore.getCurrentUser')
      },
      async signOut() {
        return notImplemented(adapterName, 'adminAuthStore.signOut')
      },
      async signInWithPassword() {
        return notImplemented(adapterName, 'adminAuthStore.signInWithPassword')
      },
    },
  }
}

export function createTemplatePublicationPlatformFactory(adapterName: string): PublicationPlatformFactory {
  return () => createTemplatePublicationPlatform(adapterName)
}
