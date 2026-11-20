/**
 * Interactive tours: short guided walks that point at the real controls of a screen.
 * A step points at the first visible element matching `target` (a CSS selector); a step without
 * one, or whose control is hidden on this device, is shown in the middle of the screen.
 */

export interface TourStep {
  /** Screen to open before the step (an address such as '/news'). */
  nav?: string;
  target?: string;
  title: string;
  body: string;
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  /** Screen the tour needs: hidden from colleagues whose role does not open it. */
  screen?: string;
  /** Permission the tour needs. */
  permission?: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: 'basics',
    title: 'جولة البداية',
    summary: 'القائمة، البحث، الإنشاء، الإشعارات، المراسلات وحجم الخط.',
    steps: [
      {
        nav: '/',
        title: 'أهلاً في «مدار»',
        body: 'جولة قصيرة على ما تحتاجه كل يوم. انتقل بالأسهم أو بزر «التالي»، وEsc يُنهي الجولة في أي وقت.',
      },
      {
        target: 'aside nav[aria-label="التنقل"]',
        title: 'القائمة مرتبة حسب دورك',
        body: '«عملي» أولاً: المراسلات ومهامك والتكليفات والطلبات، ثم أقسام عملك. اضغط عنوان أي قسم لطيّه، ويظهر على القسم المطوي عدد ما ينتظرك فيه.',
      },
      {
        target: '#app-main h1',
        title: 'أين أنت الآن',
        body: 'عنوان كل شاشة يظهر بهذا الشريط، ويقابله العنصر النشط في القائمة بالشكل نفسه.',
      },
      {
        target: '[aria-label="البحث السريع (Ctrl + K)"]',
        title: 'البحث السريع',
        body: 'Ctrl+K من أي مكان: ابحث في الأخبار والحلقات والضيوف والمهام، أو اكتب اسم شاشة للانتقال إليها.',
      },
      {
        target: '[aria-label="إنشاء جديد"]',
        title: 'إنشاء جديد',
        body: 'خبر أو برنامج أو حلقة أو مهمة، بحسب صلاحياتك.',
      },
      {
        target: '[aria-label^="الإشعارات"]',
        title: 'الإشعارات',
        body: 'كل ما يُسند إليك أو يُرسل لك يصل هنا، ويظهر أيضاً كإشعار عائم مع زر «فتح» إن كان النظام مفتوحاً.',
      },
      {
        target: '[aria-label="المحادثة الداخلية"]',
        title: 'المحادثة السريعة والمراسلات',
        body: 'هذا الزر يفتح قنوات الأقسام. الرسائل المباشرة والمجموعات والملفات في شاشة «المراسلات» من القائمة.',
      },
      {
        target: '[aria-label^="المظهر"]',
        title: 'المظهر وحجم الخط',
        body: 'نهاري أو ليلي أو حسب الجهاز، وتكبير الخط وتقليل الحركة. الاختيار محفوظ على جهازك فقط.',
      },
      {
        title: 'تم',
        body: 'تجد هذه الجولة وجولات الشاشات الأخرى في «المساعدة» متى احتجتها.',
      },
    ],
  },
  {
    id: 'newsroom',
    title: 'غرفة الأخبار',
    summary: 'حالات الخبر، البحث والفلاتر، الإنشاء والمراجعة.',
    screen: 'news',
    permission: 'news.view',
    steps: [
      {
        nav: '/news',
        target: '[role="tablist"][aria-label="تصفية الأخبار حسب الحالة"], select[aria-label="تصفية الأخبار حسب الحالة"]',
        title: 'الخبر بحسب مرحلته',
        body: 'من المسودة إلى المراجعة فالاعتماد والنشر. كل تبويب يعرض عدد الأخبار في مرحلته.',
      },
      {
        target: '#news-list-search-input',
        title: 'البحث',
        body: 'يبحث في العنوان والملخص واسم المحرر والمصدر والكلمات المفتاحية.',
      },
      {
        target: '[aria-controls="news-advanced-filters"]',
        title: 'الفلاتر',
        body: 'الكاتب والتاريخ والقسم والمصدر والأولوية، وعدد الأعمدة المعروضة. الرقم على الزر يدل على الفلاتر المفعلة.',
      },
      {
        target: '[data-tour="news-create"]',
        title: 'خبر جديد',
        body: 'يفتح المحرر على مسودة. Ctrl+S يحفظ وCtrl+Enter يرسله للمراجعة.',
      },
    ],
  },
  {
    id: 'cards',
    title: 'التكليفات',
    summary: 'مهامي، متابعة اليوم، وإنشاء بطاقة بين المحطات.',
    screen: 'cards',
    permission: 'cards.view',
    steps: [
      {
        nav: '/cards',
        target: '[role="tablist"][aria-label="التكليفات"], select[aria-label="التكليفات"]',
        title: 'ثلاث زوايا للعمل نفسه',
        body: '«مهامي» ما أُسند إليك أو متاح لمحطتك، «متابعة اليوم» لرئيس التحرير، و«كل البطاقات» مع البحث والفلاتر.',
      },
      {
        target: '[data-tour="card-create"]',
        title: 'بطاقة جديدة',
        body: 'عنوان المادة والمطلوب ومواعيد التسليم والبث، ثم المهام بالترتيب لكل محطة أو زميل.',
      },
      {
        title: 'التسليم',
        body: 'عند إنجاز مهمتك اكتب ما اكتمل وما ينقص؛ يصل التنبيه لصاحب المهمة التالية. وإن تعطلت، اكتب السبب ليصل لصاحب القرار.',
      },
    ],
  },
  {
    id: 'messages',
    title: 'المراسلات',
    summary: 'رسالة مباشرة، مجموعة، قنوات المحطات والأقسام.',
    screen: 'messages',
    steps: [
      {
        nav: '/messages',
        target: '[data-tour="message-new"]',
        title: 'رسالة جديدة',
        body: 'اختر الزميل وابدأ. الرسالة المباشرة يقرؤها طرفاها فقط.',
      },
      {
        target: '[data-tour="group-new"]',
        title: 'مجموعة',
        body: 'لتغطية أو فريق مناوبة. من يُضاف لاحقاً يرى ما يُرسل بعد انضمامه.',
      },
      {
        target: 'nav[aria-label="المحادثات"]',
        title: 'المحادثات والقنوات',
        body: 'الرسائل المباشرة والمجموعات أولاً، ثم قناة محطتك وقسمك. في كل رسالة يمكنك إرفاق ملف أو الإشارة إلى خبر أو بطاقة.',
      },
    ],
  },
  {
    id: 'admin',
    title: 'إدارة النظام',
    summary: 'الإعداد السريع، المحطات، مراقبة النظام، المستخدمون والأدوار.',
    screen: 'settings',
    permission: 'system.settings',
    steps: [
      {
        nav: '/',
        target: '[data-tour="setup-wizard"]',
        title: 'الإعداد السريع',
        body: 'معالج من ست خطوات: المؤسسة، المحطات، تصنيفات الأخبار، الفريق، الأمان والنسخ الاحتياطي، ثم الانتهاء. يبقى متاحاً من «المساعدة» بعد إكماله.',
      },
      {
        nav: '/settings',
        title: 'الإعدادات',
        body: 'كل إعدادات المحطة في أقسام: المؤسسة، المحطات والتكليفات، مراقبة النظام، الأخبار، التاريخ والوقت، المصادر وغيرها.',
      },
      {
        nav: '/users',
        title: 'المستخدمون والأدوار',
        body: 'لكل زميل دور ومحطة وقسم. ولكل دور صلاحياته والصفحات التي يفتحها، وتنشئ أدواراً مخصصة من تبويب الأدوار.',
      },
    ],
  },
];
