import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Play, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../services/http';
import { authClient } from '../services/authClient';
import { dataStore } from '../services/dataStore';
import { recalculateRundown, parseTimeToSeconds } from '../shared/rundown';
import { evaluatePermission, DEFAULT_ROLE_DEFINITIONS } from '../shared/rbac';
import { RbacService } from '../services/rbacService';
import type { RundownSegment } from '../types';

type CheckStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'WARNING' | 'FAILED';

interface LiveCheck {
  id: string;
  name: string;
  category: string;
  run: () => Promise<{ status: 'PASSED' | 'WARNING' | 'FAILED'; message: string }>;
}

interface CheckState {
  status: CheckStatus;
  message?: string;
  durationMs?: number;
}

const ok = (message: string) => ({ status: 'PASSED' as const, message });
const warn = (message: string) => ({ status: 'WARNING' as const, message });
const fail = (message: string) => ({ status: 'FAILED' as const, message });

/**
 * Live, read-only diagnostics executed against the running system.
 * Nothing here writes data, so it is safe to run in production at any time.
 * (Automated unit/integration tests live in /tests and run with `npm test`.)
 */
const CHECKS: LiveCheck[] = [
  {
    id: 'health',
    name: 'استجابة خادم التطبيق',
    category: 'البنية التحتية',
    run: async () => {
      const started = performance.now();
      const res = await apiFetch<{ status: string; version: string }>('/api/health');
      const ms = Math.round(performance.now() - started);
      return res.status === 'ok' ? ok(`الخادم يعمل (الإصدار ${res.version}) - زمن الاستجابة ${ms}ms`) : fail('استجابة غير متوقعة');
    },
  },
  {
    id: 'ready',
    name: 'جاهزية قاعدة بيانات SQLite',
    category: 'البنية التحتية',
    run: async () => {
      const res = await apiFetch<{ database: boolean }>('/api/ready');
      return res.database ? ok('قاعدة البيانات متصلة وتستجيب للاستعلامات') : fail('قاعدة البيانات غير متاحة');
    },
  },
  {
    id: 'session',
    name: 'صلاحية جلسة الدخول',
    category: 'الأمان',
    run: async () => {
      const session = await authClient.fetchSession();
      return session ? ok(`جلسة نشطة للمستخدم ${session.user.fullName} (${session.permissions.length} صلاحية فعالة)`) : fail('لا توجد جلسة نشطة');
    },
  },
  {
    id: 'csrf',
    name: 'الحماية من تزوير الطلبات (CSRF)',
    category: 'الأمان',
    run: async () => {
      // A write without the custom header must be refused by the server.
      const res = await fetch('/api/v1/data/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: [] }),
        credentials: 'same-origin',
      });
      return res.status === 403 ? ok('الخادم يرفض الطلبات المعدِّلة التي تفتقد ترويسة الحماية') : fail(`استجابة غير متوقعة: ${res.status}`);
    },
  },
  {
    id: 'sync',
    name: 'مزامنة البيانات بين المستخدمين',
    category: 'تعدد المستخدمين',
    run: async () => {
      if (!dataStore.isReady()) return fail('مخزن البيانات غير محمّل');
      await dataStore.pull();
      const pending = dataStore.pendingCount();
      return pending === 0
        ? ok('جميع التعديلات المحلية وصلت إلى الخادم، وآخر تغييرات الزملاء محمّلة')
        : warn(`${pending} تعديل بانتظار الإرسال إلى الخادم (سيُعاد المحاولة تلقائياً)`);
    },
  },
  {
    id: 'rundown',
    name: 'محرك التوقيت التراكمي للرانداون',
    category: 'البث والرانداون',
    run: async () => {
      const segs = [60, 125, 3600].map((d, i) => ({ id: `t${i}`, durationSeconds: d }) as RundownSegment);
      const out = recalculateRundown(segs);
      const valid =
        out[0].startTimeOffset === '00:00:00' &&
        out[1].startTimeOffset === out[0].endTimeOffset &&
        out[2].endTimeOffset === '01:03:05' &&
        parseTimeToSeconds(out[2].endTimeOffset) === 3785;
      return valid ? ok('بداية كل فقرة تطابق نهاية السابقة والمجموع صحيح') : fail('خطأ في حساب التوقيتات');
    },
  },
  {
    id: 'rbac',
    name: 'مصفوفة الصلاحيات (RBAC)',
    category: 'الأمان',
    run: async () => {
      const journalist = { role: 'JOURNALIST' as const, isActive: true };
      const valid =
        !evaluatePermission(journalist, 'news.publish', DEFAULT_ROLE_DEFINITIONS) &&
        evaluatePermission(journalist, 'news.create', DEFAULT_ROLE_DEFINITIONS) &&
        !evaluatePermission({ role: 'SUPER_ADMIN', isActive: false }, 'news.view', DEFAULT_ROLE_DEFINITIONS);
      const roles = RbacService.getRoleDefinitions().length;
      return valid ? ok(`قواعد الصلاحيات سليمة (${roles} دور معرّف على الخادم)`) : fail('قواعد الصلاحيات لا تعمل كما يجب');
    },
  },
  {
    id: 'ai',
    name: 'المساعد التحريري الذكي (Gemini)',
    category: 'التكاملات',
    run: async () => {
      const res = await apiFetch<{ configured: boolean; model: string }>('/api/v1/ai/status');
      return res.configured ? ok(`مفعّل عبر الخادم بالنموذج ${res.model}`) : warn('غير مفعّل: أضف GEMINI_API_KEY في إعدادات الخادم');
    },
  },
];

const STATUS_STYLE: Record<CheckStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  RUNNING: 'bg-blue-100 text-blue-700',
  PASSED: 'bg-emerald-100 text-emerald-700',
  WARNING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  PENDING: 'بانتظار التشغيل',
  RUNNING: 'قيد الفحص',
  PASSED: 'ناجح',
  WARNING: 'تنبيه',
  FAILED: 'فشل',
};

export const TestingView: React.FC = () => {
  const [results, setResults] = useState<Record<string, CheckState>>(() =>
    Object.fromEntries(CHECKS.map((c) => [c.id, { status: 'PENDING' as CheckStatus }]))
  );
  const [isRunning, setIsRunning] = useState(false);

  const runAll = useCallback(async () => {
    setIsRunning(true);
    for (const check of CHECKS) {
      setResults((prev) => ({ ...prev, [check.id]: { status: 'RUNNING' } }));
      const started = performance.now();
      let outcome: { status: 'PASSED' | 'WARNING' | 'FAILED'; message: string };
      try {
        outcome = await check.run();
      } catch (err: any) {
        outcome = fail(err?.message || 'خطأ غير متوقع');
      }
      setResults((prev) => ({
        ...prev,
        [check.id]: { ...outcome, durationMs: Math.round(performance.now() - started) },
      }));
    }
    setIsRunning(false);
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  const counts = Object.values(results).reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {} as Record<CheckStatus, number>
  );

  return (
    <div className="space-y-5 text-right" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            حالة النظام
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            فحوصات فورية لاتصال الخادم وقاعدة البيانات والمزامنة، للقراءة فقط وآمنة في أي وقت.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-60"
        >
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          <span>إعادة تشغيل الفحوصات</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(['PASSED', 'WARNING', 'FAILED'] as CheckStatus[]).map((s) => (
          <div key={s} className={`p-3 rounded-xl ${STATUS_STYLE[s]}`}>
            <div className="text-2xl font-extrabold">{counts[s] || 0}</div>
            <div className="text-xs font-bold">{STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        {CHECKS.map((check) => {
          const r = results[check.id];
          return (
            <div key={check.id} className="p-4 flex items-start gap-3">
              <div className="mt-0.5">
                {r.status === 'PASSED' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {r.status === 'WARNING' && <AlertTriangle className="w-5 h-5 text-amber-600" />}
                {r.status === 'FAILED' && <XCircle className="w-5 h-5 text-red-600" />}
                {(r.status === 'RUNNING' || r.status === 'PENDING') && <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{check.name}</span>
                  <span className="text-[10px] font-semibold text-slate-400">{check.category}</span>
                </div>
                {r.message && <p className="text-xs text-slate-600 mt-1">{r.message}</p>}
              </div>
              <div className="text-left shrink-0">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                {r.durationMs !== undefined && <div className="text-[10px] text-slate-400 mt-1 font-mono">{r.durationMs}ms</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
