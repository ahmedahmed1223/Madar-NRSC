import React, { useState } from 'react';
import {
  Keyboard,
  Search,
  Command,
  Radio,
  FileText,
  Tv,
  Video,
  CheckSquare,
  Shield,
  HelpCircle,
  X,
} from 'lucide-react';
import { Modal } from './Modal';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: 'NAVIGATION' | 'EDITORIAL' | 'BROADCAST' | 'GENERAL';
}

const SHORTCUTS: ShortcutItem[] = [
  // General & Navigation
  { keys: ['Ctrl', 'K'], description: 'فتح لوحة الأوامر والبحث الذكي الفوري (Command Palette)', category: 'NAVIGATION' },
  { keys: ['?'], description: 'عرض قائمة اختصارات لوحة المفاتيح', category: 'GENERAL' },
  { keys: ['Esc'], description: 'إغلاق أي نافذة منبثقة أو محادثة فرعية مفتوحة', category: 'GENERAL' },
  { keys: ['Ctrl', 'Shift', 'D'], description: 'الانتقال المباشر إلى لوحة القيادة المركزية', category: 'NAVIGATION' },
  { keys: ['Ctrl', 'Shift', 'N'], description: 'الانتقال إلى غرفة الأخبار وقائمة التقارير', category: 'NAVIGATION' },
  { keys: ['Ctrl', 'Shift', 'P'], description: 'الانتقال إلى دليل البرامج التلفزيونية', category: 'NAVIGATION' },
  { keys: ['Ctrl', 'Shift', 'E'], description: 'الانتقال إلى جدول الحلقات والرانداون', category: 'NAVIGATION' },
  { keys: ['Ctrl', 'Shift', 'G'], description: 'الانتقال إلى بنك الضيوف والخبراء', category: 'NAVIGATION' },

  // Editorial & News
  { keys: ['Ctrl', 'Alt', 'N'], description: 'إنشاء خبر أو تقرير صحفي جديد فوراً', category: 'EDITORIAL' },
  { keys: ['Ctrl', 'Alt', 'W'], description: 'فتح شريط برقيات وكالات الأنباء العالمية الحية (Live Wires)', category: 'EDITORIAL' },
  { keys: ['Ctrl', 'S'], description: 'حفظ مسودة الخبر أو جدول الرانداون الحالي', category: 'EDITORIAL' },

  // Broadcast & Studio
  { keys: ['Ctrl', 'Alt', 'L'], description: 'تبديل قفل البث المباشر (On-Air Lock) لمنع التعديل العرضي', category: 'BROADCAST' },
  { keys: ['Ctrl', 'Alt', 'T'], description: 'تشغيل نمط ملقن القراءة الإخباري (Teleprompter Fullscreen)', category: 'BROADCAST' },
  { keys: ['Space'], description: 'إيقاف / استئناف التمرير التلقائي في الملقن', category: 'BROADCAST' },
];

const CATEGORY_MAP = {
  NAVIGATION: { label: 'التنقل والبحث', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  EDITORIAL: { label: 'التحرير وغرفة الأخبار', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  BROADCAST: { label: 'الاستوديو والبث المباشر', color: 'text-purple-600 bg-purple-50 border-purple-200' },
  GENERAL: { label: 'عام والنظام', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  if (!isOpen) return null;

  const filtered = SHORTCUTS.filter((sc) => {
    const matchesSearch =
      sc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sc.keys.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'ALL' || sc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="اختصارات لوحة المفاتيح والإنتاج السريع"
      subtitle="استخدم الاختصارات لرفع سرعة الاستجابة والتحرير في غرفة الأخبار والاستوديو"
      maxWidth="2xl"
    >
      <div className="p-6 space-y-6">
        {/* Search & Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن اختصار أو وظيفة..."
              className="w-full pr-9 pl-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Categories pills */}
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                selectedCategory === 'ALL'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              الكل ({SHORTCUTS.length})
            </button>
            {(Object.keys(CATEGORY_MAP) as Array<keyof typeof CATEGORY_MAP>).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {CATEGORY_MAP[cat].label}
              </button>
            ))}
          </div>
        </div>

        {/* Shortcuts list table */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              <Keyboard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              لم يتم العثور على اختصار يطابق بحثك.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3.5 hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                      CATEGORY_MAP[item.category].color
                    }`}
                  >
                    {CATEGORY_MAP[item.category].label}
                  </span>
                  <span className="text-xs text-slate-700 font-medium">{item.description}</span>
                </div>

                <div className="flex items-center gap-1 font-mono">
                  {item.keys.map((k, kIdx) => (
                    <React.Fragment key={kIdx}>
                      <kbd className="min-w-[28px] text-center px-2 py-1 bg-slate-100 border border-slate-300 rounded-lg text-[11px] font-bold text-slate-800 shadow-2xs">
                        {k}
                      </kbd>
                      {kIdx < item.keys.length - 1 && <span className="text-slate-400 text-xs">+</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer tip */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-blue-500 shrink-0" />
            <span>
              نصيحة للمذيعين والمحررين: اضغط <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded-md font-mono text-[10px] font-bold">?</kbd> في أي وقت لعرض هذه الشاشة.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </Modal>
  );
};
