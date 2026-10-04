import React, { useState } from 'react';
import { Tv, Copy, Check, Sparkles, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';

interface LowerThirdGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertTag: (tag: string) => void;
  defaultTitle?: string;
  /** Sends the lower third to the graphics desk as a request. */
  onSendToGraphics?: (tag: string) => void;
}

export const LowerThirdGeneratorModal: React.FC<LowerThirdGeneratorModalProps> = ({
  isOpen,
  onClose,
  onInsertTag,
  defaultTitle = '',
  onSendToGraphics,
}) => {
  const [activeTab, setActiveTab] = useState<'GUEST' | 'HEADLINE' | 'LOCATION' | 'BREAKING'>('GUEST');

  // Guest Aston
  const [guestName, setGuestName] = useState('');
  const [guestTitle, setGuestTitle] = useState('');
  const [guestOrg, setGuestOrg] = useState('');

  // Headline Aston
  const [headlineText, setHeadlineText] = useState(defaultTitle || '');
  const [subHeadlineText, setSubHeadlineText] = useState('');

  // Location / Reporter Aston
  const [reporterName, setReporterName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');

  // Breaking Aston
  const [breakingText, setBreakingText] = useState(defaultTitle || '');

  const [copied, setCopied] = useState(false);

  // Generate Tag
  const generateTag = () => {
    switch (activeTab) {
      case 'GUEST': {
        const fullTitle = [guestTitle, guestOrg].filter(Boolean).join(' - ');
        return `[CG_GUEST: ${guestName || 'اسم الضيف'} | ${fullTitle || 'الوظيفة والمؤسسة'}]`;
      }
      case 'HEADLINE':
        return `[CG_TOPIC: ${headlineText || 'العنوان الرئيسي'} ${subHeadlineText ? `| ${subHeadlineText}` : ''}]`;
      case 'LOCATION': {
        const loc = [locationCity, locationCountry].filter(Boolean).join(' - ');
        return `[CG_LIVE: ${reporterName || 'المراسل'} | ${loc || 'الموقع'}]`;
      }
      case 'BREAKING':
        return `[CG_BREAKING: ${breakingText || 'نص الخبر العاجل'}]`;
    }
  };

  const tagResult = generateTag();

  const handleCopy = () => {
    navigator.clipboard.writeText(tagResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    onInsertTag(tagResult);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="مولد شارات الجرافيكس والشريط الإخباري"
      maxWidth="lg"
    >
      <div className="space-y-5 text-right">
        <p className="text-xs text-slate-500 leading-relaxed">
          توليد نصوص الشارات بصيغة موحدة يدرجها فني الجرافيكس في نظام الشارات لديكم. لا يرتبط النظام آلياً بأجهزة الجرافيكس.
        </p>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 gap-1 pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('GUEST')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'GUEST'
                ? 'bg-blue-50 text-blue-600'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            شارة الضيف
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HEADLINE')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'HEADLINE'
                ? 'bg-blue-50 text-blue-600'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            عنوان الموضوع
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('LOCATION')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'LOCATION'
                ? 'bg-blue-50 text-blue-600'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            المراسل الميداني
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('BREAKING')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
              activeTab === 'BREAKING'
                ? 'bg-red-50 text-red-600'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            شريط عاجل
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'GUEST' && (
          <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label htmlFor="cg-guest-name" className="block text-xs font-bold text-slate-700 mb-1">اسم الضيف كاملاً *</label>
              <input
                id="cg-guest-name"
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="مثال: د. عبد الله بن خالد الشمري"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-semibold"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cg-guest-title" className="block text-xs font-bold text-slate-700 mb-1">الصفة أو اللقب التحريري</label>
                <input
                  id="cg-guest-title"
                  type="text"
                  value={guestTitle}
                  onChange={(e) => setGuestTitle(e.target.value)}
                  placeholder="مثال: باحث أول في العلاقات الدولية"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
              <div>
                <label htmlFor="cg-guest-org" className="block text-xs font-bold text-slate-700 mb-1">المؤسسة أو جهة العمل</label>
                <input
                  id="cg-guest-org"
                  type="text"
                  value={guestOrg}
                  onChange={(e) => setGuestOrg(e.target.value)}
                  placeholder="مثال: مركز الدراسات الاستراتيجية"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'HEADLINE' && (
          <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label htmlFor="cg-headline-text" className="block text-xs font-bold text-slate-700 mb-1">العنوان الرئيسي للشريط *</label>
              <input
                id="cg-headline-text"
                type="text"
                value={headlineText}
                onChange={(e) => setHeadlineText(e.target.value)}
                placeholder="مثال: قمة الرياض للطاقة والمناخ"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-bold"
              />
            </div>
            <div>
              <label htmlFor="cg-subheadline-text" className="block text-xs font-bold text-slate-700 mb-1">السطر الثاني (فرعي / تفاصيل)</label>
              <input
                id="cg-subheadline-text"
                type="text"
                value={subHeadlineText}
                onChange={(e) => setSubHeadlineText(e.target.value)}
                placeholder="مثال: اتفاقيات استراتيجية لخفض الانبعاثات الكربونية"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>
        )}

        {activeTab === 'LOCATION' && (
          <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label htmlFor="cg-reporter-name" className="block text-xs font-bold text-slate-700 mb-1">اسم المراسل الميداني</label>
              <input
                id="cg-reporter-name"
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="مثال: أحمد المنصور"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-semibold"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cg-location-city" className="block text-xs font-bold text-slate-700 mb-1">المدينة / العاصمة</label>
                <input
                  id="cg-location-city"
                  type="text"
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  placeholder="مثال: جنيف"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
              <div>
                <label htmlFor="cg-location-country" className="block text-xs font-bold text-slate-700 mb-1">الدولة أو المقر</label>
                <input
                  id="cg-location-country"
                  type="text"
                  value={locationCountry}
                  onChange={(e) => setLocationCountry(e.target.value)}
                  placeholder="مثال: سويسرا (مقر الأمم المتحدة)"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'BREAKING' && (
          <div className="space-y-3 bg-red-50/50 p-4 rounded-xl border border-red-200">
            <div>
              <label htmlFor="cg-breaking-text" className="block text-xs font-bold text-red-900 mb-1">نص الخبر العاجل في الشريط السفلي *</label>
              <textarea
                id="cg-breaking-text"
                rows={2}
                value={breakingText}
                onChange={(e) => setBreakingText(e.target.value)}
                placeholder="اكتب جملة الخبر العاجل بوضوح واختصار..."
                className="w-full px-3.5 py-2.5 bg-white border border-red-300 rounded-xl text-xs text-slate-800 placeholder:text-red-300 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
              />
            </div>
          </div>
        )}

        {/* Live Broadcast Preview Screen */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Tv className="w-4 h-4 text-slate-500" />
            معاينة شارة البث على شاشة التلفزيون
          </label>
          <div className="relative h-28 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl overflow-hidden p-3 flex flex-col justify-end border border-slate-700 shadow-inner">
            <div className="absolute top-2 left-3 flex items-center gap-1.5 text-[10px] font-mono text-red-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              LIVE 1080p50 HD
            </div>

            {/* Simulated Lower Third */}
            <div className="bg-slate-950/90 border-r-4 border-blue-600 px-3 py-2 rounded-l-lg max-w-md shadow-2xl animate-in slide-in-from-bottom-2">
              {activeTab === 'GUEST' && (
                <>
                  <div className="text-white text-xs font-black tracking-wide">
                    {guestName || 'اسم الضيف الكريم'}
                  </div>
                  <div className="text-blue-400 text-[10px] font-semibold mt-0.5">
                    {[guestTitle, guestOrg].filter(Boolean).join(' - ') || 'الوظيفة أو التخصص والمؤسسة'}
                  </div>
                </>
              )}

              {activeTab === 'HEADLINE' && (
                <>
                  <div className="text-white text-xs font-black tracking-wide">
                    {headlineText || 'العنوان الرئيسي للموضوع'}
                  </div>
                  {subHeadlineText && (
                    <div className="text-slate-300 text-[10px] mt-0.5">{subHeadlineText}</div>
                  )}
                </>
              )}

              {activeTab === 'LOCATION' && (
                <>
                  <div className="text-white text-xs font-black tracking-wide flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {reporterName || 'مراسلنا الميداني'}
                  </div>
                  <div className="text-slate-300 text-[10px] mt-0.5">
                    {[locationCity, locationCountry].filter(Boolean).join(' - ') || 'العاصمة - الدولة'}
                  </div>
                </>
              )}

              {activeTab === 'BREAKING' && (
                <div className="text-red-400 text-xs font-black flex items-center gap-1.5">
                  <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]">عاجل</span>
                  <span className="text-white">{breakingText || 'نص الخبر العاجل'}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tag String & Insert/Copy */}
        <div className="theme-fixed bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-xs flex items-center justify-between gap-2 border border-slate-700">
          <span className="truncate text-blue-300 font-bold">{tagResult}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-[11px]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'تم النسخ' : 'نسخ الوسم'}
            </button>
            <button
              type="button"
              onClick={handleInsert}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-[11px] font-bold"
            >
              <Sparkles className="w-3.5 h-3.5" />
              إدراج في المحرر
            </button>
            {onSendToGraphics && (
              <button
                type="button"
                onClick={() => {
                  onSendToGraphics(tagResult);
                  onClose();
                }}
                className="flex items-center gap-1 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors text-[11px] font-bold"
              >
                إرسال لقسم الجرافيك
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
