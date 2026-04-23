# Changelog

## 0.1.0

- introduced a framework-facing publication platform package boundary
- added built-in `local` and `supabase` adapters behind shared contracts
- added adapter registry helpers and explicit env-based selection
- added a template adapter scaffold for future integrations
- added package-level tests for adapter selection and local persistence
- added a Neon/Postgres adapter for shared relational persistence outside Supabase
- added shared S3-compatible media storage support for the Neon adapter
