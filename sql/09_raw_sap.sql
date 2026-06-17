-- =============================================================================
-- AI Product Costing Accelerator — RAW SAP extracts ({{ database }}.SAP_RAW)
-- =============================================================================
-- Simulates GENUINELY RAW SAP data as it lands from an ECC/BW extract — BEFORE
-- any modelling. This is the input to the dbt-on-Snowflake medallion pipeline
-- (dbt/apc) which transforms it into the costing model.
--
-- Deliberate "raw" characteristics the pipeline must handle:
--   * Material-ledger LINE ITEMS (many postings/period, incl. reversals) — unit
--     cost is NOT given; it must be aggregated (Σamount / Σqty after netting).
--   * Amounts in each plant's LOCAL currency (GBP/SEK/EUR/USD/INR) — must FX to USD.
--   * Effective-dated standard prices (MBEW) — pick the row valid for the period.
--   * Cost components as CODED element numbers (KEPH) — must decode via seed.
--   * SAP quirks: POPER as integer, trailing spaces on keys, un-decoded MTART,
--     duplicate extract rows, and some incomplete (null-amount) postings.
--
-- Run with:  snow sql -c <connection> -f sql/09_raw_sap.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS {{ database }}.SAP_RAW
  COMMENT = 'Raw SAP ECC/BW extracts (pre-transformation). Source for the dbt medallion pipeline.';
USE SCHEMA {{ database }}.SAP_RAW;

-- ── MARA — Material master (raw, cryptic + trailing spaces) ───────────────────
CREATE OR REPLACE TABLE MARA_RAW (
    MANDT   VARCHAR(3)            COMMENT 'Client (SAP: MANDT)',
    MATNR   VARCHAR(40)  NOT NULL COMMENT 'Material number — may carry trailing spaces (SAP: MATNR)',
    MAKTX   VARCHAR(100)          COMMENT 'Material description (SAP: MAKTX)',
    MTART   VARCHAR(4)            COMMENT 'Material type CODE — undecoded (SAP: MTART)',
    MATKL   VARCHAR(9)            COMMENT 'Material group (SAP: MATKL)',
    MEINS   VARCHAR(3)            COMMENT 'Base UoM (SAP: MEINS)'
) COMMENT = 'RAW MARA material master.';

-- ── T001W — Plant master (raw) + company code & local currency ────────────────
CREATE OR REPLACE TABLE T001W_RAW (
    MANDT   VARCHAR(3)            COMMENT 'Client',
    WERKS   VARCHAR(8)   NOT NULL COMMENT 'Plant — may carry trailing spaces (SAP: WERKS)',
    NAME1   VARCHAR(100)          COMMENT 'Plant name (SAP: NAME1)',
    LAND1   VARCHAR(3)            COMMENT 'Country (SAP: LAND1)',
    BUKRS   VARCHAR(4)            COMMENT 'Company code (SAP: BUKRS)',
    WAERS   VARCHAR(3)            COMMENT 'Local currency of the company code (SAP: WAERS)',
    ORT01   VARCHAR(50)           COMMENT 'City (SAP: ORT01)'
) COMMENT = 'RAW T001W plant master with company code + local currency.';

-- ── CKMLCR/MLIT — Material-ledger POSTING LINE ITEMS (the messy core) ─────────
CREATE OR REPLACE TABLE MATERIAL_LEDGER_DOC (
    MANDT   VARCHAR(3)            COMMENT 'Client',
    BELNR   VARCHAR(12)  NOT NULL COMMENT 'Accounting document number (SAP: BELNR)',
    BUZEI   INTEGER               COMMENT 'Document line item (SAP: BUZEI)',
    MATNR   VARCHAR(40)           COMMENT 'Material number — trailing spaces possible',
    WERKS   VARCHAR(8)            COMMENT 'Plant — trailing spaces possible',
    BUKRS   VARCHAR(4)            COMMENT 'Company code',
    GJAHR   INTEGER               COMMENT 'Fiscal year (SAP: GJAHR)',
    POPER   INTEGER               COMMENT 'Posting period 1-12 — NOT zero-padded (SAP: POPER)',
    BWART   VARCHAR(3)            COMMENT 'Movement type: 101 receipt, 102 reversal, 261 consumption',
    MENGE   FLOAT                 COMMENT 'Quantity — negative for reversals (SAP: MENGE)',
    DMBTR   FLOAT                 COMMENT 'Amount in LOCAL currency — may be NULL on incomplete postings (SAP: DMBTR)',
    WAERS   VARCHAR(3)            COMMENT 'Local currency (SAP: WAERS)',
    BUDAT   VARCHAR(8)            COMMENT 'Posting date as YYYYMMDD string (SAP: BUDAT)'
) COMMENT = 'RAW material-ledger posting line items. Multiple rows per material/plant/period; unit cost must be derived.';

-- ── MBEW — Material valuation / standard price (effective-dated, local cur) ───
CREATE OR REPLACE TABLE MBEW_RAW (
    MANDT      VARCHAR(3)         COMMENT 'Client',
    MATNR      VARCHAR(40)        COMMENT 'Material number — trailing spaces possible',
    BWKEY      VARCHAR(8)         COMMENT 'Valuation area = plant (SAP: BWKEY)',
    STPRS      FLOAT              COMMENT 'Standard price in LOCAL currency (SAP: STPRS)',
    PEINH      INTEGER            COMMENT 'Price unit (SAP: PEINH)',
    WAERS      VARCHAR(3)         COMMENT 'Local currency',
    VALID_FROM VARCHAR(8)         COMMENT 'Standard valid-from date YYYYMMDD (effective-dated)',
    LAEPR      VARCHAR(8)         COMMENT 'Date of last price change (SAP: LAEPR)'
) COMMENT = 'RAW MBEW standard prices — effective-dated, local currency.';

-- ── KEPH — Cost component split, CODED element numbers, local currency ────────
CREATE OR REPLACE TABLE KEPH_RAW (
    MANDT    VARCHAR(3)           COMMENT 'Client',
    KALNR    VARCHAR(12)          COMMENT 'Costing run number (SAP: KALNR)',
    MATNR    VARCHAR(40)          COMMENT 'Material number',
    WERKS    VARCHAR(8)           COMMENT 'Plant',
    GJAHR    INTEGER              COMMENT 'Fiscal year',
    POPER    INTEGER              COMMENT 'Posting period 1-12 (not padded)',
    ELEMENT  INTEGER              COMMENT 'Cost component element NUMBER 1-8 — undecoded (SAP: cost element)',
    RECTYPE  VARCHAR(1)           COMMENT 'Record type: S = standard, A = actual',
    WERTN    FLOAT                COMMENT 'Component value in LOCAL currency (SAP: WERTN)',
    WAERS    VARCHAR(3)           COMMENT 'Local currency'
) COMMENT = 'RAW KEPH cost component split — coded element numbers, local currency, standard + actual.';

-- ── TCURR — FX rates (with the classic SAP inverted date) ─────────────────────
CREATE OR REPLACE TABLE TCURR_RAW (
    MANDT   VARCHAR(3)            COMMENT 'Client',
    KURST   VARCHAR(4)            COMMENT 'Exchange rate type, e.g. M (SAP: KURST)',
    FCURR   VARCHAR(3)            COMMENT 'From (local) currency (SAP: FCURR)',
    TCURR   VARCHAR(3)            COMMENT 'To (reporting) currency = USD (SAP: TCURR)',
    GDATU   VARCHAR(8)            COMMENT 'SAP inverted date: 99999999 - YYYYMMDD (SAP: GDATU)',
    UKURS   FLOAT                 COMMENT 'Rate = USD per 1 unit of FCURR (usd = local_amount * UKURS)'
) COMMENT = 'RAW TCURR exchange rates, FCURR -> USD, monthly, SAP inverted GDATU.';
