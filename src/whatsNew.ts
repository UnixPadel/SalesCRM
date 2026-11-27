import type { Lang } from "./i18n/lang";

/**
 * "Neler yeni" notları: satış ekibine giden güncelleme duyuruları. En yeni en üstte.
 *
 * Kural: satış ekibinin gördüğü ya da kullandığı bir şeyi değiştiren her commit buraya yeni bir not ekler (ya da
 * aynı günün notunu genişletir). Yeni notun `id`'si değişince program açılışta pencereyi her kullanıcıya bir kez
 * gösterir. Yalnız yöneticiyi ilgilendiren ya da görünmeyen (iç) değişiklikler buraya yazılmaz.
 *
 * Yazım: her değişiklik tek madde, metni tek cümle. Başlık en çok WHATS_NEW_TITLE_MAX_WORDS, metin en çok
 * WHATS_NEW_TEXT_MAX_WORDS kelime (Türkçede ~15 hedeflenir). Yönetici ve satış personelinin anlayacağı sade dil:
 * teknik terim yok, "ne değişti, ne yapmalıyım". Ekrandaki düğme ve aşama adları aynen yazılır. Kullanıcının bir şey
 * yapması gerekmeyen küçük düzeltmeler ve ayrıntılar yazılmaz.
 */
export const WHATS_NEW_TITLE_MAX_WORDS = 6;
export const WHATS_NEW_TEXT_MAX_WORDS = 24;

export interface WhatsNewItem {
  title: string;
  text: string;
}

export interface WhatsNewRelease {
  /** Benzersiz ve sıralı: "YYYY-MM-DD" (aynı gün ikinci not "YYYY-MM-DD-2"). */
  id: string;
  /** Takvim günü, YYYY-MM-DD. */
  date: string;
  items: Record<Lang, WhatsNewItem[]>;
}

export const WHATS_NEW: readonly WhatsNewRelease[] = [
  {
    id: "2026-11-27-2",
    date: "2026-11-27",
    items: {
      tr: [
        {
          title: "İşlemleriniz kayıt altında",
          text: "CRM'de yaptığınız her işlem, giriş dahil, adınız ve saatiyle kaydedilir; kayıtlar silinemez ve değiştirilemez.",
        },
      ],
      en: [
        {
          title: "Your actions are recorded",
          text: "Every action you take in the CRM, sign-ins included, is recorded with your name and time; records cannot be deleted or changed.",
        },
      ],
      ar: [
        {
          title: "إجراءاتك مسجّلة",
          text: "كل إجراء تقوم به في النظام، بما في ذلك تسجيل الدخول، يُسجَّل باسمك ووقته؛ ولا يمكن حذف السجلات أو تعديلها.",
        },
      ],
    },
  },
  {
    id: "2026-11-27",
    date: "2026-11-27",
    items: {
      tr: [
        {
          title: "UnixPadelST'ye gitmek için ülke gerekli",
          text: "Nitelikli lead UnixPadelST müşteri listesine ancak ülkesi girilmişse gider; ülkeyi girdiğinizde birkaç dakika içinde orada görünür.",
        },
      ],
      en: [
        {
          title: "UnixPadelST needs the lead's country",
          text: "A qualified lead goes to the UnixPadelST customer list only once it has a country; add it and it appears within minutes.",
        },
      ],
      ar: [
        {
          title: "الدولة مطلوبة للإرسال إلى UnixPadelST",
          text: "العميل المؤهل يُضاف إلى قائمة عملاء UnixPadelST فقط بعد إدخال دولته؛ أدخلها وسيظهر خلال دقائق.",
        },
      ],
    },
  },
  {
    id: "2026-11-26-2",
    date: "2026-11-26",
    items: {
      tr: [
        {
          title: "Web formunda doğru ülke ve telefon",
          text: "Web sitesinden gelen lead'lerde ülke ve telefon artık müşterinin formda yazdığı ülkeye göre kaydediliyor.",
        },
      ],
      en: [
        {
          title: "Correct country and phone from website",
          text: "Website leads now get their country and phone from the country the customer wrote on the form.",
        },
      ],
      ar: [
        {
          title: "دولة وهاتف صحيحان من الموقع",
          text: "العملاء المحتملون من الموقع يُسجَّل لهم الآن الدولة والهاتف حسب الدولة التي كتبها العميل في النموذج.",
        },
      ],
    },
  },
  {
    id: "2026-11-26",
    date: "2026-11-26",
    items: {
      tr: [
        {
          title: "Bütün ülkeler listede",
          text: "Ülke seçerken ve filtrelerken artık dünyadaki bütün ülkeler listede çıkar.",
        },
      ],
      en: [
        {
          title: "Every country is listed",
          text: "When you pick or filter by country, every country in the world now appears in the list.",
        },
      ],
      ar: [
        {
          title: "كل الدول في القائمة",
          text: "عند اختيار الدولة أو التصفية بها تظهر الآن كل دول العالم في القائمة.",
        },
      ],
    },
  },
  {
    id: "2026-11-25-3",
    date: "2026-11-25",
    items: {
      tr: [
        {
          title: "Yapılacak işi düzenleyin",
          text: "Açık bir işin türünü, konusunu, tarihini ya da notunu kalem simgesiyle değiştirin; silip yeniden eklemeniz gerekmez.",
        },
      ],
      en: [
        {
          title: "Edit your open tasks",
          text: "Change an open task's type, subject, date or note with the pencil icon; no need to delete and add it again.",
        },
      ],
      ar: [
        {
          title: "عدّل مهامك المفتوحة",
          text: "غيّر نوع المهمة المفتوحة أو موضوعها أو تاريخها أو ملاحظتها برمز القلم، دون حذفها وإضافتها من جديد.",
        },
      ],
    },
  },
  {
    id: "2026-11-25-2",
    date: "2026-11-25",
    items: {
      tr: [
        {
          title: "Nitelikli lead UnixPadelST'de müşteri olur",
          text: "Lead Nitelikli, Teklif gönderildi ya da Kazanıldı olunca en geç 15 dakika içinde UnixPadelST müşteri listenizde görünür.",
        },
      ],
      en: [
        {
          title: "Qualified leads become UnixPadelST customers",
          text: "When a lead reaches Qualified, Proposal sent or Won, it appears in your UnixPadelST customer list within 15 minutes.",
        },
      ],
      ar: [
        {
          title: "العميل المؤهل يظهر في UnixPadelST",
          text: "عندما يصبح العميل مؤهلاً أو أُرسل له عرض أو تم الفوز به، يظهر في قائمة عملائك في UnixPadelST خلال 15 دقيقة.",
        },
      ],
    },
  },
  {
    id: "2026-11-25",
    date: "2026-11-25",
    items: {
      tr: [
        {
          title: "Görüşme notu artık isteğe bağlı",
          text: "İletişim kaydederken not yazmadan da kaydedebilirsiniz; önemli bir ayrıntı varsa yine not eklemenizi öneririz.",
        },
      ],
      en: [
        {
          title: "Contact note is now optional",
          text: "You can save a contact without writing a note; we still recommend adding one when there is an important detail.",
        },
      ],
      ar: [
        {
          title: "ملاحظة التواصل أصبحت اختيارية",
          text: "يمكنك حفظ التواصل دون كتابة ملاحظة؛ ونوصي بإضافتها عند وجود تفصيل مهم.",
        },
      ],
    },
  },
  {
    id: "2026-11-24-4",
    date: "2026-11-24",
    items: {
      tr: [
        {
          title: "Lead'leri yalnız yönetici siler",
          text: "Çift ya da yanlış bir lead görürseniz yöneticiye söyleyin; silmeyi ve geri almayı yalnız yönetici yapar.",
        },
      ],
      en: [
        {
          title: "Only the admin deletes leads",
          text: "Report duplicate or wrong leads to the admin; only the admin can delete or restore them.",
        },
      ],
      ar: [
        {
          title: "الحذف للمدير فقط",
          text: "أبلغ المدير عن أي عميل مكرر أو خاطئ؛ المدير وحده يحذفه أو يستعيده.",
        },
      ],
    },
  },
  {
    id: "2026-11-24-3",
    date: "2026-11-24",
    items: {
      tr: [
        {
          title: "WhatsApp ve telefonda ekran görüntüsü zorunlu",
          text: "WhatsApp ve telefon kayıtlarına ve son aşamalara geçerken ekran görüntüsü ekleyin (Win+Shift+S, sonra Ctrl+V).",
        },
        {
          title: "Hızlı kayıt pencere açar",
          text: "WhatsApp ve aramadan sonraki hızlı kayıt düğmesi artık görüntü ekleyebileceğiniz kayıt penceresini açar.",
        },
      ],
      en: [
        {
          title: "Screenshot required for WhatsApp and calls",
          text: "Add a screenshot to WhatsApp and phone records and when moving to later stages (Win+Shift+S, then Ctrl+V).",
        },
        {
          title: "Quick log opens the window",
          text: "The quick log button after WhatsApp or a call now opens the Log contact window for the screenshot.",
        },
      ],
      ar: [
        {
          title: "لقطة الشاشة إلزامية لواتساب والهاتف",
          text: "أضف لقطة شاشة لسجلات واتساب والهاتف وعند النقل إلى المراحل المتقدمة (Win+Shift+S ثم Ctrl+V).",
        },
        {
          title: "التسجيل السريع يفتح النافذة",
          text: "زر التسجيل السريع بعد واتساب أو الاتصال يفتح الآن نافذة «تسجيل تواصل» لإضافة اللقطة.",
        },
      ],
    },
  },
  {
    id: "2026-11-24-2",
    date: "2026-11-24",
    items: {
      tr: [
        {
          title: "Ortak havuz herkese açık",
          text: "Ortak havuzdaki lead'leri herkes görür; aşamasını değiştirir ya da kayıt girerseniz lead size geçer.",
        },
      ],
      en: [
        {
          title: "Shared pool visible to everyone",
          text: "Everyone sees shared pool leads; change the stage or log a contact to make one yours.",
        },
      ],
      ar: [
        {
          title: "المجموعة المشتركة مرئية للجميع",
          text: "يرى الجميع عملاء المجموعة المشتركة؛ غيّر المرحلة أو سجّل تواصلًا لينتقل العميل إليك.",
        },
      ],
    },
  },
  {
    id: "2026-11-24",
    date: "2026-11-24",
    items: {
      tr: [
        {
          title: "Aşama değişirken iletişim sorusu",
          text: "Kaydı olmayan bir lead'i ilerletirken pencere müşteriye nereden ve ne zaman ulaştığınızı sorar.",
        },
        {
          title: '"Dönüş alındı mı?" sorusu',
          text: 'İletişim kaydında Evet ya da Hayır seçin; Evet, aşamayı "İletişim kuruldu" yapar.',
        },
        {
          title: '"Kayıt yok (eski)" durumu',
          text: 'Kaydı eksik eski lead\'lerde "İletişim kaydet" ile kaydı girince durum "Ulaşıldı" olur.',
        },
      ],
      en: [
        {
          title: "Contact details when changing stage",
          text: "Moving a lead with no contact record forward now asks how and when you reached the customer.",
        },
        {
          title: '"Did the customer reply?" question',
          text: 'Pick Yes or No when logging a contact; Yes moves the stage to "Contacted".',
        },
        {
          title: '"No record (legacy)" status',
          text: 'For older leads with no record, enter one with "Log contact" and the status becomes "Reached".',
        },
      ],
      ar: [
        {
          title: "بيانات التواصل عند تغيير المرحلة",
          text: "عند تقديم عميل بلا سجل تواصل تسألك النافذة عن قناة التواصل ووقته.",
        },
        {
          title: "سؤال «هل ردّ العميل؟»",
          text: "اختر «نعم» أو «لا» عند تسجيل التواصل؛ و«نعم» تنقل المرحلة إلى «تم التواصل».",
        },
        {
          title: "حالة «لا سجل (قديم)»",
          text: "للعملاء القدامى بلا سجل، أدخل السجل عبر «تسجيل تواصل» فتصبح الحالة «تم التواصل».",
        },
      ],
    },
  },
  {
    id: "2026-11-23-2",
    date: "2026-11-23",
    items: {
      tr: [
        {
          title: "Daha fazla bildirim",
          text: "Zil artık yeni lead'iniz, tekrar gelen form, saati gelen iş ve bekleyen sıcak lead için de çalar.",
        },
        {
          title: "Program kapalıyken de bildirim",
          text: 'Zile tıklayıp "Bu Cihazda Aç"a basın ve izin verin; iPhone\'da önce ana ekrana ekleyin.',
        },
      ],
      en: [
        {
          title: "More notifications",
          text: "The bell now also rings for new leads, repeat forms, due tasks and waiting hot leads.",
        },
        {
          title: "Notifications when the app is closed",
          text: 'Click the bell, press "Turn On Here" and allow it; on iPhone, add the app to the home screen first.',
        },
      ],
      ar: [
        {
          title: "إشعارات أكثر",
          text: "يرنّ الجرس الآن أيضًا للعملاء الجدد والنماذج المكررة والمهام المستحقة والعملاء الساخنين المنتظرين.",
        },
        {
          title: "إشعارات والبرنامج مغلق",
          text: "انقر الجرس ثم «تفعيل على هذا الجهاز» واسمح بالإشعارات؛ وعلى iPhone أضف البرنامج للشاشة الرئيسية أولًا.",
        },
      ],
    },
  },
  {
    id: "2026-11-23",
    date: "2026-11-23",
    items: {
      tr: [
        {
          title: "Yeni yazı tipi",
          text: "Yazı tipi değişti; İ harfi, ₺ işareti ve tutarlar daha düzgün görünür.",
        },
        {
          title: "Sütun gizleme başlıkta",
          text: "Sütunu gizlemek için başlıktaki göz simgesine tıklayın.",
        },
      ],
      en: [
        {
          title: "New typeface",
          text: "The new typeface shows İ, ₺ and amounts more neatly.",
        },
        {
          title: "Hide-column button in the header",
          text: "To hide a column, click the eye icon in its header.",
        },
      ],
      ar: [
        {
          title: "خط جديد",
          text: "الخط الجديد يعرض الحرف İ وعلامة ₺ والمبالغ بشكل أوضح.",
        },
        {
          title: "زر إخفاء العمود في الرأس",
          text: "لإخفاء عمود انقر رمز العين في رأسه.",
        },
      ],
    },
  },
  {
    id: "2026-11-20",
    date: "2026-11-20",
    items: {
      tr: [
        {
          title: "Özet rapor yeniden görünüyor",
          text: '"Özet Rapor" düğmesi Raporlar sayfasının üstünde yeniden görünüyor.',
        },
        {
          title: "Bağlantı koptuğunda lead sayfası",
          text: 'Bağlantı koparsa lead sayfası "Tekrar Dene" düğmesi gösterir.',
        },
        {
          title: "Program Bugün sayfasıyla açılır",
          text: "Program gecikmiş ve bugünkü işlerinizi gösteren Bugün sayfasıyla açılır.",
        },
        {
          title: "Lead listesi sadeleşti",
          text: 'Ulaşım, Teklif ve Form cevapları tek "Özet" sütununda; açmak için başlıktaki oka basın.',
        },
        {
          title: "Satırlarda daha az düğme",
          text: "Ara, E-posta ve WhatsApp artık simge; adını görmek için üzerine gelin.",
        },
        {
          title: "Yana kaydırırken arama yerinde kalır",
          text: "Listeyi sağa kaydırınca arama kutusu ve süzgeçler ekranda kalır.",
        },
      ],
      en: [
        {
          title: "Summary report is back",
          text: 'The "Summary Report" button is back at the top of the Reports page.',
        },
        {
          title: "Lead page when the connection drops",
          text: 'If the connection drops, the lead page shows a "Retry" button.',
        },
        {
          title: "The app opens on Today",
          text: "The app opens on Today, showing overdue and today's tasks.",
        },
        {
          title: "A simpler lead list",
          text: 'Reach, Proposal and Form answers sit in one "Summary" column; tap the header arrow to open them.',
        },
        {
          title: "Fewer buttons in each row",
          text: "Call, Email and WhatsApp are now icons; hover to see the name.",
        },
        {
          title: "Search stays put when scrolling sideways",
          text: "When you scroll the list sideways, search and filters stay on screen.",
        },
      ],
      ar: [
        {
          title: "التقرير الملخّص ظاهر من جديد",
          text: 'زر "التقرير الملخّص" ظاهر من جديد أعلى صفحة التقارير.',
        },
        {
          title: "صفحة العميل عند انقطاع الاتصال",
          text: 'إذا انقطع الاتصال تعرض صفحة العميل زر "إعادة المحاولة".',
        },
        {
          title: "يبدأ البرنامج بصفحة اليوم",
          text: "يفتح البرنامج على صفحة اليوم بالمهام المتأخرة ومهام اليوم.",
        },
        {
          title: "قائمة عملاء أبسط",
          text: 'التواصل وعرض السعر وإجابات النموذج في عمود "ملخص"؛ اضغط سهم العنوان لفتحها.',
        },
        {
          title: "أزرار أقل في كل صف",
          text: "الاتصال والبريد وواتساب أصبحت أيقونات؛ مرّر المؤشر لرؤية الاسم.",
        },
        {
          title: "البحث يبقى ظاهرًا عند التمرير",
          text: "عند تمرير القائمة جانبيًا يبقى البحث والتصفية ظاهرين.",
        },
      ],
    },
  },
  {
    id: "2026-11-19-2",
    date: "2026-11-19",
    items: {
      tr: [
        {
          title: "Telefonda rahat kullanım",
          text: "Program telefona uyar; sayfalar ekranın altındaki menüdedir.",
        },
        {
          title: "Telefonda arama",
          text: "Üstteki büyütece dokunup ad, telefon ya da firma yazın.",
        },
        {
          title: "Lead listesi telefonda kartlar",
          text: 'Telefonda her lead bir kart; Ara, WhatsApp ve "İletişim kaydet" karttan çalışır.',
        },
        {
          title: "Kartı aşamaya taşı",
          text: "Panoda kartın altındaki ↔ düğmesiyle yeni aşamayı seçin.",
        },
      ],
      en: [
        {
          title: "Works on your phone",
          text: "The app fits phone screens, with the pages in a menu at the bottom.",
        },
        {
          title: "Search on your phone",
          text: "Tap the magnifier at the top and type a name, phone or company.",
        },
        {
          title: "Leads as cards on your phone",
          text: 'On a phone each lead is a card with Call, WhatsApp and "Log contact" on it.',
        },
        {
          title: "Move a card to a stage",
          text: "On the Board, tap ↔ on a card and pick the new stage.",
        },
      ],
      ar: [
        {
          title: "يعمل على هاتفك",
          text: "البرنامج مناسب لشاشة الهاتف، والصفحات في القائمة أسفل الشاشة.",
        },
        {
          title: "البحث على الهاتف",
          text: "اضغط العدسة في الأعلى واكتب اسمًا أو رقم هاتف أو شركة.",
        },
        {
          title: "العملاء كبطاقات على الهاتف",
          text: "على الهاتف كل عميل بطاقة فيها أزرار الاتصال وواتساب وتسجيل التواصل.",
        },
        {
          title: "نقل البطاقة إلى مرحلة",
          text: "في اللوحة اضغط ↔ على البطاقة واختر المرحلة الجديدة.",
        },
      ],
    },
  },
  {
    id: "2026-11-19",
    date: "2026-11-19",
    items: {
      tr: [
        {
          title: "Ürünler tek sütunda",
          text: '"Ürünler" sütunu istenen ürünleri adetleriyle gösterir; hepsini görmek için "+1" üzerine gelin.',
        },
        {
          title: "Ürün nasıl eklenir",
          text: "Ürünler hücresine tıklayın, ürünü işaretleyip adedi ayarlayın ve Kaydet'e basın.",
        },
        {
          title: "Bütün ürünler seçilebilir",
          text: "Listede artık şirketin bütün ürünleri var.",
        },
        {
          title: 'Eski "Kapatma" işaretleri',
          text: 'Eski "Kapatma" işaretleri "Padel Court Cover" oldu; müşteriyle konuşunca doğru ürünü seçin.',
        },
        {
          title: "Telefon tek yerde",
          text: "Numara, WhatsApp ve Ara düğmeleri adın yanında tek hücrede.",
        },
        {
          title: "Dönüşler kanalın içinde",
          text: 'Müşteri döndüyse kanal hücresinde "dönüş" ve tarih yazar.',
        },
      ],
      en: [
        {
          title: "Products in one column",
          text: 'The "Products" column shows products with quantities; hover over "+1" to see them all.',
        },
        {
          title: "How to add a product",
          text: "Click the Products cell, tick the product, set the quantity and press Save.",
        },
        {
          title: "Every product can be chosen",
          text: "All company products are now in the list.",
        },
        {
          title: 'Old "Cover" ticks',
          text: 'Old "Cover" ticks became "Padel Court Cover"; pick the right product after talking to the customer.',
        },
        {
          title: "Phone in one place",
          text: "Number, WhatsApp and Call sit in one cell next to the name.",
        },
        {
          title: "Replies inside the channel",
          text: 'If the customer replied, the channel cell shows "reply" and the date.',
        },
      ],
      ar: [
        {
          title: "المنتجات في عمود واحد",
          text: "عمود «المنتجات» يعرض المنتجات بكمياتها؛ مرّر الفأرة فوق «+1» لرؤيتها كلها.",
        },
        {
          title: "كيف تضيف منتجًا",
          text: "انقر خلية المنتجات، وحدّد المنتج واضبط الكمية، ثم اضغط حفظ.",
        },
        {
          title: "كل المنتجات متاحة",
          text: "كل منتجات الشركة في القائمة الآن.",
        },
        {
          title: "علامات «التغطية» القديمة",
          text: "علامات «تغطية» القديمة أصبحت «Padel Court Cover»؛ اختر المنتج الصحيح بعد الحديث مع العميل.",
        },
        {
          title: "الهاتف في مكان واحد",
          text: "الرقم وزرّا واتساب والاتصال في خلية واحدة بجانب الاسم.",
        },
        {
          title: "الردود داخل القناة",
          text: "إذا ردّ العميل تظهر «رد» والتاريخ في خلية القناة.",
        },
      ],
    },
  },
];

export const LATEST_WHATS_NEW = WHATS_NEW[0]?.id ?? null;
