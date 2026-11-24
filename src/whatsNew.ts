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
    id: "2026-11-24",
    date: "2026-11-24",
    items: {
      tr: [
        {
          title: "Aşama değiştirirken iletişim bilgisi",
          text: 'Hiç iletişim kaydı olmayan bir lead\'i "İletişim kuruldu", "Nitelikli", "Teklif gönderildi" ya da "Kazanıldı" aşamasına çekerken açılan pencere artık müşteriye hangi kanaldan ve ne zaman ulaştığınızı sorar. Kanalı ve zamanı seçip kaydedin; iletişim kaydı aşamayla birlikte oluşur. Daha önce iletişim kaydı girilmiş lead\'lerde bir şey sorulmaz.',
        },
        {
          title: '"Dönüş alındı mı?" sorusu',
          text: 'İletişim Kaydet penceresindeki "Aşamayı İletişim kuruldu yap" kutusunun yerini "Dönüş alındı mı?" sorusu aldı. Evet ya da Hayır seçmeden Kaydet düğmesi açılmaz. Evet derseniz aşama "İletişim kuruldu" olur, Hayır derseniz aşama değişmez. Sonuç "Dönüş alındı" ise Evet seçili gelir.',
        },
        {
          title: '"Hiç ulaşılmadı" yerine "Kayıt yok (eski)"',
          text: 'Aşaması ilerlemiş ama iletişim kaydı girilmemiş lead\'ler artık "Hiç ulaşılmadı" değil "Kayıt yok (eski)" olarak görünür. Bu lead\'lerde "İletişim kaydet" ile kaydı girdiğinizde durum kendiliğinden "Ulaşıldı" olur. "Kaybedildi" aşamasındaki kayıtsız lead\'ler "Hiç ulaşılmadı" olarak kalır.',
        },
      ],
      en: [
        {
          title: "Contact details when changing stage",
          text: 'When you move a lead with no contact record to "Contacted", "Qualified", "Proposal sent" or "Won", the window now asks through which channel and when you reached the customer. Pick the channel and time and save; the contact record is created together with the stage. Leads that already have a contact record are not asked anything.',
        },
        {
          title: '"Did the customer reply?" question',
          text: 'In the Log contact window, the "Move the stage to Contacted" checkbox is now the question "Did the customer reply?". The Save button stays off until you pick Yes or No. Yes moves the stage to "Contacted"; No leaves the stage as it is. When the outcome is "Reply received", Yes is already selected.',
        },
        {
          title: '"No record (legacy)" instead of "Never reached"',
          text: 'Leads that have moved past the first stage without a contact record now show "No record (legacy)" instead of "Never reached". Once you enter the record with "Log contact", the status becomes "Reached" on its own. Leads in "Lost" with no record still show "Never reached".',
        },
      ],
      ar: [
        {
          title: "بيانات التواصل عند تغيير المرحلة",
          text: "عند نقل عميل محتمل بلا سجل تواصل إلى «تم التواصل» أو «مؤهَّل» أو «تم إرسال عرض السعر» أو «تم الفوز»، تسألك النافذة الآن عن القناة التي تواصلت بها مع العميل ومتى. اختر القناة والوقت واحفظ؛ يُنشأ سجل التواصل مع المرحلة. العملاء الذين لديهم سجل تواصل لا يُسألون عن شيء.",
        },
        {
          title: "سؤال «هل ردّ العميل؟»",
          text: "في نافذة «تسجيل تواصل» حلّ سؤال «هل ردّ العميل؟» محل مربع «نقل المرحلة إلى تم التواصل». لا يُفعَّل زر الحفظ قبل اختيار «نعم» أو «لا». «نعم» تجعل المرحلة «تم التواصل»، و«لا» تُبقي المرحلة كما هي. إذا كانت النتيجة «تم استلام الرد» تأتي «نعم» محددة مسبقًا.",
        },
        {
          title: "«لا سجل (قديم)» بدل «لم يتم التواصل»",
          text: "العملاء المحتملون الذين تقدّمت مرحلتهم دون سجل تواصل يظهرون الآن «لا سجل (قديم)» بدل «لم يتم التواصل». عند إدخال السجل عبر «تسجيل تواصل» تصبح الحالة «تم التواصل» تلقائيًا. العملاء في مرحلة «خسارة» بلا سجل يبقون «لم يتم التواصل».",
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
          text: "Zil artık şunlarda da haber verir: size bir lead atandığında ya da devredildiğinde, açık lead'inizdeki kişi formu tekrar doldurduğunda, planladığınız işin saati geldiğinde ya da iş geciktiğinde, sıcak bir lead'inize bir gündür işlem yapılmadığında.",
        },
        {
          title: "Program kapalıyken de bildirim",
          text: 'Zile tıklayın ve en alttaki "Bu Cihazda Aç" düğmesine basın, tarayıcı sorduğunda izin verin. Artık program kapalıyken de bilgisayarınıza ya da telefonunuza bildirim düşer; bildirime tıklayınca lead açılır. Her cihazda bir kez açmanız yeterli. iPhone\'da önce programı ana ekrana eklemeniz gerekir.',
        },
      ],
      en: [
        {
          title: "More notifications",
          text: "The bell now also tells you when a lead is assigned or handed over to you, when the person on one of your open leads fills in the form again, when a task you planned is due or overdue, and when one of your hot leads has had no action for a day.",
        },
        {
          title: "Notifications when the app is closed",
          text: 'Click the bell, press "Turn On Here" at the bottom and allow notifications when the browser asks. You will then get notifications on your computer or phone even when the app is closed; click one to open the lead. Turn it on once per device. On iPhone, add the app to the home screen first.',
        },
      ],
      ar: [
        {
          title: "إشعارات أكثر",
          text: "الجرس ينبّهك الآن أيضًا عند إسناد عميل محتمل إليك أو تحويله إليك، وعندما يعيد صاحب أحد عملائك المحتملين المفتوحين تعبئة النموذج، وعند حلول موعد مهمة خططت لها أو تأخرها، وعندما يمرّ يوم دون أي إجراء على أحد عملائك المحتملين الساخنين.",
        },
        {
          title: "إشعارات والبرنامج مغلق",
          text: "انقر على الجرس ثم اضغط «تفعيل على هذا الجهاز» في الأسفل واسمح بالإشعارات عندما يسألك المتصفح. ستصلك الإشعارات على حاسوبك أو هاتفك حتى والبرنامج مغلق، وبالنقر على الإشعار يُفتح العميل المحتمل. يكفي التفعيل مرة واحدة لكل جهاز. على iPhone أضف البرنامج إلى الشاشة الرئيسية أولًا.",
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
          text: "Programın yazı tipi değişti. Büyük İ harfi ve ₺ işareti artık diğer harflerle aynı görünür, tutarlar alt alta düzgün hizalanır, e-postalardaki I, l ve 1 birbirinden kolay ayrılır.",
        },
        {
          title: "Sütunu gizleme düğmesi başlıkta",
          text: "Lead listesinde her sütun başlığında, süzgeç okunun yanında bir göz simgesi var. Tıklayınca sütun gizlenir. Bu seçenek artık süzgeç menüsünün içinde değil.",
        },
      ],
      en: [
        {
          title: "New typeface",
          text: "The app has a new typeface. The Turkish capital İ and the ₺ sign now match the other letters, amounts line up neatly in columns, and I, l and 1 in e-mail addresses are easier to tell apart.",
        },
        {
          title: "Hide-column button in the header",
          text: "In the lead list, every column header now has an eye icon next to the filter arrow. Click it to hide the column. This option is no longer inside the filter menu.",
        },
      ],
      ar: [
        {
          title: "خط جديد",
          text: "تغيّر خط البرنامج. أصبح الحرف التركي İ وعلامة الليرة ₺ بنفس شكل باقي الحروف، وتصطف المبالغ بشكل مرتب في الأعمدة، ويسهل التمييز بين I و l و 1 في عناوين البريد الإلكتروني.",
        },
        {
          title: "زر إخفاء العمود في رأس العمود",
          text: "في قائمة العملاء المحتملين يوجد الآن رمز عين في رأس كل عمود بجانب سهم التصفية. انقر عليه لإخفاء العمود. لم يعد هذا الخيار داخل قائمة التصفية.",
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
          text: 'Raporlar sayfasının üstündeki "Aşama Raporu" ve "Özet Rapor" düğmeleri artık görünür. Özet rapora oradan geçebilirsiniz.',
        },
        {
          title: "Yazı kutuları düzeldi",
          text: "Yeni lead penceresindeki Ad Soyad, Şehir, Firma ve İlgilenilen Ürün kutuları artık diğer kutularla aynı görünür ve daha kolay dokunulur.",
        },
        {
          title: "Noktalı İ doğru yazılıyor",
          text: 'Düğme ve başlıklarda "Işaretle", "Içe Aktar" gibi noktasız yazılan kelimeler artık "İşaretle", "İçe Aktar" diye doğru görünür.',
        },
        {
          title: "Bağlantı koptuğunda lead sayfası",
          text: 'İnternet ya da sunucu bağlantısı koparsa lead sayfası artık "bulunamadı" demez; ne olduğunu yazar ve "Tekrar Dene" düğmesi gösterir.',
        },
        {
          title: "Program Bugün sayfasıyla açılır",
          text: "Satış temsilcileri programı açınca önce Bugün sayfasını görür: gecikmiş ve bugünkü işler. Lead listesi alttaki ve üstteki menüde yerinde duruyor.",
        },
        {
          title: "Lead listesi sadeleşti",
          text: 'Listede Ulaşım, Teklif ve Form cevapları sütunları artık tek bir "Özet" sütununa katlı gelir. Açmak için başlıktaki oka ya da "Sütunlar" düğmesine basın. Daha önce sütunları kendiniz ayarladıysanız düzeniniz aynen kalır.',
        },
        {
          title: "Satırlarda daha az düğme",
          text: 'Tabloda Ara ve E-posta artık yalnız simgeyle, WhatsApp simge ve "Wp" yazısıyla görünür; üzerine gelince adı yazar. "İletişim kaydet" yazılı kalır.',
        },
        {
          title: "Yana kaydırırken arama yerinde kalır",
          text: "Lead listesini sağa kaydırdığınızda başlık, arama kutusu ve süzgeç düğmeleri ekranda kalır; geri dönmeden arayabilirsiniz.",
        },
      ],
      en: [
        {
          title: "Summary report is back",
          text: 'The "Stage Report" and "Summary Report" buttons at the top of the Reports page are visible again. Use them to switch to the summary report.',
        },
        {
          title: "Text boxes fixed",
          text: "In the new lead window, the Full Name, City, Company and Product Interest boxes now look like the other boxes and are easier to tap.",
        },
        {
          title: "Turkish capital İ fixed",
          text: 'In Turkish, buttons and headings no longer show a dotless "I" in words like "İşaretle" or "İçe Aktar".',
        },
        {
          title: "Lead page when the connection drops",
          text: 'If the internet or server connection drops, the lead page no longer says the lead was not found. It says what happened and shows a "Retry" button.',
        },
        {
          title: "The app opens on Today",
          text: "Sales reps now see the Today page first when they open the app: overdue and today's tasks. The lead list is still in the menu at the top and bottom.",
        },
        {
          title: "A simpler lead list",
          text: 'The Reach, Proposal and Form answers columns now start folded into a single "Summary" column. To open them, tap the arrow in the heading or the "Columns" button. If you already arranged the columns yourself, your layout stays as it was.',
        },
        {
          title: "Fewer buttons in each row",
          text: 'In the table, Call and Email now show only their icon and WhatsApp shows its icon with "Wp"; hover to see the name. "Log contact" keeps its label.',
        },
        {
          title: "Search stays put when scrolling sideways",
          text: "When you scroll the lead list to the right, the title, search box and filter buttons stay on screen, so you can search without scrolling back.",
        },
      ],
      ar: [
        {
          title: "التقرير الملخّص ظاهر من جديد",
          text: 'أصبح زرّا "تقرير المراحل" و"التقرير الملخّص" في أعلى صفحة التقارير ظاهرين من جديد. استخدمهما للانتقال إلى التقرير الملخّص.',
        },
        {
          title: "إصلاح خانات الكتابة",
          text: "في نافذة العميل المحتمل الجديد، أصبحت خانات الاسم الكامل والمدينة والشركة والمنتج المطلوب تشبه باقي الخانات وأسهل في اللمس.",
        },
        {
          title: "إصلاح الحرف التركي İ",
          text: 'في الواجهة التركية، لم تعد الأزرار والعناوين تعرض حرف "I" بلا نقطة في كلمات مثل "İşaretle" و"İçe Aktar".',
        },
        {
          title: "صفحة العميل المحتمل عند انقطاع الاتصال",
          text: 'إذا انقطع الاتصال بالإنترنت أو بالخادم، لم تعد صفحة العميل المحتمل تقول إنه غير موجود، بل توضّح ما حدث وتعرض زر "إعادة المحاولة".',
        },
        {
          title: "يبدأ البرنامج بصفحة اليوم",
          text: "يرى مندوبو المبيعات صفحة اليوم أولًا عند فتح البرنامج: المهام المتأخرة ومهام اليوم. قائمة العملاء المحتملين ما زالت في القائمة العلوية والسفلية.",
        },
        {
          title: "قائمة عملاء محتملين أبسط",
          text: 'أعمدة التواصل وعرض السعر وإجابات النموذج تظهر الآن مطوية في عمود "ملخص" واحد. لفتحها اضغط السهم في العنوان أو زر "الأعمدة". إذا رتّبت الأعمدة بنفسك من قبل فيبقى ترتيبك كما هو.',
        },
        {
          title: "أزرار أقل في كل صف",
          text: 'في الجدول يظهر الاتصال والبريد الإلكتروني الآن كأيقونات فقط، وواتساب بأيقونته مع "Wp"، ويظهر الاسم عند تمرير المؤشر. يبقى زر "تسجيل تواصل" بنصّه.',
        },
        {
          title: "البحث يبقى ظاهرًا عند التمرير الجانبي",
          text: "عند تمرير قائمة العملاء المحتملين إلى الجانب، يبقى العنوان ومربع البحث وأزرار التصفية ظاهرة، فتستطيع البحث دون الرجوع.",
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
