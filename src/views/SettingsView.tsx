import React, { useState } from 'react';
import {
  Settings,
  Tv,
  Globe,
  Users,
  Layers,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  Shield,
  Download,
  Upload,
  HardDrive,
  FileJson,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Category, NewsSource, User, UserRole } from '../types';
import { Badge } from '../components/common/Badge';
import { apiService } from '../services/api';

interface SettingsViewProps {
  categories: Category[];
  sources: NewsSource[];
  users: User[];
  onSaveCategory: (cat: Partial<Category>) => void;
  onDeleteCategory: (id: string) => void;
  onSaveSource: (source: Partial<NewsSource>) => void;
  onDeleteSource: (id: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  categories,
  sources,
  users,
  onSaveCategory,
  onDeleteCategory,
  onSaveSource,
  onDeleteSource,
}) => {
  const [stationName, setStationName] = useState('قناة الأخبار الدولية (News 24 HD)');
  const [timezone, setTimezone] = useState('Asia/Riyadh (GMT+3)');
  const [defaultDuration, setDefaultDuration] = useState(180);
  const [autoSaveMinutes, setAutoSaveMinutes] = useState(2);
  const [isSaved, setIsSaved] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New Category State
  const [newCatNameAr, setNewCatNameAr] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');
  const [newCatColor, setNewCatColor] = useState('#2563eb');

  // New Source State
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceType, setNewSourceType] = useState('وكالة أنباء عالمية');
  const [newSourceReliability, setNewSourceReliability] = useState(5);

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
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
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const ok = apiService.restoreClientBackup(content);
        if (ok) {
          setBackupMsg({ text: 'تمت استعادة البيانات بنجاح! جاري تحديث التطبيق...', type: 'success' });
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          setBackupMsg({ text: 'فشل استعادة البيانات. تأكد من صحة ملف JSON.', type: 'error' });
        }
      }
    };
    reader.readAsText(file);
  };

  const handleAddCat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatNameAr.trim()) return;
    onSaveCategory({
      id: `cat-${Date.now()}`,
      nameAr: newCatNameAr.trim(),
      nameEn: newCatNameEn.trim() || newCatNameAr.trim(),
      slug: newCatNameAr.trim().toLowerCase().replace(/\s+/g, '-'),
      colorCode: newCatColor,
    });
    setNewCatNameAr('');
    setNewCatNameEn('');
  };

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim()) return;
    onSaveSource({
      id: `src-${Date.now()}`,
      name: newSourceName.trim(),
      type: newSourceType,
      reliabilityScore: Number(newSourceReliability) || 5,
    });
    setNewSourceName('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-blue-600" />
          <span>إعدادات النظام والمحطة التلفزيونية</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          تهيئة هوية القناة، الأقسام الصحفية، وكالات الأنباء، وإدارة حسابات طاقم العمل
        </p>
      </div>

      {isSaved && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>تم حفظ إعدادات النظام بنجاح وتطبيقها على جميع شاشات العمل.</span>
        </div>
      )}

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General Station Config */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Tv className="w-4 h-4 text-blue-600" />
            <span>بيانات المحطة الإخبارية والبث</span>
          </h3>

          <form onSubmit={handleSaveGeneral} className="space-y-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">اسم القناة / المؤسسة الإعلامية</label>
              <input
                type="text"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 font-bold text-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">المنطقة الزمنية (Timezone)</label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الزمن الافتراضي لفقرة الرانداون</label>
                <input
                  type="number"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono text-center"
                />
              </div>
            </div>

            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-xs"
            >
              <Save className="w-4 h-4" />
              <span>حفظ الإعدادات العامة</span>
            </button>
          </form>
        </div>

        {/* Categories Manager */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>الأقسام والتبويبات الصحفية</span>
          </h3>

          <form onSubmit={handleAddCat} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  required
                  value={newCatNameAr}
                  onChange={(e) => setNewCatNameAr(e.target.value)}
                  placeholder="اسم القسم بالعربية (مثال: علوم وتكنولوجيا)..."
                  className="w-full pr-3 pl-8 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
                {newCatNameAr && (
                  <button
                    type="button"
                    onClick={() => setNewCatNameAr('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                className="w-9 h-9 p-1 border border-slate-300 rounded-xl cursor-pointer shrink-0"
                title="لون التصنيف"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shrink-0"
              >
                إضافة
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {['أخبار عاجلة', 'شؤون محلية', 'تحقيقات استقصائية', 'ثقافة وفنون', 'رياضة دولية'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNewCatNameAr(preset)}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded transition-colors"
                >
                  +{preset}
                </button>
              ))}
            </div>
          </form>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full"
                    style={{ backgroundColor: cat.colorCode }}
                  />
                  <strong className="text-slate-800">{cat.nameAr}</strong>
                  <span className="text-[11px] text-slate-400">({cat.nameEn})</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteCategory(cat.id)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

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
                  type="text"
                  required
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="اسم الوكالة / المصدر..."
                  className="w-full pr-3 pl-8 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
                {newSourceName && (
                  <button
                    type="button"
                    onClick={() => setNewSourceName('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={newSourceType}
                  onChange={(e) => setNewSourceType(e.target.value)}
                  placeholder="نوع المصدر..."
                  className="w-full pr-3 pl-8 py-2 border border-slate-300 rounded-xl text-xs"
                />
                {newSourceType && (
                  <button
                    type="button"
                    onClick={() => setNewSourceType('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
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

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs"
              >
                <div>
                  <strong className="text-slate-800 block">{src.name}</strong>
                  <span className="text-[11px] text-slate-400">{src.type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-emerald-600 font-bold">
                    موثوقية {src.reliabilityScore}/5
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteSource(src.id)}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Roles & Users Directory Overview */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <span>حسابات المستخدمين وصلاحيات الوصول (RBAC)</span>
          </h3>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={u.avatarUrl}
                    alt={u.fullName}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    <strong className="text-slate-800 block">{u.fullName}</strong>
                    <span className="text-[10px] text-slate-400 font-mono" dir="ltr">
                      {u.email}
                    </span>
                  </div>
                </div>

                <Badge variant="primary" size="sm">
                  {u.role}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Full Production Backup & Disaster Recovery Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4 lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-600" />
            <span>النسخ الاحتياطي واستعادة البيانات للإنتاج الفعلي (NRCS Full Backup & Restore)</span>
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
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              )}
              <span>{backupMsg.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <strong className="text-slate-800 block font-bold text-sm">
                تصدير نسخة احتياطية كاملة (JSON Export)
              </strong>
              <p className="text-slate-500 leading-relaxed text-[11px]">
                تنزيل ملف كامل يحتوي على كافة الأخبار، التغطيات، الرانداون، بنك الضيوف، المهام، التصنيفات، والإعدادات كملف مستقل يمكن نقله أو حفظه خارجياً.
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all shadow-xs"
              >
                <Download className="w-4 h-4" />
                تحميل النسخة الاحتياطية (JSON)
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <strong className="text-slate-800 block font-bold text-sm">
                استعادة بيانات من ملف خارجي (Restore JSON)
              </strong>
              <p className="text-slate-500 leading-relaxed text-[11px]">
                استيراد واستعادة قاعدة بيانات غرفة الأخبار من ملف نسخة احتياطية تم تصديره مسبقاً لاستئناف الإنتاج والعمل فوراً.
              </p>
              <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-xs cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>اختيار ملف واستعادة البيانات</span>
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
      </div>
    </div>
  );
};
