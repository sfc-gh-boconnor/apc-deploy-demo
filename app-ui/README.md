# APC React Dashboard (`app-ui/`)

Next.js dashboard deployed as a Snowflake App (App Runtime on SPCS). Provides 8 tabs: Variance Analysis · Scenario Analysis · Profitability · Sales Forecast · Smart Insights · Ask Cortex AI · Data Engineering · Observability & Trust.

---

## Skills that manage this component

| Skill | What it does to this app |
|-------|--------------------------|
| `/apc-deploy` | Builds and deploys the app to SPCS (step 5 of the deploy workflow) |
| `/apc-cleanup` | Tears down the Snowflake Application (`snow app teardown --force --cascade`) |

For a full deploy or teardown, use those skills rather than running `snow app` commands manually.

---

## Local development

```bash
npm install
npm run dev
```

Reads credentials from the default `snow` CLI connection (`~/.snowflake/config.toml`).  
Override with `SNOWFLAKE_CONNECTION_NAME` or explicit environment variables.

---

## Manual deploy (reference)

Edit `snowflake.yml` to set your database and warehouse, then:

```bash
snow app deploy --build-only   # build the bundle
snow app deploy --deploy-only  # push to Snowflake
```

> `/apc-deploy` handles both steps automatically, including version-gating for CLI compatibility.

---

## Structure

```
app-ui/
├── app.yml                    # Snowflake App Runtime manifest
├── snowflake.yml              # snow CLI config
├── app/
│   ├── layout.tsx / page.tsx  # Root layout and entry
│   └── api/                   # API routes (query, chat, forecast, scenarios…)
├── components/                # Dashboard tab components
└── lib/
    ├── snowflake.ts           # querySnowflake() helper
    └── config.ts
```

---

## Key concepts

- `querySnowflake(sql)` returns `Record<string, any>[]` — use in API routes only, not client components.
- `export const dynamic = "force-dynamic"` is required on any page or route that queries Snowflake.
- Client components must call API routes; they cannot call `querySnowflake()` directly.
- Caller's rights: `/api/query` reads the `sf-context-current-user-token` header injected by SPCS.
