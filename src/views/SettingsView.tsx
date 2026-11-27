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
import { matchesQuery } from '../shared/search';
import { sanitizeDateSettings } from '../shared/dateFormat';
import { resolveColorPalette } from '../shared/appearancePalette';
import { DEFAULT_BREAKING_HOURS } from '../shared/newsWorkflow';
import { CATEGORY_HAS_CHILDREN, categoryBranchIds, categoryTree } from '../shared/newsCategories';
import { EditorialPublishingSettings } from '../components/settings/EditorialPublishingSettings';
import { themePreference, setThemePreference, reducedMotion, setReducedMotion, setTextScale, TEXT_SCALES, textScale, type TextScale } from '../services/theme';
import { apiFetch } from '../services/http';
import { useFormDraft } from '../hooks/useFormDraft';
import { DraftStatus } from '../components/common/DraftStatus';
import { NewsTemplatesSettings } from '../components/settings/NewsTemplatesSettings';
import { ProductionListsSettings } from '../components/settings/ProductionListsSettings';
import { TaskWorkflowSettings } from '../components/settings/TaskWorkflowSettings';
import { navigateTo } from '../services/uiEvents';
import { AirDisplaySettings } from '../components/settings/AirDisplaySettings';
import { StationsSettings } from '../components/settings/StationsSettings';
import { DepartmentsSettings } from '../components/settings/DepartmentsSettings';
import { OrgStructureSettings } from '../components/settings/OrgStructureSettings';
import { ColorPalettePicker } from '../components/settings/ColorPalettePicker';
import { SystemMonitor } from '../components/settings/SystemMonitor';
import { BackupReadinessSummary } from '../components/settings/BackupReadinessSummary';
import { AppUpdatesPanel } from '../components/settings/AppUpdatesPanel';
import { StorageSettings } from '../components/settings/StorageSettings';
import { ProgramTypesSettings } from '../components/settings/ProgramTypesSettings';
import { dataStore } from '../services/dataStore';
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
  Palette,
  FileText,
  Tag,
  Network,
  Activity,
  Cloud,
  ChevronUp,
  ChevronDown,
  Building2,
  Workflow,
} from 'lucide-react';
import { Category, NewsSource, User, NewsItem } from '../types';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { SourceFeedEditor } from '../components/settings/SourceFeedEditor';
import { PronunciationSettings } from '../components/settings/PronunciationSettings';
import { ModuleAccessSettings } from '../components/settings/ModuleAccessSettings';
import { apiService } from '../services/api';
import { AR, countLabel } from '../shared/arabicPlural';

interface SettingsViewProps {
  categories: Category[];
  sources: NewsSource[];
  users: User[];
  newsList?: NewsItem[];
  /** Resolves true once the server confirmed; undefined (legacy handlers) counts as saved. */
  onSaveCategory: (cat: Partial<Category>) => void | boolean | Promise<boolean>;
  onDeleteCategory: (id: string) => void;
  onSaveSource: (source: Partial<NewsSource>) => boolean | Promise<boolean>;
  onDeleteSource: (id: string) => void;
  /** Opens «المستخدمون والصلاحيات». */
  onOpenUsers?: () => void;
  /** Section to open with (e.g. 'sources' from the wires screen); wins over the remembered one. */
  initialSection?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  /** Source row to highlight, scroll to and open the feed editor of (with initialSection 'sources'). */
  focusSourceId?: string | null;
}

export type SettingsSection = 'modules' | 'station' | 'stations' | 'structure' | 'departments' | 'monitor' | 'editorial' | 'production' | 'airDisplay' | 'preferences' | 'system' | 'storage' | 'datetime' | 'categories' | 'sources' | 'data';
type SectionGroup = 'org' | 'news' | 'system' | 'device';
const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: 'org', label: 'المؤسسة' },
  { id: 'news', label: 'التحرير والهواء' },
  { id: 'system', label: 'النظام والبيانات' },
  { id: 'device', label: 'هذا الجهاز' },
];
const SECTIONS: { id: SettingsSection; group: SectionGroup; label: string; hint: string; icon: any }[] = [
  { id: 'station', group: 'org', label: 'المؤسسة والفريق', hint: 'اسم القناة والمنطقة الزمنية والفريق', icon: Tv },
  { id: 'stations', group: 'org', label: 'المحطات والتكليفات', hint: 'المحطة الرئيسية والفروع ومجموعات المحطات وارتباطها وأنواع المهام وأوزانها', icon: Network },
  { id: 'departments', group: 'org', label: 'الأقسام الإدارية', hint: 'أقسام المؤسسة ورؤساؤها ومحطاتها (غرفة التحرير، الإنتاج، المونتاج…)', icon: Building2 },
  { id: 'structure', group: 'org', label: 'الهيكل التنظيمي', hint: 'المحطات والمجموعات والأقسام ورؤساؤها وعدد الزملاء', icon: Workflow },
  { id: 'editorial', group: 'news', label: 'الأخبار والتحرير', hint: 'قوالب الأخبار وأولوية الخبر ومدة العاجل ومدة الفقرة', icon: FileText },
  { id: 'categories', group: 'news', label: 'تصنيفات الأخبار', hint: 'تصنيفات المواد الإخبارية وألوانها (غير الأقسام الإدارية)', icon: Layers },
  { id: 'sources', group: 'news', label: 'الوكالات والمصادر', hint: 'المصادر وخلاصات المصادر', icon: Rss },
  { id: 'production', group: 'news', label: 'قوائم الإنتاج', hint: 'سير عمل المهام والتكليفات وقوائم الإنتاج وأنواع البرامج', icon: Users },
  { id: 'airDisplay', group: 'news', label: 'عرض الهواء', hint: 'العرض التشغيلي ونص المذيع', icon: Tv },
  { id: 'datetime', group: 'news', label: 'التاريخ والوقت', hint: 'التوقيت الموحد والتقويم والساعة', icon: CalendarClock },
  { id: 'monitor', group: 'system', label: 'مراقبة النظام', hint: 'الجلسات النشطة والتخزين والمهام الدورية وما يحتاج تدخلاً', icon: Activity },
  { id: 'modules', group: 'system', label: 'وحدات النظام', hint: 'إتاحة وحدات العمل والميزات حسب المحطات والأقسام', icon: Settings },
  { id: 'system', group: 'system', label: 'حالة النظام', hint: 'الخادم والأمان والنسخ الاحتياطي', icon: Settings },
  { id: 'storage', group: 'system', label: 'التخزين', hint: 'Dropbox وGoogle Drive والمجلد المشترك وجسر مدار', icon: Cloud },
  { id: 'data', group: 'system', label: 'البيانات', hint: 'التصدير والاستعادة والبيانات التجريبية', icon: HardDrive },
  { id: 'preferences', group: 'device', label: 'تفضيلات هذا الجهاز', hint: 'المظهر وحجم الخط وتقليل الحركة', icon: Palette },
];
const SECTION_KEY = 'nrcs-settings-section';
const SECTION_SCOPE: Partial<Record<SettingsSection, string>> = {
  system: 'خادم المؤسسة · الأمان والنسخ والنشر تؤثر في كل المحطات المتصلة بهذا الخادم.',
  station: 'المؤسسة · الاسم وهوية البث والتوقيت الموحد مشتركة بين المحطات.',
  stations: 'المحطات · تعديلات سجل المحطة تنطبق على المحطة المختارة.',
  departments: 'المؤسسة · تحدد هنا بنية الأقسام الإدارية التي تستخدمها المحطات.',
  preferences: 'هذا الجهاز · يتغير العرض في هذا المتصفح.',
};
const GENERAL_LABEL = 'block font-bold text-slate-700 mb-1';
const GENERAL_INPUT = 'block w-full min-h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900';
const isSection = (value: unknown): value is SettingsSection => SECTIONS.some((x) => x.id === value);

const SOURCE_TYPE_LABELS: Record<string, string> = {
  REPORTER: 'مراسل',
  NEWS_AGENCY: 'وكالة أنباء',
  OFFICIAL_STATEMENT: 'بيان رسمي',
  INTERVIEW: 'مقابلة',
  SOCIAL_MEDIA: 'منصات التواصل',
  SPECIAL_SOURCE: 'مصدر خاص',
  OTHER: 'أخرى',
};
const sourceTypeLabel = (type?: string) => (type ? SOURCE_TYPE_LABELS[type] || type : '');
const SOURCE_TYPE_SUGGESTIONS = ['وكالة أنباء عالمية', 'وكالة أنباء', 'مراسل خاص', 'بيان رسمي', 'مقابلة', 'منصات التواصل', 'مصدر خاص'];
const RELIABILITY_OPTIONS = [
  { value: 5, label: '5 — عالية جداً' },
  { value: 4, label: '4 — عالية' },
  { value: 3, label: '3 — متوسطة' },
  { value: 2, label: '2 — ضعيفة' },
  { value: 1, label: '1 — ضعيفة جداً' },
];
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Sections grouped by what they set up. A vertical list beside the content on wide screens (the
 * content starts in the first viewport), a grouped selector above it on smaller screens.
 * Searching shows matching sections by label and hint.
 */
const SettingsNav: React.FC<{ section: SettingsSection; onChange: (s: SettingsSection) => void; counts: Record<string, number>; query: string; onQuery: (q: string) => void }> = ({ section, onChange, counts, query, onQuery }) => {
  const searching = Boolean(query.trim());
  const groups = GROUPS.map((group) => ({
    ...group,
    items: SECTIONS.filter((s) => s.group === group.id && (!searching || matchesQuery(query, s.label, s.hint))),
  })).filter(({ items }) => items.length);
  return (
    <div className="space-y-3 lg:sticky lg:top-4">
      <div role="search">
        <label htmlFor="settings-search" className="sr-only">البحث في الإعدادات</label>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input id="settings-search" type="search" value={query} onChange={(e) => onQuery(e.target.value)} className="w-full min-h-11 border border-slate-300 rounded-lg pr-9 pl-3 bg-white text-sm text-slate-800" placeholder="البحث في الإعدادات" />
        </div>
      </div>
      <nav aria-label="أقسام الإعدادات" className="space-y-3">
        {!searching && (
          <div className="lg:hidden">
            <label htmlFor="settings-section" className={GENERAL_LABEL}>قسم الإعدادات</label>
            <select id="settings-section" value={section} onChange={(e) => { if (isSection(e.target.value)) onChange(e.target.value); }} className={GENERAL_INPUT}>
              {groups.map(({ id, label, items }) => (
                <optgroup key={id} label={label}>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {!groups.length && <p role="status" className="text-sm text-slate-600 px-1">لا توجد إعدادات مطابقة</p>}
        <div className={`space-y-3 ${searching ? '' : 'hidden lg:block'}`}>
          {groups.map((group) => (
            <div key={group.id}>
              <h2 className="text-2xs font-bold text-slate-500 px-1 mb-1">{group.label}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1">
                {group.items.map((sec) => {
                  const Icon = sec.icon;
                  const active = sec.id === section;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      title={sec.hint}
                      onClick={() => onChange(sec.id)}
                      className={`text-right min-h-11 lg:min-h-9 px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-2 text-sm ${
                        active ? 'bg-blue-50 border-blue-600 text-blue-900 font-bold' : 'bg-white border-slate-200 lg:border-transparent lg:bg-transparent text-slate-700 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-700' : 'text-slate-500'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 leading-snug">{sec.label}</span>
                      {counts[sec.id] !== undefined && <span className="text-xs tabular-nums text-slate-600">{counts[sec.id]}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
};

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
  initialSection,
  onSectionChange,
  focusSourceId,
}) => {
  const [section, setSection] = useState<SettingsSection>(() => {
    if (isSection(initialSection)) return initialSection;
    // Back from a cloud provider's consent page (see StorageSettings).
    if (new URLSearchParams(window.location.search).has('storage')) return 'storage';
    try {
      const saved = localStorage.getItem(SECTION_KEY);
      return isSection(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  // A section asked for by another screen wins over the remembered one, and becomes the remembered one.
  useEffect(() => {
    if (!isSection(initialSection)) return;
    setSection(initialSection);
    try {
      localStorage.setItem(SECTION_KEY, initialSection);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }, [initialSection]);
  const chooseSection = async (next: SettingsSection) => {
    if (saving || next === section) return;
    if (dirty && !await confirmDialog({ title: 'تغييرات غير محفوظة', message: 'الانتقال دون حفظ التغييرات؟', confirmLabel: 'تجاهل التغييرات' })) return;
    if (dirty) resetGeneral();
    setSection(next);
    onSectionChange?.(next);
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
  const [colorPalette, setColorPalette] = useState(() => resolveColorPalette(initialSettings.colorPalette));
  const [organizationNameEn, setOrganizationNameEn] = useState(initialSettings.organizationNameEn || '');
  const [newsPriority, setNewsPriority] = useState(initialSettings.defaultNewsPriority || 'NORMAL');
  const [breakingHours, setBreakingHours] = useState(initialSettings.breakingDurationHours ?? DEFAULT_BREAKING_HOURS);
  const [appearance, setAppearance] = useState(themePreference());
  const [lessMotion, setLessMotion] = useState(reducedMotion());
  const [textSize, setTextSize] = useState<TextScale>(textScale());
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
  const values = { organizationName: stationName, organizationNameEn, primaryChannelName: channelName, colorPalette, defaultTimezone: timezone, defaultSegmentDurationSeconds: defaultDuration, defaultNewsPriority: newsPriority, breakingDurationHours: breakingHours, timeBasis: useStationTime };
  const [baseline, setBaseline] = useState(values);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const restoreGeneral = (saved: typeof values) => {
    setStationName(saved.organizationName); setOrganizationNameEn(saved.organizationNameEn);
    setChannelName(saved.primaryChannelName); setTimezone(saved.defaultTimezone);
    setColorPalette(resolveColorPalette(saved.colorPalette ?? apiService.getSettings().colorPalette));
    setDefaultDuration(saved.defaultSegmentDurationSeconds); setNewsPriority(saved.defaultNewsPriority);
    setBreakingHours(saved.breakingDurationHours); setUseStationTime(saved.timeBasis);
  };
  const draft = useFormDraft(`settings:${apiService.getCurrentUser().id}`, true, values, restoreGeneral, ['colorPalette']);
  const resetGeneral = () => {
    restoreGeneral(baseline);
    setGeneralError(null); setIsSaved(false);
  };
  const [backupMsg, setBackupMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Search & Filter Categories
  const [categorySearch, setCategorySearch] = useState('');

  // New Category Form State
  const [newCatNameAr, setNewCatNameAr] = useState('');
  const [newCatParentId, setNewCatParentId] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');
  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatColor, setNewCatColor] = useState('#2563eb');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Edit Category Modal State
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editNameAr, setEditNameAr] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editColor, setEditColor] = useState('#2563eb');
  const [editDesc, setEditDesc] = useState('');

  // Delete Category Confirmation Modal State
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [reordering, setReordering] = useState(false);

  // New Source State
  const [newSourceName, setNewSourceName] = useState('');
  const [feedEditingId, setFeedEditingId] = useState<string | null>(null);
  const [newSourceType, setNewSourceType] = useState('وكالة أنباء عالمية');
  const [newSourceReliability, setNewSourceReliability] = useState(5);
  const [addingSource, setAddingSource] = useState(false);

  // Edit Source State
  const [editingSource, setEditingSource] = useState<NewsSource | null>(null);
  const [editSourceName, setEditSourceName] = useState('');
  const [editSourceType, setEditSourceType] = useState('');
  const [editSourceReliability, setEditSourceReliability] = useState(5);
  const [savingSource, setSavingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // A source opened from the wires screen (e.g. a failing feed): show it and open its feed editor.
  const onSources = section === 'sources';
  useEffect(() => {
    if (!focusSourceId || !onSources) return;
    setFeedEditingId(focusSourceId);
    const t = setTimeout(() => document.getElementById(`source-row-${focusSourceId}`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }), 80);
    return () => clearTimeout(t);
  }, [focusSourceId, onSources]);

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

  const categoryEntries = useMemo(() => categoryTree(categories), [categories]);
  const editingBranch = useMemo(
    () => editingCategory ? categoryBranchIds(categories, editingCategory.id) : null,
    [categories, editingCategory],
  );
  const categorySiblings = (cat: Category) =>
    categoryEntries.map(({ category }) => category).filter(category => (category.parentId ?? null) === (cat.parentId ?? null));

  // Filtered categories
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categoryEntries;
    return categoryEntries.filter(({ category: c, path }) => matchesQuery(categorySearch, path, c.nameEn, c.slug, c.description));
  }, [categoryEntries, categorySearch]);

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
    setSaving(true);
    try {
      const patch = {
        organizationName: name,
        organizationNameEn: organizationNameEn.trim(),
        primaryChannelName: channelName.trim(),
        colorPalette,
        defaultTimezone: timezone.trim() || 'Asia/Riyadh',
        defaultSegmentDurationSeconds: duration,
        defaultNewsPriority: newsPriority,
        breakingDurationHours: breakingHours,
        dateTime: { ...sanitizeDateSettings(apiService.getSettings().dateTime), timeBasis: useStationTime ? 'station' as const : 'device' as const },
      };
      const current = apiService.getSettings();
      const error = settingsError({ ...current, ...patch }, current);
      if (error) { setGeneralError(error); return; }
      if (timezone !== baseline.defaultTimezone || useStationTime !== baseline.timeBasis) {
        if (!await confirmDialog({ title: 'تغيير توقيت المحطة', message: 'يتغير عرض وإدخال الأوقات لجميع الزملاء، ولا تتغير المواعيد المحفوظة. اعتماد التغيير؟', confirmLabel: 'اعتماد التوقيت' })) return;
      }
      // Preserve fields another administrator changed while this form was open.
      const changed = Object.fromEntries(Object.entries(patch).filter(([key]) => key === 'dateTime'
        ? useStationTime !== baseline.timeBasis
        : (values as Record<string, unknown>)[key] !== (baseline as Record<string, unknown>)[key]));
      apiService.saveSettings(changed);
      if (!await confirmSaved('settings', SINGLETON_ID, 'حُفظت إعدادات المحطة')) {
        setGeneralError('لم يؤكد الخادم حفظ الإعدادات. بقيت القيم المدخلة؛ أعد المحاولة بعد التحقق من الاتصال.');
        return;
      }
      const confirmed = {
        ...values,
        organizationName: patch.organizationName,
        organizationNameEn: patch.organizationNameEn,
        primaryChannelName: patch.primaryChannelName,
        defaultTimezone: patch.defaultTimezone,
        defaultSegmentDurationSeconds: patch.defaultSegmentDurationSeconds,
      };
      restoreGeneral(confirmed);
      setBaseline(confirmed);
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

  /** Runs App's save handler; true only when it reports success (undefined = legacy success). */
  const saveCategory = async (cat: Partial<Category>): Promise<boolean> => {
    try {
      const result = await onSaveCategory(cat);
      return result === undefined ? true : result === true;
    } catch (err) {
      notify({ type: 'error', message: err instanceof Error ? err.message : 'تعذر حفظ التصنيف' });
      return false;
    }
  };

  // Add new category
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatNameAr.trim() || savingCategory) return;
    if (categories.some((c) => sameName(c.nameAr, newCatNameAr))) {
      notify({ type: 'warning', message: `يوجد تصنيف باسم (${newCatNameAr.trim()}) بالفعل.` });
      return;
    }

    const slug = newCatSlug.trim() || (newCatNameEn.trim() || newCatNameAr.trim()).toLowerCase().replace(/\s+/g, '-');
    const lastOrder = categories.reduce((max, c) => Math.max(max, c.orderIndex ?? 0), 0);
    setSavingCategory(true);
    const saved = await saveCategory({
      nameAr: newCatNameAr.trim(),
      parentId: newCatParentId || null,
      nameEn: newCatNameEn.trim() || newCatNameAr.trim(),
      slug,
      color: newCatColor,
      colorCode: newCatColor,
      description: newCatDesc.trim(),
      orderIndex: Math.max(lastOrder, categories.length) + 1,
    });
    setSavingCategory(false);
    // A refused save keeps what was typed for another attempt.
    if (!saved) return;

    // Reset Form
    setNewCatNameAr('');
    setNewCatParentId('');
    setNewCatNameEn('');
    setNewCatSlug('');
    setNewCatDesc('');
    setNewCatColor('#2563eb');
  };

  // Open edit modal
  const handleStartEdit = (cat: Category) => {
    setEditingCategory(cat);
    setEditNameAr(cat.nameAr);
    setEditParentId(cat.parentId || '');
    setEditNameEn(cat.nameEn || '');
    setEditSlug(cat.slug || '');
    setEditColor(cat.colorCode || cat.color || '#2563eb');
    setEditDesc(cat.description || '');
  };

  // Save edited category
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editNameAr.trim() || savingCategory) return;

    setSavingCategory(true);
    const saved = await saveCategory({
      id: editingCategory.id,
      nameAr: editNameAr.trim(),
      parentId: editParentId || null,
      nameEn: editNameEn.trim() || editNameAr.trim(),
      slug: editSlug.trim() || editNameAr.trim().toLowerCase().replace(/\s+/g, '-'),
      color: editColor,
      colorCode: editColor,
      description: editDesc.trim(),
      orderIndex: editingCategory.orderIndex,
    });
    setSavingCategory(false);
    if (saved) setEditingCategory(null);
  };

  // Move a category one step up or down the editorial order: swap orderIndex with its neighbour.
  const moveCategory = async (cat: Category, direction: -1 | 1) => {
    if (reordering) return;
    const orderedCategories = categorySiblings(cat);
    const index = orderedCategories.findIndex((c) => c.id === cat.id);
    const neighbour = orderedCategories[index + direction];
    if (index < 0 || !neighbour) return;
    // Normally the two swap their orderIndex. Missing or duplicate indexes are first
    // renumbered to the visible order, so the move is always what the list shows.
    const distinct = orderedCategories.every((c, j) => c.orderIndex !== undefined && (j === 0 || c.orderIndex !== orderedCategories[j - 1].orderIndex));
    const changes: { id: string; orderIndex: number }[] = [];
    if (distinct) {
      changes.push({ id: cat.id, orderIndex: neighbour.orderIndex as number }, { id: neighbour.id, orderIndex: cat.orderIndex as number });
    } else {
      const next = [...orderedCategories];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      next.forEach((c, i) => { if (c.orderIndex !== i + 1) changes.push({ id: c.id, orderIndex: i + 1 }); });
    }
    setReordering(true);
    try {
      const saved = changes.map((change) => apiService.saveCategory(change));
      const outcomes = await Promise.all(saved.map((c) => dataStore.awaitWrite('categories', c.id)));
      const failed = outcomes.find((o) => !o.ok);
      if (!failed) notify({ type: 'success', message: `نُقل تصنيف (${cat.nameAr}) ${direction < 0 ? 'إلى الأعلى' : 'إلى الأسفل'}` });
      // A refusal is already announced with the server's reason (App's sync-error toast).
      else if (failed.pending) notify({ type: 'warning', title: 'لم يؤكد الخادم ترتيب التصنيفات بعد', message: failed.message || '' });
    } catch (err) {
      notify({ type: 'error', message: err instanceof Error ? err.message : 'تعذر تغيير ترتيب التصنيفات' });
    } finally {
      setReordering(false);
    }
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
    if (!newSourceName.trim() || addingSource) return;
    if (sources.some((s) => sameName(s.name, newSourceName))) {
      notify({ type: 'warning', message: `يوجد مصدر باسم (${newSourceName.trim()}) بالفعل.` });
      return;
    }
    setAddingSource(true);
    try {
      if (!(await onSaveSource({
        id: `src-${Date.now()}`,
        name: newSourceName.trim(),
        type: newSourceType.trim() || 'OTHER',
        reliabilityScore: Number(newSourceReliability) || 5,
      }))) return;
      setNewSourceName('');
      setNewSourceReliability(5);
    } catch (err) {
      notify({ type: 'error', message: err instanceof Error ? err.message : 'تعذر حفظ المصدر' });
    } finally {
      setAddingSource(false);
    }
  };

  const handleStartEditSource = (src: NewsSource) => {
    setEditingSource(src);
    setEditSourceName(src.name);
    setEditSourceType(sourceTypeLabel(src.type));
    setEditSourceReliability(Math.min(5, Math.max(1, Math.round(Number(src.reliabilityScore) || 5))));
    setSourceError(null);
  };

  const handleSaveSourceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSource || savingSource) return;
    const name = editSourceName.trim();
    if (!name) { setSourceError('اسم المصدر مطلوب'); return; }
    if (sources.some((s) => s.id !== editingSource.id && sameName(s.name, name))) { setSourceError('يوجد مصدر آخر بالاسم نفسه'); return; }
    // An untouched type keeps its stored code; a changed one is stored as typed.
    const typedType = editSourceType.trim();
    const type = typedType === sourceTypeLabel(editingSource.type) ? editingSource.type : typedType || 'OTHER';
    setSavingSource(true);
    setSourceError(null);
    try {
      if (await onSaveSource({ id: editingSource.id, name, type, reliabilityScore: editSourceReliability })) {
        notify({ type: 'success', message: name !== editingSource.name ? `حُفظ المصدر (${name})؛ تتحدث المواد المرتبطة به تلقائياً` : `حُفظ المصدر (${name})` });
        setEditingSource(null);
      } else {
        setSourceError('لم يؤكد الخادم الحفظ؛ بقيت القيم المدخلة لإعادة المحاولة');
      }
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'تعذر حفظ المصدر');
    } finally {
      setSavingSource(false);
    }
  };

  return (
    <div className="space-y-5 pb-12">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          <Settings className="w-5 h-5" aria-hidden="true" />
          الإعدادات
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          إعدادات المحطة مشتركة بين الزملاء. تفضيلات الجهاز خاصة بهذا المتصفح.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)] gap-5 lg:gap-6 items-start">
      <SettingsNav
        section={section}
        onChange={(next) => { setSettingsSearch(''); void chooseSection(next); }}
        counts={{ categories: categories.length, sources: sources.length }}
        query={settingsSearch}
        onQuery={setSettingsSearch}
      />
      <div className="min-w-0 space-y-5">
      {isSaved && !dirty && (section === 'station' || section === 'editorial') && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>تم حفظ إعدادات النظام وتطبيقها بنجاح على غرفة الأخبار ولوحة التحكم.</span>
        </div>
      )}
      {SECTION_SCOPE[section] && <p className="text-xs font-semibold text-slate-700">{SECTION_SCOPE[section]}</p>}
      {section === 'preferences' && <section className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4" aria-labelledby="settings-preferences-title">
        <div>
          <h2 id="settings-preferences-title" className="text-base font-bold text-slate-900">تفضيلات هذا الجهاز</h2>
          <p className="text-xs text-slate-600 mt-0.5">تُحفظ في هذا المتصفح فقط، ولا تغيّر شيئاً لدى الزملاء.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          <div><label htmlFor="settings-appearance" className="block text-sm font-bold text-slate-700 mb-1">المظهر</label><select id="settings-appearance" value={appearance} onChange={e => { const value = e.target.value as typeof appearance; setAppearance(value); setThemePreference(value); }} className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 bg-white text-sm text-slate-900"><option value="system">حسب الجهاز</option><option value="light">نهاري</option><option value="dark">ليلي</option></select></div>
          <div><label htmlFor="settings-text-scale" className="block text-sm font-bold text-slate-700 mb-1">حجم الخط</label><select id="settings-text-scale" aria-describedby="settings-text-scale-hint" value={textSize} onChange={e => { const value = e.target.value as TextScale; setTextSize(value); setTextScale(value); }} className="block w-full min-h-11 border border-slate-300 rounded-lg px-3 bg-white text-sm text-slate-900">{TEXT_SCALES.map(option => <option key={option.id} value={option.id}>{option.name}: {option.hint}</option>)}</select><p id="settings-text-scale-hint" className="text-xs text-slate-600 mt-1">يكبّر النص والأزرار والمسافات معاً.</p></div>
        </div>
        <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-slate-700"><input type="checkbox" checked={lessMotion} onChange={e => { setLessMotion(e.target.checked); setReducedMotion(e.target.checked); }} />تقليل الحركة</label>
      </section>}
      {section === 'system' && RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings') && (
        <button type="button" className="min-h-11 px-3 rounded-lg border border-slate-300 text-sm font-bold" onClick={() => void chooseSection('modules')}>إدارة إتاحة الوحدات</button>
      )}
      {section === 'modules' && RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings') && <ModuleAccessSettings />}
      {section === 'system' && <section className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4" aria-labelledby="settings-system-title">
        <div>
          <h2 id="settings-system-title" className="text-base font-bold text-slate-900">حالة الأمان والخادم</h2>
          <p className="text-xs text-slate-600 mt-0.5">قيم يضبطها الخادم عند التشغيل؛ للعرض فقط.</p>
        </div>
        {runtimeError ? <p role="alert" className="text-sm font-bold text-rose-700">{runtimeError}</p> : !runtime ? <p role="status" className="text-sm text-slate-600">جارٍ قراءة الحالة...</p> : <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm">
          {([
            ['الإصدار', runtime.version, false],
            ['قاعدة البيانات', runtime.databaseHealthy ? 'سليمة' : 'تحتاج مراجعة', !runtime.databaseHealthy],
            ['مهلة الجلسة (ساعة)', runtime.sessionTtlHours, false],
            ['حد الطلبات في الدقيقة', runtime.rateLimitPerMinute, false],
            ['النسخ الدوري (ساعة)', runtime.backupIntervalHours || 'معطل', !runtime.backupIntervalHours],
            ['عدد النسخ المحلية المحتفظ بها', runtime.backupRetention, false],
            ['وجهة النسخ الخارجية', runtime.externalBackup ? 'معدة' : 'غير معدة', false],
            ['الوجهة السحابية', runtime.cloudBackup ? 'معدة' : 'غير معدة', false],
            ['كوكي الاتصال الآمن', runtime.secureCookie ? 'مفعلة' : 'غير مفعلة', !runtime.secureCookie],
          ] as [string, unknown, boolean][]).map(([key, value, attention]) => <div key={key} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2.5"><dt className="text-slate-600">{key}</dt><dd className="font-semibold break-words tabular-nums text-left">{String(value)}{attention && <span className="ms-2 text-2xs font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">يحتاج ضبطاً</span>}</dd></div>)}
        </dl>}
      </section>}
      {section === 'system' && <BackupReadinessSummary canOpenBackups={RbacService.hasPermission(apiService.getCurrentUser(), 'system.database_manage') && RbacService.canOpenScreen(apiService.getCurrentUser(), 'database')} />}
      {section === 'system' && <AppUpdatesPanel canManage={RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings')} />}

      {(section === 'station' || section === 'editorial') && (
        <div className={`grid grid-cols-1 gap-6 ${section === 'station' ? 'xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'max-w-2xl'}`}>
        {/* General Station Config */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
            {section === 'station' ? <Tv className="w-4 h-4 text-blue-600" aria-hidden="true" /> : <FileText className="w-4 h-4 text-blue-600" aria-hidden="true" />}
            <span>{section === 'station' ? 'بيانات المؤسسة والبث' : 'الافتراضات التحريرية'}</span>
          </h2>

          <form onSubmit={handleSaveGeneral} className="space-y-4 text-sm" aria-busy={saving}>
            <DraftStatus draft={draft} />
            <fieldset disabled={saving} aria-label="إعدادات المحطة والتحرير" className="space-y-4">
            {section === 'station' && <>
            <div>
              <label htmlFor="station-name-input" className={GENERAL_LABEL}>اسم القناة / المؤسسة الإعلامية</label>
              <input id="station-name-input" aria-describedby={generalError ? 'settings-error' : undefined} required maxLength={120} type="text" value={stationName} onChange={(e) => setStationName(e.target.value)} className={GENERAL_INPUT} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={GENERAL_LABEL}>اسم المؤسسة بالإنجليزية<input value={organizationNameEn} maxLength={120} onChange={e => setOrganizationNameEn(e.target.value)} dir="ltr" className={`${GENERAL_INPUT} mt-1 font-normal`} /></label>
              <label className={GENERAL_LABEL}>اسم قناة البث<input value={channelName} maxLength={120} onChange={e => setChannelName(e.target.value)} className={`${GENERAL_INPUT} mt-1 font-normal`} /></label>
            </div>
            <div>
              <label htmlFor="station-timezone-input" className={GENERAL_LABEL}>المنطقة الزمنية</label>
              <select id="station-timezone-input" aria-describedby={generalError ? 'settings-error' : 'station-time-basis'} value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${GENERAL_INPUT} font-mono`} dir="ltr">
                {[...new Set([...timezoneOptions, timezone])].map(zone => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 min-h-11 font-bold text-slate-700"><input type="checkbox" checked={useStationTime} onChange={e => setUseStationTime(e.target.checked)} />اعتماد توقيت المحطة لجميع الزملاء</label>
              <p id="station-time-basis" role="status" className="text-xs text-slate-600">{useStationTime ? `تُعرض الأوقات وتُدخل بتوقيت ${timezone} على كل الأجهزة.` : 'يعمل كل زميل بتوقيت جهازه؛ لا تُطبق المنطقة المختارة على حقول المواعيد حتى تفعيل هذا الخيار.'}</p>
            </div>
            <ColorPalettePicker value={colorPalette} onChange={setColorPalette} />
            </>}

            {section === 'editorial' && <>
            <div>
              <label htmlFor="station-duration-input" className={GENERAL_LABEL}>الزمن الافتراضي للفقرة (ثانية)</label>
              <input id="station-duration-input" type="number" min={10} max={3600} step={5} inputMode="numeric" value={defaultDuration} onChange={(e) => setDefaultDuration(Number(e.target.value))} className={`${GENERAL_INPUT} font-mono tabular-nums`} />
            </div>
            <label className={GENERAL_LABEL}>أولوية الخبر الافتراضية<select value={newsPriority} onChange={e => setNewsPriority(e.target.value as typeof newsPriority)} className={`${GENERAL_INPUT} mt-1 font-normal`}><option value="LOW">منخفضة</option><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="URGENT">عاجلة</option></select></label>
            <label className={GENERAL_LABEL}>مدة العاجل الافتراضية (ساعة)<input type="number" min={0.25} max={24} step={0.25} value={breakingHours} onChange={e => setBreakingHours(Number(e.target.value))} className={`${GENERAL_INPUT} mt-1 font-normal tabular-nums`} /></label>
            </>}
            </fieldset>
            {generalError && <p id="settings-error" role="alert" className="text-rose-700 font-bold">{generalError}</p>}
            <div className="sticky bottom-0 bg-white border-t border-slate-200 py-3 flex flex-wrap gap-3 items-center">
              <button type="submit" disabled={saving || !dirty} className="flex min-h-11 items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات العامة'}</span>
              </button>
              {dirty && <button type="button" disabled={saving} onClick={resetGeneral} className="min-h-11 px-3 rounded-lg text-slate-700 hover:bg-slate-100 font-bold">إلغاء التغييرات</button>}
              <span role="status" className={`text-xs ${dirty ? 'text-amber-800 font-bold' : 'text-slate-500'}`}>{saving ? 'بانتظار تأكيد الحفظ' : dirty ? 'تغييرات غير محفوظة' : 'كل التغييرات محفوظة'}</span>
            </div>
          </form>
        </div>

        {/* Team summary: the full directory lives in «المستخدمون والصلاحيات». */}
        {section === 'station' && <div className="@container bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4 self-start">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <span>الفريق والصلاحيات</span>
          </h2>
          <div className="grid grid-cols-1 @[24rem]:grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-bold text-slate-800">{users.filter((u) => u.isActive !== false).length}</p>
              <p className="text-2xs text-slate-500">حساب نشط</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-bold text-slate-800">{users.filter((u) => u.isActive === false).length}</p>
              <p className="text-2xs text-slate-500">موقوف</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-lg font-bold text-slate-800">{users.filter((u) => u.twoFactorEnabled).length}</p>
              <p className="text-2xs text-slate-500">بالتحقق بخطوتين</p>
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
        </div>}
        </div>
      )}

      {section === 'editorial' && <NewsTemplatesSettings />}
      {section === 'editorial' && RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings') && <EditorialPublishingSettings />}
      {section === 'editorial' && <PronunciationSettings />}
      {section === 'production' && RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings') && (
        <TaskWorkflowSettings
          onOpenStepTypes={() => void chooseSection('stations')}
          onOpenTemplates={RbacService.hasPermission(apiService.getCurrentUser(), 'cards.manage') && RbacService.canOpenScreen(apiService.getCurrentUser(), 'cards')
            ? () => navigateTo.emit('/cards') : undefined}
        />
      )}
      {section === 'production' && <ProductionListsSettings currentUser={apiService.getCurrentUser()} />}
      {section === 'production' && RbacService.hasPermission(apiService.getCurrentUser(), 'system.settings') &&
        RbacService.canUseModule(apiService.getCurrentUser(), 'programmes') && <ProgramTypesSettings currentUser={apiService.getCurrentUser()} />}
      {section === 'airDisplay' && <AirDisplaySettings />}
      {section === 'stations' && <StationsSettings />}
      {section === 'departments' && <DepartmentsSettings />}
      {section === 'structure' && <OrgStructureSettings onOpenSection={(next) => void chooseSection(next)} />}
      {section === 'monitor' && <SystemMonitor />}
      {section === 'storage' && <StorageSettings />}
      {section === 'categories' && (
      <div className="bg-white p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>تصنيفات الأخبار وألوانها</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold tabular-nums">
                  {countLabel(categories.length, { one: 'تصنيف واحد', two: 'تصنيفان', few: 'تصنيفات', many: 'تصنيفاً', zero: 'لا تصنيفات' })}
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تصنّف المواد الإخبارية وتلوّنها في القوائم ومحرر الأخبار. ترتيبها هنا هو ترتيبها في القوائم. تختلف عن «الأقسام الإدارية».
              </p>
            </div>
          </div>
        </div>

        {/* Categories Overview & Creation Grid */}
        <div className="grid grid-cols-1 2xl:grid-cols-12 gap-6">
          {/* Create New Category Form (5 cols on lg) */}
          <div className="order-last 2xl:order-none 2xl:col-span-5 bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>إضافة تصنيف جديد</span>
              </h3>
            </div>

            <form onSubmit={handleAddCategory} className="space-y-3.5 text-xs">
              {/* Arabic Name */}
              <div>
                <label htmlFor="new-cat-name-ar-input" className="block font-bold text-slate-700 mb-1">
                  اسم التصنيف بالعربية <span className="text-rose-700" aria-hidden="true">*</span>
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
                      aria-label="مسح اسم التصنيف"
                      className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="new-cat-parent" className="block font-bold text-slate-700 mb-1">التصنيف الرئيسي</label>
                <select id="new-cat-parent" value={newCatParentId} onChange={(e) => setNewCatParentId(e.target.value)} className="w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl bg-white">
                  <option value="">بدون تصنيف رئيسي</option>
                  {categoryEntries.map(({ category, path }) => <option key={category.id} value={category.id}>{path}</option>)}
                </select>
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
                  <span className="font-mono text-2xs text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
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
                  <div className="text-2xs text-slate-500 leading-tight">
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
                  placeholder="وصف طبيعة الأخبار والمواد التابعة لهذا التصنيف..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Live Preview Card */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                <div className="text-2xs font-bold text-slate-500">معاينة الشارة</div>
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
                    <span>{newCatNameAr || 'اسم التصنيف'}</span>
                  </span>

                  <span className="text-2xs text-slate-500 font-mono">
                    {newCatNameEn ? `(${newCatNameEn})` : ''}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCategory}
                className="w-full min-h-11 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{savingCategory && !editingCategory ? 'جارٍ الحفظ...' : 'إضافة التصنيف'}</span>
              </button>
            </form>

            {/* Presets Quick Insert */}
            <div className="pt-2 border-t border-slate-200">
              <span className="text-2xs font-bold text-slate-500 block mb-1.5">
                تصنيفات مقترحة:
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
                    className="text-2xs bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2 py-1 rounded-lg transition-colors border border-slate-200 flex items-center gap-1.5"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
                    <Plus className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>{preset.nameAr}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Categories List & Management Table (7 cols on lg) */}
          <div className="2xl:col-span-7 space-y-3">
            {/* Search & Stats Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  aria-label="البحث في التصنيفات"
                  placeholder="ابحث بالاسم أو المعرف..."
                  className="w-full pr-9 pl-8 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
                />
                {categorySearch && (
                  <button
                    type="button"
                    onClick={() => setCategorySearch('')}
                    aria-label="مسح البحث"
                    className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-500 shrink-0 font-medium">
                {filteredCategories.length} من {categories.length}
              </div>
            </div>

            {/* Category Cards List */}
            <div className="space-y-2.5">
              {filteredCategories.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                  لا توجد تصنيفات مطابقة لـ«{categorySearch}».
                </div>
              ) : (
                filteredCategories.map(({ category: cat, path, depth }) => {
                  const color = cat.colorCode || cat.color || '#2563eb';
                  const siblings = categorySiblings(cat);
                  const position = siblings.findIndex((c) => c.id === cat.id);
                  const countById = newsCountByCategory[cat.id] || 0;
                  const countByName = newsCountByCategory[cat.nameAr] || 0;
                  const totalNews = Math.max(countById, countByName);

                  return (
                    <div
                      key={cat.id}
                      style={{ marginInlineStart: Math.min(depth, 3) * 8 }}
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
                              <span className="text-2xs text-slate-500 font-mono" dir="ltr">
                                {cat.nameEn}
                              </span>
                            )}
                            <span
                              dir="ltr"
                              className="text-2xs font-mono px-1.5 py-0.5 rounded font-bold border"
                              style={{
                                backgroundColor: `${color}15`,
                                color: color,
                                borderColor: `${color}30`,
                              }}
                            >
                              {color}
                            </span>
                          </div>

                          {depth > 0 && <p className="text-2xs text-slate-600 break-words">{path}</p>}
                          {cat.description ? (
                            <p className="text-2xs text-slate-500 line-clamp-1">{cat.description}</p>
                          ) : (
                            <p className="text-2xs text-slate-500 font-mono">slug: {cat.slug || cat.id}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        {/* News count badge */}
                        <span
                          className="text-2xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                          title="عدد الأخبار المرتبطة بهذا التصنيف"
                        >
                          {countLabel(totalNews, { ...AR.news, zero: 'لا أخبار' })}
                        </span>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={reordering || position <= 0}
                            onClick={() => void moveCategory(cat, -1)}
                            className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                            aria-label={`نقل تصنيف ${cat.nameAr} إلى الأعلى`}
                            title="نقل إلى الأعلى"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={reordering || position < 0 || position >= siblings.length - 1}
                            onClick={() => void moveCategory(cat, 1)}
                            className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                            aria-label={`نقل تصنيف ${cat.nameAr} إلى الأسفل`}
                            title="نقل إلى الأسفل"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`تعديل تصنيف ${cat.nameAr}`}
                            onClick={() => handleStartEdit(cat)}
                            className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="تعديل بيانات ولون التصنيف"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            aria-label={`حذف تصنيف ${cat.nameAr}`}
                            onClick={() => {
                              if (categories.some(category => category.parentId === cat.id)) {
                                notify({ type: 'warning', message: CATEGORY_HAS_CHILDREN });
                                return;
                              }
                              const inUse = (newsList || []).filter((n) => n.categoryId === cat.id).length;
                              if (inUse > 0) {
                                notify({ type: 'warning', message: `لا يمكن حذف تصنيف (${cat.nameAr}) لأنه مرتبط بـ${countLabel(inUse, AR.item)}. انقل المواد إلى تصنيف آخر أولاً.` });
                                return;
                              }
                              setCategoryToDelete(cat);
                            }}
                            className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
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
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4">
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <span>المصادر المعتمدة</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">الوكالات والمراسلون والجهات التي تُنسب إليها المواد. يُربط بكل مصدر خلاصة RSS تغذّي شاشة «المصادر».</p>
          </div>

          <form onSubmit={handleAddSource} className="space-y-2" aria-busy={addingSource}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="relative">
                <label htmlFor="new-source-name-input" className="sr-only">اسم الوكالة أو المصدر</label>
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
                <label htmlFor="new-source-type-input" className="sr-only">نوع المصدر</label>
                <input
                  id="new-source-type-input"
                  type="text"
                  list="source-type-suggestions"
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
              <div>
                <label htmlFor="new-source-reliability-input" className="sr-only">موثوقية المصدر من 1 إلى 5</label>
                <select
                  id="new-source-reliability-input"
                  value={newSourceReliability}
                  onChange={(e) => setNewSourceReliability(Number(e.target.value))}
                  title="موثوقية المصدر"
                  className="w-full min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  {RELIABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>موثوقية {o.label}</option>)}
                </select>
              </div>
              <button
                type="submit"
                disabled={addingSource}
                className="min-h-11 sm:min-h-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-50"
              >
                {addingSource ? 'جارٍ الإضافة...' : 'إضافة مصدر'}
              </button>
            </div>
            <datalist id="source-type-suggestions">
              {SOURCE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
            </datalist>
            <div className="flex flex-wrap gap-1">
              {['وكالة رويترز', 'وكالة فرانس برس', 'واس السعودية', 'بلومبرغ نيوز', 'مراسل ميداني'].map((srcPreset) => (
                <button
                  key={srcPreset}
                  type="button"
                  onClick={() => {
                    setNewSourceName(srcPreset);
                    setNewSourceType(srcPreset.includes('وكالة') ? 'وكالة أنباء عالمية' : 'مراسل خاص');
                  }}
                  className="inline-flex items-center gap-1 min-h-8 text-2xs bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-2 rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" aria-hidden="true" />
                  {srcPreset}
                </button>
              ))}
            </div>
          </form>

          <div className="space-y-2">
            {sources.map((src) => (
              <div key={src.id} id={`source-row-${src.id}`} className={`p-2.5 bg-slate-50 rounded-lg border text-xs scroll-mt-24 ${focusSourceId === src.id ? 'border-blue-600 ring-2 ring-blue-500' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="text-slate-800 block break-words">{src.name}</strong>
                  <span className="text-2xs text-slate-500">{sourceTypeLabel(src.type)}</span>
                  {src.feedUrl && (
                    <span className={`block text-2xs font-bold ${src.feedEnabled ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {src.feedEnabled ? 'خلاصة RSS مفعّلة' : 'خلاصة RSS متوقفة'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEditSource(src)}
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                    title="تعديل اسم المصدر ونوعه وموثوقيته"
                    aria-label={`تعديل المصدر ${src.name}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-expanded={feedEditingId === src.id}
                    onClick={() => setFeedEditingId(feedEditingId === src.id ? null : src.id)}
                    className={`min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center rounded-lg hover:bg-blue-50 ${feedEditingId === src.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-blue-700'}`}
                    title="ربط خلاصة RSS للمصادر"
                    aria-label={`خلاصة RSS للمصدر ${src.name}`}
                  >
                    <Rss className="w-4 h-4" />
                  </button>
                  <span className="text-2xs text-slate-600 font-bold tabular-nums whitespace-nowrap">
                    موثوقية <span dir="ltr">{src.reliabilityScore}/5</span>
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
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                    aria-label={`حذف المصدر ${src.name}`}
                    title="حذف المصدر"
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
            <HardDrive className="w-4 h-4 text-blue-600" aria-hidden="true" />
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
                تصدير بيانات العمل الحالية (JSON)
              </strong>
              <p className="text-slate-500 text-2xs">
                ما نزل إلى هذا المتصفح من بيانات العمل (الأخبار الجارية، التصنيفات، التغطيات…) في ملف واحد. ليس نسخة احتياطية: لا يشمل الحسابات وكلمات المرور ولا الملفات المرفوعة ولا الأخبار المؤرشفة الأقدم من مدة العمل. النسخة الاحتياطية الكاملة من «قاعدة البيانات» ← «نسخة احتياطية كاملة الآن».
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 min-h-11 px-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                تنزيل بيانات العمل (JSON)
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <strong className="text-slate-800 block font-bold text-xs">
                إضافة سجلات من ملف تصدير
              </strong>
              <p className="text-slate-500 text-2xs">
                يضيف من ملف التصدير السجلات غير الموجودة فقط، ولا يستبدل ما هو موجود.
              </p>
              <label className="inline-flex items-center gap-1.5 min-h-11 px-3.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg font-bold transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-blue-500">
                <Upload className="w-3.5 h-3.5" />
                <span>اختيار ملف واستعادة</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportBackup}
                  className="sr-only"
                />
              </label>
            </div>
          </div>
        </div>
          <DemoDataCard />
        </div>
      )}

      </div>
      </div>

      {/* MODAL: EDIT CATEGORY */}
      {editingCategory && (
        <FormPage
          isOpen={true}
          onClose={() => { if (savingCategory) return false; setEditingCategory(null); }}
          title={`تعديل التصنيف: ${editingCategory.nameAr}`}
          subtitle="تعديل اسم التصنيف ولونه وموقعه ضمن التصنيفات"
          maxWidth="lg"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div>
              <label htmlFor="edit-cat-name-ar-input" className="block font-bold text-slate-700 mb-1">
                اسم التصنيف بالعربية <span className="text-rose-700" aria-hidden="true">*</span>
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

            <div>
              <label htmlFor="edit-cat-parent" className="block font-bold text-slate-700 mb-1">التصنيف الرئيسي</label>
              <select id="edit-cat-parent" value={editParentId} onChange={(e) => setEditParentId(e.target.value)} className="w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl bg-white">
                <option value="">بدون تصنيف رئيسي</option>
                {categoryEntries.filter(({ category }) => !editingBranch?.has(category.id)).map(({ category, path }) => <option key={category.id} value={category.id}>{path}</option>)}
              </select>
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
                <span className="font-mono text-2xs text-slate-500">{editColor}</span>
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
                <span className="text-2xs text-slate-500">
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
              <span className="text-2xs font-bold text-slate-500 block uppercase">
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
                <span>{editNameAr || 'اسم التصنيف'}</span>
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
                disabled={savingCategory}
                className="min-h-11 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingCategory ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}</span>
              </button>
            </div>
          </form>
        </FormPage>
      )}

      {/* EDIT SOURCE */}
      {editingSource && (
        <FormPage
          isOpen={true}
          onClose={() => { if (savingSource) return false; setEditingSource(null); }}
          title={`تعديل المصدر: ${editingSource.name}`}
          subtitle="يتحدث الاسم الجديد في الأخبار ومواد الوكالات المرتبطة بالمصدر"
          maxWidth="md"
        >
          <form onSubmit={handleSaveSourceEdit} className="space-y-4 text-sm" aria-busy={savingSource}>
            <fieldset disabled={savingSource} className="space-y-4">
              <div>
                <label htmlFor="edit-source-name-input" className="block font-bold text-slate-700 mb-1">
                  اسم المصدر <span className="text-red-600">*</span>
                </label>
                <input
                  id="edit-source-name-input"
                  type="text"
                  required
                  maxLength={120}
                  value={editSourceName}
                  onChange={(e) => { setEditSourceName(e.target.value); setSourceError(null); }}
                  aria-invalid={!!sourceError}
                  aria-describedby={sourceError ? 'edit-source-error' : undefined}
                  className="w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="edit-source-type-input" className="block font-bold text-slate-700 mb-1">نوع المصدر</label>
                <input
                  id="edit-source-type-input"
                  type="text"
                  list="source-type-suggestions-edit"
                  maxLength={80}
                  value={editSourceType}
                  onChange={(e) => setEditSourceType(e.target.value)}
                  className="w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="source-type-suggestions-edit">
                  {SOURCE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div>
                <label htmlFor="edit-source-reliability-input" className="block font-bold text-slate-700 mb-1">الموثوقية (من 1 إلى 5)</label>
                <select
                  id="edit-source-reliability-input"
                  value={editSourceReliability}
                  onChange={(e) => setEditSourceReliability(Number(e.target.value))}
                  className="w-full min-h-11 px-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  {RELIABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </fieldset>
            {sourceError && <p id="edit-source-error" role="alert" className="text-rose-700 font-bold">{sourceError}</p>}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
              <button
                type="button"
                disabled={savingSource}
                onClick={() => setEditingSource(null)}
                className="min-h-11 px-4 text-slate-700 hover:bg-slate-100 rounded-lg font-bold disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingSource}
                className="min-h-11 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingSource ? 'جارٍ الحفظ...' : sourceError ? 'إعادة محاولة الحفظ' : 'حفظ المصدر'}</span>
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
          title={`تأكيد حذف التصنيف (${categoryToDelete.nameAr})`}
          message={
            `حذف تصنيف (${categoryToDelete.nameAr})؟ لا يمكن استرجاعه إلا بإعادة إنشائه.`
          }
          confirmLabel="نعم، حذف التصنيف"
          cancelLabel="تراجع"
          isDestructive={true}
        />
      )}

    </div>
  );
};
