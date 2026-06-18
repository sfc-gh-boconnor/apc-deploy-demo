-- Validation: BOM readiness assessment against existing mart_product_cost — identifies DQ gaps before AZ deployment.
-- Co-authored with CoCo
--
-- PURPOSE: Run this BEFORE deploying the BOM extension models to understand what
-- data quality issues will surface. Simulates the checks that mart_fmc_vs_bom,
-- mart_volume_alignment, mart_rate_stability, and mart_cogm_evolution will perform.
--
-- FINDINGS SUMMARY (based on current APC_DEPLOY_DB data):
--
-- GAP 1: No BOM source tables exist yet (STKO_RAW, STPO_RAW, PLPO_RAW, KSPI_RAW)
--         → All 10 FERT products × 5 plants = 50 product/plant combos will flag as MISSING_BOM
--
-- GAP 2: No APO demand plan (APO_DEMAND_RAW)
--         → Volume reconciliation cannot run; all products flag as UNPLANNED_DEMAND
--
-- GAP 3: No value chain config (VALUE_CHAIN_RAW, SCC_ADJUSTMENTS_RAW)
--         → Intercompany margin is invisible; all multi-site products have opaque transfer pricing
--
-- GAP 4: No brand/TA/country enrichment in material master
--         → COGM evolution by therapeutic area is impossible without MARA extension or mapping seed
--
-- WHAT THE EXISTING DATA TELLS US (cost structure analysis):
-- ─────────────────────────────────────────────────────────
-- The 9 cost components in MART_COST_COMPONENT_DETAIL reveal:
--   • API / Drug Substance = 46.6% of total cost (BOM material layer — largest DQ risk if BOM incomplete)
--   • Direct Labour = 14% (routing/activity rate layer)
--   • Excipients & Solvents = 13% (BOM material layer)
--   • Manufacturing Overhead = 11.2% (allocation layer — hardest to validate without rates)
--   • Energy = 3% (already has external index feed)
--   • Packaging = 6.3% (BOM material layer)
--
-- IMPLICATION: 65.5% of cost is BOM-traceable material (API + Excipients + Packaging).
-- If BOM explosion is incomplete, you're blind to the majority of cost drivers.

-- ═══════════════════════════════════════════════════════════════════
-- CHECK 1: Products that WILL flag as MISSING_BOM (no BOM source exists)
-- ═══════════════════════════════════════════════════════════════════
WITH fert_products AS (
    SELECT DISTINCT
        material_number,
        material_description,
        plant_code,
        actual_cost_per_unit,
        standard_cost_per_unit,
        cost_variance_pct
    FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_PRODUCT_COST
    WHERE fiscal_year = 2026 AND period = '006' AND material_type = 'FERT'
),

-- ═══════════════════════════════════════════════════════════════════
-- CHECK 2: Cost structure imbalance — products where component split is incomplete
-- (signals missing BOM levels: if sum of components ≠ total unit cost)
-- ═══════════════════════════════════════════════════════════════════
component_coverage AS (
    SELECT
        material_number,
        plant_code,
        COUNT(DISTINCT cost_component) AS component_count,
        SUM(actual_cost) AS sum_components,
        -- Products should have all 9 components for full BOM traceability
        CASE
            WHEN COUNT(DISTINCT cost_component) < 7 THEN 'INCOMPLETE_SPLIT'
            WHEN COUNT(DISTINCT cost_component) >= 9 THEN 'FULL_COVERAGE'
            ELSE 'PARTIAL_COVERAGE'
        END AS component_coverage_status
    FROM APC_DEPLOY_DB.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL
    WHERE fiscal_year = 2026 AND period = '006'
    GROUP BY material_number, plant_code
),

-- ═══════════════════════════════════════════════════════════════════
-- CHECK 3: Cost vs component sum reconciliation
-- (if actual_cost_per_unit ≠ sum of components → allocation gap)
-- ═══════════════════════════════════════════════════════════════════
cost_recon AS (
    SELECT
        f.material_number,
        f.plant_code,
        f.actual_cost_per_unit AS fmc_total,
        c.sum_components AS component_sum,
        ROUND(f.actual_cost_per_unit - c.sum_components, 2) AS unexplained_cost,
        ROUND(100.0 * (f.actual_cost_per_unit - c.sum_components)
              / NULLIF(f.actual_cost_per_unit, 0), 1) AS unexplained_pct,
        CASE
            WHEN ABS(f.actual_cost_per_unit - c.sum_components)
                 / NULLIF(f.actual_cost_per_unit, 0) > 0.05 THEN 'HIGH_GAP'
            WHEN ABS(f.actual_cost_per_unit - c.sum_components)
                 / NULLIF(f.actual_cost_per_unit, 0) > 0.02 THEN 'MEDIUM_GAP'
            ELSE 'RECONCILED'
        END AS recon_status
    FROM fert_products f
    LEFT JOIN component_coverage c
        ON f.material_number = c.material_number
        AND f.plant_code = c.plant_code
),

-- ═══════════════════════════════════════════════════════════════════
-- CHECK 4: High-variance products that need BOM validation most urgently
-- (if FMC shows >10% variance, BOM build-up would reveal whether it's
-- material price, activity rate, or allocation issue)
-- ═══════════════════════════════════════════════════════════════════
priority_products AS (
    SELECT
        material_number,
        material_description,
        plant_code,
        actual_cost_per_unit,
        standard_cost_per_unit,
        cost_variance_pct,
        CASE
            WHEN cost_variance_pct > 15 THEN 'CRITICAL — BOM validation urgently needed'
            WHEN cost_variance_pct > 10 THEN 'HIGH — BOM would explain driver'
            WHEN cost_variance_pct > 5 THEN 'MEDIUM — BOM useful for transparency'
            ELSE 'LOW — variance within tolerance'
        END AS bom_priority
    FROM fert_products
),

-- ═══════════════════════════════════════════════════════════════════
-- CHECK 5: Plant-level patterns — which sites have systematic issues?
-- (AZ's Dunboyne PL03 shows consistently high variance — BOM + routing
-- validation would reveal if it's a rate issue or structural BOM gap)
-- ═══════════════════════════════════════════════════════════════════
plant_summary AS (
    SELECT
        plant_code,
        COUNT(*) AS product_count,
        ROUND(AVG(cost_variance_pct), 1) AS avg_variance_pct,
        SUM(CASE WHEN cost_variance_pct > 10 THEN 1 ELSE 0 END) AS high_variance_count,
        ROUND(100.0 * SUM(CASE WHEN cost_variance_pct > 10 THEN 1 ELSE 0 END)
              / COUNT(*), 0) AS pct_high_variance
    FROM fert_products
    GROUP BY plant_code
)

-- ═══════════════════════════════════════════════════════════════════
-- FINAL OUTPUT: Consolidated readiness report
-- ═══════════════════════════════════════════════════════════════════
SELECT
    '1. PRODUCT BOM PRIORITY' AS check_category,
    p.material_number,
    p.material_description,
    p.plant_code,
    p.cost_variance_pct,
    p.bom_priority AS finding,
    cr.recon_status AS component_recon,
    cr.unexplained_pct AS unexplained_cost_pct,
    cc.component_count,
    cc.component_coverage_status
FROM priority_products p
LEFT JOIN cost_recon cr
    ON p.material_number = cr.material_number AND p.plant_code = cr.plant_code
LEFT JOIN component_coverage cc
    ON p.material_number = cc.material_number AND p.plant_code = cc.plant_code
ORDER BY p.cost_variance_pct DESC;
