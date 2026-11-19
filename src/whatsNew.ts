import type { Lang } from "./i18n/lang";

/**
 * "Neler yeni" notları: satış ekibine giden güncelleme duyuruları. En yeni en üstte.
 *
 * Kural: satış ekibinin gördüğü ya da kullandığı bir şeyi değiştiren her commit buraya yeni bir not ekler (ya da
 * aynı günün notunu genişletir). Yeni notun `id`'si değişince program açılışta pencereyi her kullanıcıya bir kez
 * gösterir. Dil sade olur: teknik terim yok, "ne değişti, nerede, ne yapmalıyım". Yalnız yöneticiyi ilgilendiren ya
 * da görünmeyen (iç) değişiklikler buraya yazılmaz.
 */
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
    id: "2026-11-19-2",
    date: "2026-11-19",
    items: {
      tr: [
        {
          title: "Telefonda rahat kullanım",
          text: "Program artık telefonda da düzgün açılır. Sayfalar (Lead listesi, Pano, Bugün, Kişiler, Raporlar) ekranın altındaki menüdedir; başparmağınızla geçebilirsiniz.",
        },
        {
          title: "Telefonda arama",
          text: "Üstteki büyütece dokunun, ad, telefon ya da firma yazın. Sonuca dokununca lead açılır.",
        },
        {
          title: "Lead listesi telefonda kartlar",
          text: 'Telefonda her lead bir kart olarak görünür: ad, aşama, sorumlu, tarih ve ürünler. Karttan doğrudan Ara, WhatsApp ya da "İletişim kaydet"e basabilirsiniz; karta dokununca lead açılır. "Sırala" kutusuyla en yeni, en eski ya da ada göre sıralayın.',
        },
        {
          title: "Kartı aşamaya taşı",
          text: "Pano kartlarının sağ altındaki ↔ düğmesine basıp yeni aşamayı seçin. Sürüklemek yerine bu düğme telefonda ve tablette de çalışır. Telefonda panonun üstündeki aşama düğmeleriyle sütunlar arasında geçin.",
        },
        {
          title: "Pencereler telefona uygun",
          text: "İletişim kaydı ve yeni lead gibi pencereler telefonda ekranın altından açılır; Kaydet düğmesi hep görünür kalır.",
        },
      ],
      en: [
        {
          title: "Works on your phone",
          text: "The app now fits phone screens. The pages (Lead list, Board, Today, Contacts, Reports) are in the menu at the bottom of the screen, within reach of your thumb.",
        },
        {
          title: "Search on your phone",
          text: "Tap the magnifier at the top and type a name, phone number or company. Tap a result to open the lead.",
        },
        {
          title: "Lead list as cards on your phone",
          text: 'On a phone each lead is a card with its name, stage, owner, date and products. Call, WhatsApp and "Log contact" work straight from the card; tap the card to open the lead. Use "Sort" to show newest, oldest or by name.',
        },
        {
          title: "Move a card to a stage",
          text: "On the Board, tap the ↔ button at the bottom of a card and pick the new stage. It does the same as dragging and also works on phones and tablets. On a phone, use the stage buttons above the board to switch columns.",
        },
        {
          title: "Windows fit your phone",
          text: "Windows such as Log contact and New lead open from the bottom of the screen on a phone, and the Save button always stays visible.",
        },
      ],
      ar: [
        {
          title: "يعمل على هاتفك",
          text: "أصبح البرنامج مناسبًا لشاشة الهاتف. الصفحات (قائمة العملاء، اللوحة، اليوم، جهات الاتصال، التقارير) في القائمة أسفل الشاشة، في متناول إبهامك.",
        },
        {
          title: "البحث على الهاتف",
          text: "اضغط على العدسة في الأعلى واكتب اسمًا أو رقم هاتف أو شركة. اضغط على النتيجة لفتح العميل.",
        },
        {
          title: "قائمة العملاء كبطاقات على الهاتف",
          text: "على الهاتف يظهر كل عميل كبطاقة فيها الاسم والمرحلة والمسؤول والتاريخ والمنتجات. يمكنك الاتصال أو فتح واتساب أو تسجيل التواصل من البطاقة مباشرة، والضغط على البطاقة يفتح العميل. استخدم «ترتيب» للعرض حسب الأحدث أو الأقدم أو الاسم.",
        },
        {
          title: "نقل البطاقة إلى مرحلة",
          text: "في اللوحة، اضغط على زر ↔ أسفل البطاقة واختر المرحلة الجديدة. يقوم بنفس عمل السحب ويعمل أيضًا على الهاتف والجهاز اللوحي. على الهاتف، استخدم أزرار المراحل أعلى اللوحة للتنقل بين الأعمدة.",
        },
        {
          title: "نوافذ مناسبة للهاتف",
          text: "النوافذ مثل تسجيل التواصل وعميل جديد تُفتح من أسفل الشاشة على الهاتف، ويبقى زر الحفظ ظاهرًا دائمًا.",
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
          text: 'Lead listesindeki "Ürünler" sütunu müşterinin istediği ürünleri adetleriyle yazar, örneğin "2 Standard Padel Court · 1 Padel Court Cover". İkiden fazla ürün varsa yanında "+1" gibi bir sayı çıkar; fareyle üstüne gelince hepsini görürsünüz.',
        },
        {
          title: "Ürün nasıl eklenir",
          text: "Ürünler hücresine tıklayın. Açılan listede ürünün yanındaki kutuyu işaretleyin, adedi − ve + düğmeleriyle ayarlayın, Kaydet'e basın. Üstteki arama kutusuna ürün adını yazarak hızlıca bulabilirsiniz. Ürünleri lead'in sorumlusu girer; havuzdaki bir lead'e girmek için önce lead'i üstlenin.",
        },
        {
          title: "Bütün ürünler seçilebilir",
          text: "Artık yalnız üç kort değil, şirketin bütün ürünleri listede: kortlar, kapatma ve tavan sistemleri, Padbol, Pickleball ve diğerleri.",
        },
        {
          title: 'Eski "Kapatma" işaretleri',
          text: 'Daha önce "Kapatma" işaretli olan lead\'lere 1 adet "Padel Court Cover" yazıldı ve notlarına "Eski kayıt: kapatma istedi" eklendi. Müşteriyle konuşunca doğru kapatma ürününü seçip düzeltin.',
        },
        {
          title: "Telefon tek yerde",
          text: "Numara, WhatsApp ve Ara düğmeleri artık aynı hücrede, adın hemen yanında. Arama kutusunda numarayı boşluklu (532 123) ya da bitişik yazarak bulabilirsiniz.",
        },
        {
          title: "Dönüşler kanalın içinde",
          text: 'Ayrı "dönüş" sütunları kalktı. Müşteri döndüyse Mail, WhatsApp ya da Diğer kanal hücresinde ✔ işaretinin altında "dönüş" ve tarih yazar. Sadece dönenleri görmek için sütun menüsünde "Dönüş alındı"yı seçin.',
        },
        {
          title: "Kort sayısı ayrı",
          text: 'Müşterinin formda yazdığı kort sayısı yalnız "Kort sayısı" sütununda görünür; Ürünler sütununa karışmaz.',
        },
      ],
      en: [
        {
          title: "Products in one column",
          text: 'The "Products" column in the lead list shows what the customer wants, with quantities, e.g. "2 Standard Padel Court · 1 Padel Court Cover". If there are more than two, a number like "+1" appears; hover over it to see them all.',
        },
        {
          title: "How to add a product",
          text: "Click the Products cell. Tick the box next to the product, set the quantity with − and +, and press Save. Type a product name in the search box at the top to find it quickly. The lead's owner enters products; take a pool lead first.",
        },
        {
          title: "Every product can be chosen",
          text: "Not just three courts any more: all company products are in the list — courts, covers and roof systems, Padbol, Pickleball and more.",
        },
        {
          title: 'Old "Cover" ticks',
          text: 'Leads that had "Cover" ticked now have 1 "Padel Court Cover", and their notes say "Eski kayıt: kapatma istedi" (old record: wanted a cover). After talking to the customer, pick the right cover product.',
        },
        {
          title: "Phone in one place",
          text: "The number, WhatsApp and Call buttons are now in one cell next to the name. In the search box you can type the number with or without spaces.",
        },
        {
          title: "Replies inside the channel",
          text: 'The separate "reply" columns are gone. If the customer replied, the Email, WhatsApp or Other channel cell shows "reply" and the date under the ✔. To see only replies, choose "Reply received" in the column menu.',
        },
        {
          title: "Court count kept apart",
          text: 'The number of courts the customer wrote on the form shows only in the "Courts" column, not in Products.',
        },
      ],
      ar: [
        {
          title: "المنتجات في عمود واحد",
          text: "يعرض عمود «المنتجات» في قائمة العملاء ما يريده العميل مع الكميات، مثل «2 Standard Padel Court · 1 Padel Court Cover». إذا كانت أكثر من منتجين يظهر رقم مثل «+1»؛ مرّر الفأرة فوقه لرؤيتها كلها.",
        },
        {
          title: "كيف تضيف منتجًا",
          text: "انقر خلية المنتجات. ضع علامة بجانب المنتج، واضبط الكمية بزرّي − و+، ثم اضغط حفظ. اكتب اسم المنتج في مربع البحث أعلاه للعثور عليه بسرعة. مسؤول العميل هو من يُدخل المنتجات؛ استلم عميل المجموعة أولًا.",
        },
        {
          title: "كل المنتجات متاحة",
          text: "لم تعد ثلاثة ملاعب فقط: كل منتجات الشركة في القائمة — الملاعب، والتغطيات وأنظمة الأسقف، وPadbol، وPickleball وغيرها.",
        },
        {
          title: "علامات «التغطية» القديمة",
          text: "العملاء الذين كانت لديهم علامة «تغطية» أصبح لديهم 1 «Padel Court Cover»، وأُضيف إلى ملاحظاتهم «Eski kayıt: kapatma istedi» (سجل قديم: طلب تغطية). بعد الحديث مع العميل اختر منتج التغطية الصحيح.",
        },
        {
          title: "الهاتف في مكان واحد",
          text: "الرقم وزرّا واتساب والاتصال أصبحت في خلية واحدة بجانب الاسم. يمكنك البحث عن الرقم مع المسافات أو بدونها.",
        },
        {
          title: "الردود داخل القناة",
          text: "أُزيلت أعمدة «الرد» المنفصلة. إذا ردّ العميل تظهر كلمة «رد» والتاريخ تحت علامة ✔ في خلية البريد أو واتساب أو القناة الأخرى. لرؤية الردود فقط اختر «وصل رد» من قائمة العمود.",
        },
        {
          title: "عدد الملاعب منفصل",
          text: "عدد الملاعب الذي كتبه العميل في النموذج يظهر فقط في عمود «عدد الملاعب»، لا في المنتجات.",
        },
      ],
    },
  },
];

export const LATEST_WHATS_NEW = WHATS_NEW[0]?.id ?? null;
