import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AdminAuthStore,
  AuditStore,
  LocalPublicationPlatformOptions,
  MediaStore,
  PublicationArticleListOptions,
  PublicationArticleRecord,
  PublicationArticleVersionRecord,
  PublicationAuditEntry,
  PublicationMediaAsset,
  PublicationMediaUploadPayload,
  PublicationPlatform,
  PublicationStore,
  PublicationTokenInventoryRecord,
  PublicationVersionStore,
  TokenStore,
} from './types'

const localStateMutationQueues = new Map<string, Promise<void>>()

type LocalState = {
  articles: PublicationArticleRecord[]
  versions: PublicationArticleVersionRecord[]
  tokens: PublicationTokenInventoryRecord[]
  audit: PublicationAuditEntry[]
  media: PublicationMediaAsset[]
}

const LOCAL_DEMO_ARTICLE_MARKDOWN = `---
title: "Portable Publication System Demo"
publicationLabel: "Demo Article"
subtitle: "A seeded publication for local development and adapter testing"
authors:
  - "Publication MCP Studio"
tags:
  - "demo"
  - "local-mode"
published: "2026-04-20"
---

## Why This Exists

This local article makes the publication library usable without provisioning Supabase first.

## What To Try

- Open the admin workspace and edit this article.
- Create a second article to verify version history and the MCP routes.
- Replace the local adapter later with another persistence layer through the platform contract.
`

function createInitialState(seedDemoContent: boolean): LocalState {
  if (!seedDemoContent) {
    return {
      articles: [],
      versions: [],
      tokens: [],
      audit: [],
      media: [],
    }
  }

  const now = new Date().toISOString()
  const articleId = randomUUID()

  return {
    articles: [
      {
        id: articleId,
        title: 'Portable Publication System Demo',
        slug: 'portable-publication-system-demo',
        contentMarkdown: LOCAL_DEMO_ARTICLE_MARKDOWN,
        metadata: {},
        category: 'demo',
        tags: ['demo', 'local-mode'],
        status: 'published',
        createdAt: now,
        updatedAt: now,
      },
    ],
    versions: [
      {
        id: randomUUID(),
        articleId,
        versionNumber: 1,
        sourceAction: 'seed',
        title: 'Portable Publication System Demo',
        slug: 'portable-publication-system-demo',
        contentMarkdown: LOCAL_DEMO_ARTICLE_MARKDOWN,
        status: 'published',
        actorLabel: 'Local Platform Seed',
        actorType: 'static',
        metadata: { source: 'local-seed' },
        createdAt: now,
      },
    ],
    tokens: [],
    audit: [],
    media: [],
  }
}

function normalizeIdentifier(identifier: string) {
  return identifier.trim()
}

function isUuid(identifier: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)
}

function compareByCreatedAtDesc(left: { createdAt: string }, right: { createdAt: string }) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
}

function filterArticles(
  articles: PublicationArticleRecord[],
  options: PublicationArticleListOptions = {}
) {
  const search = options.search?.trim().toLowerCase()
  const category = options.category?.trim().toLowerCase()
  const tags = [
    ...(options.tag ? [options.tag] : []),
    ...(options.tags ?? []),
  ].map((tag) => tag.trim().toLowerCase()).filter(Boolean)
  const cursorTime = options.cursor ? new Date(options.cursor).getTime() : null

  return articles.filter((article) => {
    if (options.status && options.status !== 'all' && article.status !== options.status) {
      return false
    }

    if (category && (article.category ?? '').toLowerCase() !== category) {
      return false
    }

    if (tags.length > 0) {
      const articleTags = new Set(article.tags.map((tag) => tag.toLowerCase()))
      if (!tags.every((tag) => articleTags.has(tag))) {
        return false
      }
    }

    if (cursorTime && new Date(article.createdAt).getTime() >= cursorTime) {
      return false
    }

    if (!search) {
      return true
    }

    return (
      article.title.toLowerCase().includes(search) ||
      article.slug.toLowerCase().includes(search) ||
      (article.category ?? '').toLowerCase().includes(search) ||
      article.tags.some((tag) => tag.toLowerCase().includes(search))
    )
  })
}

function compareByOptionalDateDesc(
  left: { updatedAt?: string; createdAt?: string },
  right: { updatedAt?: string; createdAt?: string }
) {
  const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
  const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
  return rightTime - leftTime
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  if (!limit || Number.isNaN(limit)) {
    return fallback
  }

  return Math.min(max, Math.max(1, Math.floor(limit)))
}

function clampOffset(offset: number | undefined) {
  if (!offset || Number.isNaN(offset)) {
    return 0
  }

  return Math.max(0, Math.floor(offset))
}

export function createLocalPublicationPlatform(options: LocalPublicationPlatformOptions = {}): PublicationPlatform {
  const rootDir = options.rootDir ?? process.cwd()
  const seedDemoContent = options.seedDemoContent ?? true
  const configuredAdminAuthStore = options.adminAuthStore
  const localStateDir = path.join(rootDir, '.publication-mcp-studio')
  const localStateFile = path.join(localStateDir, 'state.json')
  const localPublicRoot = path.join(rootDir, 'public', '__publication-local')
  const localMediaRoot = path.join(localPublicRoot, 'media')
  const localMediaPublicPrefix = '/__publication-local/media'
  const localMediaBucket = 'local-publication-assets'

  async function writeLocalState(state: LocalState) {
    const tempFile = `${localStateFile}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tempFile, JSON.stringify(state, null, 2))
    await rename(tempFile, localStateFile)
  }

  async function ensureLocalState() {
    await mkdir(localStateDir, { recursive: true })
    await mkdir(localMediaRoot, { recursive: true })

    try {
      const raw = await readFile(localStateFile, 'utf8')
      try {
        return JSON.parse(raw) as LocalState
      } catch (error) {
        throw new Error(
          `Local publication state at "${localStateFile}" contains invalid JSON. Refusing to reseed and overwrite existing data.`,
          { cause: error }
        )
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError?.code !== 'ENOENT') {
        throw error
      }

      const initialState = createInitialState(seedDemoContent)
      await writeLocalState(initialState)
      return initialState
    }
  }

  async function updateLocalState<T>(updater: (state: LocalState) => Promise<T> | T) {
    const queuedMutation = (localStateMutationQueues.get(localStateFile) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const state = await ensureLocalState()
        const result = await updater(state)
        await writeLocalState(state)
        return result
      })

    localStateMutationQueues.set(
      localStateFile,
      queuedMutation.then(() => undefined, () => undefined)
    )

    return queuedMutation
  }

  const publicationStore: PublicationStore = {
    async listArticles(options: PublicationArticleListOptions = {}) {
      const state = await ensureLocalState()
      const limit = clampLimit(options.limit, 50, 100)
      const offset = clampOffset(options.offset)

      return filterArticles(state.articles, options)
        .sort(compareByCreatedAtDesc)
        .slice(offset, offset + limit)
    },

    async countArticles(options = {}) {
      const state = await ensureLocalState()
      return filterArticles(state.articles, options).length
    },

    async getArticleByIdentifier(identifier: string) {
      const state = await ensureLocalState()
      const cleanIdentifier = normalizeIdentifier(identifier)
      if (!cleanIdentifier) {
        return null
      }

      return (
        state.articles.find((article) =>
          isUuid(cleanIdentifier) ? article.id === cleanIdentifier : article.slug === cleanIdentifier
        ) ?? null
      )
    },

    async createArticle(input: PublicationArticleRecord) {
      return updateLocalState((state) => {
        state.articles.unshift(input)
        return input
      })
    },

    async updateArticle(id: string, updates: Partial<PublicationArticleRecord>) {
      return updateLocalState((state) => {
        const article = state.articles.find((entry) => entry.id === id)
        if (!article) {
          throw new Error(`Article ${id} was not found in the local store.`)
        }

        Object.assign(article, updates)
        return article
      })
    },

    async deleteArticle(id: string) {
      await updateLocalState((state) => {
        const index = state.articles.findIndex((entry) => entry.id === id)
        if (index >= 0) {
          state.articles.splice(index, 1)
        }
      })
    },
  }

  const versionStore: PublicationVersionStore = {
    async createVersion(input) {
      return updateLocalState((state) => {
        const record: PublicationArticleVersionRecord = {
          ...input,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        }
        state.versions.unshift(record)
        return record
      })
    },

    async listVersions(articleId: string) {
      const state = await ensureLocalState()
      return state.versions
        .filter((entry) => entry.articleId === articleId)
        .sort((left, right) => right.versionNumber - left.versionNumber)
    },

    async getVersion(articleId: string, versionId: string) {
      const state = await ensureLocalState()
      return state.versions.find((entry) => entry.articleId === articleId && entry.id === versionId) ?? null
    },
  }

  const tokenStore: TokenStore = {
    async createTokenRecord(input) {
      return updateLocalState((state) => {
        const now = new Date().toISOString()
        const record: PublicationTokenInventoryRecord = {
          id: randomUUID(),
          label: input.label,
          tokenType: 'signed',
          scopes: input.scopes,
          profileId: input.profileId ?? null,
          profileLabel: input.profileLabel ?? null,
          profileEnabledSkillIds: input.profileEnabledSkillIds ?? [],
          tokenEnabledSkillIds: input.tokenEnabledSkillIds ?? null,
          allowProfileSkillOverrides: input.allowProfileSkillOverrides ?? false,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          revokedAt: null,
          lastUsedAt: null,
          lastUsedRoute: null,
          lastUsedMethod: null,
          createdAt: now,
          updatedAt: now,
        }
        state.tokens.unshift(record)
        return record
      })
    },

    async listTokenRecords(limit = 50) {
      const state = await ensureLocalState()
      return state.tokens.slice(0, clampLimit(limit, 50, 100))
    },

    async getTokenRecord(tokenId: string) {
      const state = await ensureLocalState()
      return state.tokens.find((entry) => entry.id === tokenId) ?? null
    },

    async revokeTokenRecord(tokenId: string) {
      return updateLocalState((state) => {
        const record = state.tokens.find((entry) => entry.id === tokenId)
        if (!record) {
          throw new Error(`Token ${tokenId} was not found in the local store.`)
        }

        const now = new Date().toISOString()
        record.revokedAt = now
        record.updatedAt = now
        return record
      })
    },

    async touchTokenRecord(tokenId: string, route: string, method: string) {
      await updateLocalState((state) => {
        const record = state.tokens.find((entry) => entry.id === tokenId)
        if (!record) {
          return
        }

        const now = new Date().toISOString()
        record.lastUsedAt = now
        record.lastUsedRoute = route
        record.lastUsedMethod = method
        record.updatedAt = now
      })
    },
  }

  const auditStore: AuditStore = {
    async recordEvent(input) {
      await updateLocalState((state) => {
        state.audit.unshift({
          ...input,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        })
      })
    },

    async listEvents(limit = 30) {
      const state = await ensureLocalState()
      return state.audit.slice(0, clampLimit(limit, 30, 100))
    },
  }

  const mediaStore: MediaStore = {
    async uploadMedia(input: PublicationMediaUploadPayload) {
      const timePrefix = Date.now()
      const fileName = `${timePrefix}-${input.fileName}`
      const diskDirectory = path.join(localMediaRoot, input.articleSlug)
      const diskPath = path.join(diskDirectory, fileName)
      const publicPath = `${localMediaPublicPrefix}/${input.articleSlug}/${fileName}`
      const now = new Date().toISOString()

      await mkdir(diskDirectory, { recursive: true })
      await writeFile(diskPath, input.data)
      const fileStats = await stat(diskPath)

      return updateLocalState((state) => {
        const asset: PublicationMediaAsset = {
          bucket: localMediaBucket,
          path: `publications/${input.articleSlug}/${fileName}`,
          publicUrl: publicPath,
          fileName,
          contentType: input.contentType,
          sizeBytes: fileStats.size,
          kind: input.kind,
          articleSlug: input.articleSlug,
          embedMarkdown: input.embedMarkdown.replaceAll(`/${input.articleSlug}/${input.fileName}`, publicPath),
          createdAt: now,
          updatedAt: now,
        }
        state.media.unshift(asset)
        return asset
      })
    },

    async listMedia(articleSlug: string, limit?: number) {
      const state = await ensureLocalState()
      return state.media
        .filter((asset) => asset.articleSlug === articleSlug)
        .sort(compareByOptionalDateDesc)
        .slice(0, clampLimit(limit, 50, 200))
    },

    async deleteMedia(pathToDelete: string) {
      await updateLocalState(async (state) => {
        const index = state.media.findIndex((asset) => asset.path === pathToDelete)
        if (index === -1) {
          return
        }

        const asset = state.media[index]
        const diskPath = path.join(localPublicRoot, asset.publicUrl.replace('/__publication-local/', ''))
        await unlink(diskPath).catch(() => undefined)
        state.media.splice(index, 1)
      })
    },
  }

  const adminAuthStore: AdminAuthStore = {
    ...(configuredAdminAuthStore ?? {}),
    kind: 'local',

    async getCurrentUser() {
      return configuredAdminAuthStore?.getCurrentUser?.() ?? null
    },

    async signOut() {
      await configuredAdminAuthStore?.signOut?.()
    },

    async signInWithPassword(input) {
      if (configuredAdminAuthStore?.signInWithPassword) {
        return configuredAdminAuthStore.signInWithPassword(input)
      }

      throw new Error(
        'This local publication platform does not provide a built-in admin session handler. Supply options.adminAuthStore from your host stack.'
      )
    },
  }

  return {
    kind: 'local',
    async ensureSchema() {},
    publicationStore,
    versionStore,
    tokenStore,
    auditStore,
    mediaStore,
    adminAuthStore,
  }
}
