-- =============================================================================
-- 12_streamlit.sql — Create / redeploy the Streamlit container-runtime app.
--
-- Prerequisites:
--   • Files must already be on stage at @{{ database }}.ANALYTICS.APC_DEPLOY_STAGE/streamlit/
--     (streamlit_app.py, pyproject.toml, .streamlit/config.toml)
--   • PYPI_ACCESS_INTEGRATION must exist (created in 01_setup or manually)
--   • SYSTEM_COMPUTE_POOL_CPU must exist and be IDLE/ACTIVE
--
-- Usage:
--   Local:     snow sql -c $CONN -f sql/12_streamlit.sql
--   Workspace: snow sql -f sql/12_streamlit.sql
--              (after uploading files via deploy_streamlit.py or base64 approach)
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.ANALYTICS;

-- Ensure EAI exists (idempotent)
CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION PYPI_ACCESS_INTEGRATION
  ALLOWED_NETWORK_RULES = (snowflake.external_access.pypi_rule)
  ENABLED = true;

-- Drop + recreate the Streamlit object
DROP STREAMLIT IF EXISTS {{ database }}.ANALYTICS.APC_DEPLOY_STREAMLIT;

CREATE STREAMLIT {{ database }}.ANALYTICS.APC_DEPLOY_STREAMLIT
  FROM '@{{ database }}.ANALYTICS.APC_DEPLOY_STAGE/streamlit'
  MAIN_FILE = 'streamlit_app.py'
  QUERY_WAREHOUSE = {{ warehouse }}
  COMPUTE_POOL = SYSTEM_COMPUTE_POOL_CPU
  RUNTIME_NAME = 'SYSTEM$ST_CONTAINER_RUNTIME_PY3_11'
  EXTERNAL_ACCESS_INTEGRATIONS = (PYPI_ACCESS_INTEGRATION)
  COMMENT = 'AI Product Costing Accelerator — Streamlit dashboard';

-- CRITICAL: Set the live version.
-- CREATE STREAMLIT ... FROM '@stage' creates a default version but does NOT mark it live.
-- Without this the app fails with "Not implemented" bootstrap error.
ALTER STREAMLIT {{ database }}.ANALYTICS.APC_DEPLOY_STREAMLIT ADD LIVE VERSION FROM LAST;
