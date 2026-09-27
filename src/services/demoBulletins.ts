import type { Bulletin, BulletinFormat, BulletinStory } from '../shared/bulletins';

/** Demo bulletin formats: an evening main bulletin (not auto-created) and an hourly brief template. */
export const INITIAL_BULLETIN_FORMATS: BulletinFormat[] = [
  {
    id: 'fmt-main',
    name: 'نشرة الثامنة',
    kind: 'MAIN',
    startTime: '20:00',
    plannedSeconds: 30 * 60,
    days: [0, 1, 2, 3, 4, 5, 6],
    autoCreate: false,
    editorId: 'usr-2',
    editorName: 'سارة عبد العزيز',
    anchors: ['فيصل العتيبي'],
    studioName: 'استوديو الأخبار الرئيسي (A1)',
    stories: [
      { slug: 'العناوين', type: 'HEADLINES' },
      { slug: 'الخبر الرئيسي', type: 'PKG' },
      { slug: 'رسالة المراسل', type: 'LIVE', manualSeconds: 150 },
      { slug: 'فاصل', type: 'BREAK', manualSeconds: 120 },
      { slug: 'الاقتصاد', type: 'VO' },
      { slug: 'الرياضة', type: 'SPORT' },
      { slug: 'الطقس', type: 'WEATHER', manualSeconds: 60 },
      { slug: 'الختام', type: 'READER', script: 'بهذا نصل إلى ختام النشرة، شكراً لمتابعتكم.' },
    ],
  },
  {
    id: 'fmt-hourly',
    name: 'موجز الساعة',
    kind: 'HOURLY',
    startTime: '12:00',
    plannedSeconds: 5 * 60,
    days: [],
    autoCreate: false,
    anchors: [],
    stories: [
      { slug: 'العناوين', type: 'HEADLINES' },
      { slug: 'الخبر الأول', type: 'VO' },
      { slug: 'الخبر الثاني', type: 'READER' },
      { slug: 'الخبر الثالث', type: 'READER' },
    ],
  },
];

/** A filled evening bulletin for today, so the desk has something real to try. */
export function demoBulletin(today: string, now = new Date().toISOString()): { bulletin: Bulletin; stories: BulletinStory[] } {
  const id = 'bul-demo-main';
  const bulletin: Bulletin = {
    id,
    title: `نشرة الثامنة — ${today}`,
    kind: 'MAIN',
    date: today,
    startTime: '20:00',
    plannedSeconds: 30 * 60,
    editorId: 'usr-2',
    editorName: 'سارة عبد العزيز',
    anchors: ['فيصل العتيبي'],
    studioName: 'استوديو الأخبار الرئيسي (A1)',
    status: 'PLANNING',
    formatId: 'fmt-main',
    createdAt: now,
    updatedAt: now,
  };
  const base = { bulletinId: id, createdAt: now, updatedAt: now, writerId: 'usr-3', writerName: 'طارق الهاشمي' };
  const stories: BulletinStory[] = [
    { ...base, id: 'bst-demo-1', rank: 1000, slug: 'العناوين', type: 'HEADLINES', status: 'APPROVED', approvedById: 'usr-2', approvedByName: 'سارة عبد العزيز', approvedAt: now,
      script: '• انطلاق أعمال القمة الاقتصادية العربية بمشاركة أكثر من عشرين دولة\n• توقيع اتفاقية لتأسيس أكبر مجمع إقليمي للحوسبة\n• افتتاح المرحلة الأولى من مترو المدينة' },
    { ...base, id: 'bst-demo-2', rank: 2000, slug: 'القمة الاقتصادية', type: 'PKG', status: 'READY', newsId: 'nws-1', clipMediaId: 'med-4', clipSeconds: 150,
      script: 'انطلقت اليوم أعمال القمة الاقتصادية العربية بمشاركة وزراء المالية والاقتصاد، لبحث توسيع مشاريع الطاقة النظيفة وتيسير التبادل التجاري. تقرير ليلى النجار.',
      graphics: [{ kind: 'TITLE', lines: ['القمة الاقتصادية العربية', 'اليوم الأول'] }] },
    { ...base, id: 'bst-demo-3', rank: 3000, slug: 'مراسلنا من مقر القمة', type: 'LIVE', status: 'DRAFT', manualSeconds: 150, anchorName: 'فيصل العتيبي',
      script: 'وللمزيد ننتقل إلى الزميلة ليلى النجار من مقر انعقاد القمة. ليلى، ما أبرز ما خرج به اليوم الأول؟',
      graphics: [{ kind: 'STRAP', lines: ['ليلى النجار', 'مراسلة الشبكة — مقر القمة'] }], directorNotes: 'الخط المباشر SNG-2' },
    { ...base, id: 'bst-demo-4', rank: 4000, slug: 'فاصل', type: 'BREAK', status: 'APPROVED', manualSeconds: 120, script: '', approvedById: 'usr-2', approvedByName: 'سارة عبد العزيز', approvedAt: now },
    { ...base, id: 'bst-demo-5', rank: 5000, slug: 'مجمع الحوسبة', type: 'VO', status: 'DRAFT', newsId: 'nws-2', clipSeconds: 40,
      script: 'وقّعت الجهات المعنية اتفاقية استراتيجية لتأسيس أكبر مجمع إقليمي للحوسبة ومراكز البيانات، باستثمارات تصل إلى ثمانية مليارات دولار.' },
    { ...base, id: 'bst-demo-6', rank: 6000, slug: 'خبر احتياطي: أسعار النفط', type: 'READER', status: 'DRAFT', floated: true,
      script: 'استقرت أسعار النفط في تعاملات اليوم وسط ترقب لقرارات المنتجين.' },
    { ...base, id: 'bst-demo-7', rank: 7000, slug: 'الطقس', type: 'WEATHER', status: 'DRAFT', manualSeconds: 60, script: 'وإلى حالة الطقس غداً.' },
  ];
  return { bulletin, stories };
}
