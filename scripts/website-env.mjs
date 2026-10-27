/** Explicit allowlist: website children never inherit engine/DB/signing credentials. */
export function websiteEnvironment(source, { port, publishedOrigin, siteUrl }) {
  const env = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'PNPM_HOME', 'SystemRoot']) if (source[key] !== undefined) env[key] = source[key]
  return { ...env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), BASE_PATH: '/', PUBLICATION_PUBLISHED_ORIGIN: publishedOrigin, PUBLICATION_SITE_URL: siteUrl }
}
