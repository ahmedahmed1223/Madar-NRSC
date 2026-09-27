import type { Episode } from '../../types';
import { formatSecondsToTime } from '../../shared/rundown';
import {
  bookingStatusName,
  bookingStatusOf,
  connectionName,
  episodeGuestList,
  groupByTopic,
  guestKey,
  guestRoleName,
  questionKindName,
  reportSourceOf,
  segmentGuests,
  segmentQuestions,
} from '../../shared/episodePlan';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const TYPE: Record<string, string> = {
  INTRO: 'مقدمة',
  REPORT: 'تقرير',
  NEWS_ITEM: 'خبر',
  LIVE_INTERVIEW: 'مقابلة',
  DISCUSSION: 'نقاش',
  BREAK: 'فاصل',
  OUTRO: 'ختام',
};

/** Builds the printable episode file: rundown by topic, guests with contacts, questions and name straps. */
export function episodeFileHtml(episode: Episode, phones: Record<string, string> = {}): string {
  const guests = episodeGuestList(episode).filter((g) => bookingStatusOf(g) !== 'DECLINED');
  const brief = episode.brief || {};
  const rows = groupByTopic(episode)
    .map(({ topic, segments }, gi) => {
      const head = `<tr class="topic"><td colspan="5">${topic ? `المحور ${gi + 1}: ${esc(topic.title)}${topic.angle ? ` — ${esc(topic.angle)}` : ''}` : 'خارج المحاور'}</td></tr>`;
      const body = segments
        .map((s: any) => {
          const sg = segmentGuests(s)
            .map((g) => `${esc(g.guestName)} (${esc(guestRoleName(g.role))})`)
            .join('، ');
          const report = s.report ? `<div class="muted">${esc(reportSourceOf(s.report.source)?.name)}${s.report.reporterName ? `: ${esc(s.report.reporterName)}` : ''}${s.report.location ? ` · ${esc(s.report.location)}` : ''}</div>` : '';
          const qs = segmentQuestions(episode, s)
            .map((q: any) => `<li>${q.parentId ? '↳ ' : ''}<b>[${esc(questionKindName(q.kind))}]</b> ${esc(q.questionText)}${q.assignedToName ? ` <span class="muted">— ${esc(q.assignedToName)}</span>` : ''}</li>`)
            .join('');
          return `<tr>
            <td class="mono">${esc(s.startTimeOffset || '')}</td>
            <td class="mono">${esc(formatSecondsToTime(s.durationSeconds || 0).slice(3))}</td>
            <td>${esc(TYPE[s.segmentType] || s.segmentType)}</td>
            <td><b>${esc(s.title)}</b>${sg ? `<div>${sg}</div>` : ''}${report}${qs ? `<ol class="qs">${qs}</ol>` : ''}${s.notes ? `<div class="muted">إخراج: ${esc(s.notes)}</div>` : ''}</td>
            <td>${esc(s.presenterName || '')}</td>
          </tr>`;
        })
        .join('');
      return head + body;
    })
    .join('');

  const guestRows = guests
    .map((g) => {
      const key = guestKey(g);
      return `<tr>
        <td><b>${esc(g.guestName)}</b></td>
        <td>${esc(bookingStatusName(bookingStatusOf(g)))}</td>
        <td>${esc(connectionName(g.connectionType))}</td>
        <td class="mono" dir="ltr">${esc(phones[key] || g.phone || '')}</td>
        <td><b>${esc(g.cgName || g.guestName)}</b><br/>${esc(g.cgTitle || [g.jobTitle, g.organization].filter(Boolean).join(' — '))}</td>
        <td>${esc(g.briefPoints || '')}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملف الحلقة — ${esc(episode.title)}</title>
<style>
  body{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px}
  table{width:100%;border-collapse:collapse} td,th{border:1px solid #cbd5e1;padding:5px;vertical-align:top;text-align:right}
  th{background:#f1f5f9} .topic td{background:#e0e7ff;font-weight:700} .mono{font-family:monospace;white-space:nowrap}
  .muted{color:#64748b;font-size:11px} .qs{margin:4px 0 0;padding-right:18px} .brief p{margin:2px 0}
  @media print{body{margin:10mm} tr{page-break-inside:avoid}}
</style></head><body>
<h1>${esc(episode.programName || '')} — ${esc(episode.title)}</h1>
<div class="muted">حلقة #${esc(episode.episodeNumber)} · ${esc(episode.broadcastDate)} ${esc(episode.startTime)}–${esc(episode.endTime)} · ${esc(episode.studioName || '')} · التقديم: ${esc(episode.presenterName || '')} · الإعداد: ${esc(episode.producerName || '')}</div>
${brief.idea || brief.angle || brief.message ? `<h2>ملخص الحلقة</h2><div class="brief">${brief.idea ? `<p><b>الفكرة:</b> ${esc(brief.idea)}</p>` : ''}${brief.angle ? `<p><b>الزاوية:</b> ${esc(brief.angle)}</p>` : ''}${brief.message ? `<p><b>الرسالة:</b> ${esc(brief.message)}</p>` : ''}</div>` : ''}
<h2>الرانداون والأسئلة</h2>
<table><thead><tr><th>البداية</th><th>المدة</th><th>النوع</th><th>الفقرة</th><th>التقديم</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا فقرات</td></tr>'}</tbody></table>
<h2>الضيوف والشارات</h2>
<table><thead><tr><th>الضيف</th><th>الحجز</th><th>المشاركة</th><th>الهاتف</th><th>الشارة</th><th>نقاط التحضير</th></tr></thead><tbody>${guestRows || '<tr><td colspan="6">لا ضيوف</td></tr>'}</tbody></table>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

export function printEpisodeFile(episode: Episode, phones: Record<string, string>) {
  const w = window.open('', '_blank');
  if (!w) {
    window.alert('اسمح للمتصفح بفتح النوافذ المنبثقة لطباعة ملف الحلقة');
    return;
  }
  w.document.open();
  w.document.write(episodeFileHtml(episode, phones));
  w.document.close();
}
