-- Nitelikli ayrıntıları (2026-11-19): üç soruya "evet" denince bütçe (tutar + para birimi), proje yeri ve kurulum
-- zamanı (kaç ay içinde ya da hangi ay) zorunludur. Aşama olayının yanında jsonb olarak saklanır:
-- { budgetAmount, budgetCurrency, site, installMonths | null, installMonth "YYYY-MM" | null }.
-- Eski kayıtlarda ve otomatik doldurulan (auto_fill) olaylarda NULL kalır.
ALTER TABLE lead_stage_events ADD COLUMN qualification_details jsonb;
