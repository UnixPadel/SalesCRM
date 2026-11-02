# ADR-0013: Satış panosu veri modeli — Lead = fırsat, aktiviteler, kuruluşlar

- Durum: Kabul edildi
- Tarih: 2026-11-02
- Karar verenler: Yazılım (Elshan)

## Bağlam

Eski uygulama Pipedrive benzeri bir satış panosuydu: `organizations`, `contacts`, `leads` (form kaydı), `deals`
(fırsat, 5 kolon), `activities`, `deal_stage_changes`; JSON dosyasında (`server/data/crm.json`). Faz 1'de altı aşamalı
lead motoru Postgres üzerinde yazıldı; "Gelen kutusu", "Pano" ve lead detayı yeni modele geçti, "Bugün", "Kişiler"
ve "Raporlar" eski JSON'la askıda kaldı. Kullanıcının isteği: eski panonun davranış kurallarını (takipsiz fırsat,
teklif sonrası otomatik takip, kayıp nedeni, kolon istatistikleri, tek tıkla dönüştürme) yeni modelde geri
getirmek; Lead → CRM entegrasyonunu bozmadan. Kararlar `docs/yol-haritasi.md` bölüm 8'de.

## Karar

1. **Tek kayıt: Lead = fırsat.** Eski "form kaydı → fırsata çevir" ayrımı aşamaya karşılık gelir: `NEW` gelen
   kutusu, sonraki aşamalar pano. Ayrı `deals` tablosu açılmaz; `lead_stage_events` fırsat geçmişidir.
2. **Altı aşama kalır** (`STAGE_CODES`). Eski "Saha ziyareti" kolonu ve istenen "Negotiation" aşaması
   **aktivite** olarak izlenir; aşama motoru, seed'ler ve platform eşlemeleri değişmez.
3. **`activities` tablosu** (Faz 6a): lead'e bağlı yapılacak işler; tür listesi sabit (`call, email, meeting,
   proposal_sent, site_visit`), tamamlanan satır silinmez (`done_at`). Kural 1 (takipsiz) sorguyla hesaplanır,
   sütun tutulmaz: açık aşamada açık aktivitesi olmayan lead. Kural 2: `PROPOSAL`'a giriş aynı transaction'da
   3 gün sonra 09:00 (Europe/Istanbul) için arama açar; satır `created_by_change_id` taşır ve 10 dakikalık geri al
   onu siler. Aktivite aşamayı **değiştirmez**; aşama yalnız `ChangeLeadStage` ile değişir.
4. **`organizations` tablosu** (Faz 6d): kulüp / yatırımcı / distribütör / müteahhit; `persons.organization_id`
   ve `leads.organization_id`. Mevcut `company` metni geçiş süresince kalır, kuruluş eşleşince doldurulur.
5. **Fırsat alanları lead'de** (Faz 6b): `court_count`, `court_model`, `expected_close_date`; tutar aşama
   olayında kalır (Teklif ve Kazanıldı), ayrı sütun açılmaz. Kolon toplamı için kurlar **uygulama ayarıdır**
   (`UseCaseDeps.eurRates`, `EUR_RATES` ortam değişkeni; varsayılan USD 0,92 · GBP 1,17 · TRY 0,027), Faz 7'de
   ekrandan düzenlenir. `organization_id` bu fazda değil, 6d'de `organizations` tablosuyla birlikte gelir (ek, 2026-11-02).
6. **Saat dilimi** uygulama ayarıdır (`UseCaseDeps.timeZone`, varsayılan Europe/Istanbul): "bugün" ve "09:00"
   satış ekibinin takvimine göredir, sunucununkine değil.
7. Eski sayfalar ve `/api/db/*` yeni sayfalar yerine geçince kaldırılır (6d); eski aktiviteler ve kuruluşlar
   `db:migrate-legacy` ile taşınır.

## Seçenekler ve neden seçilmediği

| Seçenek | Neden seçilmedi |
|---|---|
| Eski `deals` tablosunu geri getirip lead'e bağlamak | İki kayıt, iki aşama alanı; platform sinyali lead aşamasına bağlı, çift gerçek doğar |
| "Negotiation" 7. aşama | Aşama motoru, 0002/0006/0008 seed'leri, Meta/Google eşlemeleri ve testler değişir; pazarlık zaten aktiviteyle izlenebilir. Satış isterse ADR-0006 güncellenir |
| Takipsiz bayrağını sütunda tutmak | Aktivite tamamlanınca/eklenince güncellenmesi gerekir; sorgu ucuz ve hep doğru |
| Aktivite tamamlanınca aşamayı ilerletmek | Aşama tek kapıdan değişir (Genel plan); arayüz kısayolu yine komutu çağırır |

## Sonuçlar

- Migration `0009_faz6a_activities.sql`; `ActivityRepository` portu; `AddActivity`, `SetActivityDone`,
  `DeleteActivity`, `ActivityQueries.today`; `LeadQueries.list/get` aktivite özeti döner (`LeadListItem`).
- API: `POST /leads/:id/activities`, `GET /activities/today`, `POST /activities/:id/done`, `DELETE /activities/:id`;
  `LeadListDto` özet alanları, `LeadDetailDto.activities`, aşama yanıtında `followUp`.
- Arayüz: "Bugün" yeni veriyle; Kanban kartında sonraki aktivite ya da "Takipsiz"; lead detayında aktivite paneli.
- Eski `src/pages/ActivitiesPage.tsx` kaldırıldı; `Header` rozeti yeni uçtan.
- **6b (2026-11-02):** migration `0010_faz6b_lead_fields.sql`; `domain/opportunity.ts` (`parseLeadFields`, `stageSummary`,
  `columnStats`, `parseEurRates`); `UpdateLeadFields`, `LeadQueries.board`; `GET /board`, `PATCH /leads/:id`,
  `reference.eurRates`; pano filtreleri URL'de ve hatırlanır. Rapor: `docs/faz6b-kabul-raporu.md`.
- **6c (2026-11-02):** raporlar `lead_stage_events`'ten (`domain/reports.ts`, `ReportQueries.summary`, `GET /reports`);
  eski JSON rapor sayfası kaldırıldı. Rapor: `docs/faz6c-kabul-raporu.md`.
- 6d bu ADR'nin 4 ve 7. maddelerini uygular.
