-- =============================================================================
-- AI Product Costing Accelerator — Extended Period Data (RETIRED)
-- =============================================================================
-- DEPRECATED / NO-OP. The full monthly calendar (FY2024 + FY2025 + FY2026 H1)
-- and the FY2026 API-shock -> yield-crisis -> recovery narrative are now produced
-- directly by app/generate_data.py into sql/02_synthetic_data.sql.
--
-- This file is intentionally left as a no-op so existing run scripts don't fail.
-- =============================================================================

SELECT 'sql/07_period_data.sql is retired — period data now generated in sql/02_synthetic_data.sql' AS note;
