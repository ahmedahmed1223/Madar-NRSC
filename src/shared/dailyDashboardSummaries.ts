import type { NewsItem } from '../types';
import type { AdminOverview } from './adminOverview';
import { isUnderEmbargo } from './newsWorkflow';
import { ALL_PERMISSIONS } from './rbac';

type Allows = (name: string) => boolean;
const EDITORIAL_PERMISSIONS = ALL_PERMISSIONS.map(({ code }) => code).filter((code) => code.startsWith('news.') && code !== 'news.view');

export const canShowAdminExceptions = (can: Allows, canOpen: Allows) => can('system.settings') && canOpen('settings');
export const canShowApprovedMaterial = (can: Allows, canOpen: Allows) =>
  can('news.view') && canOpen('news') && !EDITORIAL_PERMISSIONS.some(can);

export function summarizeAdminExceptions(alerts: AdminOverview['alerts']) {
  const errors = alerts.filter((alert) => alert.level === 'error');
  const warnings = alerts.filter((alert) => alert.level === 'warning');
  return { errors: errors.length, warnings: warnings.length, preview: [...errors, ...warnings].slice(0, 3) };
}

export function isApprovedMaterial(item: Pick<NewsItem, 'status' | 'deletedAt' | 'embargoUntil'>, now = Date.now()) {
  return !item.deletedAt && (item.status === 'APPROVED' || item.status === 'PUBLISHED') && !isUnderEmbargo(item, now);
}

export function approvedMaterialSummary<T extends Pick<NewsItem, 'id' | 'status' | 'deletedAt' | 'updatedAt' | 'embargoUntil'>>(items: T[], now = Date.now()) {
  const eligible = items.filter((item) => isApprovedMaterial(item, now));
  const approved = eligible.filter((item) => item.status === 'APPROVED').length;
  const preview = eligible.sort((a, b) =>
    (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id)
  ).slice(0, 5);
  return { approved, published: eligible.length - approved, preview };
}
