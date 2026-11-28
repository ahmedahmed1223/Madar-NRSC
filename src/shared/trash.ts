import { assignedWorkOnly } from './assignedWork';

export const TRASH_COLLECTIONS = [
  'news', 'stories', 'bulletins', 'bulletinStories', 'bulletinFormats', 'diary',
  'programs', 'episodes', 'media', 'guests', 'productionCards', 'workflowTemplates', 'tasks', 'personalTasks', 'resources', 'bookings',
] as const;

export type TrashCollection = typeof TRASH_COLLECTIONS[number];

export const TRASH_SCREEN_LABELS = {
  news: 'الأخبار',
  stories: 'التغطيات',
  bulletins: 'النشرات',
  diary: 'أجندة التغطية',
  programs: 'البرامج',
  episodes: 'الحلقات',
  media: 'مكتبة الوسائط',
  guests: 'الضيوف',
  cards: 'التكليفات',
  tasks: 'مهام العمل',
  'personal-tasks': 'المهام الشخصية',
  bookings: 'حجز الموارد',
} as const;

export type TrashScreen = keyof typeof TRASH_SCREEN_LABELS;

export const TRASH_SECTIONS: Record<TrashCollection, { label: string; screen: TrashScreen; permissions: readonly string[] }> = {
  news: { label: 'الأخبار', screen: 'news', permissions: ['news.delete'] },
  stories: { label: 'التغطيات', screen: 'stories', permissions: ['news.delete'] },
  bulletins: { label: 'النشرات', screen: 'bulletins', permissions: ['bulletins.manage'] },
  bulletinStories: { label: 'قصص النشرات', screen: 'bulletins', permissions: ['bulletins.manage', 'bulletins.approve', 'bulletins.edit'] },
  bulletinFormats: { label: 'قوالب النشرات', screen: 'bulletins', permissions: ['bulletins.manage'] },
  diary: { label: 'أجندة التغطية', screen: 'diary', permissions: ['diary.manage'] },
  programs: { label: 'البرامج', screen: 'programs', permissions: ['programs.manage'] },
  episodes: { label: 'الحلقات', screen: 'episodes', permissions: ['episodes.delete'] },
  media: { label: 'ملفات الوسائط', screen: 'media', permissions: ['media.delete', 'media.upload'] },
  guests: { label: 'الضيوف', screen: 'guests', permissions: ['guests.manage'] },
  productionCards: { label: 'التكليفات', screen: 'cards', permissions: ['cards.manage'] },
  workflowTemplates: { label: 'قوالب سير العمل', screen: 'cards', permissions: ['cards.manage'] },
  tasks: { label: 'مهام العمل', screen: 'tasks', permissions: ['tasks.create_assign'] },
  personalTasks: { label: 'المهام الشخصية', screen: 'personal-tasks', permissions: [] },
  resources: { label: 'الموارد', screen: 'bookings', permissions: ['resources.manage'] },
  bookings: { label: 'الحجوزات', screen: 'bookings', permissions: ['resources.manage', 'resources.book'] },
};

export function isTrashCollection(value: unknown): value is TrashCollection {
  return typeof value === 'string' && Object.hasOwn(TRASH_SECTIONS, value);
}

export function isTrashScreen(value: unknown): value is TrashScreen {
  return typeof value === 'string' && Object.hasOwn(TRASH_SCREEN_LABELS, value);
}

export function mayManageTrashCollection(collection: TrashCollection, can: (permission: string) => boolean, leadsTasks: boolean): boolean {
  if (collection === 'personalTasks') return true;
  if (assignedWorkOnly(can) && collection !== 'productionCards') return false;
  return collection === 'tasks' && leadsTasks || TRASH_SECTIONS[collection].permissions.some(can);
}

export function isTaskTrashCollection(value: unknown): value is 'tasks' | 'personalTasks' {
  return value === 'tasks' || value === 'personalTasks';
}

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const MAX_TRASH_RETENTION_DAYS = 3_650;
export type TrashRetentionDays = Partial<Record<TrashCollection, number>>;

export function trashRetentionError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'إعدادات الاحتفاظ بالمحذوفات غير صالحة.';
  for (const [collection, days] of Object.entries(value)) {
    if (!isTrashCollection(collection) || typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_TRASH_RETENTION_DAYS) {
      return `مدة الاحتفاظ بالمحذوفات عدد صحيح بين 0 و${MAX_TRASH_RETENTION_DAYS} يومًا لكل نوع.`;
    }
  }
  return null;
}

export interface TrashItem {
  collection: TrashCollection;
  id: string;
  title: string;
  deletedAt: string;
  version: number;
  retentionDays: number;
}

export interface TrashPage {
  items: TrashItem[];
  nextCursor: string | null;
  collections: TrashCollection[];
  retentionDays: number;
}
