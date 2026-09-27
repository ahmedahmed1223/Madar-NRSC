import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2 } from 'lucide-react';
import type { User } from '../../types';
import { apiService } from '../../services/api';
import { notify } from '../../services/notify';
import { FormPage } from '../common/FormPage';
import { fromLocalInputValue, toLocalInputValue } from '../../shared/dates';
import { Booking, BookingLink, bookingConflicts, BOOKING_STATUSES, RESOURCE_KINDS, resourceKindName } from '../../shared/planning';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false });

interface BookingFormProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  users: User[];
  /** Existing booking to edit, or defaults for a new one. */
  booking?: Partial<Booking> | null;
  onSaved?: (b: Booking) => void;
}

/** Book a studio, camera, live unit, edit suite or crew; clashes are shown before saving. */
export const BookingForm: React.FC<BookingFormProps> = ({ isOpen, onClose, currentUser, users, booking, onSaved }) => {
  const resources = apiService.getResources(false);
  const initialStart = booking?.start ? new Date(booking.start) : (() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  })();
  const initialEnd = booking?.end ? new Date(booking.end) : new Date(initialStart.getTime() + 2 * 3600_000);
  const [resourceId, setResourceId] = useState(booking?.resourceId || resources[0]?.id || '');
  const [title, setTitle] = useState(booking?.title || booking?.link?.title || '');
  const [start, setStart] = useState(toLocalInputValue(initialStart));
  const [end, setEnd] = useState(toLocalInputValue(initialEnd));
  const [status, setStatus] = useState<Booking['status']>(booking?.status || 'CONFIRMED');
  const [assigneeId, setAssigneeId] = useState(booking?.assigneeId || currentUser.id);
  const [notes, setNotes] = useState(booking?.notes || '');
  const link: BookingLink | undefined = booking?.link;

  const draft = useMemo(
    () => ({ id: booking?.id || '__new__', resourceId, start: fromLocalInputValue(start), end: fromLocalInputValue(end), status }),
    [booking?.id, resourceId, start, end, status]
  );
  const validTimes = !!draft.start && !!draft.end && Date.parse(draft.end) > Date.parse(draft.start);
  const clashes = validTimes ? bookingConflicts(draft as Booking, apiService.getBookings()) : [];
  // Free alternatives of the same kind for the requested slot.
  const kind = resources.find((r) => r.id === resourceId)?.kind;
  const alternatives = clashes.length
    ? resources.filter((r) => r.id !== resourceId && r.kind === kind && !bookingConflicts({ ...draft, resourceId: r.id } as Booking, apiService.getBookings()).length)
    : [];

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = apiService.saveBooking({
        ...(booking?.id ? { id: booking.id } : {}),
        resourceId,
        title: title.trim(),
        start: draft.start,
        end: draft.end,
        status,
        assigneeId,
        notes: notes.trim() || undefined,
        link,
      });
      notify({ type: 'success', message: booking?.id ? 'حُدّث الحجز' : 'تم الحجز' });
      onSaved?.(saved);
      onClose();
    } catch (err: any) {
      notify({ type: 'error', title: 'تعذر الحجز', message: err?.message });
    }
  };

  const grouped = RESOURCE_KINDS.map((k) => ({ ...k, items: resources.filter((r) => r.kind === k.id) })).filter((g) => g.items.length);

  return (
    <FormPage isOpen={isOpen} onClose={onClose} title={booking?.id ? 'تعديل حجز' : 'حجز مورد'} subtitle={link ? `مرتبط بـ: ${link.title}` : 'استوديو، كاميرا، وحدة بث، غرفة مونتاج أو طاقم'}>
      {resources.length === 0 ? (
        <p className="text-sm text-slate-600 p-6 text-center">لا توجد موارد قابلة للحجز بعد. يضيفها مسؤول الحجوزات من شاشة «حجز الموارد».</p>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-slate-700">
              المورد
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
                {grouped.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.location ? ` — ${r.location}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-700">
              الغرض
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="مثال: تسجيل حلقة، تغطية مؤتمر" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              من
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              إلى
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              المستخدم / المسؤول
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
                {users
                  .filter((u) => u.isActive !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} — {u.department}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-700">
              الحالة
              <select value={status} onChange={(e) => setStatus(e.target.value as Booking['status'])} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm">
                {BOOKING_STATUSES.filter((s) => s.id !== 'CANCELLED' || booking?.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-700">
            ملاحظات
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm" />
          </label>

          {!validTimes ? (
            <p className="text-xs text-rose-600 font-bold">ينتهي الحجز بعد بدايته.</p>
          ) : clashes.length ? (
            <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1.5">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> تعارض: المورد محجوز في هذا الوقت
              </p>
              {clashes.map((c) => (
                <p key={c.id}>
                  «{c.title}» {fmtTime(c.start)}–{fmtTime(c.end)} — {c.bookedByName}
                </p>
              ))}
              {alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span>متاح بدلاً منه:</span>
                  {alternatives.map((r) => (
                    <button key={r.id} type="button" onClick={() => setResourceId(r.id)} className="px-2 py-0.5 rounded-lg bg-white border border-rose-200 font-bold hover:bg-rose-100">
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> {resourceKindName(kind)} متاح في هذا الوقت
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold">
              إلغاء
            </button>
            <button type="submit" disabled={!validTimes || clashes.length > 0} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold">
              <CalendarPlus className="w-4 h-4" />
              {booking?.id ? 'حفظ الحجز' : 'احجز'}
            </button>
          </div>
        </form>
      )}
    </FormPage>
  );
};
