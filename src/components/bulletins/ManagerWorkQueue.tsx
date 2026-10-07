import React, { useState } from 'react';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { managerQueue } from '../../shared/editorialQueue';
import { evaluateBulletinReadiness } from '../../shared/bulletinReadiness';
import type { User } from '../../types';
import { arabicDate } from '../../shared/dates';
import { useLiveData } from '../../hooks/useLiveData';

export function ManagerWorkQueue({ currentUser, onOpen }: { currentUser: User; onOpen: (id: string) => void }) {
  useLiveData(['tasks', 'news', 'media', 'bulletins', 'bulletinStories']);
  const [team, setTeam] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const bulletins = apiService.getBulletins();
  const stories = bulletins.flatMap(b => apiService.getBulletinStories(b.id));
  const users = apiService.getUsers();
  const rows = managerQueue({ user: currentUser, bulletins, stories, tasks: apiService.getTasks(), readiness: bulletins.flatMap(b => evaluateBulletinReadiness(b, stories.filter(s => s.bulletinId === b.id), apiService.getNews(), apiService.getMedia(), new Date())), now: new Date(), teamScope: team, can: p => RbacService.hasPermission(currentUser, p) });
  const visible = rows.filter(r => filter === 'ALL' || (filter === 'APPROVAL' && r.waitingApproval) || (filter === 'BLOCKED' && r.blocked) || (filter === 'OVERDUE' && r.overdue) || (filter === 'UNASSIGNED' && r.unassigned));
  return <section aria-label="مساحة عمل مدير النشرة" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label>عرض <select className="min-h-11 border rounded-lg px-3" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">كل العمل ({rows.length})</option><option value="APPROVAL">بانتظار اعتمادي</option><option value="BLOCKED">النواقص</option><option value="OVERDUE">المتأخر</option><option value="UNASSIGNED">غير مسند</option></select></label>
      {RbacService.hasPermission(currentUser, 'bulletins.manage') && <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={team} onChange={e => setTeam(e.target.checked)} />عمل الفريق</label>}
      <span role="status">{visible.length} عنصر</span>
    </div>
    <ul className="divide-y divide-slate-200">{visible.map(r => <li key={r.id}><button type="button" className="min-h-11 py-3 w-full text-right flex flex-wrap justify-between gap-3" onClick={() => {
      if (r.storyId) sessionStorage.setItem('madar-open-bulletin-story', r.storyId);
      onOpen(r.bulletinId);
    }}><span className="min-w-0 break-words"><strong>{r.title}</strong><span className="block text-sm">{r.action}{r.blocked ? ' (نواقص)' : ''}{r.overdue ? ' (متأخر)' : ''}</span></span><span className="text-sm text-slate-600">{arabicDate(r.airAt.slice(0, 10))} {r.airAt.slice(11)}<span className="block">{users.find(u => u.id === r.assigneeId)?.fullName || 'غير مسند'}</span></span></button></li>)}</ul>
    {!visible.length && <p>لا أعمال مطابقة.</p>}
  </section>;
}
