type PublicationEnv = Record<string, string | undefined>

export type PublicationMediaStorageDriver = 'local' | 's3'

export type PublicationMediaStorageOptions = {
  driver?: PublicationMediaStorageDriver
  bucket?: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  publicBaseUrl?: string
  prefix?: string
  forcePathStyle?: boolean
}

export function getPublicationMediaStorageOptionsFromEnv(
  env: PublicationEnv = process.env
): PublicationMediaStorageOptions {
  return {
    driver:
      env.PUBLICATION_MEDIA_DRIVER?.trim().toLowerCase() === 's3'
        ? 's3'
        : env.PUBLICATION_MEDIA_DRIVER?.trim().toLowerCase() === 'local'
          ? 'local'
          : undefined,
    bucket: env.PUBLICATION_MEDIA_S3_BUCKET?.trim() || undefined,
    region:
      env.PUBLICATION_MEDIA_S3_REGION?.trim() ||
      env.AWS_REGION?.trim() ||
      env.AWS_DEFAULT_REGION?.trim() ||
      undefined,
    endpoint: env.PUBLICATION_MEDIA_S3_ENDPOINT?.trim() || undefined,
    accessKeyId:
      env.PUBLICATION_MEDIA_S3_ACCESS_KEY_ID?.trim() ||
      env.AWS_ACCESS_KEY_ID?.trim() ||
      undefined,
    secretAccessKey:
      env.PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY?.trim() ||
      env.AWS_SECRET_ACCESS_KEY?.trim() ||
      undefined,
    sessionToken:
      env.PUBLICATION_MEDIA_S3_SESSION_TOKEN?.trim() ||
      env.AWS_SESSION_TOKEN?.trim() ||
      undefined,
    publicBaseUrl: env.PUBLICATION_MEDIA_PUBLIC_BASE_URL?.trim() || undefined,
    prefix: env.PUBLICATION_MEDIA_PREFIX?.trim().replace(/^\/+|\/+$/g, '') || undefined,
    forcePathStyle: env.PUBLICATION_MEDIA_S3_FORCE_PATH_STYLE?.trim()
      ? env.PUBLICATION_MEDIA_S3_FORCE_PATH_STYLE.trim().toLowerCase() === 'true'
      : undefined,
  }
}

export function hasPublicationS3MediaStorageConfig(
  env: PublicationEnv = process.env
) {
  const options = getPublicationMediaStorageOptionsFromEnv(env)

  return Boolean(
    options.bucket &&
      options.region &&
      options.accessKeyId &&
      options.secretAccessKey &&
      (options.publicBaseUrl || !options.endpoint)
  )
}

export function resolvePublicationMediaStorageDriver(
  env: PublicationEnv = process.env
): PublicationMediaStorageDriver {
  const options = getPublicationMediaStorageOptionsFromEnv(env)

  if (options.driver) {
    return options.driver
  }

  return hasPublicationS3MediaStorageConfig(env) ? 's3' : 'local'
}

export function getPublicationMediaBucketName(
  env: PublicationEnv = process.env
) {
  const options = getPublicationMediaStorageOptionsFromEnv(env)

  if (resolvePublicationMediaStorageDriver(env) === 's3') {
    return options.bucket || 'publication-media'
  }

  return 'local-publication-assets'
}
