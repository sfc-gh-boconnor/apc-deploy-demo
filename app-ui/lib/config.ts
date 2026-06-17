/**
 * Central deployment config — reads from environment variables so the app
 * works against any Snowflake database/warehouse without code changes.
 *
 * Set via SPCS service spec env vars, .env.local for local dev, or
 * SNOWFLAKE_DATABASE / SNOWFLAKE_WAREHOUSE injected by the runtime.
 */
export const DATABASE  = process.env.SNOWFLAKE_DATABASE  || "APC_DEPLOY_DB"
export const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || "APC_DEPLOY_WH"
