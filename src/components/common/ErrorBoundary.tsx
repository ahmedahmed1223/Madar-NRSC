import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, ShieldAlert, Copy, Check, Sparkles } from 'lucide-react';
import { selfHealingService } from '../../services/selfHealingService';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isCopied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isCopied: false,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[NRCS Production Guard] Uncaught runtime exception:', error, errorInfo);
    selfHealingService.logRuntimeError(error, 'ReactErrorBoundary');
    // Run background self-repair to fix any corrupt states
    try {
      selfHealingService.runFullDiagnosticsAndRepair(false);
    } catch {}
    this.setState({ errorInfo });
  }

  private handleSoftReset = () => {
    try {
      selfHealingService.runFullDiagnosticsAndRepair(true);
    } catch {}
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleHardReload = () => {
    window.location.reload();
  };

  private handleCopyDiagnostics = () => {
    const diagnosticData = `NRCS Exception Log
Time: ${new Date().toISOString()}
Error: ${this.state.error?.message}
Stack: ${this.state.error?.stack}
Component Stack: ${this.state.errorInfo?.componentStack}`;

    navigator.clipboard.writeText(diagnosticData).then(() => {
      this.setState({ isCopied: true });
      setTimeout(() => this.setState({ isCopied: false }), 3000);
    });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          id="production-error-boundary-screen"
          dir="rtl"
          className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4 font-sans"
        >
          <div className="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300">
                    FAIL-SAFE RECOVERY
                  </span>
                  <span className="text-xs text-slate-400">حماية بيئة الإنتاج</span>
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-white mt-1">
                  حدث استثناء تقني غير متوقع في واجهة العمل
                </h1>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              تم تفعيل وضع الحماية التلقائي لغرفة الأخبار لمنع تعطل البث. جميع بيانات التحرير وقاعدة البيانات المحلية محفوظة بأمان. يمكنك استئناف العمل فوراً عبر الخيارات أدناه:
            </p>

            {this.state.error && (
              <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 text-xs font-mono text-slate-400 overflow-x-auto text-left" dir="ltr">
                <div className="text-red-400 font-bold mb-1">
                  {this.state.error.name}: {this.state.error.message}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {this.state.error.stack?.split('\n')[1] || ''}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleSoftReset}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>إعادة تشغيل الواجهة (سريع)</span>
              </button>

              <button
                type="button"
                onClick={this.handleHardReload}
                className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>تحديث كامل للمنظومة</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
              <span>فريق الدعم الفني وهندسة البث</span>
              <button
                type="button"
                onClick={this.handleCopyDiagnostics}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {this.state.isCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">تم نسخ التقرير</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ التقرير التشخيصي</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
