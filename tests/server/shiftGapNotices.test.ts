import { expect, it } from 'vitest';
import { createTestServer } from '../helpers';
import { sendShiftGapNotices } from '../../src/server/shiftGapNotices';

it('writes one gap alert per station, role and shift even when the job runs again', async () => {
  const { db, close } = await createTestServer();
  try {
    const settings = db.getRow('settings', 'singleton');
    db.writeRow('settings', 'singleton', { ...settings?.d, id: 'singleton', defaultTimezone: 'Asia/Riyadh', stations: [{ id: 'test-local', name: 'المحطة المحلية' }, { id: 'test-remote', name: 'المحطة الأخرى' }] }, 0, null);
    const user = (id: string, stationId: string, role: string) => db.writeRow('users', id, { id, stationId, role, fullName: id, isActive: true, departmentId: 'newsroom' }, 0, null);
    user('local-lead', 'test-local', 'STATION_MANAGER');
    user('remote-lead', 'test-remote', 'STATION_MANAGER');
    user('local-editor', 'test-local', 'EDITOR');
    db.writeRow('bulletins', 'test-main', { id: 'test-main', title: 'نشرة الغد', kind: 'MAIN', status: 'PLANNING', date: '2032-03-03', startTime: '20:00', plannedSeconds: 1800, editorId: 'local-editor' }, 0, null);
    const now = new Date('2032-03-01T22:30:00Z'); // March 2 in the station's zone.
    expect(sendShiftGapNotices(db, now)).toBe(3);
    expect(sendShiftGapNotices(db, now)).toBe(0);
    const notices = db.listCollection('notifications').filter(row => row.id.startsWith('shift-gap-'));
    expect(notices).toHaveLength(3);
    expect(new Set(notices.map(row => row.d.userId))).toEqual(new Set(['local-lead']));
    expect(notices.every(row => row.d.message.includes('نشرة الغد'))).toBe(true);
  } finally { close(); }
});
