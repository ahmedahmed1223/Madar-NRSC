import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Share, PlusSquare, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed or running as standalone, don't show prompt
  if (isInstalled) {
    return null;
  }

  // Chromium / Desktop / Android flow
  if (isInstallable) {
    return (
      <button
        id="pwa-install-button"
        type="button"
        onClick={install}
        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
        title="تثبيت المنظومة كتطبيق رسمي مستقل على محطة العمل"
      >
        <Download className="w-3.5 h-3.5" />
        <span>تثبيت المنظومة</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          id="pwa-ios-install-button"
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
          title="تثبيت التطبيق على أجهزة آبل / آيباد"
        >
          <Download className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden sm:inline">تثبيت التطبيق</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" dir="rtl">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-right">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">تثبيت المنظومة على iPad / iPhone</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-500 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs text-slate-600">
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
                    1
                  </div>
                  <p>
                    اضغط على زر <strong>المشاركة (Share)</strong> <Share className="w-3.5 h-3.5 inline mx-1 text-blue-600" /> في شريط أدوات Safari.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
                    2
                  </div>
                  <p>
                    مرر للأسفل واضغط على <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong> <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-blue-600" />.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
                    3
                  </div>
                  <p>ستظهر المنظومة كأيقونة تطبيق مستقل على شاشة محطتك دون شريط متصفح.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
              >
                حسناً، فهمت
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
