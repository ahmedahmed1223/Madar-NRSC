import { appLocale, zoneOptions } from '../shared/dateFormat';
import { confirmDialog } from '../services/dialogs';
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Pencil, Plus, Power, Settings2, Trash2, X } from 'lucide-react';
import type { User } from '../types';
import { apiService } from '../services/api';
import { RbacService } from '../services/rbacService';
import { notify, tryAction } from '../services/notify';
import { useLiveData } from '../hooks/useLiveData';
import { BookingForm } from '../components/planning/BookingForm';
import { FormPage } from '../components/common/FormPage';
import { arabicDate, localDateString } from '../shared/dates';
import { Booking, bookingsOnDay, bookingStatusOf, Resource, RESOURCE_KINDS, resourceKindName, shiftDay } from '../shared/planning';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' });

interface BookingsViewProps {
  currentUser: User;
  users: User[];
  /** Booking opened from a notification. */
  focusId?: string | null;
}

/** Studios, cameras, live units, edit suites and crews on one day timeline; overlapping bookings are refused. */
export const BookingsView: React.FC<BookingsViewProps> = ({ currentUser, users, focusId }) => {
  useLiveData(['resources', 'bookings'], 60_000);
  const canBook = RbacService.hasPermission(currentUser, 'resources.book') || RbacService.hasPermission(currentUser, 'resources.manage');
  const canManage = RbacService.hasPermission(currentUser, 'resources.manage');
  const resources = apiService.getResources();
  const bookings = apiService.getBookings();
  const focused = focusId ? bookings.find((b) => b.id === focusId) : undefined;
  const [day, setDay] = useState(() => (focused ? localDateString(new Date(focused.start)) : localDateString()));
  const [kind, setKind] = useState<string>('ALL');
  const [editing, setEditing] = useState<Partial<Booking> | null>(null);
  const [viewing, setViewing] = useState<Booking | null>(null);
  const [managing, setManaging] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (focused) {
      setDay(localDateString(new Date(focused.start)));
      setViewing(focused);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [y, m, d] = day.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();
  const pct = (ms: number) => ((Math.min(Math.max(ms, dayStart), dayEnd) - dayStart) / (dayEnd - dayStart)) * 100;
  const todays = useMemo(() => bookingsOnDay(bookings, day), [bookings, day]);
  const visible = resources.filter((r) => r.isActive !== false && (kind === 'ALL' || r.kind === kind));
  const nowPct = now >= dayStart && now < dayEnd ? pct(now) : null;

  const mine = bookings
    .filter((b) => b.status !== 'CANCELLED' && Date.parse(b.end) > now && (b.assigneeId === currentUser.id || b.bookedById === currentUser.id))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 8);
  const resName = (id: string) => resources.find((r) => r.id === id)?.name || 'مورد محذوف';
  const userName = (id?: string) => users.find((u) => u.id === id)?.fullName || '';
  const canEdit = (b: Booking) => canManage || b.bookedById === currentUser.id;

  const newAt = (resourceId: string, hour: number) => {
    if (!canBook) return;
    const start = new Date(y, m - 1, d, hour);
    setEditing({ resourceId, start: start.toISOString(), end: new Date(start.getTime() + 2 * 3600_000).toISOString() });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-blue-600" />
            حجز الموارد
          </h1>
          <p className="text-xs text-slate-500 mt-1">الاستوديوهات والكاميرات ووحدات البث وغرف المونتاج والطواقم على جدول اليوم؛ لا يقبل النظام حجزين متعارضين للمورد نفسه.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDay(shiftDay(day, -1))} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="اليوم السابق">
            <ChevronRight className="w-4 h-4" />
          </button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="اليوم" className="px-2 py-1.5 rounded-xl border border-slate-200 text-xs" />
          <button type="button" onClick={() => setDay(shiftDay(day, 1))} className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" aria-label="اليوم التالي">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setDay(localDateString())} className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
            اليوم
          </button>
          {canManage && (
            <button type="button" onClick={() => setManaging(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold">
              <Settings2 className="w-3.5 h-3.5" /> الموارد
            </button>
          )}
          {canBook && (
            <button type="button" onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
              <Plus className="w-3.5 h-3.5" /> حجز جديد
            </button>
          )}
        </div>
      </div>

      {mine.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-4" aria-label="حجوزاتي القادمة">
          <h2 className="text-sm font-bold text-slate-800 mb-2">حجوزاتي القادمة</h2>
          <ul className="grid sm:grid-cols-2 gap-2">
            {mine.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setViewing(b)} className="w-full text-right p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs">
                  <span className="font-bold text-slate-800">{resName(b.resourceId)}</span> — {b.title}
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {arabicDate(localDateString(new Date(b.start)))} · من {fmtTime(b.start)} إلى {fmtTime(b.end)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="نوع المورد">
        {[{ id: 'ALL', name: 'الكل' }, ...RESOURCE_KINDS.filter((k) => resources.some((r) => r.kind === k.id))].map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => setKind(k.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${kind === k.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            {k.name}
          </button>
        ))}
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden" aria-label={`جدول ${arabicDate(day)}`}>
        <div className="p-3 border-b border-slate-100 text-sm font-bold text-slate-800">{arabicDate(day)}</div>
        {visible.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">{resources.length ? 'لا موارد من هذا النوع.' : canManage ? 'أضف الموارد القابلة للحجز من زر «الموارد».' : 'لم يضف مسؤول الحجوزات أي موارد بعد.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="flex border-b border-slate-100 text-[10px] text-slate-400">
                <div className="w-40 shrink-0" />
                <div className="flex-1 grid grid-cols-24" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                  {HOURS.map((h) => (
                    <span key={h} className="py-1 text-center border-s border-slate-100 font-mono">
                      {String(h).padStart(2, '0')}
                    </span>
                  ))}
                </div>
              </div>
              {visible.map((r) => {
                const rows = todays.filter((b) => b.resourceId === r.id && b.status !== 'CANCELLED');
                return (
                  <div key={r.id} className="flex border-b border-slate-100 last:border-0">
                    <div className="w-40 shrink-0 p-2 text-xs">
                      <p className="font-bold text-slate-800 truncate">{r.name}</p>
                      <p className="text-[10px] text-slate-500">{resourceKindName(r.kind)}</p>
                    </div>
                    <div className="flex-1 relative h-14">
                      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                        {HOURS.map((h) => (
                          <button
                            key={h}
                            type="button"
                            tabIndex={-1}
                            disabled={!canBook}
                            onClick={() => newAt(r.id, h)}
                            aria-label={`حجز ${r.name} الساعة ${h}`}
                            className="border-s border-slate-100 hover:bg-blue-50/60 disabled:hover:bg-transparent"
                          />
                        ))}
                      </div>
                      {nowPct !== null && <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none" style={{ insetInlineStart: `${nowPct}%` }} />}
                      {rows.map((b) => {
                        const s = pct(Date.parse(b.start));
                        const e = pct(Date.parse(b.end));
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setViewing(b)}
                            title={`${b.title} — ${fmtTime(b.start)}–${fmtTime(b.end)} — ${b.bookedByName || ''}`}
                            className={`absolute top-1.5 bottom-1.5 rounded-lg border px-1.5 text-[10px] font-bold text-right overflow-hidden whitespace-nowrap z-20 ${bookingStatusOf(b.status).tone} ${
                              focusId === b.id ? 'ring-2 ring-blue-500' : ''
                            }`}
                            style={{ insetInlineStart: `${s}%`, width: `${Math.max(e - s, 1.5)}%` }}
                          >
                            {b.title}
                            <span className="block font-normal opacity-80">
                              {fmtTime(b.start)}–{fmtTime(b.end)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Booking details */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div role="dialog" aria-label="تفاصيل الحجز" className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-bold text-slate-900">{viewing.title}</h2>
                <p className="text-xs text-slate-500">{resName(viewing.resourceId)}</p>
              </div>
              <button type="button" onClick={() => setViewing(null)} aria-label="إغلاق">
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="text-xs space-y-1.5 text-slate-700">
              <div>
                <dt className="inline font-bold">الموعد: </dt>
                <dd className="inline">
                  {arabicDate(localDateString(new Date(viewing.start)))} من {fmtTime(viewing.start)} إلى {fmtTime(viewing.end)}
                </dd>
              </div>
              <div>
                <dt className="inline font-bold">الحالة: </dt>
                <dd className="inline">{bookingStatusOf(viewing.status).name}</dd>
              </div>
              <div>
                <dt className="inline font-bold">حجزه: </dt>
                <dd className="inline">{viewing.bookedByName}</dd>
                {viewing.assigneeId && viewing.assigneeId !== viewing.bookedById && <dd className="inline"> — لـ {userName(viewing.assigneeId)}</dd>}
              </div>
              {viewing.link && (
                <div>
                  <dt className="inline font-bold">مرتبط بـ: </dt>
                  <dd className="inline">{viewing.link.title}</dd>
                </div>
              )}
              {viewing.notes && <p className="whitespace-pre-line bg-slate-50 rounded-lg p-2">{viewing.notes}</p>}
            </dl>
            {canEdit(viewing) && viewing.status !== 'CANCELLED' && (
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirmDialog('إلغاء هذا الحجز؟'))) return;
                    if (tryAction('إلغاء الحجز', () => apiService.cancelBooking(viewing.id), 'أُلغي الحجز')) setViewing(null);
                  }}
                  className="px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-50"
                >
                  إلغاء الحجز
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(viewing);
                    setViewing(null);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
                >
                  <Pencil className="w-3.5 h-3.5" /> تعديل
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && <BookingForm isOpen onClose={() => setEditing(null)} currentUser={currentUser} users={users} booking={editing} />}
      {managing && <ResourcesManager onClose={() => setManaging(false)} resources={resources} />}
    </div>
  );
};

const ResourcesManager: React.FC<{ onClose: () => void; resources: Resource[] }> = ({ onClose, resources }) => {
  const [draft, setDraft] = useState<Partial<Resource>>({ kind: 'STUDIO' });
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (tryAction('حفظ المورد', () => apiService.saveResource({ ...draft, name: (draft.name || '').trim(), location: draft.location?.trim() || undefined }), draft.id ? 'حُدّث المورد' : 'أُضيف المورد')) {
      setDraft({ kind: draft.kind });
    }
  };
  return (
    <FormPage isOpen onClose={onClose} title="الموارد القابلة للحجز" subtitle="استوديوهات، كاميرات، وحدات بث، غرف مونتاج، طواقم">
      <form onSubmit={save} className="grid sm:grid-cols-4 gap-2 items-end mb-4">
        <label className="text-xs font-bold text-slate-700 sm:col-span-1">
          النوع
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Resource['kind'] })} className="mt-1 w-full px-2 py-2 rounded-xl border border-slate-300 bg-white text-sm">
            {RESOURCE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          الاسم
          <input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={120} placeholder="استوديو 2" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-700">
          المكان (اختياري)
          <input value={draft.location || ''} onChange={(e) => setDraft({ ...draft, location: e.target.value })} maxLength={120} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="flex-1 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
            {draft.id ? 'حفظ' : 'إضافة'}
          </button>
          {draft.id && (
            <button type="button" onClick={() => setDraft({ kind: 'STUDIO' })} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold">
              جديد
            </button>
          )}
        </div>
      </form>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-2xl">
        {resources.length === 0 && <li className="p-4 text-xs text-slate-500 text-center">لا موارد بعد</li>}
        {resources.map((r) => (
          <li key={r.id} className="p-3 flex items-center justify-between gap-2 text-xs">
            <span className={r.isActive === false ? 'text-slate-400 line-through' : ''}>
              <span className="font-bold text-slate-800">{r.name}</span> — {resourceKindName(r.kind)}
              {r.location ? ` — ${r.location}` : ''}
            </span>
            <span className="flex gap-1">
              <button type="button" onClick={() => setDraft(r)} aria-label={`تعديل ${r.name}`} className="p-1.5 rounded hover:bg-slate-100">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => tryAction('تحديث المورد', () => apiService.saveResource({ ...r, isActive: r.isActive === false }), r.isActive === false ? 'أُعيد المورد للخدمة' : 'أُخرج المورد من الخدمة')}
                aria-label={r.isActive === false ? `إعادة ${r.name} للخدمة` : `إخراج ${r.name} من الخدمة`}
                title={r.isActive === false ? 'إعادة للخدمة' : 'خارج الخدمة'}
                className="p-1.5 rounded hover:bg-slate-100"
              >
                <Power className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if ((await confirmDialog(`حذف ${r.name}؟`))) tryAction('حذف المورد', () => apiService.deleteResource(r.id), 'حُذف المورد');
                }}
                aria-label={`حذف ${r.name}`}
                className="p-1.5 rounded hover:bg-rose-50 text-rose-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </FormPage>
  );
};

export default BookingsView;
