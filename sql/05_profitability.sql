-- =============================================================================
-- AI Product Costing Accelerator — Profitability Analysis
-- =============================================================================
-- Adds SD billing revenue data (simulates SAP SD VBRP/VBRK) to enable
-- CO-PA style gross margin analysis combining CO-PC costs with SD revenue.
--
-- Run AFTER 01_setup.sql through 04_scenarios.sql.
-- Run with:  snow sql -c <connection> -f sql/05_profitability.sql
-- =============================================================================

USE DATABASE {{ database }};
USE SCHEMA {{ database }}.SAP_BDC;

-- ── SD Billing Table (simulates VBRP/VBRK — Sales & Distribution Billing) ────
-- One row per billing line item: material × customer/market × period.
-- NETPR = net price per unit (revenue), FKMNG = billed quantity.
CREATE OR REPLACE TABLE SD_BILLING (
    VBELN     VARCHAR(10)  NOT NULL COMMENT 'Billing document number (SAP: VBELN)',
    POSNR     VARCHAR(6)   NOT NULL COMMENT 'Billing item number (SAP: POSNR)',
    MATNR     VARCHAR(18)  NOT NULL COMMENT 'Material number (SAP: MATNR)',
    WERKS     VARCHAR(4)   NOT NULL COMMENT 'Supplying plant (SAP: WERKS)',
    KUNNR     VARCHAR(20)           COMMENT 'Customer number (SAP: KUNNR)',
    MARKET    VARCHAR(30)  NOT NULL COMMENT 'Market/region (derived from customer master)',
    POPER     VARCHAR(3)   NOT NULL COMMENT 'Posting period 001-003 (SAP: POPER)',
    GJAHR     INTEGER      NOT NULL COMMENT 'Fiscal year (SAP: GJAHR)',
    FKMNG     FLOAT        NOT NULL COMMENT 'Billed quantity in base UoM (SAP: FKMNG)',
    NETPR     FLOAT        NOT NULL COMMENT 'Net price per unit (SAP: NETPR)',
    NETWR     FLOAT        NOT NULL COMMENT 'Net revenue value (FKMNG * NETPR)',
    CURRENCY  VARCHAR(3)   DEFAULT 'USD',
    PRIMARY KEY (VBELN, POSNR)
) COMMENT = 'SAP BDC: SD billing line items (VBRP/VBRK). Revenue per material/market/period. Combined with CO-PC costs gives gross margin (CO-PA style analysis).';

-- ── Synthetic Revenue Data ────────────────────────────────────────────────────
-- 10 finished products × 4 markets × 3 periods = 120 billing lines.
-- Net prices are pharma-realistic:
--   Oncology/biologics (AZD3312, AZD9901, AZD4567): 3.5–5.5× cost — high-value
--   Specialty (AZD2891, AZD8834, AZD1156):          2.5–3.5× cost — mid-tier
--   Established brands (AZD1234, AZD6103, AZD5521, AZD7890): 1.8–2.5× cost
-- Volumes reflect market size: US > EU > Japan > Emerging
-- Revenue trends up slightly P001→P003 (new indication launches, price realisations)

INSERT INTO SD_BILLING (VBELN, POSNR, MATNR, WERKS, KUNNR, MARKET, POPER, GJAHR, FKMNG, NETPR, NETWR, CURRENCY) VALUES

-- ── RX-1234-FIN (Tablets 10mg) — Established brand, ~2.2x cost ──────────────
('5100000001','000010','RX-1234-FIN','PL01','CUST-US-001','United States','001',2026,  85000, 120.00, 10200000.00,'USD'),
('5100000002','000010','RX-1234-FIN','PL01','CUST-EU-001','Europe',       '001',2026,  62000, 105.00,  6510000.00,'USD'),
('5100000003','000010','RX-1234-FIN','PL02','CUST-JP-001','Japan',        '001',2026,  28000, 115.00,  3220000.00,'USD'),
('5100000004','000010','RX-1234-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  45000,  72.00,  3240000.00,'USD'),
('5100000005','000010','RX-1234-FIN','PL01','CUST-US-001','United States','002',2026,  88000, 120.00, 10560000.00,'USD'),
('5100000006','000010','RX-1234-FIN','PL01','CUST-EU-001','Europe',       '002',2026,  65000, 105.00,  6825000.00,'USD'),
('5100000007','000010','RX-1234-FIN','PL02','CUST-JP-001','Japan',        '002',2026,  29000, 115.00,  3335000.00,'USD'),
('5100000008','000010','RX-1234-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  47000,  72.00,  3384000.00,'USD'),
('5100000009','000010','RX-1234-FIN','PL01','CUST-US-001','United States','003',2026,  91000, 122.00, 11102000.00,'USD'),
('5100000010','000010','RX-1234-FIN','PL01','CUST-EU-001','Europe',       '003',2026,  68000, 107.00,  7276000.00,'USD'),
('5100000011','000010','RX-1234-FIN','PL02','CUST-JP-001','Japan',        '003',2026,  31000, 115.00,  3565000.00,'USD'),
('5100000012','000010','RX-1234-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  52000,  73.00,  3796000.00,'USD'),

-- ── RX-3312-FIN (Biologics 100mg) — Oncology biologics, ~4.5x cost ──────────
('5100000101','000010','RX-3312-FIN','PL02','CUST-US-001','United States','001',2026,  12000, 820.00,  9840000.00,'USD'),
('5100000102','000010','RX-3312-FIN','PL02','CUST-EU-001','Europe',       '001',2026,   9500, 720.00,  6840000.00,'USD'),
('5100000103','000010','RX-3312-FIN','PL02','CUST-JP-001','Japan',        '001',2026,   4200, 780.00,  3276000.00,'USD'),
('5100000104','000010','RX-3312-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,   2800, 450.00,  1260000.00,'USD'),
('5100000105','000010','RX-3312-FIN','PL02','CUST-US-001','United States','002',2026,  13500, 820.00, 11070000.00,'USD'),
('5100000106','000010','RX-3312-FIN','PL02','CUST-EU-001','Europe',       '002',2026,  10200, 720.00,  7344000.00,'USD'),
('5100000107','000010','RX-3312-FIN','PL02','CUST-JP-001','Japan',        '002',2026,   4600, 780.00,  3588000.00,'USD'),
('5100000108','000010','RX-3312-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,   3100, 450.00,  1395000.00,'USD'),
('5100000109','000010','RX-3312-FIN','PL02','CUST-US-001','United States','003',2026,  15000, 835.00, 12525000.00,'USD'),
('5100000110','000010','RX-3312-FIN','PL02','CUST-EU-001','Europe',       '003',2026,  11500, 730.00,  8395000.00,'USD'),
('5100000111','000010','RX-3312-FIN','PL02','CUST-JP-001','Japan',        '003',2026,   5100, 790.00,  4029000.00,'USD'),
('5100000112','000010','RX-3312-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,   3600, 460.00,  1656000.00,'USD'),

-- ── RX-9901-FIN (Inhaler 90mcg) — Respiratory oncology, ~3.8x cost ──────────
('5100000201','000010','RX-9901-FIN','PL01','CUST-US-001','United States','001',2026,  22000, 310.00,  6820000.00,'USD'),
('5100000202','000010','RX-9901-FIN','PL01','CUST-EU-001','Europe',       '001',2026,  18000, 275.00,  4950000.00,'USD'),
('5100000203','000010','RX-9901-FIN','PL02','CUST-JP-001','Japan',        '001',2026,   9500, 295.00,  2802500.00,'USD'),
('5100000204','000010','RX-9901-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  14000, 165.00,  2310000.00,'USD'),
('5100000205','000010','RX-9901-FIN','PL01','CUST-US-001','United States','002',2026,  23500, 310.00,  7285000.00,'USD'),
('5100000206','000010','RX-9901-FIN','PL01','CUST-EU-001','Europe',       '002',2026,  19000, 275.00,  5225000.00,'USD'),
('5100000207','000010','RX-9901-FIN','PL02','CUST-JP-001','Japan',        '002',2026,  10000, 295.00,  2950000.00,'USD'),
('5100000208','000010','RX-9901-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  15500, 165.00,  2557500.00,'USD'),
('5100000209','000010','RX-9901-FIN','PL01','CUST-US-001','United States','003',2026,  25000, 315.00,  7875000.00,'USD'),
('5100000210','000010','RX-9901-FIN','PL01','CUST-EU-001','Europe',       '003',2026,  21000, 280.00,  5880000.00,'USD'),
('5100000211','000010','RX-9901-FIN','PL02','CUST-JP-001','Japan',        '003',2026,  11000, 300.00,  3300000.00,'USD'),
('5100000212','000010','RX-9901-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  17500, 168.00,  2940000.00,'USD'),

-- ── RX-4567-FIN (Injection 50mg/mL) — Specialty injection, ~3.2x cost ───────
('5100000301','000010','RX-4567-FIN','PL03','CUST-US-001','United States','001',2026,  18000, 195.00,  3510000.00,'USD'),
('5100000302','000010','RX-4567-FIN','PL03','CUST-EU-001','Europe',       '001',2026,  14000, 172.00,  2408000.00,'USD'),
('5100000303','000010','RX-4567-FIN','PL02','CUST-JP-001','Japan',        '001',2026,   7500, 185.00,  1387500.00,'USD'),
('5100000304','000010','RX-4567-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  11000, 110.00,  1210000.00,'USD'),
('5100000305','000010','RX-4567-FIN','PL03','CUST-US-001','United States','002',2026,  19500, 195.00,  3802500.00,'USD'),
('5100000306','000010','RX-4567-FIN','PL03','CUST-EU-001','Europe',       '002',2026,  15000, 172.00,  2580000.00,'USD'),
('5100000307','000010','RX-4567-FIN','PL02','CUST-JP-001','Japan',        '002',2026,   8000, 185.00,  1480000.00,'USD'),
('5100000308','000010','RX-4567-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  12000, 112.00,  1344000.00,'USD'),
('5100000309','000010','RX-4567-FIN','PL03','CUST-US-001','United States','003',2026,  21000, 198.00,  4158000.00,'USD'),
('5100000310','000010','RX-4567-FIN','PL03','CUST-EU-001','Europe',       '003',2026,  16500, 175.00,  2887500.00,'USD'),
('5100000311','000010','RX-4567-FIN','PL02','CUST-JP-001','Japan',        '003',2026,   8800, 188.00,  1654400.00,'USD'),
('5100000312','000010','RX-4567-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  13500, 115.00,  1552500.00,'USD'),

-- ── RX-2891-FIN (Capsules 25mg) — Specialty, ~2.8x cost ─────────────────────
('5100000401','000010','RX-2891-FIN','PL03','CUST-US-001','United States','001',2026,  35000,  95.00,  3325000.00,'USD'),
('5100000402','000010','RX-2891-FIN','PL03','CUST-EU-001','Europe',       '001',2026,  28000,  84.00,  2352000.00,'USD'),
('5100000403','000010','RX-2891-FIN','PL05','CUST-JP-001','Japan',        '001',2026,  12000,  90.00,  1080000.00,'USD'),
('5100000404','000010','RX-2891-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  22000,  52.00,  1144000.00,'USD'),
('5100000405','000010','RX-2891-FIN','PL03','CUST-US-001','United States','002',2026,  36500,  95.00,  3467500.00,'USD'),
('5100000406','000010','RX-2891-FIN','PL03','CUST-EU-001','Europe',       '002',2026,  29500,  84.00,  2478000.00,'USD'),
('5100000407','000010','RX-2891-FIN','PL05','CUST-JP-001','Japan',        '002',2026,  12800,  90.00,  1152000.00,'USD'),
('5100000408','000010','RX-2891-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  24000,  52.00,  1248000.00,'USD'),
('5100000409','000010','RX-2891-FIN','PL03','CUST-US-001','United States','003',2026,  38000,  97.00,  3686000.00,'USD'),
('5100000410','000010','RX-2891-FIN','PL03','CUST-EU-001','Europe',       '003',2026,  31000,  86.00,  2666000.00,'USD'),
('5100000411','000010','RX-2891-FIN','PL05','CUST-JP-001','Japan',        '003',2026,  13500,  92.00,  1242000.00,'USD'),
('5100000412','000010','RX-2891-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  26000,  53.00,  1378000.00,'USD'),

-- ── RX-6103-FIN (Tablets 5mg) — Mature brand, ~2.0x cost ────────────────────
('5100000501','000010','RX-6103-FIN','PL01','CUST-US-001','United States','001',2026, 120000,  48.00,  5760000.00,'USD'),
('5100000502','000010','RX-6103-FIN','PL01','CUST-EU-001','Europe',       '001',2026,  95000,  42.00,  3990000.00,'USD'),
('5100000503','000010','RX-6103-FIN','PL02','CUST-JP-001','Japan',        '001',2026,  42000,  45.00,  1890000.00,'USD'),
('5100000504','000010','RX-6103-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  88000,  28.00,  2464000.00,'USD'),
('5100000505','000010','RX-6103-FIN','PL01','CUST-US-001','United States','002',2026, 118000,  48.00,  5664000.00,'USD'),
('5100000506','000010','RX-6103-FIN','PL01','CUST-EU-001','Europe',       '002',2026,  93000,  42.00,  3906000.00,'USD'),
('5100000507','000010','RX-6103-FIN','PL02','CUST-JP-001','Japan',        '002',2026,  41000,  45.00,  1845000.00,'USD'),
('5100000508','000010','RX-6103-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  87000,  28.00,  2436000.00,'USD'),
('5100000509','000010','RX-6103-FIN','PL01','CUST-US-001','United States','003',2026, 115000,  48.00,  5520000.00,'USD'),
('5100000510','000010','RX-6103-FIN','PL01','CUST-EU-001','Europe',       '003',2026,  90000,  43.00,  3870000.00,'USD'),
('5100000511','000010','RX-6103-FIN','PL02','CUST-JP-001','Japan',        '003',2026,  40000,  46.00,  1840000.00,'USD'),
('5100000512','000010','RX-6103-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  85000,  29.00,  2465000.00,'USD'),

-- ── RX-8834-FIN (Tablets 20mg) — Specialty oral, ~2.9x cost ─────────────────
('5100000601','000010','RX-8834-FIN','PL05','CUST-US-001','United States','001',2026,  42000, 130.00,  5460000.00,'USD'),
('5100000602','000010','RX-8834-FIN','PL05','CUST-EU-001','Europe',       '001',2026,  32000, 115.00,  3680000.00,'USD'),
('5100000603','000010','RX-8834-FIN','PL05','CUST-JP-001','Japan',        '001',2026,  14000, 124.00,  1736000.00,'USD'),
('5100000604','000010','RX-8834-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  20000,  72.00,  1440000.00,'USD'),
('5100000605','000010','RX-8834-FIN','PL05','CUST-US-001','United States','002',2026,  44000, 130.00,  5720000.00,'USD'),
('5100000606','000010','RX-8834-FIN','PL05','CUST-EU-001','Europe',       '002',2026,  34000, 115.00,  3910000.00,'USD'),
('5100000607','000010','RX-8834-FIN','PL05','CUST-JP-001','Japan',        '002',2026,  15000, 124.00,  1860000.00,'USD'),
('5100000608','000010','RX-8834-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  22000,  72.00,  1584000.00,'USD'),
('5100000609','000010','RX-8834-FIN','PL05','CUST-US-001','United States','003',2026,  47000, 133.00,  6251000.00,'USD'),
('5100000610','000010','RX-8834-FIN','PL05','CUST-EU-001','Europe',       '003',2026,  36000, 117.00,  4212000.00,'USD'),
('5100000611','000010','RX-8834-FIN','PL05','CUST-JP-001','Japan',        '003',2026,  16000, 126.00,  2016000.00,'USD'),
('5100000612','000010','RX-8834-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  24000,  74.00,  1776000.00,'USD'),

-- ── RX-1156-FIN (IV Infusion 200mg) — Specialty hospital, ~2.7x cost ─────────
('5100000701','000010','RX-1156-FIN','PL02','CUST-US-001','United States','001',2026,   8500, 148.00,  1258000.00,'USD'),
('5100000702','000010','RX-1156-FIN','PL02','CUST-EU-001','Europe',       '001',2026,   7200, 132.00,   950400.00,'USD'),
('5100000703','000010','RX-1156-FIN','PL02','CUST-JP-001','Japan',        '001',2026,   3800, 142.00,   539600.00,'USD'),
('5100000704','000010','RX-1156-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,   5500,  82.00,   451000.00,'USD'),
('5100000705','000010','RX-1156-FIN','PL02','CUST-US-001','United States','002',2026,   9000, 148.00,  1332000.00,'USD'),
('5100000706','000010','RX-1156-FIN','PL02','CUST-EU-001','Europe',       '002',2026,   7600, 132.00,  1003200.00,'USD'),
('5100000707','000010','RX-1156-FIN','PL02','CUST-JP-001','Japan',        '002',2026,   4000, 142.00,   568000.00,'USD'),
('5100000708','000010','RX-1156-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,   5800,  82.00,   475600.00,'USD'),
('5100000709','000010','RX-1156-FIN','PL02','CUST-US-001','United States','003',2026,   9800, 151.00,  1479800.00,'USD'),
('5100000710','000010','RX-1156-FIN','PL02','CUST-EU-001','Europe',       '003',2026,   8100, 135.00,  1093500.00,'USD'),
('5100000711','000010','RX-1156-FIN','PL02','CUST-JP-001','Japan',        '003',2026,   4400, 145.00,   638000.00,'USD'),
('5100000712','000010','RX-1156-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,   6300,  84.00,   529200.00,'USD'),

-- ── RX-5521-FIN (Patches 15mg/24h) — Dermal specialty, ~2.4x cost ───────────
('5100000801','000010','RX-5521-FIN','PL03','CUST-US-001','United States','001',2026,  55000,  88.00,  4840000.00,'USD'),
('5100000802','000010','RX-5521-FIN','PL03','CUST-EU-001','Europe',       '001',2026,  42000,  78.00,  3276000.00,'USD'),
('5100000803','000010','RX-5521-FIN','PL05','CUST-JP-001','Japan',        '001',2026,  18000,  84.00,  1512000.00,'USD'),
('5100000804','000010','RX-5521-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  32000,  48.00,  1536000.00,'USD'),
('5100000805','000010','RX-5521-FIN','PL03','CUST-US-001','United States','002',2026,  57000,  88.00,  5016000.00,'USD'),
('5100000806','000010','RX-5521-FIN','PL03','CUST-EU-001','Europe',       '002',2026,  44000,  78.00,  3432000.00,'USD'),
('5100000807','000010','RX-5521-FIN','PL05','CUST-JP-001','Japan',        '002',2026,  19000,  84.00,  1596000.00,'USD'),
('5100000808','000010','RX-5521-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  34000,  48.00,  1632000.00,'USD'),
('5100000809','000010','RX-5521-FIN','PL03','CUST-US-001','United States','003',2026,  60000,  90.00,  5400000.00,'USD'),
('5100000810','000010','RX-5521-FIN','PL03','CUST-EU-001','Europe',       '003',2026,  46000,  80.00,  3680000.00,'USD'),
('5100000811','000010','RX-5521-FIN','PL05','CUST-JP-001','Japan',        '003',2026,  20500,  86.00,  1763000.00,'USD'),
('5100000812','000010','RX-5521-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  37000,  49.00,  1813000.00,'USD'),

-- ── RX-7890-FIN (Oral Solution 2mg/mL) — Paediatric/EM, ~1.9x cost ──────────
('5100000901','000010','RX-7890-FIN','PL05','CUST-US-001','United States','001',2026,  28000,  62.00,  1736000.00,'USD'),
('5100000902','000010','RX-7890-FIN','PL05','CUST-EU-001','Europe',       '001',2026,  24000,  55.00,  1320000.00,'USD'),
('5100000903','000010','RX-7890-FIN','PL05','CUST-JP-001','Japan',        '001',2026,  10000,  59.00,   590000.00,'USD'),
('5100000904','000010','RX-7890-FIN','PL04','CUST-EM-001','Emerging Mkts','001',2026,  48000,  34.00,  1632000.00,'USD'),
('5100000905','000010','RX-7890-FIN','PL05','CUST-US-001','United States','002',2026,  29000,  62.00,  1798000.00,'USD'),
('5100000906','000010','RX-7890-FIN','PL05','CUST-EU-001','Europe',       '002',2026,  25000,  55.00,  1375000.00,'USD'),
('5100000907','000010','RX-7890-FIN','PL05','CUST-JP-001','Japan',        '002',2026,  10500,  59.00,   619500.00,'USD'),
('5100000908','000010','RX-7890-FIN','PL04','CUST-EM-001','Emerging Mkts','002',2026,  50000,  34.00,  1700000.00,'USD'),
('5100000909','000010','RX-7890-FIN','PL05','CUST-US-001','United States','003',2026,  30000,  63.00,  1890000.00,'USD'),
('5100000910','000010','RX-7890-FIN','PL05','CUST-EU-001','Europe',       '003',2026,  26000,  56.00,  1456000.00,'USD'),
('5100000911','000010','RX-7890-FIN','PL05','CUST-JP-001','Japan',        '003',2026,  11000,  60.00,   660000.00,'USD'),
('5100000912','000010','RX-7890-FIN','PL04','CUST-EM-001','Emerging Mkts','003',2026,  53000,  35.00,  1855000.00,'USD');

-- ── Analytics Schema ──────────────────────────────────────────────────────────
USE SCHEMA {{ database }}.ANALYTICS;

-- ── Product Profitability View ────────────────────────────────────────────────
-- Combines SD billing revenue with CO-PC standard and actual costs.
-- One row per material × market × period.
-- Gross Profit = Revenue − COGS. Margin % = Gross Profit / Revenue.
CREATE OR REPLACE VIEW PRODUCT_PROFITABILITY AS
WITH cost_by_plant_period AS (
  -- Average actual and standard cost per unit across plants (weighted by plant)
  SELECT
    MATERIAL_NUMBER,
    MATERIAL_DESCRIPTION,
    PERIOD,
    AVG(ACTUAL_COST_PER_UNIT)   AS AVG_ACTUAL_COST_PER_UNIT,
    AVG(STANDARD_COST_PER_UNIT) AS AVG_BUDGET_COST_PER_UNIT
  FROM {{ database }}.ANALYTICS.PRODUCT_COST_SUMMARY
  WHERE FISCAL_YEAR = 2026
    AND MATERIAL_TYPE = 'FERT'
  GROUP BY MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PERIOD
)
SELECT
  b.MATNR                               AS MATERIAL_NUMBER,
  c.MATERIAL_DESCRIPTION,
  b.MARKET,
  b.POPER                               AS PERIOD,
  b.GJAHR                               AS FISCAL_YEAR,
  SUM(b.NETWR)                          AS REVENUE,
  SUM(b.FKMNG)                          AS VOLUME_UNITS,
  AVG(b.NETPR)                          AS AVG_NET_PRICE,
  -- COGS using actual cost
  SUM(b.FKMNG * c.AVG_ACTUAL_COST_PER_UNIT)   AS COGS_ACTUAL,
  -- COGS using budget (standard) cost
  SUM(b.FKMNG * c.AVG_BUDGET_COST_PER_UNIT)   AS COGS_BUDGET,
  -- Gross profit
  SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_ACTUAL_COST_PER_UNIT)  AS GROSS_PROFIT_ACTUAL,
  SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_BUDGET_COST_PER_UNIT)  AS GROSS_PROFIT_BUDGET,
  -- Margin %
  ROUND(
    (SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_ACTUAL_COST_PER_UNIT))
    / NULLIF(SUM(b.NETWR), 0) * 100, 1
  ) AS GROSS_MARGIN_PCT_ACTUAL,
  ROUND(
    (SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_BUDGET_COST_PER_UNIT))
    / NULLIF(SUM(b.NETWR), 0) * 100, 1
  ) AS GROSS_MARGIN_PCT_BUDGET,
  -- Margin variance: actual margin vs budget margin
  ROUND(
    (SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_ACTUAL_COST_PER_UNIT))
    / NULLIF(SUM(b.NETWR), 0) * 100
    -
    (SUM(b.NETWR) - SUM(b.FKMNG * c.AVG_BUDGET_COST_PER_UNIT))
    / NULLIF(SUM(b.NETWR), 0) * 100
  , 1) AS MARGIN_VARIANCE_PPS   -- percentage point swing
FROM {{ database }}.SAP_BDC.SD_BILLING b
JOIN cost_by_plant_period c
  ON b.MATNR = c.MATERIAL_NUMBER
  AND b.POPER = c.PERIOD
WHERE b.GJAHR = 2026
GROUP BY b.MATNR, c.MATERIAL_DESCRIPTION, b.MARKET, b.POPER, b.GJAHR;
