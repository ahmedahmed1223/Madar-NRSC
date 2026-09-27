import { airStories, Bulletin, BulletinStory, bulletinKindName, bulletinTiming, clockOf, mmss, storyStatusName, storyTiming, storyTypeOf } from '../../shared/bulletins';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Rundown sheet for the director and control room, then one script page per story for the anchor. */
export function bulletinPrintHtml(b: Bulletin, stories: BulletinStory[]): string {
  const t = bulletinTiming(b, stories);
  const list = airStories(stories);
  const rows = list
    .map((s, i) => {
      const r = t.rows.get(s.id)!;
      const st = storyTiming(s);
      return `<tr><td>${i + 1}</td><td><b>${esc(s.slug)}</b>${s.directorNotes ? `<div class="muted">${esc(s.directorNotes)}</div>` : ''}${(s.graphics || []).map((g) => `<div class="muted">CG: ${esc(g.lines.join(' / '))}</div>`).join('')}</td>
        <td class="mono">${esc(storyTypeOf(s.type).code)}</td><td>${esc(s.anchorName || b.anchors[0] || '')}</td><td>${esc(storyStatusName(s.status))}</td>
        <td class="mono">${mmss(st.read)}</td><td class="mono">${mmss(st.clip + st.manual)}</td><td class="mono"><b>${mmss(st.total)}</b></td>
        <td class="mono">${clockOf(r.front)}</td><td class="mono">${clockOf(r.back)}</td></tr>`;
    })
    .join('');
  const scripts = list
    .filter((s) => storyTypeOf(s.type).read && s.script.trim())
    .map(
      (s, i) => `<section class="page"><div class="slug">${i + 1}. ${esc(s.slug)} <span class="mono">[${esc(storyTypeOf(s.type).code)}]</span> — ${esc(s.anchorName || b.anchors[0] || '')}${s.status !== 'APPROVED' ? ' <span class="warn">غير معتمدة</span>' : ''}</div>
      <div class="script">${esc(s.script).replace(/\n/g, '<br/>')}</div>${storyTypeOf(s.type).clip ? `<div class="cue">▶ ${esc(storyTypeOf(s.type).code)} ${mmss(storyTiming(s).clip)}</div>` : ''}</section>`
    )
    .join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(b.title)}</title>
<style>
 body{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;color:#0f172a;margin:20px;font-size:12px}
 h1{font-size:18px;margin:0} table{width:100%;border-collapse:collapse;margin-top:10px} td,th{border:1px solid #cbd5e1;padding:4px;text-align:right;vertical-align:top}
 th{background:#f1f5f9} .mono{font-family:monospace;white-space:nowrap} .muted{color:#64748b;font-size:10px}
 .page{page-break-before:always;padding-top:8px} .slug{font-weight:700;border-bottom:2px solid #0f172a;padding-bottom:4px;margin-bottom:10px}
 .script{font-size:22px;line-height:2} .cue{margin-top:10px;font-weight:700;color:#1d4ed8} .warn{color:#b91c1c}
 .sum{margin-top:6px} .over{color:#b91c1c} .under{color:#b45309}
</style></head><body>
<h1>${esc(b.title)}</h1>
<div class="muted">${esc(bulletinKindName(b.kind))} · ${esc(b.date)} · ${esc(b.startTime)} · المحرر: ${esc(b.editorName || '')} · التقديم: ${esc(b.anchors.join('، '))} ${b.studioName ? `· ${esc(b.studioName)}` : ''}</div>
<div class="sum">البداية ${clockOf(t.start)} · النهاية المحددة ${clockOf(t.hardOut)} · المخطط ${mmss(t.planned)} · الفعلي ${mmss(t.total)} · <b class="${t.overUnder > 0 ? 'over' : 'under'}">${t.overUnder > 0 ? '+' : ''}${mmss(t.overUnder)}</b></div>
<table><thead><tr><th>#</th><th>القصة</th><th>النوع</th><th>المذيع</th><th>الحالة</th><th>قراءة</th><th>لقطة</th><th>المدة</th><th>البداية</th><th>Back</th></tr></thead><tbody>${rows}</tbody></table>
${scripts}
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

export function printBulletin(b: Bulletin, stories: BulletinStory[]) {
  const w = window.open('', '_blank');
  if (!w) {
    window.alert('اسمح للمتصفح بفتح النوافذ المنبثقة للطباعة');
    return;
  }
  w.document.open();
  w.document.write(bulletinPrintHtml(b, stories));
  w.document.close();
}
