import React, { useId, useState } from 'react';
import { apiService } from '../../services/api';
import { useLiveData } from '../../hooks/useLiveData';
import { matchesQuery } from '../../shared/search';
import { programTeamOptions, toggleTeamMember } from './programTeam';

interface ProgramTeamFieldProps {
  value: string[];
  onChange: (members: string[]) => void;
}

/** «فريق البرنامج»: tick the colleagues who work on the program (shown on its team tab). */
export const ProgramTeamField: React.FC<ProgramTeamFieldProps> = ({ value, onChange }) => {
  useLiveData(['users']);
  const searchId = useId();
  const [query, setQuery] = useState('');
  const { users, others } = programTeamOptions(apiService.getUsers(), value);
  const chosen = new Set(value.map((n) => n.trim()));
  const shown = query.trim() ? users.filter((u) => matchesQuery(query, u.name, u.detail)) : users;

  const row = (name: string, detail: string) => (
    <li key={name}>
      <label className="flex items-center gap-2.5 min-h-11 px-2 rounded-lg hover:bg-slate-50 cursor-pointer">
        <input
          type="checkbox"
          checked={chosen.has(name)}
          onChange={() => onChange(toggleTeamMember(value, name))}
          className="w-4 h-4 accent-blue-600 shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-800 truncate">{name}</span>
          {detail && <span className="block text-2xs text-slate-500 truncate">{detail}</span>}
        </span>
      </label>
    </li>
  );

  return (
    <fieldset className="p-3 rounded-lg border border-slate-200 space-y-2 min-w-0">
      <legend className="px-1 text-xs font-bold text-slate-700">فريق البرنامج ({value.length})</legend>
      <p className="text-2xs text-slate-500">يظهر الفريق في تبويب «طاقم العمل والإنتاج» في ملف البرنامج.</p>
      {users.length > 8 && (
        <div>
          <label htmlFor={searchId} className="sr-only">بحث في الزملاء</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم أو المسمى أو القسم..."
            className="w-full min-h-11 px-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      )}
      <ul className="max-h-60 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-2" aria-label="الزملاء النشطون">
        {shown.map((u) => row(u.name, u.detail))}
        {shown.length === 0 && <li className="text-2xs text-slate-500 p-2">لا يوجد زميل مطابق.</li>}
      </ul>
      {others.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <p className="text-2xs font-bold text-slate-600">أعضاء محفوظون ليسوا ضمن المستخدمين النشطين:</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-2">{others.map((name) => row(name, ''))}</ul>
        </div>
      )}
    </fieldset>
  );
};
