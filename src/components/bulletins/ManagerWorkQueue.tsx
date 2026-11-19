import { useState } from 'react';
import { apiService } from '../../services/api';
import { RbacService } from '../../services/rbacService';
import { managerQueue } from '../../shared/editorialQueue';
import { evaluateBulletinReadiness } from '../../shared/bulletinReadiness';
import type { User } from '../../types';
import { arabicDate } from '../../shared/dates';
import { countLabel } from '../../shared/arabicPlural';
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
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
      <label className="inline-flex items-center gap-2">عرض <select className="min-h-11 border border-slate-300 bg-white rounded-lg px-3 text-sm" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">كل العمل ({rows.length})</option><option value="APPROVAL">بانتظار اعتمادي</option><option value="BLOCKED">النواقص</option><option value="OVERDUE">المتأخر</option><option value="UNASSIGNED">غير مسند</option></select></label>
      {RbacService.hasPermission(currentUser, 'bulletins.manage') && <label className="min-h-11 flex items-center gap-2 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={team} onChange={e => setTeam(e.target.checked)} />عمل الفريق</label>}
      <span role="status" className="text-xs text-slate-600 tabular-nums">{countLabel(visible.length, { one: 'عمل واحد', two: 'عملان', few: 'أعمال', many: 'عملاً', zero: 'لا أعمال' })}</span>
    </div>
    {visible.length > 0 && <ul className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">{visible.map(r => <li key={r.id}><button type="button" className="min-h-11 px-4 py-3 w-full text-right flex flex-wrap justify-between gap-3 hover:bg-slate-50 transition-colors" onClick={() => {
      if (r.storyId) sessionStorage.setItem('madar-open-bulletin-story', r.storyId);
      onOpen(r.bulletinId);
    }}><span className="min-w-0 break-words"><strong className="text-sm font-bold text-slate-900">{r.title}</strong><span className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-slate-600">{r.action}{r.blocked && <span className="px-1.5 rounded bg-rose-50 text-rose-700 font-semibold">نواقص</span>}{r.overdue && <span className="px-1.5 rounded bg-amber-50 text-amber-800 font-semibold">متأخر</span>}</span></span><span className="text-xs text-slate-600 text-left"><span className="tabular-nums">{arabicDate(r.airAt.slice(0, 10))} {r.airAt.slice(11)}</span><span className="block">{users.find(u => u.id === r.assigneeId)?.fullName || 'غير مسند'}</span></span></button></li>)}</ul>}
    {!visible.length && <p className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center text-xs text-slate-500">{filter === 'ALL' ? 'لا أعمال على النشرات الآن.' : 'لا أعمال مطابقة لهذا العرض.'}</p>}
  </section>;
}
