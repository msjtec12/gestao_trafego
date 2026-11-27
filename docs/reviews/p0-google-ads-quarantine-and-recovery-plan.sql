-- ============================================================================
-- KONNEXY ADS — P0 DATA INTEGRITY QUARANTINE & BACKUP RUNBOOK (NON-DESTRUCTIVE)
-- ============================================================================
-- IMPORTANTE:
-- 1. NÃO EXECUTE ESTE SCRIPT AUTOMATICAMENTE SEM AUTORIZAÇÃO EXPLÍCITA DO
--    PROPRIETÁRIO DO BANCO DE PRODUÇÃO.
-- 2. Este script NÃO altera `users`, `organizations`, `memberships`, `clients`,
--    `user_sessions` nem as credenciais OAuth em `integrations`.
-- 3. Etapa A: Diagnóstico somente leitura (100% seguro).
-- 4. Etapa B: Backup em tabelas de quarentena (`quarantine_p0_*`) antes de
--    qualquer limpeza autorizada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ETAPA A — DIAGNÓSTICO SOMENTE LEITURA (IDENTIFICAR REGISTROS CONTAMINADOS)
-- ----------------------------------------------------------------------------
SELECT 'synthetic_ad_accounts' AS category, count(*) AS total
FROM ad_accounts
WHERE is_demo_data = true
   OR (provider = 'GOOGLE_ADS' AND (external_account_id = '4028819001' OR external_account_id !~ '^[0-9]{10}$'))
UNION ALL
SELECT 'synthetic_campaigns', count(*)
FROM campaigns
WHERE is_demo_data = true
   OR (provider = 'GOOGLE_ADS' AND external_campaign_id !~ '^[0-9]+$')
UNION ALL
SELECT 'contaminated_daily_metrics', count(*)
FROM daily_metrics dm
WHERE dm.is_demo_data = true
   OR dm.campaign_id IN (
     SELECT id FROM campaigns
     WHERE is_demo_data = true OR (provider = 'GOOGLE_ADS' AND external_campaign_id !~ '^[0-9]+$')
   )
UNION ALL
SELECT 'contaminated_recommendations', count(*)
FROM recommendations r
WHERE r.is_demo_data = true
   OR r.campaign_id IN (
     SELECT id FROM campaigns
     WHERE is_demo_data = true OR (provider = 'GOOGLE_ADS' AND external_campaign_id !~ '^[0-9]+$')
   )
UNION ALL
SELECT 'false_completed_sync_runs', count(*)
FROM sync_runs
WHERE is_demo_data = true OR checkpoint_token LIKE 'ckpt-pg-%';

-- ----------------------------------------------------------------------------
-- ETAPA B — BACKUP EM QUARENTENA (EXECUTAR SOMENTE APÓS AUTORIZAÇÃO EXPLÍCITA)
-- ----------------------------------------------------------------------------
-- BEGIN;
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_ad_accounts AS
--   SELECT * FROM ad_accounts
--   WHERE is_demo_data = true
--      OR (provider = 'GOOGLE_ADS' AND (external_account_id = '4028819001' OR external_account_id !~ '^[0-9]{10}$'));
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_campaigns AS
--   SELECT * FROM campaigns
--   WHERE is_demo_data = true
--      OR (provider = 'GOOGLE_ADS' AND external_campaign_id !~ '^[0-9]+$');
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_daily_metrics AS
--   SELECT * FROM daily_metrics
--   WHERE is_demo_data = true
--      OR campaign_id IN (SELECT id FROM quarantine_p0_campaigns);
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_recommendations AS
--   SELECT * FROM recommendations
--   WHERE is_demo_data = true
--      OR campaign_id IN (SELECT id FROM quarantine_p0_campaigns);
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_reports AS
--   SELECT * FROM reports
--   WHERE client_id IN (SELECT DISTINCT client_id FROM quarantine_p0_ad_accounts);
--
-- CREATE TABLE IF NOT EXISTS quarantine_p0_sync_runs AS
--   SELECT * FROM sync_runs
--   WHERE is_demo_data = true OR checkpoint_token LIKE 'ckpt-pg-%';
--
-- -- Após validar o backup acima, a remoção controlada (somente sob autorização):
-- -- DELETE FROM recommendations WHERE id IN (SELECT id FROM quarantine_p0_recommendations);
-- -- DELETE FROM reports WHERE id IN (SELECT id FROM quarantine_p0_reports);
-- -- DELETE FROM daily_metrics WHERE id IN (SELECT id FROM quarantine_p0_daily_metrics);
-- -- DELETE FROM campaigns WHERE id IN (SELECT id FROM quarantine_p0_campaigns);
-- -- DELETE FROM ad_accounts WHERE id IN (SELECT id FROM quarantine_p0_ad_accounts);
-- -- UPDATE sync_runs SET status = 'FAILED', error_code = 'QUARANTINED_SYNTHETIC_SYNC'
-- --   WHERE id IN (SELECT id FROM quarantine_p0_sync_runs);
--
-- COMMIT;
