export interface ReviewThread {
  id: string;
  collection: 'news' | 'bulletinStories';
  entityId: string;
  field: 'content' | 'script';
  baseVersion: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  resolved: boolean;
  createdById: string;
  createdAt: string;
  resolvedById?: string;
  resolvedAt?: string;
}
export function reviewThreadError(t: any): string | null {
  if (!t || !['news', 'bulletinStories'].includes(t.collection) || typeof t.entityId !== 'string' || !t.entityId || t.field !== (t.collection === 'news' ? 'content' : 'script')) return 'موضع المراجعة غير صالح';
  if (typeof t.baseVersion !== 'string' || t.baseVersion.length > 100 || !t.baseVersion) return 'نسخة النص غير صالحة';
  if (typeof t.quote !== 'string' || !t.quote.trim() || t.quote.length > 2000 || typeof t.contextBefore !== 'string' || t.contextBefore.length > 200 || typeof t.contextAfter !== 'string' || t.contextAfter.length > 200) return 'مقتطف المراجعة غير صالح';
  if (typeof t.resolved !== 'boolean') return 'حالة المراجعة غير صالحة';
  return null;
}
export function anchorStatus(text: string, quote: string): 'matched' | 'stale' | 'ambiguous' {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return 'stale';
  return text.indexOf(quote, at + quote.length) >= 0 ? 'ambiguous' : 'matched';
}
