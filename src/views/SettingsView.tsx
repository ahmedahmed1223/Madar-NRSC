import { StationDateTimeSettings } from '../components/common/DateTimePrefs';
import { RbacService } from '../services/rbacService';
import { confirmDialog } from '../services/dialogs';
import { notify } from '../services/notify';
import { FormPage } from '../components/common/FormPage';
import { Avatar } from '../components/common/Avatar';
import { DemoDataCard } from '../components/settings/DemoDataCard';
import { stationTimeZone } from '../shared/dates';
import React, { useState, useMemo, useEffect } from 'react';
import { confirmSaved } from '../services/confirmSave';
import { SINGLETON_ID } from '../shared/collections';
import { settingsError } from '../shared/settings';
import { sanitizeDateSettings } from '../shared/dateFormat';
import { DEFAULT_BREAKING_HOURS } from '../shared/newsWorkflow';
import { themePreference, setThemePreference, reducedMotion, setReducedMotion } from '../services/theme';
import { apiFetch } from '../services/http';
import { useFormDraft } from '../hooks/useFormDraft';
import { DraftStatus } from '../components/common/DraftStatus';
import { NewsTemplatesSettings } from '../components/settings/NewsTemplatesSettings';
import { ProductionListsSettings } from '../components/settings/ProductionListsSettings';
import { AirDisplaySettings } from '../components/settings/AirDisplaySettings';
import {
  Settings,
  Tv,
  CalendarClock,
  Globe,
  Rss,
  Users,
  Layers,
  Save,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Download,
  Upload,
  HardDrive,
  AlertTriangle,
  X,
  Search,
  Sparkles,
  Palette,
  Hash,
  FileText,
  Tag,
} from 'lucide-react';
import { Category, NewsSource, User, NewsItem } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SourceFeedEditor } from '../components/settings/SourceFeedEditor';
import { apiService } from '../services/api';

interface SettingsViewProps {
  categories: Category[];
  sources: NewsSource[];
  users: User[];
  newsList?: NewsItem[];
  onSaveCategory: (cat: Partial<Category>) => void;
  onDeleteCategory: (id: string) => void;
  onSaveSource: (source: Partial<NewsSource>) => boolean | Promise<boolean>;
  onDeleteSource: (id: string) => void;
  /** Opens «المستخدمون والصلاحيات». */
  onOpenUsers?: () => void;
}

type SettingsSection = 'station' | 'editorial' | 'production' | 'airDisplay' | 'preferences' | 'system' | 'datetime' | 'categories' | 'sources' | 'data';
const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: any }[] = [
  { id: 'station', label: 'المؤسسة والفريق', hint: 'اسم القناة والمنطقة الزمنية والفريق', icon: Tv },
  { id: 'editorial', label: 'الأخبار والتحرير', hint: 'قوالب الأخبار وأولوية الخبر ومدة العاجل ومدة الفقرة', icon: FileText },
  { id: 'production', label: 'قوائم الإنتاج', hint: 'المذيعون والمخرجون والاستديوهات', icon: Users },
  { id: 'airDisplay', label: 'عرض الهواء', hint: 'العرض التشغيلي ونص المذيع', icon: Tv },
  { id: 'preferences', label: 'تفضيلات هذا الجهاز', hint: 'المظهر وتقليل الحركة', icon: Palette },
  { id: 'system', label: 'حالة النظام', hint: 'الخادم والأمان والنسخ الاحتياطي', icon: Settings },
  { id: 'datetime', label: 'التاريخ والوقت', hint: 'التوقيت الموحد والتقويم والساعة', icon: CalendarClock },
  { id: 'categories', label: 'الأقسام الصحفية', hint: 'تصنيفات الأخبار وألوانها', icon: Layers },
  { id: 'sources', label: 'الوكالات والمصادر', hint: 'المصادر وخلاصات البرقيات', icon: Rss },
  { id: 'data', label: 'البيانات', hint: 'التصدير والاستعادة والبيانات التجريبية', icon: HardDrive },
];
const SECTION_KEY = 'nrcs-settings-section';

const SettingsNav: React.FC<{ section: SettingsSection; onChange: (s: SettingsSection) => void; counts: Record<string, number> }> = ({ section, onChange, counts }) => (
  <nav aria-label="أقسام الإعدادات" className="grid grid-cols-2 lg:grid-cols-3 gap-2">
    {SECTIONS.map((sec) => {
      const Icon = sec.icon;
      const active = sec.id === section;
      return (
        <button
          key={sec.id}
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={() => onChange(sec.id)}
          className={`text-right min-h-11 p-2 sm:p-3 rounded-lg border transition-colors flex items-center gap-2 ${
            active ? 'bg-blue-50 border-blue-600 text-blue-900' : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40'
          }`}
        >
          <span className={`hidden sm:block p-2 rounded-lg shrink-0 ${active ? 'text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            <Icon className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold">
              {sec.label}
              {counts[sec.id] !== undefined && <span className="ms-1 text-xs text-slate-600">({counts[sec.id]})</span>}
            </span>
            <span className="hidden sm:block text-xs mt-0.5 leading-snug text-slate-600">{sec.hint}</span>
          </span>
        </button>
      );
    })}
  </nav>
);

const PRESET_COLORS = [
  { name: 'أحمر عاجل / سياسي', hex: '#dc2626' },
  { name: 'أخضر اقتصادي', hex: '#16a34a' },
  { name: 'أزرق محلي / عام', hex: '#2563eb' },
  { name: 'بنفسجي دولي', hex: '#7c3aed' },
  { name: 'سماوي تقني', hex: '#0891b2' },
  { name: 'برتقالي رياضي', hex: '#ea580c' },
  { name: 'كهرماني ثقافي', hex: '#d97706' },
  { name: 'وردي مجتمعي', hex: '#db2777' },
  { name: 'نيلي استقصائي', hex: '#4f46e5' },
  { name: 'رمادي داكن', hex: '#475569' },
];

const PRESET_CATEGORIES = [
  { nameAr: 'تحقيقات استقصائية', nameEn: 'Investigations', color: '#4f46e5', desc: 'تقارير معمقة وتغطيات حصرية استقصائية' },
  { nameAr: 'شؤون الطاقة والنفط', nameEn: 'Energy & Oil', color: '#16a34a', desc: 'أسواق النفط، الغاز، والطاقة المتجددة' },
  { nameAr: 'ذكاء اصطناعي وأمن رقمي', nameEn: 'AI & Cyber', color: '#0891b2', desc: 'الابتكار والتقنيات الناشئة والأمن السيبراني' },
  { nameAr: 'بيئة ومناخ', nameEn: 'Environment', color: '#059669', desc: 'الاستدامة، التغير المناخي، والطقس المتطرف' },
  { nameAr: 'فنون وسينما', nameEn: 'Arts & Cinema', color: '#d97706', desc: 'المهرجانات الفنية والإصدارات السينمائية' },
  { nameAr: 'صحة وطب', nameEn: 'Health & Medicine', color: '#db2777', desc: 'الأبحاث الطبية، الصحة العامة، والمستجدات الوبائية' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  categories = [],
  sources = [],
  users = [],
  newsList = [],
  onSaveCategory,
  onDeleteCategory,
  onSaveSource,
  onDeleteSource,
  onOpenUsers,
}) => {
  const [section, setSection] = useState<SettingsSection>(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY) as SettingsSection | null;
      return saved && SECTIONS.some((x) => x.id === saved) ? saved : 'station';
    } catch {
      return 'station';
    }
  });
  const chooseSection = async (next: SettingsSection) => {
    if (saving) return;
    if (dirty && !await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'الانتقال دون حفظ التغييرات؟', confirmLabel: 'تجاهل التغييرات' })) return;
    if (dirty) resetGeneral();
    setSection(next);
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };
  const initialSettings = useMemo(() => apiService.getSettings(), []);
  const [stationName, setStationName] = useState(initialSettings.organizationName || '');
  const [timezone, setTimezone] = useState(initialSettings.defaultTimezone || 'Asia/Riyadh');
  const timezoneOptions = useMemo(() => {
    const common = ['Asia/Riyadh', 'Asia/Dubai', 'Africa/Cairo', 'Asia/Kuwait', 'Asia/Amman', 'Europe/London', 'UTC', 'Europe/Istanbul', 'Asia/Tokyo', 'America/New_York'];
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    let supported: string[] = [];
    try { supported = intl.supportedValuesOf?.('timeZone') || []; } catch { /* Older browsers retain the common zones. */ }
    return [...new Set([...common, initialSettings.defaultTimezone || 'Asia/Riyadh', ...supported])];
  }, [initialSettings.defaultTimezone]);
  const [defaultDuration, setDefaultDuration] = useState(initialSettings.defaultSegmentDurationSeconds ?? 180);
  const [isSaved, setIsSaved] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [channelName, setChannelName] = useState(initialSettings.primaryChannelName || '');
  const [organizationNameEn, setOrganizationNameEn] = useState(initialSettings.organizationNameEn || '');
  const [newsPriority, setNewsPriority] = useState(initialSettings.defaultNewsPriority || 'NORMAL');
  const [breakingHours, setBreakingHours] = useState(initialSettings.breakingDurationHours ?? DEFAULT_BREAKING_HOURS);
  const [appearance, setAppearance] = useState(themePreference());
  const [lessMotion, setLessMotion] = useState(reducedMotion());
  const [runtime, setRuntime] = useState<Record<string, any> | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  useEffect(() => {
    if (section !== 'system') return;
    let active = true;
    setRuntime(null); setRuntimeError('');
    void apiFetch<{ data: Record<string, any> }>('/api/v1/admin/runtime').then(result => {
      if (active) setRuntime(result.data);
    }).catch(() => { if (active) setRuntimeError('تعذر قراءة حالة النظام. تحقق من الاتصال والصلاحيات.'); });
    return () => { active = false; };
  }, [section]);
  const [useStationTime, setUseStationTime] = useState(sanitizeDateSettings(initialSettings.dateTime).timeBasis === 'station');
  const values = { organizationName: stationName, organizationNameEn, primaryChannelName: channelName, defaultTimezone: timezone, defaultSegmentDurationSeconds: defaultDuration, defaultNewsPriority: newsPriority, breakingDurationHours: breakingHours, timeBasis: useStationTime };
  const [baseline, setBaseline] = useState(values);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const restoreGeneral = (saved: typeof values) => {
    setStationName(saved.organizationName); setOrganizationNameEn(saved.organizationNameEn);
    setChannelName(saved.primaryChannelName); setTimezone(saved.defaultTimezone);
    setDefaultDuration(saved.defaultSegmentDurationSeconds); setNewsPriority(saved.defaultNewsPriority);
    setBreakingHours(saved.breakingDurationHours); setUseStationTime(saved.timeBasis);
  };
  const draft = useFormDraft(`settings:${apiService.getCurrentUser().id}`, true, values, restoreGeneral);
  const resetGeneral = () => {
    restoreGeneral(baseline);
    setGeneralError(null); setIsSaved(false);
  };
  const [backupMsg, setBackupMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Search & Filter Categories
  const [categorySearch, setCategorySearch] = useState('');

  // New Category Form State
  const [newCatNameAr, setNewCatNameAr] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');
  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatColor, setNewCatColor] = useState('#2563eb');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Edit Category Modal State
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editNameAr, setEditNameAr] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editColor, setEditColor] = useState('#2563eb');
  const [editDesc, setEditDesc] = useState('');

  // Delete Category Confirmation Modal State
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  // New Source State
  const [newSourceName, setNewSourceName] = useState('');
  const [feedEditingId, setFeedEditingId] = useState<string | null>(null);
  const [newSourceType, setNewSourceType] = useState('وكالة أنباء عالمية');
  const [newSourceReliability, setNewSourceReliability] = useState(5);

  // Count news per category
  const newsCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    (newsList || []).forEach((item) => {
      if (item.categoryId) {
        counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
      }
      if (item.categoryName) {
        counts[item.categoryName] = (counts[item.categoryName] || 0) + 1;
      }
    });
    return counts;
  }, [newsList]);

  // Filtered categories
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const q = categorySearch.toLowerCase();
    return categories.filter(
      (c) =>
        c.nameAr.toLowerCase().includes(q) ||
        (c.nameEn && c.nameEn.toLowerCase().includes(q)) ||
        (c.slug && c.slug.toLowerCase().includes(q)) ||
        (c.description && c.description.toLowerCase().includes(q))
    );
  }, [categories, categorySearch]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setIsSaved(false);
    setGeneralError(null);
    const name = stationName.trim();
    const duration = Math.round(Number(defaultDuration));
    if (!name) {
      setGeneralError('اسم المؤسسة مطلوب');
      return;
    }
    if (!Number.isFinite(duration) || duration < 10 || duration > 3600) {
      setGeneralError('الزمن الافتراضي للفقرة يجب أن يكون بين 10 و 3600 ثانية');
      return;
    }
    if (timezone.trim() && !stationTimeZone(timezone)) {
      setGeneralError('المنطقة الزمنية غير معروفة؛ اختر من القائمة مثل Asia/Riyadh');
      return;
    }
    try {
      const patch = {
        organizationName: name,
        organizationNameEn: organizationNameEn.trim(),
        primaryChannelName: channelName.trim(),
        defaultTimezone: timezone.trim() || 'Asia/Riyadh',
        defaultSegmentDurationSeconds: duration,
        defaultNewsPriority: newsPriority,
        breakingDurationHours: breakingHours,
        dateTime: { ...sanitizeDateSettings(apiService.getSettings().dateTime), timeBasis: useStationTime ? 'station' as const : 'device' as const },
      };
      const error = settingsError({ ...apiService.getSettings(), ...patch });
      if (error) { setGeneralError(error); return; }
      if (timezone !== baseline.defaultTimezone || useStationTime !== baseline.timeBasis) {
        if (!await confirmDialog({ title: 'تغيير توقيت المحطة', message: 'يتغير عرض وإدخال الأوقات لجميع الزملاء، ولا تتغير المواعيد المحفوظة. اعتماد التغيير؟', confirmLabel: 'اعتماد التوقيت' })) return;
      }
      setSaving(true);
      // Preserve fields another administrator changed while this form was open.
      const changed = Object.fromEntries(Object.entries(patch).filter(([key]) => key === 'dateTime'
        ? useStationTime !== baseline.timeBasis
        : (values as Record<string, unknown>)[key] !== (baseline as Record<string, unknown>)[key]));
      apiService.saveSettings(changed);
      if (!await confirmSaved('settings', SINGLETON_ID, 'حُفظت إعدادات المحطة')) {
        setGeneralError('لم يؤكد الخادم حفظ الإعدادات. بقيت القيم المدخلة؛ أعد المحاولة بعد التحقق من الاتصال.');
        return;
      }
      setBaseline(values);
      draft.clearDraft();
      setIsSaved(true);
    } catch (err: any) {
      setGeneralError(err?.message || 'تعذر حفظ الإعدادات');
      return;
    } finally {
      setSaving(false);
    }
  };

  const handleExportBackup = () => {
    try {
      const json = apiService.exportClientBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `nrcs_newsroom_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupMsg({ text: 'تم تصدير وحفظ النسخة الاحتياطية بنجاح.', type: 'success' });
    } catch {
      setBackupMsg({ text: 'تعذر تصدير النسخة الاحتياطية.', type: 'error' });
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        if (!(await confirmDialog('سيتم إضافة السجلات غير الموجودة فقط من الملف، دون تعديل أي بيانات أو حسابات حالية. متابعة؟'))) return;
        try {
          const { added, skipped } = apiService.restoreClientBackup(content);
          setBackupMsg({
            text: `أُرسلت ${added} سجلاً جديداً للخادم، وتُخطي ${skipped} (موجود مسبقاً أو غير قابل للاستيراد). أي سجل يرفضه الخادم يظهر في تنبيه منفصل.`,
            type: 'success',
          });
        } catch (err: any) {
          setBackupMsg({ text: err?.message || 'فشل استعادة البيانات. تأكد من صحة ملف JSON.', type: 'error' });
        }
      }
    };
    reader.readAsText(file);
  };

  // Add new category
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatNameAr.trim()) return;

    const slug = newCatSlug.trim() || (newCatNameEn.trim() || newCatNameAr.trim()).toLowerCase().replace(/\s+/g, '-');
    onSaveCategory({
      nameAr: newCatNameAr.trim(),
      nameEn: newCatNameEn.trim() || newCatNameAr.trim(),
      slug,
      color: newCatColor,
      colorCode: newCatColor,
      description: newCatDesc.trim(),
      orderIndex: categories.length + 1,
    });

    // Reset Form
    setNewCatNameAr('');
    setNewCatNameEn('');
    setNewCatSlug('');
    setNewCatDesc('');
    setNewCatColor('#2563eb');
  };

  // Open edit modal
  const handleStartEdit = (cat: Category) => {
    setEditingCategory(cat);
    setEditNameAr(cat.nameAr);
    setEditNameEn(cat.nameEn || '');
    setEditSlug(cat.slug || '');
    setEditColor(cat.colorCode || cat.color || '#2563eb');
    setEditDesc(cat.description || '');
  };

  // Save edited category
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editNameAr.trim()) return;

    onSaveCategory({
      id: editingCategory.id,
      nameAr: editNameAr.trim(),
      nameEn: editNameEn.trim() || editNameAr.trim(),
      slug: editSlug.trim() || editNameAr.trim().toLowerCase().replace(/\s+/g, '-'),
      color: editColor,
      colorCode: editColor,
      description: editDesc.trim(),
      orderIndex: editingCategory.orderIndex,
    });

    setEditingCategory(null);
  };

  // Confirm delete
  const handleConfirmDelete = () => {
    if (categoryToDelete) {
      onDeleteCategory(categoryToDelete.id);
      setCategoryToDelete(null);
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim()) return;
    try {
    if (!(await onSaveSource({
      id: `src-${Date.now()}`,
      name: newSourceName.trim(),
      type: newSourceType,
      reliabilityScore: Number(newSourceReliability) || 5,
    }))) return;
    setNewSourceName('');
    } catch (err) {
      notify({ type: 'error', message: err instanceof Error ? err.message : 'تعذر حفظ المصدر' });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
            <Settings className="w-6 h-6" />
          </div>
          <span>الإعدادات</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          إعدادات المحطة مشتركة بين الزملاء. تفضيلات الجهاز خاصة بهذا المتصفح.
        </p>
      </div>

      {isSaved && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>تم حفظ إعدادات النظام وتطبيقها بنجاح على غرفة الأخبار ولوحة التحكم.</span>
        </div>
      )}

      <SettingsNav section={section} onChange={chooseSection} counts={{ categories: categories.length, sources: sources.length }} />
      <div role="search" className="space-y-2">
        <label htmlFor="settings-search" className="sr-only">البحث في الإعدادات</label>
        <input id="settings-search" type="search" value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} className="w-full min-h-11 border border-slate-300 rounded-lg px-3 bg-white text-slate-800" placeholder="البحث في الإعدادات" />
        {settingsSearch.trim() && <div aria-live="polite" className="flex flex-wrap gap-2">
          {SECTIONS.filter(s => `${s.label} ${s.hint}`.includes(settingsSearch.trim())).map(s => <button key={s.id} type="button" onClick={() => { void chooseSection(s.id); setSettingsSearch(''); }} className="min-h-11 px-3 text-blue-700 underline">{s.label}</button>)}
          {!SECTIONS.some(s => `${s.label} ${s.hint}`.includes(settingsSearch.trim())) && <p>لا توجد إعدادات مطابقة</p>}
        </div>}
      </div>
      {section === 'preferences' && <section className="space-y-4 border-b border-slate-200 py-4">
        <h2 className="text-lg font-bold">تفضيلات هذا الجهاز</h2>
        <div><label htmlFor="settings-appearance" className="block">المظهر</label><select id="settings-appearance" value={appearance} onChange={e => { const value = e.target.value as typeof appearance; setAppearance(value); setThemePreference(value); }} className="block min-h-11 border border-slate-300 rounded-lg px-3 mt-1"><option value="system">حسب الجهاز</option><option value="light">نهاري</option><option value="dark">ليلي</option></select></div>
        <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={lessMotion} onChange={e => { setLessMotion(e.target.checked); setReducedMotion(e.target.checked); }} />تقليل الحركة</label>
      </section>}
      {section === 'system' && <section className="space-y-4 border-b border-slate-200 py-4">
        <h2 className="text-lg font-bold">حالة النظام وإعدادات التشغيل المعتمدة</h2>
        {runtimeError ? <p role="alert">{runtimeError}</p> : !runtime ? <p role="status">جارٍ قراءة الحالة...</p> : <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {Object.entries({ 'الإصدار': runtime.version, 'قاعدة البيانات': runtime.databaseHealthy ? 'سليمة' : 'تحتاج مراجعة', 'مهلة الجلسة (ساعة)': runtime.sessionTtlHours, 'حد الطلبات في الدقيقة': runtime.rateLimitPerMinute, 'النسخ الدوري (ساعة)': runtime.backupIntervalHours || 'معطل', 'عدد النسخ المحلية المحتفظ بها': runtime.backupRetention, 'وجهة النسخ الخارجية': runtime.externalBackup ? 'معدة' : 'غير معدة', 'الوجهة السحابية': runtime.cloudBackup ? 'معدة' : 'غير معدة', 'كوكي الاتصال الآمن': runtime.secureCookie ? 'مفعلة' : 'غير مفعلة' }).map(([key, value]) => <div key={key} className="border-b border-slate-200 py-2"><dt className="text-slate-600">{key}</dt><dd className="font-semibold break-words">{String(value)}</dd></div>)}
        </dl>}
      </section>}

      {(section === 'station' || section === 'editorial') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General Station Config */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Tv className="w-4 h-4 text-blue-600" />
            <span>{section === 'station' ? 'بيانات المحطة الإخبارية والبث' : 'الافتراضات التحريرية'}</span>
          </h3>

          <form onSubmit={handleSaveGeneral} className="space-y-3 text-xs" aria-busy={saving}>
            <DraftStatus draft={draft} />
            <fieldset disabled={saving} aria-label="إعدادات المحطة والتحرير" className="space-y-3">
            {section === 'station' && <>
            <div>
              <label htmlFor="station-name-input" className="block font-bold text-slate-700 mb-1">اسم القناة / المؤسسة الإعلامية</label>
              <input
                id="station-name-input"
                aria-describedby={generalError ? 'settings-error' : undefined}
                required
                maxLength={120}
                type="text"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <label className="block font-bold">اسم المؤسسة بالإنجليزية<input value={organizationNameEn} maxLength={120} onChange={e => setOrganizationNameEn(e.target.value)} dir="ltr" className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 mt-1" /></label>
            <label className="block font-bold">اسم قناة البث<input value={channelName} maxLength={120} onChange={e => setChannelName(e.target.value)} className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 mt-1" /></label>
            <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={useStationTime} onChange={e => setUseStationTime(e.target.checked)} />اعتماد توقيت المحطة لجميع الزملاء</label>
            <p role="status" className="text-slate-600">{useStationTime ? `التوقيت المعتمد: ${timezone}` : 'التوقيت المعتمد: جهاز كل مستخدم؛ المنطقة المختارة لا تُطبق على حقول المواعيد حتى تفعيل توقيت المحطة.'}</p>
            </>}

            <div className="grid grid-cols-1 gap-3">
              {section === 'station' && <div>
                <label htmlFor="station-timezone-input" className="block font-bold text-slate-700 mb-1">المنطقة الزمنية </label>
                <select
                  id="station-timezone-input"
                  aria-describedby={generalError ? 'settings-error' : undefined}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  dir="ltr"
                >
                  {[...new Set([...timezoneOptions, timezone])].map(zone => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </div>}

              {section === 'editorial' && <div>
                <label htmlFor="station-duration-input" className="block font-bold text-slate-700 mb-1">الزمن الافتراضي للفقرة (ثانية)</label>
                <input
                  id="station-duration-input"
                  type="number"
                  min={10}
                  max={3600}
                  step={5}
                  inputMode="numeric"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>}
            </div>
            {section === 'editorial' && <>
            <label className="block font-bold">أولوية الخبر الافتراضية<select value={newsPriority} onChange={e => setNewsPriority(e.target.value as typeof newsPriority)} className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 mt-1"><option value="LOW">منخفضة</option><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="URGENT">عاجلة</option></select></label>
            <label className="block font-bold">مدة العاجل الافتراضية (ساعة)<input type="number" min={0.25} max={24} step={0.25} value={breakingHours} onChange={e => setBreakingHours(Number(e.target.value))} className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 mt-1" /></label>
            </>}
            </fieldset>
            <div className="sticky bottom-0 bg-white border-t border-slate-200 py-3 flex flex-wrap gap-3 items-center">

            <button
              type="submit"
              disabled={saving || !dirty}
              className="flex min-h-11 items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all shadow-xs disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات العامة'}</span>
            </button>
            <button type="button" disabled={saving || !dirty} onClick={resetGeneral} className="min-h-11 px-3 text-slate-700">إلغاء التغييرات</button>
            <span role="status">{dirty ? 'تغييرات غير محفوظة' : 'لا توجد تغييرات معلقة'}</span>
            </div>
            {generalError && <p id="settings-error" role="alert" className="text-rose-600 font-bold">{generalError}</p>}
          </form>
        </div>

        {/* Team summary: the full directory lives in «المستخدمون والصلاحيات». */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <span>الفريق والصلاحيات</span>
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-black text-slate-800">{users.filter((u) => u.isActive !== false).length}</p>
              <p className="text-[11px] text-slate-500">حساب نشط</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-black text-slate-800">{users.filter((u) => u.isActive === false).length}</p>
              <p className="text-[11px] text-slate-500">موقوف</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-black text-slate-800">{users.filter((u) => u.twoFactorEnabled).length}</p>
              <p className="text-[11px] text-slate-500">بالتحقق بخطوتين</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {users.slice(0, 10).map((u) => (
              <Avatar key={u.id} src={u.avatarUrl} name={u.fullName} className="w-8 h-8 rounded-full" />
            ))}
          </div>
          {onOpenUsers && (
            <button type="button" onClick={onOpenUsers} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700">
              <Users className="w-3.5 h-3.5" /> إدارة المستخدمين والأدوار
            </button>
          )}
        </div>
        </div>
      )}

      {section === 'editorial' && <NewsTemplatesSettings />}
      {section === 'production' && <ProductionListsSettings currentUser={apiService.getCurrentUser()} />}
      {section === 'airDisplay' && <AirDisplaySettings />}
      {section === 'categories' && (
      <div className="bg-white p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>الأقسام الصحفية وألوانها</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-mono font-bold">
                  {categories.length} أقسام
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                يمكنك إنشاء، تعديل، وحذف تصنيفات الأخبار وتخصيص الألوان لكل منها لتسهيل الفلترة الفورية في لوحة التحكم ومحرر الأخبار
              </p>
            </div>
          </div>
        </div>

        {/* Categories Overview & Creation Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Create New Category Form (5 cols on lg) */}
          <div className="lg:col-span-5 bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>إضافة قسم صحفي جديد</span>
              </h3>
              <span className="text-[11px] text-slate-500">تخصيص لوني فوري</span>
            </div>

            <form onSubmit={handleAddCategory} className="space-y-3.5 text-xs">
              {/* Arabic Name */}
              <div>
                <label htmlFor="new-cat-name-ar-input" className="block font-bold text-slate-700 mb-1">
                  اسم القسم بالعربية <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="new-cat-name-ar-input"
                    type="text"
                    required
                    value={newCatNameAr}
                    onChange={(e) => {
                      setNewCatNameAr(e.target.value);
                      if (!newCatSlug) {
                        setNewCatSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                      }
                    }}
                    placeholder="مثال: ذكاء اصطناعي، طاقة وبيئة..."
                    className="w-full pr-3 pl-8 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                  {newCatNameAr && (
                    <button
                      type="button"
                      onClick={() => setNewCatNameAr('')}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* English Name & Slug */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="new-cat-name-en-input" className="block font-bold text-slate-700 mb-1">الاسم بالإنجليزية</label>
                  <input
                    id="new-cat-name-en-input"
                    type="text"
                    value={newCatNameEn}
                    onChange={(e) => setNewCatNameEn(e.target.value)}
                    placeholder="e.g. Technology"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                    dir="ltr"
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                </div>
                <div>
                  <label htmlFor="new-cat-slug-input" className="block font-bold text-slate-700 mb-1">المعرف (Slug)</label>
                  <input
                    id="new-cat-slug-input"
                    type="text"
                    value={newCatSlug}
                    onChange={(e) => setNewCatSlug(e.target.value)}
                    placeholder="e.g. tech"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                    dir="ltr"
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                </div>
              </div>

              {/* Color Picker & Curated Swatches */}
              <div>
                <label htmlFor="new-cat-color-picker" className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-blue-600" />
                    <span>لون التصنيف المخصص</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                    {newCatColor}
                  </span>
                </label>

                <div className="flex items-center gap-2 mb-2">
                  <input
                    id="new-cat-color-picker"
                    type="color"
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                    className="w-10 h-10 p-0.5 border border-slate-300 rounded-xl cursor-pointer shrink-0 bg-white shadow-2xs"
                    title="اختر لوناً مخصصاً بدقة"
                  />
                  <input
                    id="new-cat-color-hex"
                    type="text"
                    value={newCatColor}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewCatColor(val.startsWith('#') ? val : `#${val}`);
                    }}
                    placeholder="#2563eb"
                    pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
                    maxLength={7}
                    dir="ltr"
                    className="w-24 px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold bg-white focus:ring-2 focus:ring-blue-500 uppercase"
                    title="رمز اللون بنظام Hex مثل #2563eb"
                  />
                  <div className="text-[11px] text-slate-500 leading-tight">
                    انقر على المربع اللوني، أو اكتب كود Hex، أو اختر نموذجاً من الأسفل.
                  </div>
                </div>

                {/* Preset Color Swatches */}
                <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded-xl border border-slate-200/80">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewCatColor(c.hex)}
                      title={c.name}
                      className={`w-6 h-6 rounded-lg transition-transform ${
                        newCatColor.toLowerCase() === c.hex.toLowerCase()
                          ? 'ring-2 ring-offset-2 ring-slate-800 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="new-cat-desc-input" className="block font-bold text-slate-700 mb-1">وصف موجز لنطاق التغطية</label>
                <textarea
                  id="new-cat-desc-input"
                  rows={2}
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  placeholder="وصف طبيعة الأخبار والمواد التابعة لهذا القسم..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Live Preview Card */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  معاينة حية للشارة والبطاقة
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="px-3 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all shadow-2xs"
                    style={{
                      backgroundColor: `${newCatColor}15`,
                      color: newCatColor,
                      borderColor: `${newCatColor}40`,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: newCatColor }}
                    />
                    <span>{newCatNameAr || 'اسم القسم الصحفي'}</span>
                  </span>

                  <span className="text-[11px] text-slate-500 font-mono">
                    {newCatNameEn ? `(${newCatNameEn})` : ''}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة وتفعيل القسم الصحفي</span>
              </button>
            </form>

            {/* Presets Quick Insert */}
            <div className="pt-2 border-t border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 block mb-1.5">
                أقسام جاهزة ومقترحة لغرفة الأخبار:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_CATEGORIES.map((preset) => (
                  <button
                    key={preset.nameAr}
                    type="button"
                    onClick={() => {
                      setNewCatNameAr(preset.nameAr);
                      setNewCatNameEn(preset.nameEn);
                      setNewCatSlug(preset.nameEn.toLowerCase().replace(/\s+/g, '-'));
                      setNewCatColor(preset.color);
                      setNewCatDesc(preset.desc);
                    }}
                    className="text-[11px] bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2 py-1 rounded-lg transition-colors border border-slate-200 flex items-center gap-1.5"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
                    <span>+{preset.nameAr}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Categories List & Management Table (7 cols on lg) */}
          <div className="lg:col-span-7 space-y-3">
            {/* Search & Stats Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="ابحث في التصنيفات الحالية بالاسم أو المعرف..."
                  className="w-full pr-9 pl-8 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
                />
                {categorySearch && (
                  <button
                    type="button"
                    onClick={() => setCategorySearch('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-500 shrink-0 font-medium">
                عرض {filteredCategories.length} من أصل {categories.length}
              </div>
            </div>

            {/* Category Cards List */}
            <div className="space-y-2.5">
              {filteredCategories.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                  لا توجد أقسام مطابقة للبحث "{categorySearch}".
                </div>
              ) : (
                filteredCategories.map((cat) => {
                  const color = cat.colorCode || cat.color || '#2563eb';
                  const countById = newsCountByCategory[cat.id] || 0;
                  const countByName = newsCountByCategory[cat.nameAr] || 0;
                  const totalNews = Math.max(countById, countByName);

                  return (
                    <div
                      key={cat.id}
                      className="p-3.5 bg-white hover:bg-slate-50/60 rounded-xl border border-slate-200 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:border-slate-300 group"
                    >
                      <div className="flex items-start sm:items-center gap-3 min-w-0">
                        {/* Dynamic Color Circle */}
                        <div
                          className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center font-bold text-white shadow-2xs border"
                          style={{
                            backgroundColor: color,
                            borderColor: `${color}60`,
                          }}
                        >
                          <Tag className="w-4 h-4 text-white" />
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <strong className="text-slate-800 text-xs sm:text-sm font-bold">
                              {cat.nameAr}
                            </strong>
                            {cat.nameEn && (
                              <span className="text-[11px] text-slate-500 font-mono" dir="ltr">
                                {cat.nameEn}
                              </span>
                            )}
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border"
                              style={{
                                backgroundColor: `${color}15`,
                                color: color,
                                borderColor: `${color}30`,
                              }}
                            >
                              {color}
                            </span>
                          </div>

                          {cat.description ? (
                            <p className="text-[11px] text-slate-500 line-clamp-1">{cat.description}</p>
                          ) : (
                            <p className="text-[11px] text-slate-500 font-mono">slug: {cat.slug || cat.id}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        {/* News count badge */}
                        <span
                          className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                          title="عدد الأخبار المرتبطة بهذا التصنيف"
                        >
                          {totalNews} {totalNews === 1 ? 'خبر' : 'أخبار'}
                        </span>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(cat)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="تعديل بيانات ولون التصنيف"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const inUse = (newsList || []).filter((n) => n.categoryId === cat.id).length;
                              if (inUse > 0) {
                                notify({ type: 'warning', message: `لا يمكن حذف قسم (${cat.nameAr}) لأنه مرتبط بـ ${inUse} مادة إخبارية. انقل المواد إلى قسم آخر أولاً.` });
                                return;
                              }
                              setCategoryToDelete(cat);
                            }}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="حذف هذا التصنيف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      )}

      {section === 'sources' && (
        <div className="max-w-4xl">
        {/* News Sources Manager */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600" />
            <span>وكالات ومصادر الأخبار المعتمدة</span>
          </h3>

          <form onSubmit={handleAddSource} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="relative">
                <input
                  id="new-source-name-input"
                  type="text"
                  required
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="اسم الوكالة / المصدر..."
                  className="w-full pr-3 pl-8 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
                {newSourceName && (
                  <button
                    type="button"
                    onClick={() => setNewSourceName('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
                    aria-label="مسح اسم المصدر"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="new-source-type-input"
                  type="text"
                  value={newSourceType}
                  onChange={(e) => setNewSourceType(e.target.value)}
                  placeholder="نوع المصدر..."
                  className="w-full pr-3 pl-8 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
                {newSourceType && (
                  <button
                    type="button"
                    onClick={() => setNewSourceType('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 p-0.5"
                    aria-label="مسح نوع المصدر"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
              >
                إضافة مصدر
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {['وكالة رويترز', 'وكالة فرانس برس', 'واس السعودية', 'بلومبرغ نيوز', 'مراسل ميداني'].map((srcPreset) => (
                <button
                  key={srcPreset}
                  type="button"
                  onClick={() => {
                    setNewSourceName(srcPreset);
                    setNewSourceType(srcPreset.includes('وكالة') ? 'وكالة أنباء عالمية' : 'مراسل خاص');
                  }}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded transition-colors"
                >
                  +{srcPreset}
                </button>
              ))}
            </div>
          </form>

          <div className="space-y-2">
            {sources.map((src) => (
              <div key={src.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <strong className="text-slate-800 block">{src.name}</strong>
                  <span className="text-[11px] text-slate-500">{src.type}</span>
                  {src.feedUrl && (
                    <span className={`block text-[10px] font-bold ${src.feedEnabled ? 'text-orange-700' : 'text-slate-500'}`}>
                      {src.feedEnabled ? 'خلاصة RSS مفعّلة' : 'خلاصة RSS متوقفة'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setFeedEditingId(feedEditingId === src.id ? null : src.id)}
                    className="text-orange-500 hover:text-orange-700 p-1"
                    title="ربط خلاصة RSS للبرقيات"
                    aria-label={`خلاصة RSS للمصدر ${src.name}`}
                  >
                    <Rss className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-mono text-emerald-700 font-bold">
                    موثوقية {src.reliabilityScore}/5
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const inUse = (newsList || []).filter((n) => n.sourceId === src.id).length;
                      if (inUse > 0) {
                        notify({ type: 'warning', message: `لا يمكن حذف المصدر (${src.name}) لأنه مرتبط بـ ${inUse} مادة إخبارية.` });
                        return;
                      }
                      if ((await confirmDialog(`حذف المصدر (${src.name}) نهائياً؟`))) onDeleteSource(src.id);
                    }}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {feedEditingId === src.id && (
                <SourceFeedEditor source={src} onSave={onSaveSource} onClose={() => setFeedEditingId(null)} />
              )}
              </div>
            ))}
          </div>
        </div>

        </div>
      )}

      {section === 'datetime' && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-600" />
            <span>التاريخ والوقت للمحطة</span>
          </h3>
          <StationDateTimeSettings canEdit={RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings')} />
        </section>
      )}

      {section === 'data' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Production Backup & Disaster Recovery Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-700" />
            <span>التصدير والاستعادة</span>
          </h3>

          {backupMsg && (
            <div
              className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                backupMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {backupMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{backupMsg.text}</span>
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <strong className="text-slate-800 block font-bold text-xs">
                تصدير نسخة كاملة (ملف JSON)
              </strong>
              <p className="text-slate-500 text-[11px]">
                تنزيل ملف كامل لبيانات غرفة الأخبار، التصنيفات، والتغطيات.
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold transition-all shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                تحميل النسخة الاحتياطية (JSON)
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <strong className="text-slate-800 block font-bold text-xs">
                استعادة من ملف نسخة احتياطية
              </strong>
              <p className="text-slate-500 text-[11px]">
                استيراد ملف نسخة احتياطية واستئناف العمل فوراً.
              </p>
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-xs cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>اختيار ملف واستعادة</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
          <DemoDataCard />
        </div>
      )}

      {/* MODAL: EDIT CATEGORY */}
      {editingCategory && (
        <FormPage
          isOpen={true}
          onClose={() => setEditingCategory(null)}
          title={`تعديل القسم الصحفي: ${editingCategory.nameAr}`}
          subtitle="تعديل اسم وتخصيص لون التصنيف لتحديثه في كافة شاشات العمل"
          maxWidth="lg"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div>
              <label htmlFor="edit-cat-name-ar-input" className="block font-bold text-slate-700 mb-1">
                اسم القسم بالعربية <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-cat-name-ar-input"
                type="text"
                required
                value={editNameAr}
                onChange={(e) => setEditNameAr(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-bold text-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-cat-name-en-input" className="block font-bold text-slate-700 mb-1">الاسم بالإنجليزية</label>
                <input
                  id="edit-cat-name-en-input"
                  type="text"
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                  dir="ltr"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </div>
              <div>
                <label htmlFor="edit-cat-slug-input" className="block font-bold text-slate-700 mb-1">المعرف (Slug)</label>
                <input
                  id="edit-cat-slug-input"
                  type="text"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                  dir="ltr"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </div>
            </div>

            {/* Edit Color & Palette */}
            <div>
              <label htmlFor="edit-cat-color-picker" className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>تخصيص اللون</span>
                <span className="font-mono text-[11px] text-slate-500">{editColor}</span>
              </label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  id="edit-cat-color-picker"
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-10 h-10 p-0.5 border border-slate-300 rounded-xl cursor-pointer shrink-0 bg-white"
                />
                <input
                  id="edit-cat-color-hex"
                  type="text"
                  value={editColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditColor(val.startsWith('#') ? val : `#${val}`);
                  }}
                  placeholder="#2563eb"
                  pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
                  maxLength={7}
                  dir="ltr"
                  className="w-24 px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-mono font-bold bg-white focus:ring-2 focus:ring-blue-500 uppercase"
                  title="رمز اللون بنظام Hex"
                />
                <span className="text-[11px] text-slate-500">
                  انقر لاختيار لون دقيق أو اكتب كود Hex أو اختر من النماذج أدناه:
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-200">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setEditColor(c.hex)}
                    title={c.name}
                    className={`w-6 h-6 rounded-lg transition-transform ${
                      editColor.toLowerCase() === c.hex.toLowerCase()
                        ? 'ring-2 ring-offset-2 ring-slate-800 scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="edit-cat-desc-input" className="block font-bold text-slate-700 mb-1">الوصف ونطاق التغطية</label>
              <textarea
                id="edit-cat-desc-input"
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Live Preview */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <span className="text-[10px] font-bold text-slate-500 block uppercase">
                معاينة الشارة بعد التعديل:
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border"
                style={{
                  backgroundColor: `${editColor}15`,
                  color: editColor,
                  borderColor: `${editColor}35`,
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: editColor }} />
                <span>{editNameAr || 'اسم القسم'}</span>
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </form>
        </FormPage>
      )}

      {/* CONFIRM DELETE CATEGORY DIALOG */}
      {categoryToDelete && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setCategoryToDelete(null)}
          onConfirm={handleConfirmDelete}
          title={`تأكيد حذف القسم الصحفي (${categoryToDelete.nameAr})`}
          message={
            `هل أنت متأكد من رغبتك في حذف قسم (${categoryToDelete.nameAr})؟ لن تتمكن من استرجاعه إلا بإعادة إنشائه.`
          }
          confirmLabel="نعم، حذف التصنيف"
          cancelLabel="تراجع"
          isDestructive={true}
        />
      )}

    </div>
  );
};
