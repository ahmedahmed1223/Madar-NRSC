import type { ReactNode } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import type { LoginSetupMode } from '../../shared/setup';

type SetupMode = NonNullable<LoginSetupMode>;

const descriptions = {
  browser: {
    summary: 'أنشئ حساب المسؤول الأول واضبط هوية غرفة الأخبار.',
    firstStep: 'إنشاء حساب المسؤول',
    instructions: 'استخدم رمز إعداد الخادم لإنشاء الحساب. يفتح معالج المؤسسة تلقائيًا بعد الدخول.',
  },
  'sign-in': {
    summary: 'ابدأ بحساب المسؤول الأول لمراجعة المؤسسة والمحطات.',
    firstStep: 'الدخول بحساب المسؤول',
    instructions: 'سجّل الدخول ببريد المسؤول وكلمة المرور الأولى التي عيّنها مشغّل الخادم أو التي حفظتها عند إنشاء الحساب. إذا ولّدها الخادم تجدها في سجل بدء التشغيل الأول. بعد تغييرها، يفتح معالج إعداد المؤسسة.',
  },
  demo: {
    summary: 'جرّب مسار التهيئة بحساب مدير النظام التجريبي.',
    firstStep: 'اختيار حساب تجريبي',
    instructions: 'اختر حساب مدير النظام من حسابات التجربة أدناه. يمكنك حذف البيانات النموذجية من الإعدادات بعد إنشاء حساب إدارة خاص بالمؤسسة.',
  },
} satisfies Record<SetupMode, { summary: string; firstStep: string; instructions: string }>;

interface LoginSetupPanelProps {
  mode: SetupMode;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export function LoginSetupPanel({ mode, open, disabled, onToggle, children }: LoginSetupPanelProps) {
  const description = descriptions[mode];
  const openLabel = mode === 'browser' ? 'العودة إلى تسجيل الدخول' : 'إغلاق خطوات الإعداد';

  return (
    <section className="mb-5 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5" aria-labelledby="login-setup-title">
      <h2 id="login-setup-title" className="text-sm font-bold text-slate-900">
        {mode === 'demo' ? 'تجربة إعداد غرفة الأخبار' : 'تشغيل مدار لأول مرة'}
      </h2>
      <p id="login-setup-summary" className="mt-1 text-sm leading-relaxed text-slate-700">{description.summary}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="login-setup"
        aria-describedby="login-setup-summary"
        disabled={disabled}
        onClick={onToggle}
        className={`mt-3 flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-start text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 ${
          open ? 'border-blue-200 bg-white text-blue-900 hover:bg-blue-50' : 'border-transparent bg-blue-700 text-white hover:bg-blue-800'
        }`}
      >
        <Settings2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{open ? openLabel : 'بدء إعداد النظام'}</span>
        <ChevronDown className={`size-4 shrink-0 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div id="login-setup" hidden={!open} className="mt-3 space-y-3">
        <ol aria-label="رحلة إعداد مدار" className="list-decimal space-y-0.5 ps-5 text-sm font-semibold text-slate-800 marker:text-slate-600">
          <li>{description.firstStep}</li>
          <li>مراجعة المؤسسة والمحطات</li>
          <li>فتح مساحة العمل</li>
        </ol>
        <p className="text-sm leading-relaxed text-slate-700">{description.instructions}</p>
        {mode !== 'demo' && <p className="text-xs leading-relaxed text-slate-700">تبدأ التهيئة بقيم قابلة للتعديل لاسم المؤسسة والقناة والتوقيت والمحطات.</p>}
        {children}
      </div>
    </section>
  );
}
