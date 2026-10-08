import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
export function OfflineViewerControls({ onMove, onFont }: { onMove: (delta: number) => void; onFont: (delta: number) => void }) {
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('main')?.requestFullscreen();
      setError('');
    } catch { setError('ملء الشاشة غير متاح في هذا المتصفح'); }
  }
  useEffect(() => {
    const changed = () => setFull(!!document.fullscreenElement);
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || target.isContentEditable || ['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft') onMove(1);
      else if (event.key === 'ArrowRight') onMove(-1);
      else if (event.key === '+') onFont(2);
      else if (event.key === '-') onFont(-2);
      else if (event.key === 'f' || event.key === 'F') void toggle();
      else if (event.key === 'Home') document.querySelector('article')?.scrollIntoView();
      else return;
      event.preventDefault();
    };
    document.addEventListener('fullscreenchange', changed); window.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('keydown', keyboard); };
  }, [onMove, onFont]);
  return <><button type="button" title={full ? 'إنهاء ملء الشاشة (F)' : 'ملء الشاشة (F)'} aria-label="ملء الشاشة" onClick={() => void toggle()}>{full ? <Minimize2/> : <Maximize2/>}</button>{error && <p role="alert">{error}</p>}</>;
}
