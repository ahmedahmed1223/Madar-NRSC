import React from 'react';
import { User, ShiftType } from '../../types';
import { RbacService } from '../../services/rbacService';
import { Clock, Sun, Moon, Sunrise, Radio, Users, Shield, ArrowRightLeft } from 'lucide-react';

interface ShiftScheduleBoardProps {
  users: User[];
  onUserClick: (user: User) => void;
  onQuickShiftChange: (userId: string, newShift: ShiftType) => void;
}

export const ShiftScheduleBoard: React.FC<ShiftScheduleBoardProps> = ({
  users,
  onUserClick,
  onQuickShiftChange,
}) => {
  const currentHour = new Date().getHours();

  // Determine current active on-air shift
  let currentActiveShift: ShiftType = 'FLEXIBLE';
  if (currentHour >= 6 && currentHour < 14) {
    currentActiveShift = 'MORNING';
  } else if (currentHour >= 14 && currentHour < 22) {
    currentActiveShift = 'EVENING';
  } else {
    currentActiveShift = 'NIGHT_ON_CALL';
  }

  const shiftConfigs = [
    {
      type: 'MORNING' as ShiftType,
      titleAr: 'الوردية الصباحية (Morning Shift)',
      timeRange: '06:00 ص - 02:00 م',
      icon: Sunrise,
      bg: 'bg-amber-500/10 border-amber-200',
      headerBg: 'bg-amber-500 text-white',
      badge: 'bg-amber-100 text-amber-800',
      description: 'نشرات الصباح، برامج الصباح الحوارية، والتغطيات الاستهلالية',
    },
    {
      type: 'EVENING' as ShiftType,
      titleAr: 'الوردية المسائية (Evening Prime Time)',
      timeRange: '02:00 م - 10:00 م',
      icon: Sun,
      bg: 'bg-blue-500/10 border-blue-200',
      headerBg: 'bg-blue-600 text-white',
      badge: 'bg-blue-100 text-blue-800',
      description: 'نشرة التاسعة الرئيسية، البرامج السياسية، وذروة المشاهدات',
    },
    {
      type: 'NIGHT_ON_CALL' as ShiftType,
      titleAr: 'المناوبة الليلية وطوارئ الأخبار (Night Desk)',
      timeRange: '10:00 م - 06:00 ص',
      icon: Moon,
      bg: 'bg-indigo-500/10 border-indigo-200',
      headerBg: 'bg-indigo-700 text-white',
      badge: 'bg-indigo-100 text-indigo-800',
      description: 'متابعة الأخبار الدولية العاجلة، مراقبة وكالات الأنباء والبث التلقائي',
    },
    {
      type: 'FLEXIBLE' as ShiftType,
      titleAr: 'تغطيات مفتوحة وإدارة (Flexible / Leadership)',
      timeRange: 'على مدار الساعة / مرن',
      icon: Clock,
      bg: 'bg-slate-500/10 border-slate-200',
      headerBg: 'bg-slate-700 text-white',
      badge: 'bg-slate-100 text-slate-800',
      description: 'القيادات التحريرية، الموجهون، والفرق الاستشارية',
    },
  ];

  return (
    <div className="space-y-6 font-sans text-right" dir="rtl">
      {/* Shift Live Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 flex items-center justify-between flex-wrap gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center animate-pulse shrink-0">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-red-400 tracking-wider uppercase">
                بث حي ومناوبة نشطة الآن (ON-AIR SHIFT)
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <h3 className="text-base font-bold mt-0.5">
              {shiftConfigs.find((s) => s.type === currentActiveShift)?.titleAr}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
            <span className="text-slate-400 block text-[10px]">طاقم الوردية النشطة:</span>
            <span className="font-bold text-emerald-400 text-sm">
              {users.filter((u) => u.shift === currentActiveShift && u.isActive).length} كادر صحفي وفني
            </span>
          </div>
          <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
            <span className="text-slate-400 block text-[10px]">إجمالي الطاقم الجاهز:</span>
            <span className="font-bold text-white text-sm">
              {users.filter((u) => u.isActive).length} موظف
            </span>
          </div>
        </div>
      </div>

      {/* Shift Columns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {shiftConfigs.map((shiftCfg) => {
          const shiftUsers = users.filter((u) => (u.shift || 'MORNING') === shiftCfg.type);
          const isLiveNow = currentActiveShift === shiftCfg.type;
          const ShiftIcon = shiftCfg.icon;

          return (
            <div
              key={shiftCfg.type}
              className={`rounded-2xl border transition-all flex flex-col justify-between overflow-hidden shadow-xs ${
                isLiveNow ? 'ring-2 ring-blue-500 bg-white shadow-md' : 'bg-white border-slate-200'
              }`}
            >
              {/* Header */}
              <div>
                <div className={`p-4 flex items-center justify-between ${shiftCfg.headerBg}`}>
                  <div className="flex items-center gap-2">
                    <ShiftIcon className="w-4 h-4" />
                    <span className="text-xs font-bold">{shiftCfg.titleAr.split('(')[0]}</span>
                  </div>
                  {isLiveNow && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white animate-pulse">
                      على الهواء
                    </span>
                  )}
                </div>

                <div className="p-3 bg-slate-50/70 border-b border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>{shiftCfg.timeRange}</span>
                  <span className="font-bold font-mono text-slate-700">
                    {shiftUsers.length} أعضاء
                  </span>
                </div>

                {/* Users list in shift */}
                <div className="p-3 space-y-2.5 max-h-80 overflow-y-auto">
                  {shiftUsers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      لا يوجد موظفون معينون في هذه الوردية حالياً
                    </div>
                  ) : (
                    shiftUsers.map((user) => {
                      const badge = RbacService.getRoleBadge(user.role);
                      return (
                        <div
                          key={user.id}
                          className="p-2.5 bg-white rounded-xl border border-slate-200/80 hover:border-blue-400 transition-all shadow-2xs group"
                        >
                          <div className="flex items-center justify-between">
                            <div
                              onClick={() => onUserClick(user)}
                              className="flex items-center gap-2.5 cursor-pointer flex-1"
                            >
                              <img
                                src={user.avatarUrl}
                                alt={user.fullName}
                                className="w-8 h-8 rounded-full object-cover border border-slate-200"
                              />
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                                  {user.fullName}
                                </h4>
                                <span className="text-[10px] text-slate-500 block">
                                  {user.jobTitle}
                                </span>
                              </div>
                            </div>

                            {/* Shift Switch Quick Select */}
                            <select
                              value={user.shift || 'MORNING'}
                              onChange={(e) => onQuickShiftChange(user.id, e.target.value as ShiftType)}
                              className="text-[10px] bg-slate-50 border border-slate-200 rounded-lg p-1 text-slate-600 focus:outline-none"
                              title="نقل الموظف لوردية أخرى"
                            >
                              <option value="MORNING">صباحية</option>
                              <option value="EVENING">مسائية</option>
                              <option value="NIGHT_ON_CALL">ليلية</option>
                              <option value="FLEXIBLE">مرن</option>
                            </select>
                          </div>

                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[10px]">
                            <span className="text-slate-500">{user.department}</span>
                            <span className={`px-1.5 py-0.2 rounded-md font-bold ${badge.badgeBg}`}>
                              {badge.labelAr}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Bottom description */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500">
                {shiftCfg.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
