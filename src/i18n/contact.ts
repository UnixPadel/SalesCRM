/**
 * Temas kaydı ve satış takip metinleri (Faz 7g, iş emri §5.10); `index.tsx` sözlüğe yayar. S2'de yalnız domain
 * kurallarının hata kodları (`err.contact.*`, `err.product.*`) var; arayüz metinleri S8'de bu dosyaya eklenir.
 */
export const CONTACT_DICT = {
  "err.contact.type": ["Bu tür temas kanalı olarak seçilemez.", "This type cannot be used as a contact channel."],
  "err.contact.outcome": ["Temas sonucunu seçin.", "Choose the contact outcome."],
  "err.contact.replied_flag": [
    '"Müşteri cevap verdi" yalnız Takip edilecek ve Teklif gönderildi sonuçlarında seçilir.',
    '"Customer replied" applies only to To follow up and Proposal sent.',
  ],
  "err.contact.occurred_invalid": ["Temas zamanı geçersiz.", "The contact time is invalid."],
  "err.contact.future": ["İleri bir saat seçilemez.", "A future time cannot be chosen."],
  "err.contact.too_old": ["Temas tarihi 01.01.2024'ten önce olamaz.", "The contact date cannot be before 01.01.2024."],
  "err.contact.note_too_long": ["Görüşme notu en fazla 4000 karakter.", "The note is at most 4000 characters."],
  "err.contact.activity_not_open": [
    "Tamamlanacak iş artık açık değil; listeyi yenileyin.",
    "The task to complete is no longer open; refresh the list.",
  ],
  "err.contact.next_past": [
    "Sonraki takip geçmiş bir zamana planlanamaz.",
    "The next follow-up cannot be in the past.",
  ],
  "err.contact.next_with_stage": [
    "Bu aşamada sonraki takip ayrıca planlanmaz.",
    "No separate follow-up is planned for this stage.",
  ],
  "err.contact.proposal_stage_required": [
    "Teklif gönderildiyse aşama 'Teklif' olmalı.",
    "If a proposal was sent, the stage must be 'Proposal'.",
  ],
  "err.contact.stage_not_allowed": [
    "Bu sonuçla bu aşamaya geçilemez.",
    "This outcome cannot move the lead to that stage.",
  ],
  "err.contact.undo_expired": ["Geri alma süresi doldu.", "The undo window has passed."],
  "err.contact.reopen_logged": [
    "Temas kaydı yeniden açılmaz; geri alın ya da silin.",
    "A logged contact cannot be reopened; undo or delete it.",
  ],
  "err.lead.customer_status": ["Müşteri durumu listede yok.", "This customer status is not in the list."],
  "err.warning.code": ["Bilinmeyen uyarı kodu.", "Unknown warning code."],
  "err.undo.stale": [
    "Aşama bu kayıttan sonra yeniden değişti; aşama geri alınmadı.",
    "The stage changed again after this entry; the stage was not undone.",
  ],
  "err.court_count.derived": [
    "Kort sayısı ürün adetlerinden gelir; ürünleri düzenleyin.",
    "The court count comes from product quantities; edit the products.",
  ],
  "err.history.range": ["Tarih aralığı geçersiz.", "The date range is invalid."],
  "err.report.range": ["Tarih aralığı geçersiz.", "The date range is invalid."],
  "err.product.invalid": ["Ürün tercihleri okunamadı.", "Product preferences could not be read."],
  "err.product.qty_range": ["Adet 1 ile 29 arasında tam sayı olmalı.", "Quantity must be a whole number from 1 to 29."],
  "err.product.roof_size": [
    "Çatı ölçüsü 0'dan büyük ve en fazla 999,99 m olmalı.",
    "Roof size must be greater than 0 and at most 999.99 m.",
  ],
  "err.product.roof_dims_without_roof": [
    "Çatı ölçüsü için Kapatma'yı işaretleyin.",
    "Tick Cover (roof) to enter a roof size.",
  ],
} as const satisfies Record<string, readonly [string, string]>;
