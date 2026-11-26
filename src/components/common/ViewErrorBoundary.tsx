import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { selfHealingService } from '../../services/selfHealingService';

interface Props {
  children: ReactNode;
  onHome?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a failure inside one screen: the sidebar, top bar and live alerts stay usable, and
 * the screen can be retried. Remounted (reset) whenever the user moves to another screen.
 */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NRCS] screen failed', error, info.componentStack);
    try {
      selfHealingService.logRuntimeError(error, 'ViewErrorBoundary');
    } catch {
      // Logging must never break the fallback.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="max-w-lg mx-auto mt-10 bg-white border border-amber-200 rounded-2xl p-6 text-center space-y-3 shadow-sm">
        <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto" aria-hidden />
        <h2 className="text-base font-bold text-slate-800">تعذر عرض هذه الشاشة</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          أعد المحاولة لفتح الشاشة. إذا استمر الخطأ يمكنك الرجوع إلى الرئيسية أو إعادة تحميل الصفحة.
        </p>
        {this.state.error.message && <details className="text-start text-xs text-slate-600">
          <summary className="w-fit cursor-pointer py-2 font-semibold">تفاصيل الخطأ</summary>
          <p className="break-words rounded-lg bg-slate-50 p-2 [overflow-wrap:anywhere]" dir="auto">{this.state.error.message}</p>
        </details>}
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button type="button" onClick={() => this.setState({ error: null })} className="flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
            <RotateCcw className="w-4 h-4" /> إعادة المحاولة
          </button>
          {this.props.onHome && (
            <button type="button" onClick={this.props.onHome} className="flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700">
              <Home className="w-4 h-4" /> الرئيسية
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50">
            إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }
}
