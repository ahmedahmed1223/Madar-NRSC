import React, { useState, useEffect } from 'react';
import {
  Radio,
  Search,
  Filter,
  Flame,
  FilePlus,
  Clock,
  Globe,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Building2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Modal } from '../common/Modal';

export interface WireItem {
  id: string;
  sourceAgency: 'رويترز' | 'فرانس برس' | 'وكالة الأنباء السعودية (واس)' | 'أسوشيتد برس' | 'بلومبرغ' | 'وام';
  urgency: 'FLASH' | 'URGENT' | 'ROUTINE';
  category: 'عاجل' | 'سياسة' | 'اقتصاد وطاقة' | 'تكنولوجيا' | 'أمن ودفاع';
  title: string;
  body: string;
  location: string;
  receivedAt: string;
  isRead: boolean;
}

const INITIAL_WIRES: WireItem[] = [
  {
    id: 'wire-1',
    sourceAgency: 'رويترز',
    urgency: 'FLASH',
    category: 'عاجل',
    title: 'عاجل: إعلان اتفاق استثماري ضخم في قطاع الطاقة المتجددة والهيدروجين الأخضر بقيمة 15 مليار دولار',
    body: 'أعلنت مجموعة من الشركات الاستثمارية الدولية الكبرى توقيع مذكرات تفاهم ملزمة لإطلاق أكبر مشروع لإنتاج الهيدروجين الأخضر وسلاسل التوريد المستدامة، مع توقعات ببدء التشغيل التجاري بحلول 2028.',
    location: 'الرياض - رويترز',
    receivedAt: 'منذ دقيقة',
    isRead: false,
  },
  {
    id: 'wire-2',
    sourceAgency: 'وكالة الأنباء السعودية (واس)',
    urgency: 'URGENT',
    category: 'سياسة',
    title: 'صدور بيان مشترك في ختام المباحثات الرسمية يؤكد تعزيز التعاون الأمني والاستقرار الإقليمي',
    body: 'أكد البيان المشترك الصادر اليوم تطابق وجهات النظر حول القضايا الإقليمية والدولية ذات الاهتمام المشترك، والحرص على تكثيف التنسيق الدبلوماسي لمواجهة التحديات الراهنة.',
    location: 'الرياض - واس',
    receivedAt: 'منذ 4 دقائق',
    isRead: false,
  },
  {
    id: 'wire-3',
    sourceAgency: 'بلومبرغ',
    urgency: 'ROUTINE',
    category: 'اقتصاد وطاقة',
    title: 'أسواق النفط العالمية تسجل استقراراً ملحوظاً مع ترقب بيانات الطلب والنمو الصناعي',
    body: 'سجلت العقود الآجلة لخام برنت وخام غرب تكساس تحركات عرضية ضيقة اليوم، مدفوعة ببيانات إيجابية حول معدلات استهلاك الوقود وزيادة وتيرة حركة الطيران العالمية.',
    location: 'لندن - بلومبرغ',
    receivedAt: 'منذ 9 دقائق',
    isRead: true,
  },
  {
    id: 'wire-4',
    sourceAgency: 'فرانس برس',
    urgency: 'URGENT',
    category: 'سياسة',
    title: 'الأمم المتحدة تدعو لتسهيل وصول المساعدات الإنسانية وتثبيت التهدئة في المناطق المتأثرة',
    body: 'دعا الأمين العام للأمم المتحدة في مؤتمر صحفي عقد بمقر المنظمة في نيويورك إلى تضافر الجهود الدولية لإيصال الإمدادات الغذائية والطبية الضرورية دون عوائق.',
    location: 'نيويورك - أ ف ب',
    receivedAt: 'منذ 14 دقيقة',
    isRead: true,
  },
  {
    id: 'wire-5',
    sourceAgency: 'أسوشيتد برس',
    urgency: 'ROUTINE',
    category: 'تكنولوجيا',
    title: 'قمة الذكاء الاصطناعي العالمية تناقش أطر الحوكمة وحماية البيانات في الأنظمة المتقدمة',
    body: 'انطلقت اليوم فعاليات القمة السنوية للذكاء الاصطناعي بمشاركة أكثر من 100 خبير وممثل حكومي لبحث التشريعات المستقبلية ومسؤولية استخدام النماذج التوليدية في قطاعات الأعمال.',
    location: 'سان فرانسيسكو - أ ب',
    receivedAt: 'منذ 22 دقيقة',
    isRead: true,
  },
];

interface LiveWireFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConvertWireToNews: (wire: WireItem) => void;
}

export const LiveWireFeedModal: React.FC<LiveWireFeedModalProps> = ({
  isOpen,
  onClose,
  onConvertWireToNews,
}) => {
  const [wires, setWires] = useState<WireItem[]>(INITIAL_WIRES);
  const [selectedAgency, setSelectedAgency] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Periodic incoming wire simulator
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const agencies: WireItem['sourceAgency'][] = ['رويترز', 'فرانس برس', 'وكالة الأنباء السعودية (واس)', 'بلومبرغ'];
      const randomAgency = agencies[Math.floor(Math.random() * agencies.length)];
      
      const newWire: WireItem = {
        id: `wire-${Date.now()}`,
        sourceAgency: randomAgency,
        urgency: Math.random() > 0.6 ? 'FLASH' : 'URGENT',
        category: 'عاجل',
        title: `برقية واردة: تطورات جديدة في المباحثات الدبلوماسية وسوق الأسهم الدولية (${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })})`,
        body: 'أفادت مصادر مطلعة باستمرار المشاورات التنسيقية بين وفود الدول المشاركة للتوصل إلى مسودة تفاهمات نهائية تشمل ملفات التبادل التجاري والاستثمار المشترك.',
        location: `${randomAgency} - مباشر`,
        receivedAt: 'الآن',
        isRead: false,
      };

      setWires((prev) => [newWire, ...prev.slice(0, 19)]);
    }, 45000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  const handleCopy = (wire: WireItem) => {
    const text = `[${wire.sourceAgency} - ${wire.urgency}]\n${wire.title}\n\n${wire.body}\nالموقع: ${wire.location}`;
    navigator.clipboard.writeText(text);
    setCopiedId(wire.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredWires = wires.filter((w) => {
    if (selectedAgency !== 'ALL' && w.sourceAgency !== selectedAgency) return false;
    if (selectedCategory !== 'ALL' && w.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return w.title.toLowerCase().includes(q) || w.body.toLowerCase().includes(q) || w.sourceAgency.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="شريط برقيات وكالات الأنباء العالمية المباشرة (Live Wire Services Desk)"
      maxWidth="xl"
    >
      <div className="space-y-4 text-right">
        {/* Header & Agency Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-xs font-black text-slate-800">
              تدفق البرقيات الحية (Live Wire Feed)
            </span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-mono font-bold rounded-full">
              {filteredWires.length} برقية
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              تحديث البرقيات
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث في نص وعناوين البرقيات..."
              className="w-full pr-9 pl-8 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={selectedAgency}
            onChange={(e) => setSelectedAgency(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-700 font-semibold focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">جميع وكالات الأنباء</option>
            <option value="رويترز">رويترز (Reuters)</option>
            <option value="فرانس برس">فرانس برس (AFP)</option>
            <option value="وكالة الأنباء السعودية (واس)">واس (SPA)</option>
            <option value="بلومبرغ">بلومبرغ (Bloomberg)</option>
            <option value="أسوشيتد برس">أسوشيتد برس (AP)</option>
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-700 font-semibold focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">جميع التصنيفات</option>
            <option value="عاجل">أخبار عاجلة (Flash)</option>
            <option value="سياسة">شؤون سياسية</option>
            <option value="اقتصاد وطاقة">اقتصاد وطاقة</option>
            <option value="تكنولوجيا">تكنولوجيا وعلوم</option>
          </select>
        </div>

        {/* Wires Stream List */}
        <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
          {filteredWires.map((wire) => (
            <div
              key={wire.id}
              className={`p-4 rounded-2xl border transition-all ${
                wire.urgency === 'FLASH'
                  ? 'bg-red-50/60 border-red-200 hover:border-red-400'
                  : 'bg-white border-slate-200 hover:border-blue-300'
              } shadow-2xs space-y-2`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      wire.urgency === 'FLASH'
                        ? 'bg-red-600 text-white animate-pulse'
                        : wire.urgency === 'URGENT'
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {wire.urgency === 'FLASH' ? 'عاجل FLASH' : wire.urgency === 'URGENT' ? 'هام URGENT' : 'برقية'}
                  </span>

                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" />
                    {wire.sourceAgency}
                  </span>

                  <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {wire.receivedAt}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(wire)}
                    className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"
                    title="نسخ نص البرقية"
                  >
                    {copiedId === wire.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onConvertWireToNews(wire);
                      onClose();
                    }}
                    className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                  >
                    <FilePlus className="w-3.5 h-3.5" />
                    تحويل إلى خبر بالمحرر
                  </button>
                </div>
              </div>

              <h3 className="text-xs sm:text-sm font-bold text-slate-900 leading-snug">
                {wire.title}
              </h3>

              <p className="text-xs text-slate-600 leading-relaxed">
                {wire.body}
              </p>

              <div className="text-[10px] text-slate-400 font-mono border-t border-slate-100 pt-1.5">
                {wire.location}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
