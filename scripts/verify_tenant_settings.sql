-- ============================================================================
-- NORIA / Gênesis: Consulta de Conferência de Configurações de Tenants
-- Corrige a leitura: tenant_settings é vinculada a tenants via tenant_id.
-- Lê timezone e business_hours de tenant_settings e slugs reais de produção.
-- Slugs autorizados: 'wesley_automoveis' (Gênesis) e 'clinica_nubia_oficial' (Núbia).
-- ============================================================================

SELECT 
    t.id AS tenant_id,
    t.slug,
    t.name,
    ts.timezone,
    ts.business_hours,
    ts.settings->'sales'->'hot_lead_rule' AS hot_lead_rule,
    ts.settings->'sales'->'stages'->'sales_financing' AS sales_financing_stage_config,
    ts.settings->'sales'->'stages'->'sales_qualifying' AS sales_qualifying_stage_config,
    ts.settings->'sales'->'stages'->'sales_human' AS sales_human_stage_config
FROM public.tenants t
LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
WHERE t.slug IN ('wesley_automoveis', 'clinica_nubia_oficial')
ORDER BY t.slug;
