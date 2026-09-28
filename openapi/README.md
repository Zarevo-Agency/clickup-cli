# ClickUp OpenAPI specs

Official public API specs, vendored unchanged so `cup api ops` and the coverage docs work offline.

- `clickup-v2.json`: https://developer.clickup.com/openapi/clickup-api-v2-reference.json
- `clickup-v3.json`: https://developer.clickup.com/openapi/ClickUp_PUBLIC_API_V3.yaml (JSON despite the extension)

Fetched 2026-09-28. Refresh by downloading both URLs again, then regenerate the compact index that ships with cup (`src/openapi-index.json`, checked by a unit test):

```bash
node --import tsx scripts/build-openapi-index.ts
```
