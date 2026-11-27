import { appLocale, zoneOptions } from '../../shared/dateFormat';
import { pronunciationDraftConflict, type PronunciationTerm } from '../../shared/pronunciation';
import { savedNewsFilterError, type SavedNewsFilterInput, type SavedNewsFilterRow } from '../../shared/savedNewsFilters';
import { CATEGORY_HAS_CHILDREN, categoryParentError } from '../../shared/newsCategories';
import type { PersonalNote, WorkspacePreferences } from '../../shared/personalWorkspace';
import { preparePersonalTask, type PersonalTask, type PersonalTaskInput } from '../../shared/personalTasks';
import { sanitizeWorkSections, type WorkSectionPreferences } from '../../shared/workContext';
import { savedFilterRequest } from '../savedNewsFilterTransport';
import type { SyncOpResult } from '../../shared/collections';
import { COLLECTIONS } from '../../shared/collections';
import { INITIAL_SETTINGS, settingsError } from '../../shared/settings';
import { applyDepartmentSettings } from '../../shared/departments';
import { rememberStationSettings } from '../../shared/stations';
import { Booking, bookingConflicts, bookingError, DiaryEntry, diaryError, Resource } from '../../shared/planning';
import type { ProductionPerson } from '../../shared/productionPeople';
import { newId } from '../../shared/ids';
import { dataStore } from '../dataStore';
import { apiFetch } from '../http';
import type { Category, NewsSource, Program, ProgramType, SystemSettings } from '../../types';
import { ApiDomainDeps, getSnapshot, getStored, setStored, STORAGE_KEYS } from './storeContext';

export function createReferenceApi(deps: ApiDomainDeps) {
  /** Active news/stories that still reference a category or source. */
  function countReferences(field: 'categoryId' | 'sourceId', id: string): number {
    return [STORAGE_KEYS.NEWS, STORAGE_KEYS.STORIES]
      .flatMap((key) => getStored<any[]>(key, []))
      .filter((n) => !n.deletedAt && n[field] === id).length;
  }

  function getCategories(): Category[] {
    return getSnapshot<Category[]>(STORAGE_KEYS.CATEGORIES, []);
  }

  function saveCategory(cat: Partial<Category>): Category {
    const all = getStored<Category[]>(STORAGE_KEYS.CATEGORIES, []);
    const existing = cat.id ? all.find((c) => c.id === cat.id) : undefined;
    // A partial update (e.g. only orderIndex) keeps the stored colour.
    const colorVal = cat.colorCode || cat.color || existing?.colorCode || existing?.color || '#2563eb';

    if (cat.id) {
      const idx = all.findIndex((c) => c.id === cat.id);
      if (idx !== -1) {
        const updated: Category = {
          ...all[idx],
          ...cat,
          color: colorVal,
          colorCode: colorVal,
        };
        const parentError = categoryParentError(updated, all);
        if (parentError) throw new Error(parentError);
        all[idx] = updated;
        setStored(STORAGE_KEYS.CATEGORIES, all);

        // News items pick up the new name from the server (see server sync), not from this client.
        deps.logActivity('تعديل قسم إخباري', 'CATEGORY', updated.id, updated.nameAr, `تم تحديث بيانات ولون تصنيف (${updated.nameAr})`);
        return updated;
      }
    }

    const newCat: Category = {
      id: newId('cat'),
      nameAr: cat.nameAr || 'قسم جديد',
      parentId: cat.parentId,
      nameEn: cat.nameEn || 'New Category',
      slug: (cat.slug || cat.nameEn || 'new-cat').toLowerCase().replace(/\s+/g, '-'),
      color: colorVal,
      colorCode: colorVal,
      description: cat.description || '',
      orderIndex: cat.orderIndex || all.length + 1,
    };
    const parentError = categoryParentError(newCat, all);
    if (parentError) throw new Error(parentError);
    all.push(newCat);
    setStored(STORAGE_KEYS.CATEGORIES, all);
    deps.logActivity('إضافة قسم إخباري جديد', 'CATEGORY', newCat.id, newCat.nameAr, `تم إنشاء تصنيف إخباري جديد (${newCat.nameAr}) باللون المخصص.`);
    return newCat;
  }

  function deleteCategory(id: string): void {
    const all = getCategories();
    if (all.some((category) => category.parentId === id)) throw new Error(CATEGORY_HAS_CHILDREN);
    const inUse = countReferences('categoryId', id);
    if (inUse > 0) throw new Error(`لا يمكن حذف القسم لأنه مرتبط بـ ${inUse} مادة إخبارية نشطة`);
    const target = all.find((c) => c.id === id);
    const filtered = all.filter((c) => c.id !== id);
    setStored(STORAGE_KEYS.CATEGORIES, filtered);
    if (target) {
      deps.logActivity('حذف قسم إخباري', 'CATEGORY', target.id, target.nameAr, `تم حذف تصنيف (${target.nameAr}) من النظام.`);
    }
  }

  function getSources(): NewsSource[] {
    return getSnapshot<NewsSource[]>(STORAGE_KEYS.SOURCES, []);
  }

  function getPronunciationTerms(): PronunciationTerm[] {
    return getStored(COLLECTIONS.pronunciationTerms.storageKey, []);
  }

  async function getSavedNewsFilterRows(signal?: AbortSignal): Promise<SavedNewsFilterRow[]> {
    const result = await savedFilterRequest<{ rows: SavedNewsFilterRow[] }>('/api/v1/saved-news-filters', {}, signal);
    return result.rows;
  }

  async function saveSavedNewsFilter(value: SavedNewsFilterInput, baseV?: number, signal?: AbortSignal): Promise<SavedNewsFilterRow> {
    const error = savedNewsFilterError(value);
    if (error) throw new Error(error);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('اتصل بالخادم لحفظ الفلتر');
    const response = await savedFilterRequest<{ results: SyncOpResult[] }>(
      '/api/v1/data/sync',
      { method: 'POST', json: { ops: [{ c: 'savedNewsFilters', op: 'upsert', id: value.id, d: value, baseV }] } },
      signal
    );
    const result = response.results[0];
    if (!result) throw new Error('لم يؤكد الخادم حفظ الفلتر');
    if (result.ok === false) throw new Error(result.message || 'لم يؤكد الخادم حفظ الفلتر');
    return result.row as SavedNewsFilterRow;
  }

  async function deleteSavedNewsFilter(id: string, baseV: number, signal?: AbortSignal): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('اتصل بالخادم لحذف الفلتر');
    const response = await savedFilterRequest<{ results: SyncOpResult[] }>(
      '/api/v1/data/sync',
      { method: 'POST', json: { ops: [{ c: 'savedNewsFilters', op: 'delete', id, baseV }] } },
      signal
    );
    const result = response.results[0];
    if (!result) throw new Error('لم يؤكد الخادم حذف الفلتر');
    if (result.ok === false) throw new Error(result.message || 'لم يؤكد الخادم حذف الفلتر');
  }

  async function savePronunciationTerm(value: Partial<PronunciationTerm>, original?: PronunciationTerm) {
    const all = getPronunciationTerms();
    const index = all.findIndex((t) => t.id === value.id);
    if (value.id) {
      if (!original || original.id !== value.id) throw new Error('راجع النسخة الحالية قبل حفظ النطق');
      const conflict = pronunciationDraftConflict(original, index >= 0 ? all[index] : undefined);
      if (conflict) throw new Error(conflict);
    }
    const next = { ...(index >= 0 ? all[index] : { id: newId('term'), note: '', enabled: true }), ...value } as PronunciationTerm;
    if (index >= 0) all[index] = next;
    else all.push(next);
    setStored(COLLECTIONS.pronunciationTerms.storageKey, all);
    const outcome = await dataStore.awaitWrite('pronunciationTerms', next.id);
    if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ النطق');
    return getPronunciationTerms().find((t) => t.id === next.id)!;
  }

  async function deletePronunciationTerm(id: string): Promise<void> {
    setStored(COLLECTIONS.pronunciationTerms.storageKey, getPronunciationTerms().filter((t) => t.id !== id));
    const outcome = await dataStore.awaitWrite('pronunciationTerms', id);
    if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حذف النطق');
  }

  function saveSource(src: Partial<NewsSource>): NewsSource {
    const all = getStored<NewsSource[]>(STORAGE_KEYS.SOURCES, []);
    if (src.id) {
      const idx = all.findIndex((s) => s.id === src.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...src };
        setStored(STORAGE_KEYS.SOURCES, all);
        return all[idx];
      }
    }
    const newSrc: NewsSource = {
      id: newId('src'),
      name: src.name || 'مصدر جديد',
      type: src.type || 'SPECIAL_SOURCE',
      reliabilityScore: src.reliabilityScore || 4,
      contactInfo: src.contactInfo || '',
      notes: src.notes || '',
      feedUrl: src.feedUrl?.trim() || undefined,
      feedEnabled: !!src.feedEnabled && !!src.feedUrl?.trim(),
    };
    all.push(newSrc);
    setStored(STORAGE_KEYS.SOURCES, all);
    return newSrc;
  }

  function deleteSource(id: string): void {
    const inUse = countReferences('sourceId', id);
    if (inUse > 0) throw new Error(`لا يمكن حذف المصدر لأنه مرتبط بـ ${inUse} مادة إخبارية نشطة`);
    const all = getSources();
    const filtered = all.filter((s) => s.id !== id);
    setStored(STORAGE_KEYS.SOURCES, filtered);
  }

  function getWorkspaceWorkSections(): WorkSectionPreferences | undefined {
    const key = COLLECTIONS.workspacePrefs.storageKey;
    return getStored<WorkspacePreferences[]>(key, []).find(({ id }) => id === deps.getCurrentUser().id)?.workSections;
  }

  function saveWorkspaceWorkSections(sections: WorkSectionPreferences): void {
    const userId = deps.getCurrentUser().id;
    setStored<WorkspacePreferences[]>(COLLECTIONS.workspacePrefs.storageKey, [
      {
        id: userId,
        ownerId: userId,
        workSections: sanitizeWorkSections(sections),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }

  function getPersonalNotes(): PersonalNote[] {
    const userId = deps.getCurrentUser().id;
    return getStored<PersonalNote[]>(COLLECTIONS.personalNotes.storageKey, []).filter(({ ownerId }) => ownerId === userId);
  }

  function savePersonalNote(input: Pick<PersonalNote, 'title' | 'body' | 'pinned'> & { id?: string }): PersonalNote {
    const notes = getPersonalNotes();
    const previous = notes.find(({ id }) => id === input.id);
    const updatedAt = new Date().toISOString();
    const saved: PersonalNote = {
      id: previous?.id || input.id || newId('note'),
      ownerId: deps.getCurrentUser().id,
      title: input.title.trim(),
      body: input.body,
      pinned: input.pinned,
      createdAt: previous?.createdAt || updatedAt,
      updatedAt,
    };
    setStored(COLLECTIONS.personalNotes.storageKey, [saved, ...notes.filter(({ id }) => id !== saved.id)]);
    return saved;
  }

  function deletePersonalNote(id: string): void {
    setStored(COLLECTIONS.personalNotes.storageKey, getPersonalNotes().filter((note) => note.id !== id));
  }

  function getPersonalTasks(): PersonalTask[] {
    const ownerId = deps.getCurrentUser().id;
    return getStored<PersonalTask[]>(COLLECTIONS.personalTasks.storageKey, []).filter((task) => task.ownerId === ownerId);
  }

  function savePersonalTask(id: string, input: PersonalTaskInput): PersonalTask {
    const tasks = getPersonalTasks();
    const saved = preparePersonalTask(id, deps.getCurrentUser().id, input, tasks.find((task) => task.id === id));
    setStored(COLLECTIONS.personalTasks.storageKey, [saved, ...tasks.filter((task) => task.id !== id)]);
    return saved;
  }

  function deletePersonalTask(id: string): void {
    setStored(COLLECTIONS.personalTasks.storageKey, getPersonalTasks().filter((task) => task.id !== id));
  }

  // --- PLANNING DIARY ---
  function getDiary(): DiaryEntry[] {
    return getStored<DiaryEntry[]>(COLLECTIONS.diary.storageKey, []).filter((e) => !e.deletedAt);
  }

  function saveDiaryEntry(data: Partial<DiaryEntry>): DiaryEntry {
    const all = getStored<DiaryEntry[]>(COLLECTIONS.diary.storageKey, []);
    const now = new Date().toISOString();
    const idx = data.id ? all.findIndex((e) => e.id === data.id) : -1;
    const next = {
      ...(idx >= 0
        ? all[idx]
        : {
            id: newId('diary'),
            kind: 'EVENT',
            coverage: 'UNDECIDED',
            priority: 'NORMAL',
            assigneeIds: [],
            createdAt: now,
            createdById: deps.getCurrentUser().id,
            createdByName: deps.getCurrentUser().fullName,
          }),
      ...data,
      updatedAt: now,
    } as DiaryEntry;
    const err = diaryError(next);
    if (err) throw new Error(err);
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.diary.storageKey, all);
    return next;
  }

  function deleteDiaryEntry(id: string): void {
    const all = getStored<DiaryEntry[]>(COLLECTIONS.diary.storageKey, []);
    setStored(COLLECTIONS.diary.storageKey, all.map((e) => (e.id === id ? { ...e, deletedAt: new Date().toISOString() } : e)));
  }

  function getProductionPeople(): ProductionPerson[] {
    return getStored(COLLECTIONS.productionPeople.storageKey, []);
  }

  function saveProductionPerson(data: Partial<ProductionPerson>): ProductionPerson {
    const all = getProductionPeople();
    const now = new Date().toISOString();
    const idx = data.id ? all.findIndex((p) => p.id === data.id) : -1;
    const next = {
      ...(idx >= 0 ? all[idx] : { id: data.id || newId('person'), roles: ['PRESENTER'], active: true, createdAt: now }),
      ...data,
      name: data.name?.trim(),
      updatedAt: now,
    } as ProductionPerson;
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.productionPeople.storageKey, all);
    return next;
  }

  // --- RESOURCES & BOOKINGS ---
  function getResources(includeInactive = true): Resource[] {
    return getStored<Resource[]>(COLLECTIONS.resources.storageKey, []).filter((r) => !r.deletedAt && (includeInactive || r.isActive !== false));
  }

  function saveResource(data: Partial<Resource>): Resource {
    const all = getStored<Resource[]>(COLLECTIONS.resources.storageKey, []);
    const now = new Date().toISOString();
    const idx = data.id ? all.findIndex((r) => r.id === data.id) : -1;
    const next = { ...(idx >= 0 ? all[idx] : { id: newId('res'), kind: 'STUDIO', isActive: true, createdAt: now }), ...data, updatedAt: now } as Resource;
    if (!next.name?.trim()) throw new Error('اسم المورد مطلوب');
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.resources.storageKey, all);
    return next;
  }

  function getBookings(): Booking[] {
    return getStored<Booking[]>(COLLECTIONS.bookings.storageKey, []).filter((b) => !b.deletedAt);
  }

  function deleteResource(id: string): void {
    if (getBookings().some((b) => b.resourceId === id && b.status !== 'CANCELLED' && Date.parse(b.end) > Date.now())) {
      throw new Error('للمورد حجوزات قادمة؛ ألغها أو عطّل المورد بدلاً من حذفه');
    }
    const all = getStored<Resource[]>(COLLECTIONS.resources.storageKey, []);
    setStored(COLLECTIONS.resources.storageKey, all.map((r) => (r.id === id ? { ...r, deletedAt: new Date().toISOString() } : r)));
  }

  function saveBooking(data: Partial<Booking>): Booking {
    const all = getStored<Booking[]>(COLLECTIONS.bookings.storageKey, []);
    const now = new Date().toISOString();
    const me = deps.getCurrentUser();
    const idx = data.id ? all.findIndex((b) => b.id === data.id) : -1;
    const next = {
      ...(idx >= 0 ? all[idx] : { id: newId('bkg'), status: 'CONFIRMED', createdAt: now, bookedById: me.id, bookedByName: me.fullName }),
      ...data,
      updatedAt: now,
    } as Booking;
    if (!next.assigneeId) next.assigneeId = next.bookedById;
    const err = bookingError(next);
    if (err) throw new Error(err);
    const clash = bookingConflicts(next, getBookings())[0];
    if (clash) {
      const res = getResources().find((r) => r.id === next.resourceId);
      const t = (iso: string) => new Date(iso).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' });
      throw new Error(`${res?.name || 'المورد'} محجوز في هذا الوقت: «${clash.title}» (${t(clash.start)}–${t(clash.end)}) باسم ${clash.bookedByName || 'زميل'}`);
    }
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.bookings.storageKey, all);
    return next;
  }

  function cancelBooking(id: string): void {
    const b = getBookings().find((x) => x.id === id);
    if (b) saveBooking({ ...b, status: 'CANCELLED' });
  }

  // --- PROGRAM TYPES ---
  function getProgramTypes(): ProgramType[] {
    return getSnapshot<ProgramType[]>(STORAGE_KEYS.PROGRAM_TYPES, []);
  }

  function saveProgramType(data: Partial<ProgramType>): ProgramType {
    const nameAr = (data.nameAr ?? '').trim();
    if (!nameAr) throw new Error('اسم نوع البرنامج مطلوب');
    if (nameAr.length > 80) throw new Error('اسم نوع البرنامج حتى 80 حرفاً');
    const all = getStored<ProgramType[]>(STORAGE_KEYS.PROGRAM_TYPES, []);
    const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (all.some((t) => t.id !== data.id && key(t.nameAr || t.name || '') === key(nameAr))) throw new Error('يوجد نوع برنامج بالاسم نفسه');
    const idx = data.id ? all.findIndex((t) => t.id === data.id) : -1;
    const next: ProgramType = { ...(idx >= 0 ? all[idx] : { id: data.id || newId('ptype') }), ...data, nameAr, name: nameAr };
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(STORAGE_KEYS.PROGRAM_TYPES, all);
    return next;
  }

  function countProgramsOfType(id: string): number {
    return getSnapshot<Program[]>(STORAGE_KEYS.PROGRAMS, []).filter((p) => !p.deletedAt && p.typeId === id).length;
  }

  function deleteProgramType(id: string): void {
    const inUse = countProgramsOfType(id);
    if (inUse > 0) {
      const count = inUse === 1 ? 'برنامج واحد' : inUse === 2 ? 'برنامجين' : inUse <= 10 ? `${inUse} برامج` : `${inUse} برنامجاً`;
      throw new Error(`لا يمكن حذف نوع البرنامج لأنه مستخدم في ${count}؛ انقل البرامج إلى نوع آخر أولاً`);
    }
    setStored(STORAGE_KEYS.PROGRAM_TYPES, getProgramTypes().filter((t) => t.id !== id));
  }

  // --- SETTINGS ---
  function getSettings(): SystemSettings {
    const settings = getSnapshot<SystemSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    // Department names, station groups and removed stations' names follow the shared settings everywhere.
    applyDepartmentSettings(settings);
    rememberStationSettings(settings);
    return settings;
  }

  function saveSettings(settings: Partial<SystemSettings>): SystemSettings {
    const current = getSettings();
    const updated = { ...current, ...settings };
    const error = settingsError(updated, current);
    if (error) throw new Error(error);
    setStored(STORAGE_KEYS.SETTINGS, updated);
    // Settings are audited by the server only after an accepted write.
    return updated;
  }

  // --- STATIONS ---
  async function getStationUsage(stationId: string): Promise<{ members: { id: string; fullName: string }[]; managers: { id: string; fullName: string }[]; openSteps: { cardId: string; cardTitle: string; stepId: string; assigneeName?: string }[]; openCardsOwned: number; localDepartments?: { id: string; name: string }[] }> {
    return (await apiFetch<{ data: any }>(`/api/v1/admin/stations/${encodeURIComponent(stationId)}/usage`)).data;
  }

  async function removeStation(stationId: string, replacementId?: string): Promise<{ movedUsers: number; movedSteps: number }> {
    const res = (await apiFetch<{ data: { movedUsers: number; movedSteps: number } }>(`/api/v1/admin/stations/${encodeURIComponent(stationId)}/remove`, { method: 'POST', json: { replacementId } })).data;
    await dataStore.pull();
    return res;
  }

  return {
    getCategories,
    saveCategory,
    deleteCategory,
    getSources,
    saveSource,
    deleteSource,
    getPronunciationTerms,
    savePronunciationTerm,
    deletePronunciationTerm,
    getSavedNewsFilterRows,
    saveSavedNewsFilter,
    deleteSavedNewsFilter,
    getWorkspaceWorkSections,
    saveWorkspaceWorkSections,
    getPersonalNotes,
    savePersonalNote,
    deletePersonalNote,
    getPersonalTasks,
    savePersonalTask,
    deletePersonalTask,
    getDiary,
    saveDiaryEntry,
    deleteDiaryEntry,
    getProductionPeople,
    saveProductionPerson,
    getResources,
    saveResource,
    deleteResource,
    getBookings,
    saveBooking,
    cancelBooking,
    getProgramTypes,
    saveProgramType,
    countProgramsOfType,
    deleteProgramType,
    getSettings,
    saveSettings,
    getStationUsage,
    removeStation,
  };
}
