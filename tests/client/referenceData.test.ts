import { beforeEach, describe, expect, it, vi } from 'vitest';

// apiService reads and writes through the synced store; an in-memory map stands in for it here.
const memory = new Map<string, unknown>();
vi.mock('../../src/services/dataStore', () => ({
  dataStore: {
    get: (key: string, fallback: unknown) => (memory.has(key) ? structuredClone(memory.get(key)) : fallback),
    set: (key: string, value: unknown) => void memory.set(key, structuredClone(value)),
    subscribe: () => () => undefined,
  },
}));

const { apiService } = await import('../../src/services/api');
const { COLLECTIONS } = await import('../../src/shared/collections');

beforeEach(() => {
  memory.clear();
  memory.set(COLLECTIONS.programTypes.storageKey, [{ id: 'pt-talk', nameAr: 'حواري' }]);
  memory.set(COLLECTIONS.programs.storageKey, [
    { id: 'prg-1', name: 'برنامج', typeId: 'pt-talk', typeName: 'حواري' },
    { id: 'prg-2', name: 'برنامج محذوف', typeId: 'pt-old', deletedAt: '2026-01-01T00:00:00.000Z' },
  ]);
});

describe('program types', () => {
  it('adds and renames a type, refusing empty and duplicate names', () => {
    const added = apiService.saveProgramType({ nameAr: '  صباحي ' });
    expect(added.nameAr).toBe('صباحي');
    expect(apiService.getProgramTypes().map((t) => t.nameAr)).toEqual(['حواري', 'صباحي']);
    expect(() => apiService.saveProgramType({ nameAr: '   ' })).toThrow('مطلوب');
    expect(() => apiService.saveProgramType({ nameAr: 'حواري' })).toThrow('بالاسم نفسه');
    apiService.saveProgramType({ id: added.id, nameAr: 'صباحي منوع' });
    expect(apiService.getProgramTypes().find((t) => t.id === added.id)?.nameAr).toBe('صباحي منوع');
    expect(apiService.getProgramTypes()).toHaveLength(2);
  });

  it('refuses to delete a type that programs still use; deleted programs do not count', () => {
    expect(() => apiService.deleteProgramType('pt-talk')).toThrow('لا يمكن حذف نوع البرنامج لأنه مستخدم في برنامج واحد');
    memory.set(COLLECTIONS.programTypes.storageKey, [...apiService.getProgramTypes(), { id: 'pt-old', nameAr: 'قديم' }]);
    apiService.deleteProgramType('pt-old');
    expect(apiService.getProgramTypes().map((t) => t.id)).toEqual(['pt-talk']);
  });
});

describe('categories', () => {
  it('a partial update (reordering) keeps the stored colour', () => {
    memory.set(COLLECTIONS.categories.storageKey, [{ id: 'cat-1', nameAr: 'سياسة', color: '#dc2626', colorCode: '#dc2626', orderIndex: 1 }]);
    vi.spyOn(apiService, 'logActivity' as any).mockImplementation(() => undefined);
    const saved = apiService.saveCategory({ id: 'cat-1', orderIndex: 4 });
    expect(saved).toMatchObject({ orderIndex: 4, color: '#dc2626', colorCode: '#dc2626', nameAr: 'سياسة' });
  });
});
