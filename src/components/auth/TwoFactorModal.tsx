import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { authClient } from '../../services/authClient';

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEnabled: boolean;
  onChanged: (enabled: boolean) => void;
}

type Step = 'password' | 'scan' | 'done' | 'disable';

const inputClass =
  'w-full text-sm px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left';

/** Enrol / remove an authenticator app (TOTP) for the signed-in user. */
export const TwoFactorModal: React.FC<TwoFactorModalProps> = ({ isOpen, onClose, isEnabled, onChanged }) => {
  const [step, setStep] = useState<Step>(isEnabled ? 'disable' : 'password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(isEnabled ? 'disable' : 'password');
    setPassword('');
    setCode('');
    setSecret('');
    setQrDataUrl('');
    setError(null);
  }, [isOpen, isEnabled]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ');
    } finally {
      setBusy(false);
    }
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await authClient.setupTwoFactor(password);
      setSecret(res.secret);
      setQrDataUrl(await QRCode.toDataURL(res.otpauthUrl, { margin: 1, width: 200 }));
      setStep('scan');
    });
  };

  const handleEnable = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authClient.enableTwoFactor(code.trim());
      setStep('done');
      onChanged(true);
    });
  };

  const handleDisable = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authClient.disableTwoFactor(password, code.trim());
      onChanged(false);
      onClose();
    });
  };

  const codeInput = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      required
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      placeholder="000000"
      className={`${inputClass} text-lg tracking-[0.5em] text-center font-mono`}
      dir="ltr"
      aria-label="رمز التحقق"
    />
  );

  const submit = (label: string) => (
    <button
      type="submit"
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-60"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      <span>{label}</span>
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="التحقق بخطوتين (تطبيق المصادقة)" maxWidth="md">
      <div className="space-y-4 text-right" dir="rtl">
        {step === 'password' && (
          <form onSubmit={handleStart} className="space-y-3">
            <p className="text-xs text-slate-600 leading-relaxed">
              يضيف التحقق بخطوتين رمزاً متغيراً من تطبيق على هاتفك (مثل Google Authenticator أو Microsoft Authenticator) إلى كلمة المرور عند كل دخول.
              أدخل كلمة المرور الحالية للمتابعة.
            </p>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              dir="ltr"
              aria-label="كلمة المرور الحالية"
            />
            {submit('متابعة')}
          </form>
        )}

        {step === 'scan' && (
          <form onSubmit={handleEnable} className="space-y-3">
            <p className="text-xs text-slate-600">امسح الرمز بتطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام الظاهر فيه.</p>
            {qrDataUrl && <img src={qrDataUrl} alt="رمز QR لإعداد تطبيق المصادقة" className="mx-auto w-48 h-48" />}
            <div className="text-[11px] text-slate-500 text-center">
              أو أدخل المفتاح يدوياً:
              <div className="font-mono text-xs text-slate-800 break-all mt-1 select-all" dir="ltr">
                {secret.replace(/(.{4})/g, '$1 ').trim()}
              </div>
            </div>
            {codeInput}
            {submit('تفعيل التحقق بخطوتين')}
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-3 py-4">
            <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="text-sm font-bold text-slate-800">تم تفعيل التحقق بخطوتين</p>
            <p className="text-xs text-slate-500">سيُطلب منك الرمز عند كل تسجيل دخول. تم إنهاء جلساتك على الأجهزة الأخرى.</p>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold">
              إغلاق
            </button>
          </div>
        )}

        {step === 'disable' && (
          <form onSubmit={handleDisable} className="space-y-3">
            <p className="text-xs text-slate-600">التحقق بخطوتين مفعّل لحسابك. لإلغائه أدخل كلمة المرور ورمزاً حالياً من التطبيق.</p>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              dir="ltr"
              aria-label="كلمة المرور الحالية"
            />
            {codeInput}
            {submit('إلغاء التحقق بخطوتين')}
          </form>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
