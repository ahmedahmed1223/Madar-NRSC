import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskWorkflowSettings } from '../../src/components/settings/TaskWorkflowSettings';

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock('../../src/services/api', () => ({ apiService: { getSettings } }));
vi.mock('../../src/services/confirmSave', () => ({ confirmSaved: vi.fn() }));
vi.mock('../../src/hooks/useLiveData', () => ({ useLiveData: vi.fn() }));

describe('task workflow settings', () => {
  beforeEach(() => { getSettings.mockReturnValue({}); });

  it('keeps every optional rule off when older settings have no workflow config', () => {
    const html = renderToStaticMarkup(createElement(TaskWorkflowSettings, { onOpenStepTypes: () => {} }));
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('تتطلب إدارة القوالب صلاحية إدارة التكليفات.');
  });

  it('loads the saved rules and shows existing configuration destinations', () => {
    getSettings.mockReturnValue({ taskWorkflow: { requireReview: true, requireBlockedReason: false, reopenManagersOnly: true } });
    const html = renderToStaticMarkup(createElement(TaskWorkflowSettings, { onOpenStepTypes: () => {}, onOpenTemplates: () => {} }));
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toMatch(/id="task-workflow-requireReview"[^>]*checked=""/);
    expect(html).toMatch(/id="task-workflow-reopenManagersOnly"[^>]*checked=""/);
    expect(html).toContain('إعداد أنواع خطوات التكليفات');
    expect(html).toContain('فتح التكليفات والقوالب');
  });
});
