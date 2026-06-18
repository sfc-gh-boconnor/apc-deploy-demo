-- Synthetic data for BOM, routing, activity rates, APO demand, and value chain tables.
-- Co-authored with CoCo
--
-- PURPOSE: Populates the 7 new SAP_RAW source tables needed by the AZ-extension
-- dbt models (BOM explosion, volume reconciliation, value chain, rate stability).
-- Data is calibrated to reconcile with existing MART_PRODUCT_COST within ~5-10%.
--
-- TABLES CREATED:
--   APC_DEPLOY_DB.SAP_RAW.STKO_RAW         — BOM headers
--   APC_DEPLOY_DB.SAP_RAW.STPO_RAW         — BOM line items
--   APC_DEPLOY_DB.SAP_RAW.PLPO_RAW         — Routing operations
--   APC_DEPLOY_DB.SAP_RAW.KSPI_RAW         — Activity rates
--   APC_DEPLOY_DB.SAP_RAW.APO_DEMAND_RAW   — Demand plan
--   APC_DEPLOY_DB.SAP_RAW.VALUE_CHAIN_RAW  — Value chain config
--   APC_DEPLOY_DB.SAP_RAW.SCC_ADJUSTMENTS_RAW — SCC adjustments

USE DATABASE APC_DEPLOY_DB;
USE SCHEMA SAP_RAW;
USE WAREHOUSE APC_DEPLOY_WH;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. STKO_RAW — BOM Headers (one active production BOM per FERT × plant)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.STKO_RAW (
    MATNR    VARCHAR(20),
    WERKS    VARCHAR(10),
    STLNR    VARCHAR(20),
    STLAN    VARCHAR(5),
    DATEFROM DATE,
    DATETO   DATE,
    STLST    VARCHAR(5),
    BMENG    NUMBER(12,4),
    BMEIN    VARCHAR(5)
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.STKO_RAW
SELECT
    m.MATNR,
    p.PLANT_CODE AS WERKS,
    'BOM-' || m.MATNR || '-' || p.PLANT_CODE AS STLNR,
    '1' AS STLAN,          -- Production BOM
    '2024-01-01'::DATE AS DATEFROM,
    '9999-12-31'::DATE AS DATETO,
    '01' AS STLST,         -- Active
    1000 AS BMENG,         -- Base qty = 1000 units
    'EA' AS BMEIN
FROM (SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT') m
CROSS JOIN (SELECT DISTINCT TRIM(WERKS) AS PLANT_CODE FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW) p;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. STPO_RAW — BOM Line Items (realistic pharma BOM structure)
--    Each FERT has: 1 API (ROH), 2 excipients (ROH), 1 HALB (semi-finished),
--    1 primary packaging (ROH), 1 secondary packaging (ROH)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.STPO_RAW (
    STLNR    VARCHAR(20),
    POSNR    NUMBER(6),
    IDNRK    VARCHAR(20),
    POSTP    VARCHAR(5),
    MENGE    NUMBER(12,4),
    MEINS    VARCHAR(5),
    AUSCH    NUMBER(5,2),
    KZAUS    NUMBER(1),
    POTX1    VARCHAR(100)
);

-- First ensure we have ROH and HALB materials in MARA_RAW
INSERT INTO APC_DEPLOY_DB.SAP_RAW.MARA_RAW (MATNR, MAKTX, MTART, MATKL, MEINS)
SELECT * FROM (
    SELECT 'API-1234' AS MATNR, 'Omeprazole API Bulk' AS MAKTX, 'ROH' AS MTART, 'API' AS MATKL, 'KG' AS MEINS UNION ALL
    SELECT 'API-2891', 'Esomeprazole Mg Trihydrate', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-3312', 'Trastuzumab DS Bulk', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-4567', 'Osimertinib Mesylate', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-5521', 'Olaparib Free Base', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-6103', 'Ticagrelor Crystalline', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-7890', 'Budesonide Micronized', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-8834', 'Dapagliflozin PGS', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-9901', 'Formoterol Fumarate', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'API-1156', 'Anifrolumab DS', 'ROH', 'API', 'KG' UNION ALL
    SELECT 'EXC-0001', 'Microcrystalline Cellulose', 'ROH', 'EXC', 'KG' UNION ALL
    SELECT 'EXC-0002', 'Lactose Monohydrate', 'ROH', 'EXC', 'KG' UNION ALL
    SELECT 'EXC-0003', 'Magnesium Stearate', 'ROH', 'EXC', 'KG' UNION ALL
    SELECT 'EXC-0004', 'Hydroxypropyl Cellulose', 'ROH', 'EXC', 'KG' UNION ALL
    SELECT 'EXC-0005', 'Polysorbate 80', 'ROH', 'EXC', 'L' UNION ALL
    SELECT 'PKG-PRI-01', 'PVC/Alu Blister 10-count', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'PKG-PRI-02', 'Pre-filled Syringe 1mL', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'PKG-PRI-03', 'HDPE Bottle 60mL', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'PKG-PRI-04', 'MDI Canister Assy', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'PKG-PRI-05', 'Transdermal Patch Pouch', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'PKG-SEC-01', 'Folding Carton + Leaflet', 'ROH', 'PKG', 'EA' UNION ALL
    SELECT 'HALB-1234', 'AZD1234 Granulate Blend', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-2891', 'AZD2891 Capsule Fill', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-3312', 'AZD3312 Drug Product Bulk', 'HALB', 'SEMI', 'L' UNION ALL
    SELECT 'HALB-4567', 'AZD4567 Sterile Solution', 'HALB', 'SEMI', 'L' UNION ALL
    SELECT 'HALB-5521', 'AZD5521 Patch Matrix', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-6103', 'AZD6103 Tablet Core', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-7890', 'AZD7890 Oral Suspension', 'HALB', 'SEMI', 'L' UNION ALL
    SELECT 'HALB-8834', 'AZD8834 Film-Coat Tablet', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-9901', 'AZD9901 Inhaler Formulation', 'HALB', 'SEMI', 'KG' UNION ALL
    SELECT 'HALB-1156', 'AZD1156 IV Concentrate', 'HALB', 'SEMI', 'L'
) src
WHERE NOT EXISTS (SELECT 1 FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MATNR) = src.MATNR);

-- Generate BOM items for each product (quantities calibrated per 1000 finished units)
-- Pattern: API (~35-46% cost), HALB (assembly), 2 excipients (~13%), primary pkg (~4%), secondary pkg (~2.5%)
INSERT INTO APC_DEPLOY_DB.SAP_RAW.STPO_RAW
WITH products AS (
    SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT'
),
plants AS (
    SELECT DISTINCT TRIM(WERKS) AS WERKS FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW
),
bom_lines AS (
    -- Line 1: API (main active ingredient) — qty in KG per 1000 finished units
    SELECT 
        'BOM-' || p.MATNR || '-' || pl.WERKS AS STLNR,
        10 AS POSNR,
        'API-' || SUBSTRING(p.MATNR, 4, 4) AS IDNRK,  -- API-1234 from RX-1234-FIN
        'L' AS POSTP, 
        CASE 
            WHEN p.MATNR LIKE '%3312%' THEN 500    -- biologics: high-potency, less mass needed
            WHEN p.MATNR LIKE '%1156%' THEN 500    -- IV infusion: high-potency
            WHEN p.MATNR LIKE '%2891%' THEN 900    -- lower-cost product
            WHEN p.MATNR LIKE '%8834%' THEN 900    -- lower-cost product
            ELSE 1200                               -- standard oral solid
        END AS MENGE,
        'KG' AS MEINS,
        CASE WHEN pl.WERKS = 'PL03' THEN 4.5 ELSE 2.5 END AS AUSCH,  -- PL03 higher scrap (drives variance)
        0 AS KZAUS,
        'Active Pharmaceutical Ingredient' AS POTX1
    FROM products p CROSS JOIN plants pl
    
    UNION ALL
    -- Line 2: HALB (semi-finished intermediate) — qty in KG per 1000 finished units
    SELECT
        'BOM-' || p.MATNR || '-' || pl.WERKS,
        20,
        'HALB-' || SUBSTRING(p.MATNR, 4, 4),
        'L',
        CASE
            WHEN p.MATNR LIKE '%3312%' THEN 350    -- biologics: smaller intermediate batch
            WHEN p.MATNR LIKE '%1156%' THEN 350
            WHEN p.MATNR LIKE '%2891%' THEN 400    -- lower-cost
            WHEN p.MATNR LIKE '%8834%' THEN 400
            ELSE 600
        END,
        'KG',
        CASE WHEN pl.WERKS = 'PL03' THEN 3.0 ELSE 1.5 END,
        0,
        'Semi-finished intermediate'
    FROM products p CROSS JOIN plants pl
    
    UNION ALL
    -- Line 3: Excipient 1 — 900 KG per 1000 units
    SELECT
        'BOM-' || p.MATNR || '-' || pl.WERKS,
        30,
        CASE WHEN p.MATNR LIKE '%3312%' OR p.MATNR LIKE '%1156%' THEN 'EXC-0005'  -- biologics use Polysorbate
             ELSE 'EXC-0001' END,
        'L', 900, 'KG', 1.0, 0, 'Excipient primary'
    FROM products p CROSS JOIN plants pl
    
    UNION ALL
    -- Line 4: Excipient 2 — 500 KG per 1000 units
    SELECT
        'BOM-' || p.MATNR || '-' || pl.WERKS,
        40,
        CASE WHEN p.MATNR LIKE '%3312%' OR p.MATNR LIKE '%1156%' THEN 'EXC-0004'
             ELSE 'EXC-0002' END,
        'L', 500, 'KG', 0.5, 0, 'Excipient filler/binder'
    FROM products p CROSS JOIN plants pl
    
    UNION ALL
    -- Line 5: Primary packaging — 1050 EA per 1000 units (5% overpack for rejects)
    SELECT
        'BOM-' || p.MATNR || '-' || pl.WERKS,
        50,
        CASE 
            WHEN p.MATNR LIKE '%4567%' OR p.MATNR LIKE '%1156%' THEN 'PKG-PRI-02'  -- syringes
            WHEN p.MATNR LIKE '%7890%' THEN 'PKG-PRI-03'  -- bottles
            WHEN p.MATNR LIKE '%9901%' THEN 'PKG-PRI-04'  -- inhaler
            WHEN p.MATNR LIKE '%5521%' THEN 'PKG-PRI-05'  -- patches
            ELSE 'PKG-PRI-01'  -- blisters
        END,
        'L', 1050, 'EA', 0.5, 0, 'Primary packaging'
    FROM products p CROSS JOIN plants pl
    
    UNION ALL
    -- Line 6: Secondary packaging — 1020 EA per 1000 units
    SELECT
        'BOM-' || p.MATNR || '-' || pl.WERKS,
        60,
        'PKG-SEC-01',
        'L', 1020, 'EA', 0.3, 0, 'Secondary packaging (carton + leaflet)'
    FROM products p CROSS JOIN plants pl
)
SELECT * FROM bom_lines;

-- Also create BOM headers for the HALB intermediates (one level deeper)
INSERT INTO APC_DEPLOY_DB.SAP_RAW.STKO_RAW
SELECT
    'HALB-' || SUBSTRING(m.MATNR, 4, 4) AS MATNR,
    p.PLANT_CODE AS WERKS,
    'BOM-HALB-' || SUBSTRING(m.MATNR, 4, 4) || '-' || p.PLANT_CODE AS STLNR,
    '1', '2024-01-01'::DATE, '9999-12-31'::DATE, '01', 500, 'KG'
FROM (SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT') m
CROSS JOIN (SELECT DISTINCT TRIM(WERKS) AS PLANT_CODE FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW) p;

-- HALB BOM items (the HALB is made from API + excipient + water/solvent)
-- Quantities per 500 KG batch (HALB BMENG = 500)
INSERT INTO APC_DEPLOY_DB.SAP_RAW.STPO_RAW
SELECT
    'BOM-HALB-' || SUBSTRING(m.MATNR, 4, 4) || '-' || p.PLANT_CODE AS STLNR,
    10 AS POSNR,
    'API-' || SUBSTRING(m.MATNR, 4, 4) AS IDNRK,  -- API-1234 from RX-1234-FIN
    'L', 350, 'KG',
    CASE WHEN p.PLANT_CODE = 'PL03' THEN 5.0 ELSE 2.0 END,
    0, 'API for intermediate'
FROM (SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT') m
CROSS JOIN (SELECT DISTINCT TRIM(WERKS) AS PLANT_CODE FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW) p;

INSERT INTO APC_DEPLOY_DB.SAP_RAW.STPO_RAW
SELECT
    'BOM-HALB-' || SUBSTRING(m.MATNR, 4, 4) || '-' || p.PLANT_CODE,
    20, 'EXC-0003', 'L', 150, 'KG', 0.5, 0, 'Lubricant (Mg Stearate)'
FROM (SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT') m
CROSS JOIN (SELECT DISTINCT TRIM(WERKS) AS PLANT_CODE FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW) p;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PLPO_RAW — Routing Operations
--    Each FERT has 4 operations: Dispensing → Granulation/Mixing → Forming → Packaging
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.PLPO_RAW (
    MATNR    VARCHAR(20),
    WERKS    VARCHAR(10),
    PLNTY    VARCHAR(5),
    PLNNR    VARCHAR(20),
    VORNR    VARCHAR(10),
    ARBPL    VARCHAR(20),
    KOSTL    VARCHAR(20),
    LTXA1    VARCHAR(100),
    LAR01    VARCHAR(10),
    VGW01    NUMBER(10,4),
    VGE01    VARCHAR(5),
    LAR02    VARCHAR(10),
    VGW02    NUMBER(10,4),
    VGE02    VARCHAR(5),
    BMSCH    NUMBER(12,4),
    MEINH    VARCHAR(5),
    LOEKZ    VARCHAR(5)
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.PLPO_RAW
WITH products AS (
    SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT'
),
plants AS (
    SELECT DISTINCT TRIM(WERKS) AS WERKS FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW
),
ops AS (
    -- Operation 10: Dispensing & Weighing
    SELECT p.MATNR, pl.WERKS, 'N' AS PLNTY,
        'RTG-' || p.MATNR || '-' || pl.WERKS AS PLNNR,
        '0010' AS VORNR,
        'WC-DISP-' || pl.WERKS AS ARBPL,
        'CC-MFG-' || pl.WERKS AS KOSTL,
        'Dispensing & Weighing' AS LTXA1,
        'MACHINE' AS LAR01, 0.5 AS VGW01, 'HR' AS VGE01,
        'LABOUR' AS LAR02, 1.0 AS VGW02, 'HR' AS VGE02,
        1000 AS BMSCH, 'EA' AS MEINH, '' AS LOEKZ
    FROM products p CROSS JOIN plants pl
    UNION ALL
    -- Operation 20: Granulation / Mixing / Compounding
    SELECT p.MATNR, pl.WERKS, 'N',
        'RTG-' || p.MATNR || '-' || pl.WERKS,
        '0020',
        'WC-GRAN-' || pl.WERKS,
        'CC-MFG-' || pl.WERKS,
        CASE WHEN p.MATNR LIKE '%3312%' OR p.MATNR LIKE '%1156%' THEN 'Bioprocessing & Purification'
             WHEN p.MATNR LIKE '%7890%' THEN 'Suspension Compounding'
             ELSE 'Granulation & Blending' END,
        'MACHINE',
        CASE WHEN p.MATNR LIKE '%3312%' OR p.MATNR LIKE '%1156%' THEN 3.5  -- biologics longer
             ELSE 1.8 END,
        'HR',
        'LABOUR',
        CASE WHEN p.MATNR LIKE '%3312%' OR p.MATNR LIKE '%1156%' THEN 4.0
             ELSE 2.0 END,
        'HR', 1000, 'EA', ''
    FROM products p CROSS JOIN plants pl
    UNION ALL
    -- Operation 30: Forming (tableting / filling / coating)
    SELECT p.MATNR, pl.WERKS, 'N',
        'RTG-' || p.MATNR || '-' || pl.WERKS,
        '0030',
        'WC-FORM-' || pl.WERKS,
        'CC-MFG-' || pl.WERKS,
        CASE WHEN p.MATNR LIKE '%4567%' OR p.MATNR LIKE '%1156%' THEN 'Aseptic Filling'
             WHEN p.MATNR LIKE '%9901%' THEN 'Inhaler Assembly'
             WHEN p.MATNR LIKE '%5521%' THEN 'Patch Lamination & Die-Cut'
             ELSE 'Tablet Compression & Coating' END,
        'MACHINE',
        CASE WHEN p.MATNR LIKE '%4567%' OR p.MATNR LIKE '%1156%' THEN 2.5
             ELSE 1.5 END,
        'HR',
        'LABOUR',
        CASE WHEN p.MATNR LIKE '%4567%' OR p.MATNR LIKE '%1156%' THEN 3.0
             ELSE 1.5 END,
        'HR', 1000, 'EA', ''
    FROM products p CROSS JOIN plants pl
    UNION ALL
    -- Operation 40: Packaging
    SELECT p.MATNR, pl.WERKS, 'N',
        'RTG-' || p.MATNR || '-' || pl.WERKS,
        '0040',
        'WC-PACK-' || pl.WERKS,
        'CC-PKG-' || pl.WERKS,
        'Primary & Secondary Packaging',
        'MACHINE', 0.8, 'HR',
        'LABOUR', 1.2, 'HR',
        1000, 'EA', ''
    FROM products p CROSS JOIN plants pl
)
SELECT * FROM ops;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. KSPI_RAW — Activity Rates per Cost Centre
--    Plan (TARKZ=1) and Actual (TARKZ=4) rates for FY2025 and FY2026
--    PL03 has unstable rates (15-25% jump) to demonstrate the rate stability alert
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.KSPI_RAW (
    KOSTL    VARCHAR(20),
    LSTAR    VARCHAR(10),
    GJAHR    NUMBER(4),
    WERKS    VARCHAR(10),
    TARKZ    NUMBER(1),
    LST001   NUMBER(10,2),
    LST002   NUMBER(10,2),
    WAERS    VARCHAR(5)
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.KSPI_RAW
WITH plants AS (
    SELECT DISTINCT TRIM(WERKS) AS WERKS FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW
),
base_rates AS (
    SELECT
        p.WERKS,
        -- Machine rates vary by plant (PL01 UK highest, PL05 India lowest)
        CASE p.WERKS
            WHEN 'PL01' THEN 85.00 WHEN 'PL02' THEN 78.00 WHEN 'PL03' THEN 92.00
            WHEN 'PL04' THEN 80.00 WHEN 'PL05' THEN 45.00
        END AS mach_rate,
        CASE p.WERKS
            WHEN 'PL01' THEN 55.00 WHEN 'PL02' THEN 52.00 WHEN 'PL03' THEN 58.00
            WHEN 'PL04' THEN 50.00 WHEN 'PL05' THEN 28.00
        END AS labour_rate
    FROM plants p
),
rate_rows AS (
    -- FY2025 Plan rates (Manufacturing)
    SELECT 'CC-MFG-' || WERKS AS KOSTL, 'MACHINE' AS LSTAR, 2025 AS GJAHR, WERKS, 1 AS TARKZ,
        mach_rate * 0.6 AS LST001, mach_rate * 0.4 AS LST002, 'USD' AS WAERS FROM base_rates
    UNION ALL
    SELECT 'CC-MFG-' || WERKS, 'LABOUR', 2025, WERKS, 1,
        labour_rate * 0.7, labour_rate * 0.3, 'USD' FROM base_rates
    UNION ALL
    -- FY2025 Actual rates
    SELECT 'CC-MFG-' || WERKS, 'MACHINE', 2025, WERKS, 4,
        mach_rate * 0.6 * 1.03, mach_rate * 0.4 * 1.05, 'USD' FROM base_rates  -- slight overrun
    UNION ALL
    SELECT 'CC-MFG-' || WERKS, 'LABOUR', 2025, WERKS, 4,
        labour_rate * 0.7 * 1.02, labour_rate * 0.3 * 1.04, 'USD' FROM base_rates
    UNION ALL
    -- FY2026 Plan rates (3% inflation except PL03 which jumps 20% — unstable!)
    SELECT 'CC-MFG-' || WERKS, 'MACHINE', 2026, WERKS, 1,
        mach_rate * 0.6 * CASE WHEN WERKS = 'PL03' THEN 1.22 ELSE 1.03 END,
        mach_rate * 0.4 * CASE WHEN WERKS = 'PL03' THEN 1.18 ELSE 1.03 END,
        'USD' FROM base_rates
    UNION ALL
    SELECT 'CC-MFG-' || WERKS, 'LABOUR', 2026, WERKS, 1,
        labour_rate * 0.7 * CASE WHEN WERKS = 'PL03' THEN 1.15 ELSE 1.03 END,
        labour_rate * 0.3 * CASE WHEN WERKS = 'PL03' THEN 1.25 ELSE 1.04 END,
        'USD' FROM base_rates
    UNION ALL
    -- FY2026 Actual rates
    SELECT 'CC-MFG-' || WERKS, 'MACHINE', 2026, WERKS, 4,
        mach_rate * 0.6 * CASE WHEN WERKS = 'PL03' THEN 1.28 ELSE 1.05 END,
        mach_rate * 0.4 * CASE WHEN WERKS = 'PL03' THEN 1.20 ELSE 1.06 END,
        'USD' FROM base_rates
    UNION ALL
    SELECT 'CC-MFG-' || WERKS, 'LABOUR', 2026, WERKS, 4,
        labour_rate * 0.7 * CASE WHEN WERKS = 'PL03' THEN 1.18 ELSE 1.04 END,
        labour_rate * 0.3 * CASE WHEN WERKS = 'PL03' THEN 1.30 ELSE 1.05 END,
        'USD' FROM base_rates
    UNION ALL
    -- Packaging cost centre rates (all years)
    SELECT 'CC-PKG-' || WERKS, 'MACHINE', yr.Y, WERKS, t.T,
        35.00 * CASE WHEN WERKS = 'PL05' THEN 0.5 ELSE 1.0 END * (1 + (yr.Y - 2025) * 0.03),
        15.00 * CASE WHEN WERKS = 'PL05' THEN 0.5 ELSE 1.0 END * (1 + (yr.Y - 2025) * 0.03),
        'USD'
    FROM base_rates
    CROSS JOIN (SELECT 2025 AS Y UNION ALL SELECT 2026) yr
    CROSS JOIN (SELECT 1 AS T UNION ALL SELECT 4) t
    UNION ALL
    SELECT 'CC-PKG-' || WERKS, 'LABOUR', yr.Y, WERKS, t.T,
        25.00 * CASE WHEN WERKS = 'PL05' THEN 0.45 ELSE 1.0 END * (1 + (yr.Y - 2025) * 0.03),
        12.00 * CASE WHEN WERKS = 'PL05' THEN 0.45 ELSE 1.0 END * (1 + (yr.Y - 2025) * 0.03),
        'USD'
    FROM base_rates
    CROSS JOIN (SELECT 2025 AS Y UNION ALL SELECT 2026) yr
    CROSS JOIN (SELECT 1 AS T UNION ALL SELECT 4) t
)
SELECT * FROM rate_rows;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. APO_DEMAND_RAW — Demand Plan (planned volumes vs actual billing)
--    Includes deliberate misalignment: PL03 over-planned, PL05 under-planned
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.APO_DEMAND_RAW (
    MATNR    VARCHAR(20),
    WERKS    VARCHAR(10),
    GJAHR    NUMBER(4),
    POPER    NUMBER(3),
    PLNMG    NUMBER(12,0),
    CFMNG    NUMBER(12,0),
    FCMNG    NUMBER(12,0),
    VERSN    VARCHAR(5),
    MEINS    VARCHAR(5)
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.APO_DEMAND_RAW
WITH billing_actual AS (
    -- Get actual billed quantities per product/plant/period
    SELECT 
        TRIM(MATNR) AS MATNR,
        TRIM(WERKS) AS WERKS,
        GJAHR,
        POPER,
        SUM(FKMNG) AS actual_qty
    FROM APC_DEPLOY_DB.SAP_BDC.SD_BILLING
    WHERE GJAHR = 2026
    GROUP BY 1, 2, 3, 4
),
planned AS (
    SELECT
        b.MATNR,
        b.WERKS,
        b.GJAHR,
        b.POPER,
        -- Planned qty: actual × bias factor per plant (simulate planning accuracy)
        ROUND(b.actual_qty * CASE 
            WHEN b.WERKS = 'PL03' THEN 1.25  -- Dunboyne over-planned by 25% (capacity reserved but not used)
            WHEN b.WERKS = 'PL05' THEN 0.80  -- Bangalore under-planned by 20% (surprise demand)
            WHEN b.WERKS = 'PL01' THEN 1.05  -- Macclesfield slight over
            WHEN b.WERKS = 'PL02' THEN 0.95  -- Sodertalje slight under
            ELSE 1.0
        END, 0) AS planned_qty,
        -- Confirmed = 85% of planned (typical confirmation rate)
        ROUND(b.actual_qty * CASE 
            WHEN b.WERKS = 'PL03' THEN 1.25
            WHEN b.WERKS = 'PL05' THEN 0.80
            ELSE 1.0
        END * 0.85, 0) AS confirmed_qty,
        -- Commercial forecast: slightly different from production plan
        ROUND(b.actual_qty * CASE 
            WHEN b.WERKS = 'PL03' THEN 1.15  -- commercial less aggressive than APO
            WHEN b.WERKS = 'PL05' THEN 0.90
            ELSE 1.02
        END, 0) AS commercial_qty
    FROM billing_actual b
)
SELECT
    MATNR, WERKS, GJAHR, POPER,
    planned_qty AS PLNMG,
    confirmed_qty AS CFMNG,
    commercial_qty AS FCMNG,
    '000' AS VERSN,
    'EA' AS MEINS
FROM planned;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. VALUE_CHAIN_RAW — Site-to-site production flow
--    Pattern: PL05 (India API) → PL01/PL03 (formulation) → PL04 (US packaging/market)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.VALUE_CHAIN_RAW (
    MATNR    VARCHAR(20),
    LOCFR    VARCHAR(10),
    LOCTO    VARCHAR(10),
    PRESSION NUMBER(3),
    PDSTYP   VARCHAR(10),
    PDSTYP_DESC VARCHAR(50),
    MARKUP_PCT  NUMBER(5,2),
    TRANSP_COST NUMBER(8,4),
    WAERS    VARCHAR(5),
    DATEFROM DATE,
    DATETO   DATE
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.VALUE_CHAIN_RAW
WITH products AS (
    SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT'
),
chains AS (
    -- Step 1: API manufacturing at PL05 (India — lowest cost)
    SELECT MATNR, 'PL05' AS LOCFR, 
        CASE WHEN MATNR IN ('RX-3312-FIN','RX-1156-FIN','RX-9901-FIN') THEN 'PL03'  -- biologics to Ireland
             ELSE 'PL01' END AS LOCTO,
        1 AS PRESSION, 'API_MFG' AS PDSTYP, 'API Manufacturing' AS PDSTYP_DESC,
        8.5 AS MARKUP_PCT, 0.45 AS TRANSP_COST
    FROM products
    UNION ALL
    -- Step 2: Formulation at PL01 (UK) or PL03 (Ireland)
    SELECT MATNR,
        CASE WHEN MATNR IN ('RX-3312-FIN','RX-1156-FIN','RX-9901-FIN') THEN 'PL03' ELSE 'PL01' END,
        'PL02' AS LOCTO,  -- formulated product goes to Sweden for EU packaging
        2, 'FORMULATE', 'Drug Product Formulation',
        5.5, 0.22
    FROM products
    UNION ALL
    -- Step 3: Packaging at PL02 (Sweden) or PL04 (US)
    SELECT MATNR, 'PL02',
        'PL04',  -- final market = US
        3, 'PACKAGING', 'Primary & Secondary Packaging',
        3.0, 0.35
    FROM products
)
SELECT MATNR, LOCFR, LOCTO, PRESSION, PDSTYP, PDSTYP_DESC,
    MARKUP_PCT, TRANSP_COST, 'USD',
    '2024-01-01'::DATE, '9999-12-31'::DATE
FROM chains;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. SCC_ADJUSTMENTS_RAW — Manual value chain adjustments
--    Includes transfer pricing corrections, revaluations, and FX adjustments
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE TABLE APC_DEPLOY_DB.SAP_RAW.SCC_ADJUSTMENTS_RAW (
    MATNR       VARCHAR(20),
    WERKS       VARCHAR(10),
    GJAHR       NUMBER(4),
    POPER       NUMBER(3),
    ADJ_TYPE    VARCHAR(20),
    ADJ_REASON  VARCHAR(100),
    ADJ_AMOUNT  NUMBER(12,4),
    WAERS       VARCHAR(5),
    APPROVED_BY VARCHAR(50),
    APPROVED_DATE DATE,
    STATUS      VARCHAR(20)
);

INSERT INTO APC_DEPLOY_DB.SAP_RAW.SCC_ADJUSTMENTS_RAW
WITH products AS (
    SELECT DISTINCT TRIM(MATNR) AS MATNR FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW WHERE TRIM(MTART) = 'FERT'
),
adjustments AS (
    -- Transfer pricing markup correction (Q1 — undercharged India→UK)
    SELECT MATNR, 'PL01', 2026, p.POPER, 'TP_MARKUP',
        'Interco transfer price correction India→UK',
        CASE WHEN p.POPER <= 3 THEN 0.85 ELSE 0.0 END,
        'USD', 'Finance-TP-Team', DATE_FROM_PARTS(2026, p.POPER, 15), 'POSTED'
    FROM products
    CROSS JOIN (SELECT 1 AS POPER UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) p
    WHERE CASE WHEN p.POPER <= 3 THEN 0.85 ELSE 0.0 END > 0
    
    UNION ALL
    -- FX revaluation (Ireland plant — EUR/USD swing in April)
    SELECT MATNR, 'PL03', 2026, 4, 'REVAL',
        'EUR/USD revaluation — April FX swing',
        1.20, 'USD', 'Treasury', '2026-04-30'::DATE, 'POSTED'
    FROM products
    
    UNION ALL
    -- Allocation correction (PL05 overhead reallocation in May)
    SELECT MATNR, 'PL05', 2026, 5, 'ALLOC',
        'Overhead reallocation — shared services adjustment',
        -0.35, 'USD', 'Cost-Accounting', '2026-05-31'::DATE, 'POSTED'
    FROM products
    
    UNION ALL
    -- Manual correction (biologics at PL03 — yield loss write-off)
    SELECT MATNR, 'PL03', 2026, 5, 'MANUAL',
        'Yield loss write-off — batch failure',
        2.50, 'USD', 'Plant-Controller-PL03', '2026-05-20'::DATE, 'POSTED'
    FROM products
    WHERE MATNR IN ('RX-3312-FIN', 'RX-1156-FIN')
)
SELECT * FROM adjustments;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. MBEW_RAW — Standard prices for raw materials (needed for BOM costing)
--    Adds prices for API, excipient, packaging, and HALB materials
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO APC_DEPLOY_DB.SAP_RAW.MBEW_RAW (MANDT, MATNR, BWKEY, STPRS, PEINH, WAERS, VALID_FROM, LAEPR)
WITH raw_materials AS (
    SELECT TRIM(MATNR) AS MATNR, TRIM(MTART) AS MTART FROM APC_DEPLOY_DB.SAP_RAW.MARA_RAW
    WHERE TRIM(MTART) IN ('ROH', 'HALB')
),
plants AS (
    SELECT DISTINCT TRIM(WERKS) AS WERKS FROM APC_DEPLOY_DB.SAP_RAW.T001W_RAW
),
prices AS (
    SELECT 
        100 AS MANDT,
        rm.MATNR,
        p.WERKS AS BWKEY,
        CASE 
            -- API prices: biologics more expensive ($28.50/kg vs $14.50/kg)
            WHEN rm.MATNR LIKE 'API-%' AND rm.MATNR IN ('API-3312','API-1156') THEN 28.50
            WHEN rm.MATNR LIKE 'API-%' THEN 14.50
            -- Excipients: ~$3.20/kg
            WHEN rm.MATNR LIKE 'EXC-%' THEN 3.20
            -- Packaging: syringes/inhalers expensive, blisters/cartons cheap
            WHEN rm.MATNR = 'PKG-PRI-02' THEN 1.85  -- pre-filled syringes
            WHEN rm.MATNR = 'PKG-PRI-04' THEN 2.10  -- MDI canister
            WHEN rm.MATNR LIKE 'PKG-PRI%' THEN 0.95
            WHEN rm.MATNR LIKE 'PKG-SEC%' THEN 0.55
            -- HALB intermediates: biologics $18/kg, others $9.50/kg
            WHEN rm.MATNR IN ('HALB-3312','HALB-1156') THEN 18.00
            WHEN rm.MATNR LIKE 'HALB-%' THEN 9.50
            ELSE 5.00
        END AS STPRS,
        1 AS PEINH,
        'USD' AS WAERS,
        20250101 AS VALID_FROM,
        20250101 AS LAEPR
    FROM raw_materials rm
    CROSS JOIN plants p
)
SELECT MANDT, MATNR, BWKEY, STPRS, PEINH, WAERS, VALID_FROM, LAEPR FROM prices
WHERE NOT EXISTS (
    SELECT 1 FROM APC_DEPLOY_DB.SAP_RAW.MBEW_RAW x 
    WHERE TRIM(x.MATNR) = prices.MATNR AND TRIM(x.BWKEY) = prices.BWKEY
        AND x.VALID_FROM = prices.VALID_FROM
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Row counts
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 'STKO_RAW' AS table_name, COUNT(*) AS row_count FROM APC_DEPLOY_DB.SAP_RAW.STKO_RAW
UNION ALL SELECT 'STPO_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.STPO_RAW
UNION ALL SELECT 'PLPO_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.PLPO_RAW
UNION ALL SELECT 'KSPI_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.KSPI_RAW
UNION ALL SELECT 'APO_DEMAND_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.APO_DEMAND_RAW
UNION ALL SELECT 'VALUE_CHAIN_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.VALUE_CHAIN_RAW
UNION ALL SELECT 'SCC_ADJUSTMENTS_RAW', COUNT(*) FROM APC_DEPLOY_DB.SAP_RAW.SCC_ADJUSTMENTS_RAW
ORDER BY table_name;
