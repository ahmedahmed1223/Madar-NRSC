/** Demo planning data: bookable resources, a week of diary events and a few bookings. */
import type { Booking, DiaryEntry, Resource } from '../shared/planning';
import { shiftDay } from '../shared/planning';

const T0 = '2026-01-01T00:00:00.000Z';

export const INITIAL_RESOURCES: Resource[] = [
  { id: 'res-studio-1', name: 'استوديو 1 (الأخبار)', kind: 'STUDIO', location: 'الطابق الأرضي', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-studio-2', name: 'استوديو 2 (البرامج)', kind: 'STUDIO', location: 'الطابق الأول', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-cam-1', name: 'كاميرا ميدانية A', kind: 'CAMERA', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-cam-2', name: 'كاميرا ميدانية B', kind: 'CAMERA', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-sng-1', name: 'وحدة بث SNG', kind: 'LIVE_UNIT', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-liveu-1', name: 'حقيبة LiveU 1', kind: 'LIVE_UNIT', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-edit-1', name: 'غرفة مونتاج 1', kind: 'EDIT_SUITE', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-edit-2', name: 'غرفة مونتاج 2', kind: 'EDIT_SUITE', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-crew-1', name: 'طاقم التصوير الأول', kind: 'CREW', isActive: true, createdAt: T0, updatedAt: T0 },
  { id: 'res-car-1', name: 'سيارة النقل الخارجي', kind: 'VEHICLE', isActive: true, createdAt: T0, updatedAt: T0 },
];

export function demoDiary(today: string): DiaryEntry[] {
  const now = new Date().toISOString();
  const base = { createdById: 'usr-2', createdByName: 'سارة عبد العزيز', createdAt: now, updatedAt: now };
  return [
    { id: 'diary-demo-1', title: 'مؤتمر صحفي لوزير الطاقة حول أسعار الوقود', date: today, startTime: '11:00', endTime: '12:00', kind: 'PRESSER', coverage: 'COVER', priority: 'HIGH', location: 'مقر وزارة الطاقة', categoryId: 'cat-2', assigneeIds: ['usr-6'], notes: 'نحتاج تصريحاً خاصاً بعد المؤتمر، وصورة للقاعة.', ...base },
    { id: 'diary-demo-2', title: 'جلسة مجلس الشورى الأسبوعية', date: today, startTime: '16:00', kind: 'SESSION', coverage: 'DESK', priority: 'NORMAL', categoryId: 'cat-1', assigneeIds: ['usr-3'], ...base },
    { id: 'diary-demo-3', title: 'افتتاح معرض الكتاب الدولي', date: shiftDay(today, 1), startTime: '10:00', endTime: '13:00', kind: 'EVENT', coverage: 'LIVE', priority: 'HIGH', location: 'مركز المعارض', categoryId: 'cat-7', assigneeIds: ['usr-6', 'usr-7'], notes: 'رسالة مباشرة في نشرة الظهيرة من موقع الافتتاح.', ...base },
    { id: 'diary-demo-4', title: 'صدور بيانات التضخم الشهرية', date: shiftDay(today, 2), startTime: '09:00', kind: 'RELEASE', coverage: 'UNDECIDED', priority: 'NORMAL', categoryId: 'cat-2', assigneeIds: [], ...base },
    { id: 'diary-demo-5', title: 'نهائي كأس الدوري', date: shiftDay(today, 3), startTime: '20:00', endTime: '22:00', kind: 'SPORTS', coverage: 'COVER', priority: 'NORMAL', location: 'الاستاد الدولي', categoryId: 'cat-6', assigneeIds: ['usr-3'], ...base },
  ];
}

export function demoBookings(today: string): Booking[] {
  const [y, m, d] = today.split('-').map(Number);
  const at = (h: number, min = 0, day = 0) => new Date(y, m - 1, d + day, h, min).toISOString();
  const now = new Date().toISOString();
  return [
    { id: 'bkg-demo-1', resourceId: 'res-cam-1', title: 'مؤتمر وزير الطاقة', start: at(10, 30), end: at(13), status: 'CONFIRMED', assigneeId: 'usr-6', bookedById: 'usr-2', bookedByName: 'سارة عبد العزيز', link: { kind: 'diary', id: 'diary-demo-1', title: 'مؤتمر صحفي لوزير الطاقة حول أسعار الوقود' }, createdAt: now, updatedAt: now },
    { id: 'bkg-demo-2', resourceId: 'res-studio-1', title: 'نشرة الظهيرة', start: at(12, 30), end: at(14), status: 'CONFIRMED', assigneeId: 'usr-8', bookedById: 'usr-2', bookedByName: 'سارة عبد العزيز', createdAt: now, updatedAt: now },
    { id: 'bkg-demo-3', resourceId: 'res-edit-1', title: 'مونتاج تقرير الطاقة', start: at(13, 30), end: at(15, 30), status: 'TENTATIVE', assigneeId: 'usr-7', bookedById: 'usr-3', bookedByName: 'طارق الهاشمي', createdAt: now, updatedAt: now },
    { id: 'bkg-demo-4', resourceId: 'res-sng-1', title: 'رسالة مباشرة من معرض الكتاب', start: at(9, 0, 1), end: at(14, 0, 1), status: 'CONFIRMED', assigneeId: 'usr-6', bookedById: 'usr-2', bookedByName: 'سارة عبد العزيز', link: { kind: 'diary', id: 'diary-demo-3', title: 'افتتاح معرض الكتاب الدولي' }, createdAt: now, updatedAt: now },
  ];
}
