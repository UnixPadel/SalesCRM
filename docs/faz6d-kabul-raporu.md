# Faz 6d — Satış panosu: kuruluşlar, kişiler, eski panonun kaldırılması: kabul raporu

Tarih: 2026-11-02. Kapsam: `docs/yol-haritasi.md` bölüm 6, Faz 6d; ADR-0013 madde 4 ve 7. Bu fazla Faz 6 (satış
panosunun yeni modelde geri gelmesi) tamamlandı: arayüzde eski JSON verisine bağlı hiçbir ekran kalmadı.

## Görevler ve commit'ler

| Görev | Nerede | Commit |
|---|---|---|
| Migration `0011_faz6d_organizations.sql` (`organizations`; `persons.organization_id`, `leads.organization_id`; `activities.legacy_id`); `Organization` alan kuralları; portlar (`OrganizationRepository`, kişi listesi/güncelleme, lead kimlik güncelleme, `findByLegacyId`); Postgres ve bellek içi depolar | `db/migrations`, `sales-pipeline/domain/organization.ts`, `ports.ts`, `infrastructure/*`, `application/fakes.ts` | `67516d4` |
| `CreateOrganization`, `UpdateOrganization`, `UpdateLeadContact`, `PeopleQueries` (kuruluş özetleri, kişi listesi, arama); lead kuruluş bağı; API uçları | `sales-pipeline/application/organizations.ts`, `queries.ts`, `api/*` | `fa5713a` |
| `db:migrate-legacy`: kuruluşlar ve 28 eski aktivite | `bootstrap/migrateLegacy.ts`, `scripts/migrate-json-to-pg.ts` | `e7153a3` |
| Kişiler ve kuruluşlar sayfası, kimlik düzenleme, kuruluş seçimi, üst menü araması API'den; eski sayfalar, bileşenler, servisler, `/api/db/*` ve JSON deposu silindi | `src/pipeline/PeoplePage.tsx`, `OrganizationDialog.tsx`, `LeadContactForm.tsx`, `LeadFieldsForm.tsx`, `Header.tsx`, `state/CrmContext.tsx`, `server/index.mjs` | `761da7a` |
| Belgeler: bu rapor, README (eski pano bölümleri yeniden yazıldı), yol haritası, ADR-0013 eki, `.env.example` | `docs/`, `README.md` | (bu commit) |

## Kurallar ve doğrulama

| Konu | Kural | Nerede | Test |
|---|---|---|---|
| Kuruluş | Ad zorunlu (≤200), tür listeden (`club, investor, distributor, contractor, other`), ülke ISO-2, web ≤200, not ≤4000; **aynı ad + ülke tek kayıt** | `parseOrganizationFields`, `CreateOrganization`/`UpdateOrganization` (`organization.duplicate`), DB indeksi `organizations_name_country_uq` | `organization.test.ts`; `application.test.ts` "CreateOrganization…"; `infrastructure.test.ts` (teklik, CRUD); `api.test.ts` (201/403/422/404) |
| Lead ↔ kuruluş | `PATCH /leads/:id` `organizationId` ile bağlanır/çözülür; kuruluş yoksa `lead.organization_not_found`; `company` metni kalır | `parseLeadFields.organizationId`, `UpdateLeadFields`, `CreateLead` | `application.test.ts` "PeopleQueries…" (bilinmeyen kuruluş), `infrastructure.test.ts` |
| Kimlik düzenleme | Ad, e-posta, telefon; lead ve bağlı kişi **aynı transaction**; e-posta ya da telefondan biri kalır; başka kişiye kayıtlı e-posta/telefon reddedilir (`person.email_taken`, `person.phone_taken`); yetki aktivitelerle aynı | `UpdateLeadContact` | `application.test.ts` "UpdateLeadContact…"; `api.test.ts` (200/422/403) |
| Kişi ve kuruluş listeleri | Kayıtlar ekibin ortak defteri (herkes görür, görüntüleyici yazamaz); özetlerde yalnız **görünür** lead'ler sayılır (satışçı kendi + havuz) | `PeopleQueries.organizations/persons` | `application.test.ts` (rep-1 başkasının lead'ini saymaz, kişi görünür lead'i değil) |
| Arama | Üst menü: görünür lead'ler, kişiler, kuruluşlar; en az 2 karakter, her küme ≤ 6 | `PeopleQueries.search`, `GET /search` | `application.test.ts`, `api.test.ts` |
| Taşıma | Kuruluşlar `legacy_id` ile, aynı ad+ülke varsa ona bağlanır; kişi ve fırsat kuruluşa bağlanır; aktiviteler fırsatın lead'ine, `proforma_sent → proposal_sent`, `legacy_id` ile tekrar açılmaz; yeniden çalıştırma güvenli | `bootstrap/migrateLegacy.ts` | `migrateLegacy.test.ts` (3 kuruluş/1 çift, 3 aktivite/1 atlanan, ikinci çalıştırma) |

Gerçek dışa aktarımda kuru çalıştırma (`npm run db:migrate-legacy -- --dry-run`): 15 kuruluş, 960 form lead'i,
15 fırsat, 28 aktivite açılır; 0 atlanan. Sorumlu adları kullanıcı tablosundan çözüldü.

## Kaldırılanlar

- Arayüz: `src/pages/{ContactsPage, LeadsPage, PipelinePage, JourneyView, MapView}`, `dealStatus.ts`;
  `src/components/{DealPanel, NewDealDialog, MoveMenu, useStageMover, Stations, MailThread}`;
  `src/services/crmService.ts`; `src/data/{repository, httpRepository, seed}.ts`; `src/domain/rules.ts`;
  `src/seed/leads.json`. `src/domain/constants.ts` ve `types.ts` yalnız kabuğun kullandığı parçalarla kaldı
  (ülke adları, kort modelleri, kullanıcı tipleri).
- `CrmContext` yalnız oturum, tema ve balon; "örnek veriyi sıfırla" menüsü ve `#/leads` rotası kalktı.
- Sunucu: JSON deposu, `/api/db/*`, `/api/db-meta/*`. `server/data/crm.json` dosyası silinmez; yalnız
  `db:migrate-legacy` girdisidir (`CRM_DATA` ya da `--file`).
- `db/schema.sql` (eski deal modelinin Postgres taslağı; gerçek şema `db/migrations/*`). ADR-0002 tarihsel kayıt olarak ona
  atıf yapmaya devam eder.
- `npm run verify` uyarı sayısı 11 → 3 (eski koddaki uyarılar gitti).

## Test planı ve çıktı

```
npm run verify (2026-11-02, Faz 6d sonrası)
  lint 0 hata · 3 uyarı (önceden var olan) · Prettier temiz · tsc (iki proje) temiz
  · depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan) · secretlint temiz
  · 38 test dosyası / 385 test yeşil (6c sonu: 37 / 376)
```

Yeni ve güncellenen testler: `domain/organization.test.ts` (3), `application.test.ts` "Kuruluşlar ve kişiler (Faz 6d)"
(3), `api.test.ts` "kuruluşlar ve kişiler (Faz 6d)" (2), `infrastructure.test.ts` (+1), `migrateLegacy.test.ts`
(kuruluş + aktivite beklentileri), `migrate.test.ts` (11 migration, 17 tablo).

## Tarayıcı doğrulaması (yerel PGlite, `crm-test-login`, satışçı hesabı)

| Adım | Görülen |
|---|---|
| `#/contacts` (boş) | "Kuruluşlar 0 · Kişiler 8"; boş durum metni ve "Yeni kuruluş" düğmesi |
| Kuruluş açma ve lead bağlama (API'den; kullanıcı aynı anda tarayıcıda gezindiği için) | `POST /organizations` 201, `PATCH /leads/:id` 200; `GET /search?q=demir` → 1 lead, 1 kişi, 1 kuruluş |
| `#/contacts?q=demir` | Kuruluş satırı: Demir Spor Kulübü · Kulüp (satırdan değiştirilebilir) · Türkiye · 0 kişi · 1 açık lead · €95K · "Düzenle", "1 lead" |
| Kişiler sekmesi `?q=ayse` | Ayşe Demir · e-posta · telefon · ülke · lead çipi "Teklif gönderildi · Panoramik kort · €95K" |
| Lead detayı | Kişi panelinde "Kuruluş: Demir Spor Kulübü" (bağlantı Kişiler sayfasına), "Düzenle" düğmeleri |
| Konsol | Bu oturuma ait hata yok |

Not: "Yeni kuruluş" penceresi ve kimlik formu DOM'da doğrulandı (alanlar, tür ve ülke listeleri); gönderim API testleriyle.

## Kabul kriterleri (yol haritası, 6d)

| Kriter | Doğrulama |
|---|---|
| Eski JSON'a hiçbir ekran bağlı değil | `src/pages/*` yalnız `LoginPage`; `useCrm` veri taşımıyor; `/api/db/*` yok; depcruise temiz |
| Taşıma betiği testli | `migrateLegacy.test.ts` 3 test; gerçek veride kuru çalıştırma 0 atlanan |

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı saf ve testli (`organization.ts`; kimlik kuralları `UpdateLeadContact` içinde, bellek içi testli)
- [x] Dış bağımlılık port arkasında (`OrganizationRepository`, kişi/lead port eklemeleri; bellek içi + Postgres)
- [x] Tek transaction: kimlik güncellemesi lead + kişi birlikte; kuruluş oluşturma teklik kontrolüyle aynı transaction
- [x] Logda kişisel veri yok (kuruluş ve kimlik logları yalnız kimlikler)
- [x] Config ve secret kodda değil
- [x] Arayüz metinleri TR ve EN (`people.*`, `org.*`, `search.*`, `err.organization.*`, `err.person.*`)
- [x] ADR güncellendi (ADR-0013 eki)
- [x] Sözlük testi geçti

## Bilinen eksikler ve sonraki adımlar

1. **Kişi birleştirme** yok: başka kişiye kayıtlı e-posta/telefon reddedilir; iki kişi kaydını birleştirmek Faz 7
   yönetim paneline aday.
2. Kişi kaydının kendi düzenleme ekranı yok; ad/e-posta/telefon lead detayından güncellenir (kişiyle birlikte).
   Lead'siz kişi yok (kişiler lead'le oluşur), bu yüzden şimdilik yeterli.
3. Kuruluş silme yok (lead ve kişiler bağlı); gerekirse Faz 7'de "birleştir / arşivle".
4. Eski `legacy/` klasöründeki tek dosyalık takip sayfası depoda duruyor; canlıya alma öncesi silinir (Faz 8).
5. **Faz 7** (Genel plan Faz 6): alan eşleme ve ayar ekranları, outbox/inbox sağlık paneli, dead satırları yeniden
   kuyruğa alma, Google `requestStatus`, `EUR_RATES` ekrandan. **Faz 8:** hosting kararı sonrası canlıya alma
   (`db:migrate` + `db:migrate-legacy` gerçek Postgres'te).
