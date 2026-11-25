import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useQueueFilter } from '../../src/hooks/useQueueFilter';
import { onNotify } from '../../src/services/notify';

function Queue({ userId, options }: { userId: string; options?: string[] }) {
  const [departmentDefault, setDepartmentDefault] = useState('old-department');
  const [department] = useQueueFilter(userId, 'requests', 'department', departmentDefault, [departmentDefault]);
  const [query, setQuery] = useQueueFilter(userId, 'tasks', 'query', '');
  const [member, setMember] = useQueueFilter(userId, 'tasks', 'member', 'ALL', options);
  const [urgent, setUrgent] = useQueueFilter(userId, 'tasks', 'urgent', false);
  return <>
    <output aria-label="Department">{department}</output>
    <button onClick={() => setDepartmentDefault('new-department')}>Archive department</button>
    <input aria-label="Query" value={query} onChange={event => setQuery(event.target.value)} />
    <output aria-label="Member">{member}</output>
    <button onClick={() => setMember('member-a')}>Select member</button>
    <input aria-label="Urgent" type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} />
    <button onClick={() => { setUrgent(value => !value); setUrgent(value => !value); }}>Toggle twice</button>
  </>;
}

function Harness() {
  const [userId, setUserId] = useState('a');
  const [visible, setVisible] = useState(true);
  const [options, setOptions] = useState<string[]>();
  return <>
    <button onClick={() => setUserId('a')}>Account A</button>
    <button onClick={() => setUserId('b')}>Account B</button>
    <button onClick={() => setVisible(value => !value)}>Navigate</button>
    <button onClick={() => setOptions(['member-a'])}>Load members</button>
    <button onClick={() => setOptions([])}>Remove member</button>
    {visible && <Queue userId={userId} options={options} />}
  </>;
}

onNotify(notification => {
  document.querySelector('#notice')!.textContent = notification.message;
});
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
