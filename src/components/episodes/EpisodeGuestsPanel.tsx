import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { confirmDialog } from '../../services/dialogs';
import { notify } from '../../services/notify';
import React, { useState } from 'react';
import { AlertTriangle, Phone, Plus, Replace, Send, Trash2, UserPlus } from 'lucide-react';
import type { Episode, EpisodeGuest, Guest, RundownSegment, User } from '../../types';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { Avatar } from '../common/Avatar';
import { FormPage } from '../common/FormPage';
import {
  arrivalFromBooking,
  BOOKING_STATUSES,
  BookingStatus,
  bookingStatusOf,
  CONNECTION_TYPES,
  episodeGuestList,
  GUEST_ROLES,
  GuestRole,
  guestClashes,
  guestKey,
  guestRoleName,
  guestSegments,
  segmentGuests,
  withSegmentGuests,
} from '../../shared/episodePlan';

interface Props {
  episode: Episode;
  allGuests: Guest[];
  currentUser: User;
  canEditEpisode: boolean;
  canEditRundown: boolean;
  onSaveEpisode: (data: Partial<Episode>) => void;
  onUpdateRundown: (segments: RundownSegment[]) => void;
}

const TONE: Record<string, string> = {
  CANDIDATE: 'border-slate-300 bg-slate-50 text-slate-700',
  CONTACTED: 'border-amber-300 bg-amber-50 text-amber-800',
  CONFIRMED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  DECLINED: 'border-rose-300 bg-rose-50 text-rose-700',
  ARRIVED: 'border-blue-300 bg-blue-50 text-blue-800',
};

const clean = ({ virtual: _v, ...g }: any): EpisodeGuest => g;

export const EpisodeGuestsPanel: React.FC<Props> = ({ episode, allGuests, currentUser, canEditEpisode, canEditRundown, onSaveEpisode, onUpdateRundown }) => {
  const list = episodeGuestList(episode);
  const rundown = episode.rundown || [];
  const allEpisodes = apiService.getEpisodes();
  const requests = apiService.getRequests();
  const canRequest = RbacService.hasPermission(currentUser, 'requests.create');
  const [adding, setAdding] = useState(false);
  const [newGuestId, setNewGuestId] = useState('');
  const [newStatus, setNewStatus] = useState<BookingStatus>('CANDIDATE');
  const [drafts, setDrafts] = useState<Record<string, { cgName?: string; cgTitle?: string; briefPoints?: string; note?: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  const bankOf = (id: string) => allGuests.find((g) => g.id === id);

  const saveList = (next: any[]) => onSaveEpisode({ id: episode.id, guests: next.map(clean) });

  const update = (key: string, patch: Partial<EpisodeGuest>) => {
    saveList(
      list.map((g) => {
        if (guestKey(g) !== key) return g;
        const next = { ...g, ...patch };
        if (patch.bookingStatus) next.arrivalStatus = arrivalFromBooking(patch.bookingStatus);
        return next;
      })
    );
  };

  const flash = (t: string) => {
    setMessage(t);
    setTimeout(() => setMessage(null), 4000);
  };

  const addGuest = (e: React.FormEvent) => {
    e.preventDefault();
    const g = bankOf(newGuestId);
    if (!g || list.some((x) => guestKey(x) === g.id)) return setAdding(false);
    saveList([
      ...list,
      {
        guestId: g.id,
        guestName: g.fullName,
        guestAvatar: g.avatarUrl,
        organization: g.organization,
        jobTitle: g.jobTitle,
        connectionType: 'STUDIO',
        segmentTopic: '',
        bookingStatus: newStatus,
        arrivalStatus: arrivalFromBooking(newStatus),
      },
    ]);
    setAdding(false);
    setNewGuestId('');
  };

  const removeGuest = async (key: string, name: string) => {
    const inSegments = guestSegments(episode, key).length;
    if (!(await confirmDialog(inSegments ? `إزالة ${name} من الحلقة ومن ${inSegments} فقرة؟` : `إزالة ${name} من الحلقة؟`))) return;
    if (inSegments) onUpdateRundown(rundown.map((s) => (segmentGuests(s).some((g) => g.guestId === key) ? withSegmentGuests(s, segmentGuests(s).filter((g) => g.guestId !== key)) : s)));
    saveList(list.filter((g) => guestKey(g) !== key));
  };

  /** Puts the backup guest in place of one who declined, in every segment. */
  const swapToBackup = async (g: any) => {
    const backup = bankOf(g.backupGuestId);
    if (!backup) return;
    if (!(await confirmDialog(`استبدال ${g.guestName} بالبديل ${backup.fullName} في كل فقراته؟`))) return;
    onUpdateRundown(
      rundown.map((s) =>
        segmentGuests(s).some((x) => x.guestId === guestKey(g))
          ? withSegmentGuests(
              s,
              segmentGuests(s).map((x) => (x.guestId === guestKey(g) ? { ...x, guestId: backup.id, guestName: backup.fullName } : x))
            )
          : s
      )
    );
    const next = list.map((x) => (guestKey(x) === guestKey(g) ? { ...x, bookingStatus: 'DECLINED', arrivalStatus: 'PENDING' } : x));
    if (!next.some((x) => guestKey(x) === backup.id)) {
      next.push({
        guestId: backup.id,
        guestName: backup.fullName,
        guestAvatar: backup.avatarUrl,
        organization: backup.organization,
        jobTitle: backup.jobTitle,
        connectionType: g.connectionType || 'STUDIO',
        segmentTopic: g.segmentTopic || '',
        bookingStatus: 'CONTACTED',
        arrivalStatus: 'PENDING',
        briefPoints: g.briefPoints,
      });
    }
    saveList(next);
    flash(`أصبح ${backup.fullName} ضيف الفقرات بدلاً من ${g.guestName}؛ تابع تأكيد حجزه.`);
  };

  const addToSegment = (key: string, name: string, segId: string, role: GuestRole) => {
    onUpdateRundown(
      rundown.map((s) => (s.id === segId && !segmentGuests(s).some((x) => x.guestId === key) ? withSegmentGuests(s, [...segmentGuests(s), { guestId: key, guestName: name, role }]) : s))
    );
  };

  const sendLowerThird = (g: any, lines: string[]) => {
    try {
      apiService.createRequest({
        type: 'GRAPHICS',
        title: `شارة الضيف: ${g.guestName}`,
        details: `${episode.programName || ''} — ${episode.title}`,
        lines,
        link: { kind: 'episode', episodeId: episode.id, title: `${episode.programName || ''} — ${episode.title}` },
      });
      flash('أُرسلت الشارة إلى قسم الجرافيك');
    } catch (err: any) {
      notify({ type: 'warning', message: err?.message || 'تعذر إرسال الطلب' });
    }
  };

  const counts = BOOKING_STATUSES.map((s) => ({ ...s, n: list.filter((g) => bookingStatusOf(g) === s.id).length }));

  return (
    <div className="space-y-4" data-testid="episode-guests">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
        <div>
          <h3 className="text-sm font-bold text-slate-800">ضيوف الحلقة وحجزهم</h3>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {counts.map((c) => (
              <span key={c.id} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TONE[c.id]}`}>
                {c.name}: {c.n}
              </span>
            ))}
          </div>
        </div>
        {canEditEpisode && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold">
            <UserPlus className="w-4 h-4" /> ترشيح ضيف
          </button>
        )}
      </div>

      {message && (
        <p role="status" className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
          {message}
        </p>
      )}

      {list.length === 0 && (
        <div className="bg-white p-10 text-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
          لا ضيوف بعد. رشّح ضيفاً من بنك الضيوف، أو أضفه مباشرة لفقرة من «تحضير الحلقة».
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {list.map((g) => {
          const key = guestKey(g);
          const bank = bankOf(key);
          const status = bookingStatusOf(g);
          const segs = guestSegments(episode, key);
          const clashes = status === 'DECLINED' ? [] : guestClashes(episode, key, allEpisodes);
          const draft = drafts[key] || {};
          const cgName = draft.cgName ?? g.cgName ?? g.guestName;
          const cgTitle = draft.cgTitle ?? g.cgTitle ?? [bank?.jobTitle || g.jobTitle, bank?.organization || g.organization].filter(Boolean).join(' — ');
          const briefPoints = draft.briefPoints ?? g.briefPoints ?? '';
          const setDraft = (patch: any) => setDrafts({ ...drafts, [key]: { ...draft, ...patch } });
          const dirty = draft.cgName !== undefined || draft.cgTitle !== undefined || draft.briefPoints !== undefined;
          const cgSent = requests.some((r) => r.type === 'GRAPHICS' && r.link?.episodeId === episode.id && r.status !== 'CANCELLED' && r.lines?.[0] === cgName);
          const talkSegments = rundown.filter((s) => s.segmentType !== 'BREAK' && !segs.some((x: any) => x.id === s.id));
          return (
            <article key={key} aria-label={`الضيف ${g.guestName}`} className={`bg-white p-4 rounded-2xl border-2 space-y-3 ${status === 'DECLINED' ? 'border-rose-200' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={g.guestAvatar || bank?.avatarUrl} name={g.guestName} className="w-11 h-11 rounded-xl ring-1 ring-slate-200" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-800">{g.guestName}</h4>
                    <p className="text-[11px] text-slate-500 truncate">{[bank?.jobTitle || g.jobTitle, bank?.organization || g.organization].filter(Boolean).join(' — ')}</p>
                    {bank?.phone && (
                      <a href={`tel:${bank.phone}`} className="text-[11px] text-blue-700 flex items-center gap-1" dir="ltr">
                        <Phone className="w-3 h-3" /> {bank.phone}
                      </a>
                    )}
                  </div>
                </div>
                {canEditEpisode && (
                  <button type="button" onClick={() => removeGuest(key, g.guestName)} aria-label={`إزالة ${g.guestName}`} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {clashes.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  محجوز في نفس التوقيت: {clashes.map((e) => `${e.programName || ''} (${e.startTime})`).join('، ')}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-slate-600">
                  حالة الحجز
                  <select
                    value={status}
                    disabled={!canEditEpisode}
                    onChange={(e) => update(key, { bookingStatus: e.target.value as BookingStatus })}
                    className={`mt-1 w-full px-2 py-1.5 rounded-lg border-2 text-xs font-bold ${TONE[status]}`}
                  >
                    {BOOKING_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  وسيلة المشاركة
                  <select
                    value={g.connectionType || 'STUDIO'}
                    disabled={!canEditEpisode}
                    onChange={(e) => update(key, { connectionType: e.target.value as any })}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    {CONNECTION_TYPES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="text-xs space-y-1">
                <span className="font-bold text-slate-600">الفقرات:</span>
                {segs.length === 0 ? (
                  <span className="text-rose-600 font-bold mr-1">غير مضاف لأي فقرة</span>
                ) : (
                  <ul className="flex flex-wrap gap-1 mt-1">
                    {segs.map((s: any) => (
                      <li key={s.id} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                        {s.title} · {guestRoleName(segmentGuests(s).find((x) => x.guestId === key)?.role)}
                      </li>
                    ))}
                  </ul>
                )}
                {canEditRundown && talkSegments.length > 0 && (
                  <select
                    aria-label={`إضافة ${g.guestName} إلى فقرة`}
                    value=""
                    onChange={(e) => {
                      const [segId, role] = e.target.value.split('|');
                      if (segId) addToSegment(key, g.guestName, segId, role as GuestRole);
                    }}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-dashed border-slate-300 text-[11px] bg-white"
                  >
                    <option value="">+ إضافته إلى فقرة…</option>
                    {talkSegments.map((s) =>
                      GUEST_ROLES.map((r) => (
                        <option key={`${s.id}|${r.id}`} value={`${s.id}|${r.id}`}>
                          {s.title} — {r.name}
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-[11px] font-bold text-slate-600">
                  الضيف البديل
                  <select
                    value={g.backupGuestId || ''}
                    disabled={!canEditEpisode}
                    onChange={(e) => update(key, { backupGuestId: e.target.value || undefined, backupGuestName: bankOf(e.target.value)?.fullName })}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">— بلا بديل —</option>
                    {allGuests
                      .filter((x) => x.id !== key)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.fullName}
                        </option>
                      ))}
                  </select>
                </label>
                {status === 'DECLINED' && g.backupGuestId && canEditEpisode && canEditRundown && (
                  <button type="button" onClick={() => swapToBackup(g)} className="self-end flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold">
                    <Replace className="w-3.5 h-3.5" /> استبدال بالبديل
                  </button>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="text-[11px] font-bold text-slate-700">شارة الاسم</div>
                <input aria-label={`سطر الاسم لـ ${g.guestName}`} value={cgName} readOnly={!canEditEpisode} onChange={(e) => setDraft({ cgName: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold bg-white" />
                <input aria-label={`سطر الصفة لـ ${g.guestName}`} value={cgTitle} readOnly={!canEditEpisode} onChange={(e) => setDraft({ cgTitle: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white" />
                {canRequest &&
                  (cgSent ? (
                    <p className="text-[11px] font-bold text-emerald-700">أُرسلت الشارة للجرافيك</p>
                  ) : (
                    <button type="button" onClick={() => sendLowerThird(g, [cgName, cgTitle].filter(Boolean))} className="flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
                      <Send className="w-3 h-3" /> إرسال الشارة لقسم الجرافيك
                    </button>
                  ))}
              </div>

              <label className="block text-[11px] font-bold text-slate-600">
                ما نريده من الضيف (نقاط التحضير)
                <textarea rows={2} value={briefPoints} readOnly={!canEditEpisode} onChange={(e) => setDraft({ briefPoints: e.target.value })} className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white" />
              </label>
              {canEditEpisode && dirty && (
                <button
                  type="button"
                  onClick={() => {
                    update(key, { cgName, cgTitle, briefPoints });
                    setDrafts({ ...drafts, [key]: {} });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold"
                >
                  حفظ بيانات الضيف
                </button>
              )}

              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-600">سجل التواصل ({(g.contactLog || []).length})</div>
                {(g.contactLog || [])
                  .slice(-3)
                  .reverse()
                  .map((c: any, i: number) => (
                    <p key={i} className="text-[11px] text-slate-600">
                      <span className="text-slate-500">{new Date(c.at).toLocaleString(appLocale(), { ...zoneOptions(), dateStyle: 'short', timeStyle: 'short' })} · {c.byName}:</span> {c.note}
                    </p>
                  ))}
                {canEditEpisode && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const note = (draft.note || '').trim();
                      if (!note) return;
                      update(key, { contactLog: [...(g.contactLog || []), { at: new Date().toISOString(), byName: currentUser.fullName, note }] });
                      setDrafts({ ...drafts, [key]: { ...draft, note: '' } });
                    }}
                    className="flex gap-1.5"
                  >
                    <input aria-label={`ملاحظة تواصل مع ${g.guestName}`} placeholder="مثال: اتصلت، سيؤكد مساءً" value={draft.note || ''} onChange={(e) => setDraft({ note: e.target.value })} className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs" />
                    <button type="submit" aria-label="تسجيل" className="px-2.5 rounded-lg bg-slate-800 text-white">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <FormPage isOpen={adding} onClose={() => setAdding(false)} title="ترشيح ضيف للحلقة" maxWidth="md">
        <form onSubmit={addGuest} className="space-y-4">
          <label className="block text-xs font-bold text-slate-700">
            الضيف من بنك الضيوف *
            <select data-autofocus required value={newGuestId} onChange={(e) => setNewGuestId(e.target.value)} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
              <option value="">— اختر —</option>
              {allGuests
                .filter((x) => !list.some((g) => guestKey(g) === x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName} ({x.jobTitle} — {x.organization})
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            حالة الحجز
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as BookingStatus)} className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs bg-white">
              {BOOKING_STATUSES.filter((s) => s.id !== 'ARRIVED' && s.id !== 'DECLINED').map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500">بعد الترشيح أضفه إلى فقرة من بطاقته أو من «تحضير الحلقة».</p>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
              إلغاء
            </button>
            <button type="submit" className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl">
              ترشيح
            </button>
          </div>
        </form>
      </FormPage>
    </div>
  );
};
