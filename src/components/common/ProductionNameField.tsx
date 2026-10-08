import { useId, type InputHTMLAttributes } from 'react';
import { useLiveData } from '../../hooks/useLiveData';
import { apiService } from '../../services/api';
import { departmentIdOf } from '../../shared/departments';
import { normalizeProductionName, productionNameSuggestions, type ProductionRole } from '../../shared/productionPeople';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list' | 'multiple'> & {
  kind: ProductionRole | 'STUDIO'; label: string; value: string; onChange: (value: string) => void;
  multiple?: boolean; fallbackNames?: string[];
};
export function ProductionNameField({ kind, label, value, onChange, multiple, fallbackNames = [], ...input }: Props) {
  useLiveData(['productionPeople', 'users', 'resources']);
  const list = `production-names-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const users = apiService.getUsers().filter(u => u.isActive !== false && departmentIdOf(u) === (kind === 'PRESENTER' ? 'presenters' : 'direction')).map(u => u.fullName);
  const suggestions = kind === 'STUDIO'
    ? [...new Map(apiService.getResources(false).filter(r => r.kind === 'STUDIO').map(r => [normalizeProductionName(r.name), r.name])).values()]
    : productionNameSuggestions(apiService.getProductionPeople(), kind, [...users, ...fallbackNames]);
  const existing = multiple ? value.split(/[،,]/).slice(0, -1).map(v => v.trim()).filter(Boolean) : [];
  const prefix = existing.length ? `${existing.join('، ')}، ` : '';
  const used = new Set(existing.map(normalizeProductionName));
  return <>
    <input {...input} aria-label={label} value={value} list={list} onChange={e => onChange(e.target.value)} />
    <datalist id={list}>{suggestions.filter(name => !used.has(normalizeProductionName(name))).map(name => <option key={name} value={`${prefix}${name}`}>{prefix}{name}</option>)}</datalist>
  </>;
}
