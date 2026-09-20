import { User, UserRole } from '../types';

export type PermissionCategory =
  | 'NEWS'
  | 'PROGRAMS'
  | 'RUNDOWN'
  | 'GUESTS'
  | 'MEDIA'
  | 'TASKS'
  | 'AUDIT'
  | 'USERS'
  | 'SYSTEM';

export interface PermissionDefinition {
  code: string;
  nameAr: string;
  nameEn: string;
  description: string;
  category: PermissionCategory;
  categoryNameAr: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface RoleDefinition {
  id: string;
  roleCode: UserRole | string;
  nameAr: string;
  nameEn: string;
  description: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  isSystemRole: boolean;
  permissions: string[];
}

export const PERMISSION_CATEGORIES: { key: PermissionCategory; labelAr: string; descriptionAr: string; icon: string }[] = [
  {
    key: 'NEWS',
    labelAr: 'غرفة الأخبار والتحرير الصحفي',
    descriptionAr: 'صياغة، مراجعة، تدقيق، اعتماد ونشر التقارير الإخبارية',
    icon: 'Newspaper',
  },
  {
    key: 'RUNDOWN',
    labelAr: 'الرانداون والبث الحي (On-Air)',
    descriptionAr: 'ترتيب فقرات النشرات، توقيتات البث المباشر، وتجاوز أقفال الهواء',
    icon: 'Radio',
  },
  {
    key: 'PROGRAMS',
    labelAr: 'البرامج التلفزيونية والحلقات',
    descriptionAr: 'تخطيط مواسم البرامج، إعداد الحلقات، والتقييم المهني',
    icon: 'Tv',
  },
  {
    key: 'GUESTS',
    labelAr: 'بنك الضيوف والاتصالات',
    descriptionAr: 'إدارة سجل الشخصيات، بيانات الاتصال السرية، وتنسيق المداخلات',
    icon: 'Users',
  },
  {
    key: 'MEDIA',
    labelAr: 'المكتبة والوسائط الرقمية',
    descriptionAr: 'رفع المواد المرئية، إدارة الأرشيف، وتحميل المواد الخام',
    icon: 'Image',
  },
  {
    key: 'TASKS',
    labelAr: 'المهام التحريرية والتواصل',
    descriptionAr: 'تكليف الصحفيين والمراسلين، متابعة الإنجاز، وإرسال نداءات الديسك',
    icon: 'CheckSquare',
  },
  {
    key: 'AUDIT',
    labelAr: 'التقارير وسجل التدقيق والأمان',
    descriptionAr: 'الاطلاع على تقارير الأداء، سجل العمليات الحساسة، والاستعلامات',
    icon: 'ShieldCheck',
  },
  {
    key: 'USERS',
    labelAr: 'إدارة المستخدمين والأدوار',
    descriptionAr: 'إضافة وتعديل حسابات الطاقم، تعيين الصلاحيات، وإدارة الهيكل الوظيفي',
    icon: 'UserCog',
  },
  {
    key: 'SYSTEM',
    labelAr: 'إعدادات المحطة والتعافي الذاتي',
    descriptionAr: 'تهيئة البث، النسخ الاحتياطي، قاعدة بيانات SQLite، والتعافي 24/7',
    icon: 'Settings',
  },
];

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  // --- NEWS ---
  {
    code: 'news.view',
    nameAr: 'عرض الأخبار والتقارير',
    nameEn: 'View News',
    description: 'إمكانية قراءة مسودات وتقارير غرفة الأخبار',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'LOW',
  },
  {
    code: 'news.create',
    nameAr: 'صياغة خبر أو تقرير جديد',
    nameEn: 'Create News',
    description: 'إنشاء مسودات إخبارية وتقارير ميدانية',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'LOW',
  },
  {
    code: 'news.edit_own',
    nameAr: 'تعديل الأخبار الخاصة',
    nameEn: 'Edit Own News',
    description: 'تعديل المسودات التي أنشأها المحرر نفسه',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'LOW',
  },
  {
    code: 'news.edit_any',
    nameAr: 'تعديل أي خبر في الغرفة',
    nameEn: 'Edit Any News',
    description: 'تعديل الأخبار والتقارير المنشأة من أي محرر بالديسك',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'news.review',
    nameAr: 'مراجعة وتدقيق لغوي',
    nameEn: 'Review & Copyedit',
    description: 'مراجعة المواد وإحالتها للتعديل أو المراجعة القانونية والتحريرية',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'news.approve',
    nameAr: 'اعتماد الأخبار للبث',
    nameEn: 'Approve News for Broadcast',
    description: 'الموافقة الرسمية على الخبر وتأهيله للنشر والبث',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'HIGH',
  },
  {
    code: 'news.publish',
    nameAr: 'نشر فوري للبث الرقمي والفضائي',
    nameEn: 'Publish News',
    description: 'نشر الأخبار على الهواء مباشرة والمنصات الرقمية',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'HIGH',
  },
  {
    code: 'news.breaking_push',
    nameAr: 'إطلاق شريط الأخبار العاجلة',
    nameEn: 'Push Breaking News',
    description: 'بث خبر عاجل أحمر فوري على الشاشة والشريط السفلي',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'CRITICAL',
  },
  {
    code: 'news.delete',
    nameAr: 'حذف وأرشفة المواد الإخبارية',
    nameEn: 'Delete News',
    description: 'نقل المواد لسلة المهملات أو الحذف النهائي',
    category: 'NEWS',
    categoryNameAr: 'غرفة الأخبار',
    riskLevel: 'HIGH',
  },

  // --- RUNDOWN ---
  {
    code: 'rundown.view',
    nameAr: 'عرض الرانداون وجدول النشرة',
    nameEn: 'View Rundown',
    description: 'الاطلاع على فقرات النشرة والتسلسل الزمني',
    category: 'RUNDOWN',
    categoryNameAr: 'الرانداون والبث الحي',
    riskLevel: 'LOW',
  },
  {
    code: 'rundown.edit',
    nameAr: 'تعديل فقرات الرانداون',
    nameEn: 'Edit Rundown Segments',
    description: 'تعديل نصوص الفقرات والمواد المرتبطة بها',
    category: 'RUNDOWN',
    categoryNameAr: 'الرانداون والبث الحي',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'rundown.reorder',
    nameAr: 'إعادة ترتيب وتوقيت الفقرات',
    nameEn: 'Reorder & Retime Rundown',
    description: 'سحب وإفلات الفقرات وإعادة حساب التوقيت التراكمي',
    category: 'RUNDOWN',
    categoryNameAr: 'الرانداون والبث الحي',
    riskLevel: 'HIGH',
  },
  {
    code: 'rundown.lock_override',
    nameAr: 'تجاوز قفل البث الحي (On-Air Override)',
    nameEn: 'Override On-Air Lock',
    description: 'إجراء تعديلات طارئة على الرانداون أثناء البث المباشر المقفول',
    category: 'RUNDOWN',
    categoryNameAr: 'الرانداون والبث الحي',
    riskLevel: 'CRITICAL',
  },
  {
    code: 'rundown.presenter_teleprompter',
    nameAr: 'شاشة التلقين والمذيع (Teleprompter)',
    nameEn: 'Presenter Teleprompter Access',
    description: 'تشغيل شاشة القراءة الحية للمذيعين في الاستوديو',
    category: 'RUNDOWN',
    categoryNameAr: 'الرانداون والبث الحي',
    riskLevel: 'LOW',
  },

  // --- PROGRAMS ---
  {
    code: 'programs.view',
    nameAr: 'استعراض البرامج والحلقات',
    nameEn: 'View Programs & Episodes',
    description: 'الاطلاع على شاشات البرامج وجداول الإنتاج',
    category: 'PROGRAMS',
    categoryNameAr: 'البرامج التلفزيونية',
    riskLevel: 'LOW',
  },
  {
    code: 'programs.manage',
    nameAr: 'إنشاء وتعديل بطاقات البرامج',
    nameEn: 'Manage Programs',
    description: 'إضافة برامج جديدة، تحديد أوقات البث والاستوديو وفريق العمل',
    category: 'PROGRAMS',
    categoryNameAr: 'البرامج التلفزيونية',
    riskLevel: 'HIGH',
  },
  {
    code: 'episodes.create',
    nameAr: 'إنشاء حلقات جديدة',
    nameEn: 'Create Episodes',
    description: 'جدولة حلقات جديدة وتحديد مواضيعها وضيوفها',
    category: 'PROGRAMS',
    categoryNameAr: 'البرامج التلفزيونية',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'episodes.edit',
    nameAr: 'تعديل ملف ومحتوى الحلقة',
    nameEn: 'Edit Episode Workspace',
    description: 'تحرير سيناريو الحلقة، الأسئلة، والفقرات الحوارية',
    category: 'PROGRAMS',
    categoryNameAr: 'البرامج التلفزيونية',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'episodes.evaluate',
    nameAr: 'إجراء التقييم المهني للحلقات',
    nameEn: 'Evaluate Episodes',
    description: 'تسجيل بطاقة التقييم النقدية وتدوين مؤشرات الجودة والريتنج',
    category: 'PROGRAMS',
    categoryNameAr: 'البرامج التلفزيونية',
    riskLevel: 'MEDIUM',
  },

  // --- GUESTS ---
  {
    code: 'guests.view',
    nameAr: 'عرض دليل الضيوف العام',
    nameEn: 'View Guests Directory',
    description: 'استعراض أسماء الضيوف وتخصصاتهم وسجل مشاركاتهم',
    category: 'GUESTS',
    categoryNameAr: 'بنك الضيوف',
    riskLevel: 'LOW',
  },
  {
    code: 'guests.manage',
    nameAr: 'إضافة وتعديل بيانات الضيوف',
    nameEn: 'Manage Guests',
    description: 'تسجيل ضيف جديد وتحديث صفته وتصنيفه المهني',
    category: 'GUESTS',
    categoryNameAr: 'بنك الضيوف',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'guests.confidential_contacts',
    nameAr: 'الاطلاع على أرقام الاتصال السرية',
    nameEn: 'View Confidential Contacts',
    description: 'إظهار أرقام الهواتف الخاصة ومراسلات الشخصيات الهامة',
    category: 'GUESTS',
    categoryNameAr: 'بنك الضيوف',
    riskLevel: 'HIGH',
  },

  // --- MEDIA ---
  {
    code: 'media.view',
    nameAr: 'استعراض مكتبة الوسائط',
    nameEn: 'View Media Assets',
    description: 'تصفح ملفات الفيديو والصور والمواد الأرشيفية',
    category: 'MEDIA',
    categoryNameAr: 'المكتبة والوسائط',
    riskLevel: 'LOW',
  },
  {
    code: 'media.upload',
    nameAr: 'رفع وإدراج وسائط جديدة',
    nameEn: 'Upload Media',
    description: 'إيداع مقاطع الفيديو والصور والتسجيلات في الخادم',
    category: 'MEDIA',
    categoryNameAr: 'المكتبة والوسائط',
    riskLevel: 'LOW',
  },
  {
    code: 'media.delete',
    nameAr: 'حذف مواد من الأرشيف',
    nameEn: 'Delete Media',
    description: 'إزالة الملفات من السيرفر والمكتبة المركزية',
    category: 'MEDIA',
    categoryNameAr: 'المكتبة والوسائط',
    riskLevel: 'HIGH',
  },

  // --- TASKS ---
  {
    code: 'tasks.view',
    nameAr: 'عرض المهام والتكليفات',
    nameEn: 'View Tasks',
    description: 'الاطلاع على لوحة المهام وجدول الإنجاز',
    category: 'TASKS',
    categoryNameAr: 'المهام التحريرية',
    riskLevel: 'LOW',
  },
  {
    code: 'tasks.create_assign',
    nameAr: 'إنشاء وتعيين مهام للآخرين',
    nameEn: 'Create & Assign Tasks',
    description: 'تكليف الصحفيين والمراسلين وتحديد المواعيد النهائية',
    category: 'TASKS',
    categoryNameAr: 'المهام التحريرية',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'tasks.intercom_broadcast',
    nameAr: 'إرسال نداء إنتركوم لغرفة الأخبار',
    nameEn: 'Broadcast Intercom Message',
    description: 'إرسال إشعار فوري عالي الأولوية لجميع شاشات الطاقم',
    category: 'TASKS',
    categoryNameAr: 'المهام التحريرية',
    riskLevel: 'MEDIUM',
  },

  // --- AUDIT ---
  {
    code: 'audit.view',
    nameAr: 'عرض سجل التدقيق والأمان',
    nameEn: 'View Audit Logs',
    description: 'متابعة سجل نشاطات المستخدمين والتعديلات والانتهاكات',
    category: 'AUDIT',
    categoryNameAr: 'سجل التدقيق والأمان',
    riskLevel: 'MEDIUM',
  },
  {
    code: 'reports.export',
    nameAr: 'تصدير التقارير والإحصائيات',
    nameEn: 'Export Reports & Metrics',
    description: 'استخراج تقارير الأداء بصيغ PDF و Excel و JSON',
    category: 'AUDIT',
    categoryNameAr: 'سجل التدقيق والأمان',
    riskLevel: 'LOW',
  },

  // --- USERS ---
  {
    code: 'users.view',
    nameAr: 'استعراض قائمة المستخدمين',
    nameEn: 'View Users List',
    description: 'الاطلاع على أسماء الموظفين وأدوارهم وأقسامهم',
    category: 'USERS',
    categoryNameAr: 'إدارة المستخدمين',
    riskLevel: 'LOW',
  },
  {
    code: 'users.create',
    nameAr: 'إضافة حسابات مستخدمين جديدة',
    nameEn: 'Create New Users',
    description: 'تسجيل أعضاء جدد وتعيين الأقسام والبريد الإلكتروني',
    category: 'USERS',
    categoryNameAr: 'إدارة المستخدمين',
    riskLevel: 'HIGH',
  },
  {
    code: 'users.edit_profile',
    nameAr: 'تعديل بيانات وحسابات الموظفين',
    nameEn: 'Edit User Accounts',
    description: 'تعديل البيانات الوظيفية، التصنيف الأمني، والمناوبات',
    category: 'USERS',
    categoryNameAr: 'إدارة المستخدمين',
    riskLevel: 'HIGH',
  },
  {
    code: 'users.manage_roles_permissions',
    nameAr: 'إدارة وتعديل مصفوفة الصلاحيات والأدوار',
    nameEn: 'Manage Roles & RBAC Matrix',
    description: 'تعديل الصلاحيات الممنوحة لكل دور أو إنشاء أدوار مخصصة',
    category: 'USERS',
    categoryNameAr: 'إدارة المستخدمين',
    riskLevel: 'CRITICAL',
  },
  {
    code: 'users.suspend_delete',
    nameAr: 'تجميد وحذف الحسابات',
    nameEn: 'Suspend & Delete Users',
    description: 'إلغاء تنشيط أو مسح مستخدم من النظام',
    category: 'USERS',
    categoryNameAr: 'إدارة المستخدمين',
    riskLevel: 'CRITICAL',
  },

  // --- SYSTEM ---
  {
    code: 'system.settings',
    nameAr: 'تعديل إعدادات المحطة والبث',
    nameEn: 'Station Configuration',
    description: 'تغيير اسم القناة، التوقيت، التصنيفات، والمصادر',
    category: 'SYSTEM',
    categoryNameAr: 'إعدادات النظام',
    riskLevel: 'HIGH',
  },
  {
    code: 'system.database_manage',
    nameAr: 'إدارة قاعدة بيانات SQLite والنسخ الاحتياطي',
    nameEn: 'SQLite Database & Backup Admin',
    description: 'تنفيذ استعلامات SQL، تصدير واسترجاع النسخ الاحتياطية',
    category: 'SYSTEM',
    categoryNameAr: 'إعدادات النظام',
    riskLevel: 'CRITICAL',
  },
  {
    code: 'system.self_healing',
    nameAr: 'تشغيل التعافي الذاتي وإجراءات الطوارئ',
    nameEn: 'Trigger Self-Healing & Emergency Reset',
    description: 'إجراء فحص وإصلاح هيكلي فوري وتفريغ الذاكرة',
    category: 'SYSTEM',
    categoryNameAr: 'إعدادات النظام',
    riskLevel: 'HIGH',
  },
];

export const DEFAULT_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'role-super-admin',
    roleCode: 'SUPER_ADMIN',
    nameAr: 'مدير النظام العام (Super Admin)',
    nameEn: 'Super Administrator',
    description: 'كامل الصلاحيات دون أي قيود على مستوى كافة أقسام المنظومة وقواعد البيانات والبث',
    color: '#dc2626',
    badgeBg: 'bg-red-50 text-red-700 border-red-200',
    badgeText: 'مدير النظام العام',
    isSystemRole: true,
    permissions: ALL_PERMISSIONS.map((p) => p.code),
  },
  {
    id: 'role-admin',
    roleCode: 'ADMIN',
    nameAr: 'مدير قطاع الأخبار والبرامج (News Director)',
    nameEn: 'News & Broadcast Director',
    description: 'إدارة العمليات التحريرية، إقرار السياسات، النشر المباشر، وتعيين الطواقم وإدارتها',
    color: '#7c3aed',
    badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
    badgeText: 'مدير الأخبار',
    isSystemRole: true,
    permissions: ALL_PERMISSIONS.filter((p) => p.code !== 'system.database_manage').map((p) => p.code),
  },
  {
    id: 'role-editor',
    roleCode: 'EDITOR',
    nameAr: 'رئيس تحرير أول (Senior Editor)',
    nameEn: 'Senior Editor & Desk Chief',
    description: 'اعتماد المواد، تدقيق المسودات، التحكم بالرانداون، وإطلاق الأخبار العاجلة',
    color: '#2563eb',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    badgeText: 'رئيس تحرير',
    isSystemRole: true,
    permissions: [
      'news.view',
      'news.create',
      'news.edit_own',
      'news.edit_any',
      'news.review',
      'news.approve',
      'news.publish',
      'news.breaking_push',
      'news.delete',
      'rundown.view',
      'rundown.edit',
      'rundown.reorder',
      'rundown.lock_override',
      'programs.view',
      'episodes.create',
      'episodes.edit',
      'episodes.evaluate',
      'guests.view',
      'guests.manage',
      'guests.confidential_contacts',
      'media.view',
      'media.upload',
      'tasks.view',
      'tasks.create_assign',
      'tasks.intercom_broadcast',
      'audit.view',
      'reports.export',
      'users.view',
      'system.self_healing',
    ],
  },
  {
    id: 'role-journalist',
    roleCode: 'JOURNALIST',
    nameAr: 'محرر صحفي (Journalist / Copywriter)',
    nameEn: 'Journalist / Copywriter',
    description: 'صياغة الأخبار، كتابة التقارير، إرفاق الوسائط، وتلقي المهام التحريرية',
    color: '#059669',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badgeText: 'محرر صحفي',
    isSystemRole: true,
    permissions: [
      'news.view',
      'news.create',
      'news.edit_own',
      'rundown.view',
      'programs.view',
      'guests.view',
      'media.view',
      'media.upload',
      'tasks.view',
      'reports.export',
    ],
  },
  {
    id: 'role-producer',
    roleCode: 'PRODUCER',
    nameAr: 'منتج برامج (Executive Producer)',
    nameEn: 'Executive Producer',
    description: 'إعداد الحلقات، التنسيق مع الضيوف، إعداد محاور النقاش والأسئلة، وتجهيز الرانداون',
    color: '#d97706',
    badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    badgeText: 'منتج برامج',
    isSystemRole: true,
    permissions: [
      'news.view',
      'news.create',
      'rundown.view',
      'rundown.edit',
      'rundown.reorder',
      'programs.view',
      'programs.manage',
      'episodes.create',
      'episodes.edit',
      'episodes.evaluate',
      'guests.view',
      'guests.manage',
      'guests.confidential_contacts',
      'media.view',
      'media.upload',
      'tasks.view',
      'tasks.create_assign',
      'tasks.intercom_broadcast',
      'reports.export',
    ],
  },
  {
    id: 'role-presenter',
    roleCode: 'PRESENTER',
    nameAr: 'مذيع ومقدم برامج (News Anchor / Presenter)',
    nameEn: 'News Anchor / Presenter',
    description: 'الاطلاع على الرانداون الحي، قراءة شاشة التلقين (Teleprompter)، ومتابعة أسئلة الضيوف',
    color: '#0891b2',
    badgeBg: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    badgeText: 'مذيع ومقدم',
    isSystemRole: true,
    permissions: [
      'news.view',
      'rundown.view',
      'rundown.presenter_teleprompter',
      'programs.view',
      'episodes.edit',
      'guests.view',
      'media.view',
      'tasks.view',
    ],
  },
  {
    id: 'role-reporter',
    roleCode: 'REPORTER',
    nameAr: 'مراسل ميداني (Field Reporter)',
    nameEn: 'Field Reporter / Correspondent',
    description: 'إرسال التقارير الميدانية العاجلة، رفع المواد المصورة، واستقبال التكليفات الخارجية',
    color: '#ea580c',
    badgeBg: 'bg-orange-50 text-orange-700 border-orange-200',
    badgeText: 'مراسل ميداني',
    isSystemRole: true,
    permissions: [
      'news.view',
      'news.create',
      'news.edit_own',
      'guests.view',
      'media.view',
      'media.upload',
      'tasks.view',
    ],
  },
  {
    id: 'role-media',
    roleCode: 'MEDIA',
    nameAr: 'فني وسائط وأرشيف (Media & Video Specialist)',
    nameEn: 'Media & Video Specialist',
    description: 'معالجة الفيديو والصور، تصنيف المواد الأرشيفية، وضبط الجودة الفنية',
    color: '#4f46e5',
    badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    badgeText: 'فني وسائط',
    isSystemRole: true,
    permissions: [
      'news.view',
      'rundown.view',
      'media.view',
      'media.upload',
      'media.delete',
      'tasks.view',
    ],
  },
  {
    id: 'role-viewer',
    roleCode: 'VIEWER',
    nameAr: 'مطلع / متدرب (Viewer / Trainee)',
    nameEn: 'Viewer / Trainee',
    description: 'صلاحيات قراءة واطلاع فقط دون إمكانية التعديل أو النشر أو الحذف',
    color: '#64748b',
    badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
    badgeText: 'مطلع / متدرب',
    isSystemRole: true,
    permissions: [
      'news.view',
      'rundown.view',
      'programs.view',
      'guests.view',
      'media.view',
      'tasks.view',
    ],
  },
];

const STORAGE_KEY_ROLES = 'nrcs_custom_roles_v2';

export class RbacService {
  static getRoleDefinitions(): RoleDefinition[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ROLES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return DEFAULT_ROLE_DEFINITIONS;
  }

  static saveRoleDefinitions(roles: RoleDefinition[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_ROLES, JSON.stringify(roles));
    } catch (e) {
      console.error('[RBAC] Failed to save roles:', e);
    }
  }

  static saveRole(role: RoleDefinition): RoleDefinition[] {
    const roles = this.getRoleDefinitions();
    const existingIndex = roles.findIndex((r) => r.id === role.id || r.roleCode === role.roleCode);

    if (existingIndex !== -1) {
      roles[existingIndex] = { ...roles[existingIndex], ...role };
    } else {
      roles.push(role);
    }

    this.saveRoleDefinitions(roles);
    return roles;
  }

  static deleteRole(roleId: string): { success: boolean; error?: string; roles: RoleDefinition[] } {
    const roles = this.getRoleDefinitions();
    const target = roles.find((r) => r.id === roleId);

    if (!target) {
      return { success: false, error: 'الدور غير موجود', roles };
    }

    if (target.isSystemRole) {
      return { success: false, error: 'لا يمكن حذف الأدوار الأساسية للنظام', roles };
    }

    const filtered = roles.filter((r) => r.id !== roleId);
    this.saveRoleDefinitions(filtered);
    return { success: true, roles: filtered };
  }

  static resetToDefaults(): RoleDefinition[] {
    this.saveRoleDefinitions(DEFAULT_ROLE_DEFINITIONS);
    return DEFAULT_ROLE_DEFINITIONS;
  }

  /**
   * Evaluates if a given user has permission to perform an action.
   * Handles role inheritance, custom user overrides, and Super Admin bypass.
   */
  static hasPermission(user: User | undefined | null, permissionCode: string): boolean {
    if (!user || !user.isActive) return false;

    // Super Admin has all permissions automatically
    if (user.role === 'SUPER_ADMIN') return true;

    // Check custom user explicit overrides if present
    if (Array.isArray(user.customPermissions)) {
      if (user.customPermissions.includes(permissionCode)) return true;
      if (user.customPermissions.includes(`!${permissionCode}`)) return false; // explicit deny
    }

    // Lookup user's role definition
    const roles = this.getRoleDefinitions();
    const userRole = roles.find((r) => r.roleCode === user.role || r.id === user.customRoleId);

    if (!userRole) return false;
    return userRole.permissions.includes(permissionCode);
  }

  /**
   * Retrieves full list of effective permission codes for a user
   */
  static getEffectivePermissions(user: User | undefined | null): string[] {
    if (!user || !user.isActive) return [];
    if (user.role === 'SUPER_ADMIN') {
      return ALL_PERMISSIONS.map((p) => p.code);
    }

    const roles = this.getRoleDefinitions();
    const userRole = roles.find((r) => r.roleCode === user.role || r.id === user.customRoleId);
    const basePerms = userRole ? [...userRole.permissions] : [];

    if (Array.isArray(user.customPermissions)) {
      user.customPermissions.forEach((cp) => {
        if (cp.startsWith('!')) {
          const denied = cp.substring(1);
          const idx = basePerms.indexOf(denied);
          if (idx !== -1) basePerms.splice(idx, 1);
        } else if (!basePerms.includes(cp)) {
          basePerms.push(cp);
        }
      });
    }

    return basePerms;
  }

  static getRoleBadge(roleCode: string): { labelAr: string; color: string; badgeBg: string; badgeText: string } {
    const roles = this.getRoleDefinitions();
    const found = roles.find((r) => r.roleCode === roleCode || r.id === roleCode);
    if (found) {
      return {
        labelAr: found.nameAr,
        color: found.color,
        badgeBg: found.badgeBg,
        badgeText: found.badgeText,
      };
    }
    return {
      labelAr: roleCode,
      color: '#64748b',
      badgeBg: 'bg-slate-100 text-slate-700 border-slate-200',
      badgeText: roleCode,
    };
  }
}
