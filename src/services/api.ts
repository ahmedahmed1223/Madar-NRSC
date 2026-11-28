import type { NewsArchiveFilters } from '../shared/newsArchive';
import type { PersonalNote } from '../shared/personalWorkspace';
import type { PersonalTask, PersonalTaskInput } from '../shared/personalTasks';
import { assignmentScope } from '../shared/assignmentScope';
import { departmentsOf, departmentWorkScope } from '../shared/departments';
import type { WorkSectionPreferences } from '../shared/workContext';
import { handoverRequest } from './handoverTransport';
import type { HandoverDraftInput, HandoverRow } from '../shared/shiftHandovers';
import type { EntityRow, SyncOpResult } from '../shared/collections';
import type { BackupStatus, BackupVerification, BackupRehearsal, DatabaseDiagnosticReport, RecentServerErrors } from '../shared/databaseDiagnostics';
import { reviewThreadError, type ReviewThread } from '../shared/reviewThreads';
import { createSearchIndex, matchesSearch, parseQuery, prepareText, scorePrepared, type SearchIndex } from '../shared/arabicSearch';
import type { SavedNewsFilterInput, SavedNewsFilterRow } from '../shared/savedNewsFilters';
import {
  NewsItem,
  Story,
  NewsStatus,
  Program,
  Episode,
  RundownSegment,
  Guest,
  EditorialTask,
  MediaFile,
  User,
  UserRole,
  Category,
  NewsSource,
  ProgramType,
  AppNotification,
  ActivityLog,
  AuditLog,
  SystemSettings,
  EpisodeQuestion,
  DbStats,
  SqlQueryResult,
  DbBackupFileInfo,
  WireItem,
} from '../types';

import { dataStore } from './dataStore';
import { authClient } from './authClient';
import { apiFetch, downloadDatabaseFile } from './http';
import { newId } from '../shared/ids';
import { addDaysIso } from '../shared/dates';
import { RosterEntry, rosterEntryError, rosterEntryId } from '../shared/roster';
import type { DeptRequest } from '../shared/production';
import { chatReadsError, conversationChangeError, messageError, type ChatAttachment, type ChatReads, type ChatRef, type Conversation } from '../shared/chat';
import type { CardActor, CardStep, ProductionCard } from '../shared/productionCards';
import type { WorkflowTemplate } from '../shared/workflowTemplates';
import { canControlOnAir, Cue, OnAirState, PRESENTER_INSTRUCTION_MS } from '../shared/onair';
import type { Bulletin, BulletinFormat, BulletinStory } from '../shared/bulletins';
import { CommentTarget, commentError, TeamComment } from '../shared/comments';
import { defaultPrefs, NotificationPrefs, prefsError, requiresNotificationAcknowledgment } from '../shared/notifications';
import type { Booking, DiaryEntry, Resource } from '../shared/planning';
import { COLLECTIONS, BroadcastState, ChatMessage, EditLock, isLockActive, isOwnLock, lockIdFor } from '../shared/collections';
import { RbacService } from './rbacService';
export { formatSecondsToTime, parseTimeToSeconds, recalculateRundown } from '../shared/rundown';
import { taskAssigneeId } from '../shared/assignedWork';
import { normalizeTaskStatus } from '../shared/taskWorkflow';
import { selfHealingService } from './selfHealingService';

import { ApiDomainDeps, getSnapshot, getStored, setStored, STORAGE_KEYS } from './domains/storeContext';
import { createReferenceApi } from './domains/referenceApi';
import { createNewsApi, type NewsArchivePage, type NewsRevision, type WireFeedStatus, type WireStatusInfo } from './domains/newsApi';
import { createProductionApi, type EpisodeSummaries, type GuestEpisodeSummary } from './domains/productionApi';

export type { WireFeedStatus, NewsArchivePage, WireStatusInfo, NewsRevision, GuestEpisodeSummary, EpisodeSummaries };

// Role-based permission checker
export function hasPermission(
  role: UserRole,
  action:
    | 'MANAGE_USERS'
    | 'PUBLISH_NEWS'
    | 'APPROVE_NEWS'
    | 'EDIT_ANY_NEWS'
    | 'CREATE_NEWS'
    | 'DELETE_NEWS'
    | 'MANAGE_BREAKING'
    | 'MANAGE_PROGRAMS'
    | 'MANAGE_RUNDOWN'
    | 'MANAGE_GUESTS'
    | 'MANAGE_TASKS'
    | 'MANAGE_MEDIA'
    | 'VIEW_AUDIT_LOGS'
    | 'SYSTEM_SETTINGS'
): boolean {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return true;
    case 'EDITOR':
      return [
        'PUBLISH_NEWS',
        'APPROVE_NEWS',
        'EDIT_ANY_NEWS',
        'CREATE_NEWS',
        'MANAGE_BREAKING',
        'MANAGE_GUESTS',
        'MANAGE_TASKS',
        'MANAGE_MEDIA',
        'DELETE_NEWS',
      ].includes(action);
    case 'JOURNALIST':
      return ['CREATE_NEWS', 'MANAGE_MEDIA'].includes(action);
    case 'PRODUCER':
      return [
        'MANAGE_PROGRAMS',
        'MANAGE_RUNDOWN',
        'MANAGE_GUESTS',
        'MANAGE_TASKS',
        'MANAGE_MEDIA',
      ].includes(action);
    case 'PRESENTER':
      return ['MANAGE_GUESTS'].includes(action);
    case 'REPORTER':
      return ['CREATE_NEWS', 'MANAGE_MEDIA'].includes(action);
    case 'MEDIA':
      return ['MANAGE_MEDIA'].includes(action);
    case 'VIEWER':
      return false;
    default:
      return false;
  }
}

const htmlText = (html: string | undefined) => (html || '').replace(/<[^>]*>/g, ' ');
const versionOf = (r: { updatedAt?: string; createdAt?: string }) => `${r.updatedAt || ''}|${r.createdAt || ''}`;
const newsSearchTitle = (news: NewsItem) => [news.title, news.shortTitle];
const newsSearchMetadata = (news: NewsItem) => [news.keywords, news.summary, news.locationName];

/** Whether a news result needs its content to satisfy the global search query. */
export function newsMatchUsesContent(news: NewsItem, query: string): boolean {
  const parsed = parseQuery(query);
  const title = newsSearchTitle(news);
  const metadata = newsSearchMetadata(news);
  return parsed.empty
    ? !matchesSearch(query, title, metadata)
    : scorePrepared(parsed, prepareText(title), prepareText(metadata)) === null;
}

/** Search indexes of the unified search, memoised per record id + updatedAt. */
const GLOBAL_INDEX = {
  news: createSearchIndex<NewsItem>({ id: (n) => n.id, version: versionOf, title: newsSearchTitle, body: (n) => [...newsSearchMetadata(n), htmlText(n.content)] }),
  programs: createSearchIndex<Program & { createdAt?: string }>({ id: (p) => p.id, version: versionOf, title: (p) => [p.name], body: (p) => [p.description, p.presenterName, p.producerName] }),
  episodes: createSearchIndex<Episode & { createdAt?: string }>({ id: (e) => e.id, version: versionOf, title: (e) => [e.title], body: (e) => [e.description, e.programName, e.episodeNumber, e.broadcastDate] }),
  guests: createSearchIndex<Guest & { createdAt?: string }>({ id: (g) => g.id, version: versionOf, title: (g) => [g.fullName], body: (g) => [g.organization, g.specialty, g.jobTitle] }),
  tasks: createSearchIndex<EditorialTask & { createdAt?: string }>({ id: (t) => t.id, version: versionOf, title: (t) => [t.title], body: (t) => [t.description, t.assigneeName, t.assignedToName] }),
  bulletins: createSearchIndex<Bulletin>({ id: (b) => b.id, version: versionOf, title: (b) => [b.title], body: (b) => [b.date, b.editorName, b.anchors, b.studioName, b.notes] }),
  cards: createSearchIndex<ProductionCard>({ id: (c) => c.id, version: versionOf, title: (c) => [c.title], body: (c) => [c.brief, c.ownerName, c.target?.title, c.steps.map((st) => st.assigneeName || '')] }),
};

export interface GlobalSearchResult {
  news: NewsItem[];
  programs: Program[];
  episodes: Episode[];
  guests: Guest[];
  tasks: EditorialTask[];
  bulletins: Bulletin[];
  cards: ProductionCard[];
}

const domainDeps: ApiDomainDeps = {
  getCurrentUser: () => ApiService.getCurrentUser(),
  getUsers: () => ApiService.getUsers(),
  getSettings: () => ApiService.getSettings(),
  getOnAirStates: () => ApiService.getOnAirStates(),
  logActivity: (action, entityType, entityId, entityTitle, summaryAr) =>
    ApiService.logActivity(action, entityType, entityId, entityTitle, summaryAr),
};
const referenceApi = createReferenceApi(domainDeps);
const newsApi = createNewsApi(domainDeps);
const productionApi = createProductionApi(domainDeps);

export class ApiService {
  static getEpisodeSummaries(signal?: AbortSignal): Promise<EpisodeSummaries> {
    return productionApi.getEpisodeSummaries(signal);
  }

  static async getShiftHandovers(signal?: AbortSignal): Promise<HandoverRow[]> {
    return (await handoverRequest<{ rows: HandoverRow[] }>('/api/v1/shift-handovers', {}, signal)).rows;
  }
  static async getShiftHandover(id: string, signal?: AbortSignal): Promise<HandoverRow> {
    return (await handoverRequest<{ row: HandoverRow }>(`/api/v1/shift-handovers/${encodeURIComponent(id)}`, {}, signal)).row;
  }
  static async isShiftHandoverPublished(id: string, signal?: AbortSignal): Promise<boolean> {
    return (await handoverRequest<{ published: boolean }>(`/api/v1/shift-handovers/${encodeURIComponent(id)}/publication-status`, {}, signal)).published;
  }
  static async saveShiftHandover(draft: HandoverDraftInput, baseV?: number, signal?: AbortSignal): Promise<HandoverRow> {
    return (await handoverRequest<{ row: HandoverRow }>(`/api/v1/shift-handovers${baseV === undefined ? '' : `/${encodeURIComponent(draft.id)}`}`, { method: baseV === undefined ? 'POST' : 'PATCH', json: baseV === undefined ? draft : { draft, baseV } }, signal)).row;
  }
  static async deleteShiftHandover(id: string, baseV: number, signal?: AbortSignal): Promise<void> {
    await handoverRequest(`/api/v1/shift-handovers/${encodeURIComponent(id)}`, { method: 'DELETE', json: { baseV } }, signal);
  }
  static async publishShiftHandover(id: string, baseV: number, signal?: AbortSignal): Promise<HandoverRow> {
    return (await handoverRequest<{ row: HandoverRow }>(`/api/v1/shift-handovers/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { baseV } }, signal)).row;
  }
  static async acknowledgeShiftHandover(id: string, note: string, signal?: AbortSignal): Promise<HandoverRow> {
    return (await handoverRequest<{ row: HandoverRow }>(`/api/v1/shift-handovers/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', json: { note } }, signal)).row;
  }
  static async remindShiftHandover(id: string, signal?: AbortSignal): Promise<HandoverRow> {
    return (await handoverRequest<{ row: HandoverRow }>(`/api/v1/shift-handovers/${encodeURIComponent(id)}/remind`, { method: 'POST', json: {} }, signal)).row;
  }
  static getNewsCorrections(): import('../shared/newsCorrections').NewsCorrection[] {
    return newsApi.getNewsCorrections();
  }
  static correctionContext(newsId: string): Promise<{ newsVersion: number; newsTitle: string; newsText: string; records: import('../shared/newsCorrections').NewsCorrection[]; historyVersions: number[] }> {
    return newsApi.correctionContext(newsId);
  }
  static registerNewsCorrection(input: import('../shared/newsCorrections').CreateCorrectionInput): Promise<import('../shared/newsCorrections').NewsCorrection> {
    return newsApi.registerNewsCorrection(input);
  }
  // --- AUTH & CURRENT USER ---
  /** The signed-in user (kept fresh from the synchronised users collection). */
  static getCurrentUser(): User {
    const session = authClient.getSession();
    if (!session) throw new Error('لا توجد جلسة دخول نشطة');
    const fresh = this.getUsers().find((u) => u.id === session.user.id);
    return fresh || session.user;
  }

  static getUsers(): User[] {
    return getSnapshot<User[]>(STORAGE_KEYS.USERS, []);
  }

  static getUserById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  }

  static async createUserWithPassword(user: Partial<User>, password: string): Promise<User> {
    const { row } = await apiFetch<{ row: EntityRow }>('/api/v1/users', {
      method: 'POST', json: { user, password }, signal: AbortSignal.timeout(20_000),
    });
    dataStore.mergeSearchRows([row]);
    return row.d as User;
  }

  static saveUser(user: Partial<User> & { id?: string }): User {
    const users = getStored<User[]>(STORAGE_KEYS.USERS, []);
    if (user.id) {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx !== -1) {
        users[idx] = { ...users[idx], ...user };
        setStored(STORAGE_KEYS.USERS, users);
        return users[idx];
      }
    }
    const newUser: User = {
      id: user.id || newId('usr'),
      fullName: user.fullName || 'مستخدم جديد',
      fullNameEn: user.fullNameEn,
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'JOURNALIST',
      customRoleId: user.customRoleId,
      workflowRoles: user.workflowRoles,
      workflowDelegations: user.workflowDelegations,
      avatarUrl: user.avatarUrl || '/avatar.svg',
      jobTitle: user.jobTitle || 'صحفي',
      departmentId: user.departmentId || 'newsroom',
      department: user.department || 'غرفة التحرير',
      stationId: user.stationId,
      staffId: user.staffId || '',
      bio: user.bio || '',
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      // Empty until the first sign-in (the server sets it at login).
      customPermissions: user.customPermissions || [],
      isActive: user.isActive !== undefined ? user.isActive : true,
      createdAt: user.createdAt || new Date().toISOString(),
    };
    users.push(newUser);
    setStored(STORAGE_KEYS.USERS, users);
    return newUser;
  }

  static deleteUser(id: string): boolean {
    const users = this.getUsers();
    const current = this.getCurrentUser();
    if (current.id === id) {
      throw new Error('لا يمكن حذف المستخدم النشط حالياً');
    }
    const target = users.find((u) => u.id === id);
    if (!target) return false;

    const filtered = users.filter((u) => u.id !== id);
    setStored(STORAGE_KEYS.USERS, filtered);
    return true;
  }

  static toggleUserStatus(id: string): User | null {
    const users = getStored<User[]>(STORAGE_KEYS.USERS, []);
    const current = this.getCurrentUser();
    if (current.id === id) {
      throw new Error('لا يمكن تجميد حسابك النشط');
    }
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;

    users[idx].isActive = !users[idx].isActive;
    setStored(STORAGE_KEYS.USERS, users);
    return users[idx];
  }

  // --- NEWS CRUD & WORKFLOW ---
  static getNews(): NewsItem[] { return newsApi.getNews(); }
  static getNewsById(id: string): NewsItem | undefined { return newsApi.getNewsById(id); }
  static saveNews(newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, user?: User): NewsItem { return newsApi.saveNews(newsData, user); }
  static updateNewsStatus(newsId: string, toStatus: NewsStatus, userOrComment?: User | string, optionalComment?: string, opts: { scheduledDate?: string } = {}): NewsItem {
    return newsApi.updateNewsStatus(newsId, toStatus, userOrComment, optionalComment, opts);
  }
  static deleteNews(newsId: string, user?: User): void { return newsApi.deleteNews(newsId, user); }

  // --- BREAKING NEWS ---
  static getActiveBreakingNews(): NewsItem[] { return newsApi.getActiveBreakingNews(); }
  static setBreaking(newsId: string, on: boolean, hours?: number): NewsItem { return newsApi.setBreaking(newsId, on, hours); }

  // --- PROGRAMS & EPISODES ---
  static getPrograms(): Program[] { return productionApi.getPrograms(); }
  static getProgramById(id: string): Program | undefined { return productionApi.getProgramById(id); }
  static saveProgram(program: Partial<Program>, user?: User): Program { return productionApi.saveProgram(program, user); }
  static deleteProgram(id: string, user?: User): void { return productionApi.deleteProgram(id, user); }
  static getEpisodes(): Episode[] { return productionApi.getEpisodes(); }
  static getEpisodeById(id: string): Episode | undefined { return productionApi.getEpisodeById(id); }
  static saveEpisode(episodeData: Partial<Episode>, user?: User): Episode { return productionApi.saveEpisode(episodeData, user); }
  static deleteEpisode(id: string, user?: User): void { return productionApi.deleteEpisode(id, user); }

  // --- RUNDOWN MANAGEMENT ---
  static updateEpisodeRundown(episodeId: string, rundown: RundownSegment[], user?: User): Episode { return productionApi.updateEpisodeRundown(episodeId, rundown, user); }
  static addRundownSegment(episodeId: string, segment: Partial<RundownSegment>): Episode { return productionApi.addRundownSegment(episodeId, segment); }
  static deleteRundownSegment(episodeId: string, segmentId: string): Episode { return productionApi.deleteRundownSegment(episodeId, segmentId); }

  // --- QUESTIONS & TOPICS ---
  static saveEpisodeQuestion(episodeId: string, question: Partial<EpisodeQuestion>): Episode { return productionApi.saveEpisodeQuestion(episodeId, question); }
  static deleteEpisodeQuestion(episodeId: string, questionId: string): Episode { return productionApi.deleteEpisodeQuestion(episodeId, questionId); }

  // --- GUESTS ---
  static getGuests(): Guest[] { return productionApi.getGuests(); }
  static saveGuest(guest: Partial<Guest>, user?: User): Guest { return productionApi.saveGuest(guest, user); }
  static deleteGuest(id: string, user?: User): void { return productionApi.deleteGuest(id, user); }

  // --- DUTY ROSTER ---
  static getRoster(): RosterEntry[] {
    return getStored<RosterEntry[]>(COLLECTIONS.roster.storageKey, []).filter((e: any) => !e.deletedAt);
  }

  static addRosterEntry(entry: Omit<RosterEntry, 'id' | 'userName'> & { userName?: string }): RosterEntry {
    if (!RbacService.hasPermission(this.getCurrentUser(), 'roster.manage')) throw new Error('صلاحياتك لا تسمح بتعديل جدول المناوبات');
    const user = this.getUsers().find((u) => u.id === entry.userId);
    const row: RosterEntry = { ...entry, userName: user?.fullName || entry.userName || '', id: rosterEntryId(entry) };
    const err = rosterEntryError(row);
    if (err) throw new Error(err);
    const all = getStored<RosterEntry[]>(COLLECTIONS.roster.storageKey, []);
    if (all.some((e) => e.id === row.id)) return row;
    setStored(COLLECTIONS.roster.storageKey, [...all, row]);
    return row;
  }

  static updateRosterEntry(id: string, changes: Partial<Pick<RosterEntry, 'isLead' | 'notes'>>): void {
    if (!RbacService.hasPermission(this.getCurrentUser(), 'roster.manage')) throw new Error('صلاحياتك لا تسمح بتعديل جدول المناوبات');
    const all = getStored<RosterEntry[]>(COLLECTIONS.roster.storageKey, []);
    setStored(COLLECTIONS.roster.storageKey, all.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }

  static removeRosterEntry(id: string): void {
    if (!RbacService.hasPermission(this.getCurrentUser(), 'roster.manage')) throw new Error('صلاحياتك لا تسمح بتعديل جدول المناوبات');
    const all = getStored<RosterEntry[]>(COLLECTIONS.roster.storageKey, []);
    setStored(COLLECTIONS.roster.storageKey, all.filter((e) => e.id !== id));
  }

  /** Copies every entry of the 7 days starting `fromWeekStart` one week later (existing entries are kept). */
  static copyRosterWeek(fromWeekStart: string): number {
    if (!RbacService.hasPermission(this.getCurrentUser(), 'roster.manage')) throw new Error('صلاحياتك لا تسمح بتعديل جدول المناوبات');
    const shift = addDaysIso;
    const end = shift(fromWeekStart, 7);
    const all = getStored<RosterEntry[]>(COLLECTIONS.roster.storageKey, []);
    const existing = new Set(all.map((e) => e.id));
    const copies = all
      .filter((e) => !(e as any).deletedAt && e.date >= fromWeekStart && e.date < end)
      .map((e) => {
        const date = shift(e.date, 7);
        const { createdBy: _c, ...rest } = e;
        return { ...rest, date, id: rosterEntryId({ ...e, date }) };
      })
      .filter((e) => !existing.has(e.id));
    if (copies.length) setStored(COLLECTIONS.roster.storageKey, [...all, ...copies]);
    return copies.length;
  }

  // --- TASKS ---
  static getTasks(): EditorialTask[] {
    return getSnapshot<EditorialTask[]>(STORAGE_KEYS.TASKS, []);
  }

  static saveTask(task: Partial<EditorialTask>, user?: User): EditorialTask {
    const all = getStored<EditorialTask[]>(STORAGE_KEYS.TASKS, []);
    const currentUser = user || this.getCurrentUser();
    const existingTask = task.id ? all.find((t) => t.id === task.id) : undefined;
    const existingAssignee = taskAssigneeId(existingTask);
    const nextAssignee = taskAssigneeId(task) || existingAssignee || currentUser.id;
    const users = this.getUsers();
    const recipient = users.find(member => member.id === nextAssignee);
    const settings = this.getSettings();
    const team = RbacService.leadsDepartment(currentUser) && currentUser.role !== 'ADMIN' && currentUser.role !== 'SUPER_ADMIN'
      ? departmentWorkScope(currentUser.id, departmentsOf(settings)) : null;
    const isInTeam = (id?: string) => {
      const member = users.find(candidate => candidate.id === id);
      return !!member && !!team?.departmentFor(member);
    };
    const canAssign = team ? (!existingTask || isInTeam(existingAssignee)) && isInTeam(nextAssignee)
      : RbacService.hasPermission(currentUser, 'tasks.create_assign');
    if (!canAssign && !(existingAssignee === currentUser.id && nextAssignee === currentUser.id)) {
      throw new Error('صلاحياتك لا تسمح بإنشاء المهام أو تعديلها');
    }
    if (nextAssignee !== existingAssignee) {
      const error = assignmentScope(currentUser, settings).errorFor(recipient);
      if (error) throw new Error(error);
    }
    const now = new Date().toISOString();
    const { assignedToId: _legacyId, assignedToName: _legacyName, ...cleanTask } = task;
    const nextAssigneeName = recipient?.fullName || task.assigneeName || task.assignedToName || existingTask?.assigneeName || existingTask?.assignedToName || currentUser.fullName;

    if (task.id) {
      const idx = all.findIndex((t) => t.id === task.id);
      if (idx !== -1) {
        const { assignedToId: _oldLegacyId, assignedToName: _oldLegacyName, ...existingClean } = all[idx];
        all[idx] = {
          ...existingClean,
          ...cleanTask,
          status: normalizeTaskStatus(cleanTask.status ?? existingClean.status),
          assigneeId: nextAssignee,
          assigneeName: nextAssigneeName,
        };
        setStored(STORAGE_KEYS.TASKS, all);
        this.logActivity('تحديث مهمة', 'TASK', task.id, all[idx].title, `تحديث حالة المهمة إلى: ${all[idx].status}`);
        return all[idx];
      }
    }

    const newTask: EditorialTask = {
      id: task.id || newId('tsk'),
      title: task.title || 'مهمة جديدة',
      description: task.description || '',
      assigneeId: nextAssignee,
      assigneeName: nextAssigneeName,
      assigneeAvatar: task.assigneeAvatar,
      creatorId: currentUser.id,
      creatorName: currentUser.fullName,
      priority: task.priority || 'MEDIUM',
      status: normalizeTaskStatus(task.status),
      startDate: task.startDate || now,
      dueDate: task.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      reminderOptions: task.reminderOptions,
      relatedEntityType: task.relatedEntityType || 'GENERAL',
      relatedEntityId: task.relatedEntityId,
      relatedEntityTitle: task.relatedEntityTitle,
      notes: task.notes || '',
      createdAt: now,
    };

    all.unshift(newTask);
    setStored(STORAGE_KEYS.TASKS, all);
    this.logActivity('إنشاء مهمة', 'TASK', newTask.id, newTask.title, `تم إسناد مهمة جديدة إلى ${newTask.assigneeName}`);

    // Assignment notifications are written by the server after accepting the task.

    return newTask;
  }

  static deleteTask(taskId: string, user?: User): void {
    const currentUser = user || this.getCurrentUser();
    if (!RbacService.hasPermission(currentUser, 'tasks.create_assign') && !RbacService.leadsDepartment(currentUser)) {
      throw new Error('صلاحياتك لا تسمح بحذف المهام');
    }
    const all = this.getTasks();
    const filtered = all.filter((t) => t.id !== taskId);
    setStored(STORAGE_KEYS.TASKS, filtered);
    this.logActivity('حذف مهمة', 'TASK', taskId, 'مهمة محذوفة', `قام ${currentUser.fullName} بحذف المهمة.`);
  }

  // --- MEDIA ---
  static getMedia(): MediaFile[] {
    return getSnapshot<MediaFile[]>(STORAGE_KEYS.MEDIA, []).filter(asset => !asset.deletedAt);
  }

  static getMediaAssets(): MediaFile[] {
    return this.getMedia();
  }

  static getMediaFiles(): MediaFile[] {
    return this.getMedia();
  }

  static saveMedia(file: Partial<MediaFile>, user?: User): MediaFile {
    const all = getStored<MediaFile[]>(STORAGE_KEYS.MEDIA, []);
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    const url = file.url || file.fileUrl;
    if (!url) throw new Error('يجب رفع ملف أو إدخال رابط للمادة');
    const newMedia: MediaFile = {
      ...file,
      id: newId('med'),
      title: file.title || file.originalName || file.fileName,
      fileName: file.fileName || file.originalName || 'ملف',
      originalName: file.originalName || file.fileName,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes ?? file.fileSize,
      url,
      fileUrl: url,
      mediaType: file.mediaType || 'IMAGE',
      ownerId: currentUser.id,
      ownerName: currentUser.fullName,
      uploadedById: currentUser.id,
      uploadedByName: currentUser.fullName,
      tags: file.tags && file.tags.length ? file.tags : [],
      description: file.description || '',
      createdAt: now,
    };

    all.unshift(newMedia);
    setStored(STORAGE_KEYS.MEDIA, all);
    this.logActivity('رفع ملف وسائط', 'MEDIA', newMedia.id, newMedia.originalName, `رفع ملف جديد: ${newMedia.originalName}`);
    return newMedia;
  }

  static saveMediaAsset(file: Partial<MediaFile>, user?: User): MediaFile {
    return this.saveMedia(file, user);
  }

  static deleteMedia(mediaId: string, user?: User): void {
    const all = getStored<MediaFile[]>(STORAGE_KEYS.MEDIA, []);
    const filtered = all.filter((m) => m.id !== mediaId);
    setStored(STORAGE_KEYS.MEDIA, filtered);
    const currentUser = user || this.getCurrentUser();
    this.logActivity('حذف ملف وسائط', 'MEDIA', mediaId, 'ملف وسائط', `قام ${currentUser.fullName} بحذف ملف الوسائط.`);
  }

  static deleteMediaAsset(mediaId: string, user?: User): void {
    this.deleteMedia(mediaId, user);
  }

  static trashMediaAsset(mediaId: string): void {
    this.updateMedia(mediaId, { deletedAt: new Date().toISOString() });
  }

  /** Updates metadata of a library item (e.g. the video workflow state). */
  static updateMedia(mediaId: string, changes: Partial<MediaFile>): MediaFile {
    const all = getStored<MediaFile[]>(STORAGE_KEYS.MEDIA, []);
    const idx = all.findIndex((m) => m.id === mediaId && !m.deletedAt);
    if (idx === -1) throw new Error('المادة غير موجودة في المكتبة');
    const { id: _id, ownerId: _o, uploadedById: _u, ...allowed } = changes as any;
    all[idx] = { ...all[idx], ...allowed };
    setStored(STORAGE_KEYS.MEDIA, all);
    return all[idx];
  }

  /** Where a library item is used: stories and rundown segments. */
  static getMediaUsage(mediaId: string): { kind: 'news' | 'segment'; id: string; title: string; episodeId?: string; episodeTitle?: string }[] {
    const usage: { kind: 'news' | 'segment'; id: string; title: string; episodeId?: string; episodeTitle?: string }[] = [];
    this.getNews().forEach((n) => {
      if ((n.mediaIds || []).includes(mediaId)) usage.push({ kind: 'news', id: n.id, title: n.title });
    });
    this.getEpisodes().forEach((e) =>
      (e.rundown || []).forEach((seg) => {
        if ((seg.mediaIds || []).includes(mediaId)) usage.push({ kind: 'segment', id: seg.id, title: seg.title, episodeId: e.id, episodeTitle: e.title });
      })
    );
    return usage;
  }

  // --- TEAM COMMENTS ---
  static getComments(target?: Pick<CommentTarget, 'kind' | 'id'>): TeamComment[] {
    const all = getStored<TeamComment[]>(COLLECTIONS.comments.storageKey, []).filter((c: any) => !c.deletedAt);
    const list = target ? all.filter((c) => c.target.kind === target.kind && c.target.id === target.id) : all;
    return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  static getReviewThreads(collection: ReviewThread['collection'], entityId: string): ReviewThread[] {
    return getStored<ReviewThread[]>(COLLECTIONS.reviewThreads.storageKey, []).filter(t => t.collection === collection && t.entityId === entityId);
  }
  static createReviewThread(input: Omit<ReviewThread, 'id' | 'createdById' | 'createdAt' | 'resolved'>, id = newId('review')): ReviewThread {
    const existing = getStored<ReviewThread[]>(COLLECTIONS.reviewThreads.storageKey, []).find(t => t.id === id);
    if (existing) return existing;
    const thread = { ...input, id, createdById: this.getCurrentUser().id, createdAt: new Date().toISOString(), resolved: false };
    const error = reviewThreadError(thread);
    if (error) throw new Error(error);
    setStored(COLLECTIONS.reviewThreads.storageKey, [...getStored<ReviewThread[]>(COLLECTIONS.reviewThreads.storageKey, []), thread]);
    return thread;
  }
  static setReviewThreadResolved(id: string, resolved: boolean): void {
    setStored(COLLECTIONS.reviewThreads.storageKey, getStored<ReviewThread[]>(COLLECTIONS.reviewThreads.storageKey, []).map(t => t.id === id ? { ...t, resolved } : t));
  }
  static addComment(target: CommentTarget, text: string, mentions: string[], threadId?: string, id = newId('cmt')): TeamComment {
    const existing = getStored<TeamComment[]>(COLLECTIONS.comments.storageKey, []).find(c => c.id === id);
    if (existing) return existing;
    const me = this.getCurrentUser();
    const comment: TeamComment = {
      id,
        ...(threadId ? { threadId } : {}),
      target,
      text: text.trim(),
      mentions: [...new Set(mentions.filter((id) => id !== me.id))],
      authorId: me.id,
      authorName: me.fullName,
      createdAt: new Date().toISOString(),
    };
    const err = commentError(comment);
    if (err) throw new Error(err);
    setStored(COLLECTIONS.comments.storageKey, [...getStored<TeamComment[]>(COLLECTIONS.comments.storageKey, []), comment]);
    return comment;
  }

  static deleteComment(id: string): void {
    setStored(COLLECTIONS.comments.storageKey, getStored<TeamComment[]>(COLLECTIONS.comments.storageKey, []).filter((c) => c.id !== id));
  }

  // --- ON AIR ---
  static getOnAirStates(): OnAirState[] {
    return getStored<OnAirState[]>(COLLECTIONS.onAir.storageKey, []);
  }

  static getOnAir(episodeId: string): OnAirState | null {
    return this.getOnAirStates().find((s) => s.episodeId === episodeId) || null;
  }

  /** Starts, moves or ends the live show; the server stamps the times. */
  static setOnAir(episodeId: string, status: 'LIVE' | 'ENDED', currentSegmentId: string): OnAirState {
    const me = this.getCurrentUser();
    if (!canControlOnAir(me, (p) => RbacService.hasPermission(me, p))) throw new Error('تشغيل وضع الهواء للمخرج والكنترول فقط');
    const episode = this.getAirShows().find((e) => e.id === episodeId);
    if (!episode) throw new Error('الحلقة أو النشرة غير موجودة');
    const all = this.getOnAirStates();
    const before = all.find((s) => s.episodeId === episodeId);
    const now = new Date().toISOString();
    const moved = !before || before.currentSegmentId !== currentSegmentId || before.status !== status;
    const next: OnAirState = {
      ...(before || { log: [], startedAt: now }),
      id: episodeId,
      episodeId,
      episodeTitle: episode.title,
      programName: episode.programName,
      status,
      currentSegmentId,
      // Optimistic local timing; replaced by the server's stamp on sync.
      segmentStartedAt: moved ? now : before!.segmentStartedAt,
      startedAt: !before || (before.status === 'ENDED' && status === 'LIVE') ? now : before.startedAt,
      endedAt: status === 'ENDED' ? now : undefined,
    } as OnAirState;
    setStored(COLLECTIONS.onAir.storageKey, [...all.filter((s) => s.episodeId !== episodeId), next]);
    return next;
  }

  // --- ON-AIR ALERTS ---
  static getCues(): Cue[] {
    return getStored<Cue[]>(COLLECTIONS.cues.storageKey, []);
  }

  static sendCue(message: string, level: Cue['level'], targetDepartmentIds: string[], episodeId?: string): Cue {
    const me = this.getCurrentUser();
    const cue: Cue = {
      id: newId('cue'),
      episodeId,
      targetDepartmentIds,
      message: message.trim(),
      level,
      fromId: me.id,
      fromName: me.fullName,
      createdAt: new Date().toISOString(),
      acks: [],
    };
    if (!cue.message) throw new Error('اكتب نص التنبيه');
    setStored(COLLECTIONS.cues.storageKey, [cue, ...this.getCues()]);
    return cue;
  }

  /** Time-sensitive instructions are sent directly so an offline queue cannot replay them. */
  static async sendPresenterInstruction(episodeId: string, message: string, level: Cue['level'], targetUserId?: string): Promise<void> {
    const id = newId('cue');
    const cue = {
      id, episodeId, message: message.trim(), level, targetUserId,
      targetDepartmentIds: targetUserId ? ['studio'] : ['studio', 'presenters'],
      expiresAt: new Date(Date.now() + PRESENTER_INSTRUCTION_MS).toISOString(),
    };
    const response = await apiFetch<{ results: SyncOpResult[] }>('/api/v1/data/sync', {
      method: 'POST', json: { ops: [{ c: 'cues', op: 'upsert', id, d: cue }] },
      signal: AbortSignal.timeout(5000),
    });
    const result = response.results[0];
    if (!result?.ok) throw new Error(result && 'message' in result ? result.message : 'لم يؤكد الخادم إرسال التوجيه');
    void dataStore.pull();
  }

  static ackCue(id: string): void {
    const me = this.getCurrentUser();
    const all = this.getCues();
    setStored(
      COLLECTIONS.cues.storageKey,
      all.map((c) => (c.id === id && !c.acks.some((a) => a.userId === me.id) ? { ...c, acks: [...c.acks, { userId: me.id, userName: me.fullName, at: new Date().toISOString() }] } : c))
    );
  }

  /** Reports a correction already passed by the live reader directly to the broadcast desk. */
  static async reportPrompterCorrection(showId: string, segmentId: string, revision: string): Promise<void> {
    await apiFetch(`/api/v1/onair/${encodeURIComponent(showId)}/prompter-correction`, {
      method: 'POST', json: { segmentId, revision }, signal: AbortSignal.timeout(5000),
    });
  }

  // --- BULLETINS ---
  static getBulletins(): Bulletin[] { return productionApi.getBulletins(); }
  static getBulletinStories(bulletinId?: string): BulletinStory[] { return productionApi.getBulletinStories(bulletinId); }
  static getBulletinFormats(): BulletinFormat[] { return productionApi.getBulletinFormats(); }
  static saveBulletin(data: Partial<Bulletin>): Bulletin { return productionApi.saveBulletin(data); }
  static deleteBulletin(id: string): void { return productionApi.deleteBulletin(id); }
  static saveBulletinStory(data: Partial<BulletinStory> & { bulletinId: string }, base?: EntityRow): BulletinStory { return productionApi.saveBulletinStory(data, base); }
  static deleteBulletinStory(id: string): void { return productionApi.deleteBulletinStory(id); }
  static moveBulletinStory(id: string, dir: -1 | 1): void { return productionApi.moveBulletinStory(id, dir); }
  static copyStoriesToBulletin(storyIds: string[], bulletinId: string): number { return productionApi.copyStoriesToBulletin(storyIds, bulletinId); }
  static saveBulletinFormat(data: Partial<BulletinFormat>): BulletinFormat { return productionApi.saveBulletinFormat(data); }
  static deleteBulletinFormat(id: string): void { return productionApi.deleteBulletinFormat(id); }
  static createBulletinFromFormat(formatId: string, date: string, opts: { scheduled?: boolean; overrides?: Partial<Bulletin> } = {}): Bulletin { return productionApi.createBulletinFromFormat(formatId, date, opts); }
  static missingScheduledBulletins(date: string): BulletinFormat[] { return productionApi.missingScheduledBulletins(date); }
  static getAirShows(): any[] { return productionApi.getAirShows(); }

  // --- REQUESTS BETWEEN DEPARTMENTS ---
  static getRequests(): DeptRequest[] { return productionApi.getRequests(); }
  static createRequest(data: Pick<DeptRequest, 'type' | 'title'> & Partial<DeptRequest>): DeptRequest { return productionApi.createRequest(data); }
  static updateRequest(id: string, changes: Partial<DeptRequest>): DeptRequest { return productionApi.updateRequest(id, changes); }
  static deleteRequest(id: string): void { return productionApi.deleteRequest(id); }

  // --- PRODUCTION CARDS ---
  static getCards(): ProductionCard[] { return productionApi.getCards(); }
  static getCard(id: string): ProductionCard | undefined { return productionApi.getCard(id); }
  static cardActor(card?: Pick<ProductionCard, 'kind' | 'target'> & Partial<Pick<ProductionCard, 'steps'>>, existing = true): CardActor { return productionApi.cardActor(card, existing); }
  static saveCard(card: ProductionCard): ProductionCard { return productionApi.saveCard(card); }
  static updateCard(id: string, change: (card: ProductionCard) => ProductionCard): ProductionCard { return productionApi.updateCard(id, change); }
  static updateCardStep(cardId: string, stepId: string, changes: Partial<CardStep>): ProductionCard { return productionApi.updateCardStep(cardId, stepId, changes); }
  static addCardNote(cardId: string, text: string, stepId?: string, decision = false): ProductionCard { return productionApi.addCardNote(cardId, text, stepId, decision); }
  static sendBackCardStep(cardId: string, targetStepId: string, reason: string, fromStepId?: string, dueAt?: string): ProductionCard { return productionApi.sendBackCardStep(cardId, targetStepId, reason, fromStepId, dueAt); }
  static finishCardStep(cardId: string, stepId: string, note: string | undefined, sessionMinutes?: number): ProductionCard { return productionApi.finishCardStep(cardId, stepId, note, sessionMinutes); }
  static deleteCard(id: string): void { return productionApi.deleteCard(id); }

  // --- WORKFLOW TEMPLATES (assignments are created from them) ---
  static getWorkflowTemplates(): WorkflowTemplate[] { return productionApi.getWorkflowTemplates(); }
  static saveWorkflowTemplate(template: WorkflowTemplate): WorkflowTemplate { return productionApi.saveWorkflowTemplate(template); }
  static deleteWorkflowTemplate(id: string): void { return productionApi.deleteWorkflowTemplate(id); }

  // --- TAXONOMY & CONFIG ---
  static getCategories(): Category[] { return referenceApi.getCategories(); }

  // --- STORIES ---
  static getStories(): Story[] { return newsApi.getStories(); }
  static getStory(id: string): Story | undefined { return newsApi.getStory(id); }
  static saveStory(data: Partial<Story>, currentUser: User): Story { return newsApi.saveStory(data, currentUser); }
  static deleteStory(id: string, currentUser: User): void { return newsApi.deleteStory(id, currentUser); }

  static saveCategory(cat: Partial<Category>): Category { return referenceApi.saveCategory(cat); }
  static deleteCategory(id: string): void { return referenceApi.deleteCategory(id); }
  static getSources(): NewsSource[] { return referenceApi.getSources(); }
  static getNewsSources(): NewsSource[] { return referenceApi.getSources(); }
  static getPronunciationTerms(): import('../shared/pronunciation').PronunciationTerm[] { return referenceApi.getPronunciationTerms(); }
  static getSavedNewsFilterRows(signal?: AbortSignal): Promise<SavedNewsFilterRow[]> { return referenceApi.getSavedNewsFilterRows(signal); }
  static saveSavedNewsFilter(value: SavedNewsFilterInput, baseV?: number, signal?: AbortSignal): Promise<SavedNewsFilterRow> { return referenceApi.saveSavedNewsFilter(value, baseV, signal); }
  static deleteSavedNewsFilter(id: string, baseV: number, signal?: AbortSignal): Promise<void> { return referenceApi.deleteSavedNewsFilter(id, baseV, signal); }
  static savePronunciationTerm(value: Partial<import('../shared/pronunciation').PronunciationTerm>, original?: import('../shared/pronunciation').PronunciationTerm) { return referenceApi.savePronunciationTerm(value, original); }
  static deletePronunciationTerm(id: string): Promise<void> { return referenceApi.deletePronunciationTerm(id); }
  static saveSource(src: Partial<NewsSource>): NewsSource { return referenceApi.saveSource(src); }
  static saveNewsSource(src: Partial<NewsSource>): NewsSource { return referenceApi.saveSource(src); }
  static deleteSource(id: string): void { return referenceApi.deleteSource(id); }
  static deleteNewsSource(id: string): void { return referenceApi.deleteSource(id); }

  // --- NEWS ARCHIVE (settled news kept on the server only) ---
  static searchNewsArchive(query: string, page = 1, filters: NewsArchiveFilters = {}): Promise<NewsArchivePage> { return newsApi.searchNewsArchive(query, page, filters); }
  static getWorkspaceWorkSections(): WorkSectionPreferences | undefined { return referenceApi.getWorkspaceWorkSections(); }
  static saveWorkspaceWorkSections(sections: WorkSectionPreferences): void { return referenceApi.saveWorkspaceWorkSections(sections); }
  static getPersonalNotes(): PersonalNote[] { return referenceApi.getPersonalNotes(); }
  static savePersonalNote(input: Pick<PersonalNote, 'title' | 'body' | 'pinned'> & { id?: string }): PersonalNote { return referenceApi.savePersonalNote(input); }
  static deletePersonalNote(id: string): void { return referenceApi.deletePersonalNote(id); }
  static getPersonalTasks(): PersonalTask[] { return referenceApi.getPersonalTasks(); }
  static savePersonalTask(id: string, input: PersonalTaskInput): PersonalTask { return referenceApi.savePersonalTask(id, input); }
  static deletePersonalTask(id: string): void { return referenceApi.deletePersonalTask(id); }
  static getArchivedNews(id: string): Promise<NewsItem> { return newsApi.getArchivedNews(id); }
  static reactivateArchivedNews(id: string): Promise<void> { return newsApi.reactivateArchivedNews(id); }

  // --- AGENCY WIRES ---
  static getWires(): WireItem[] { return newsApi.getWires(); }
  static getWireStatus(): Promise<WireStatusInfo> { return newsApi.getWireStatus(); }
  static refreshWires(): Promise<WireFeedStatus[]> { return newsApi.refreshWires(); }
  static testFeed(url: string): Promise<{ title: string; itemCount: number; sample: string[] }> { return newsApi.testFeed(url); }

  // --- NOTIFICATION PREFERENCES & DELIVERY ---
  static getMyNotificationPrefs(): NotificationPrefs {
    const me = this.getCurrentUser().id;
    const own = getStored<NotificationPrefs[]>(COLLECTIONS.notificationPrefs.storageKey, []).find((p) => p.userId === me);
    return own ? { ...defaultPrefs(me), ...own } : defaultPrefs(me);
  }

  static saveMyNotificationPrefs(prefs: Partial<NotificationPrefs>): NotificationPrefs {
    const me = this.getCurrentUser().id;
    const next: NotificationPrefs = { ...this.getMyNotificationPrefs(), ...prefs, id: me, userId: me };
    next.watchWords = [...new Set((next.watchWords || []).map((w) => w.trim()).filter(Boolean))];
    if (!next.quietFrom || !next.quietTo) {
      delete next.quietFrom;
      delete next.quietTo;
    }
    const err = prefsError(next, me);
    if (err) throw new Error(err);
    const all = getStored<NotificationPrefs[]>(COLLECTIONS.notificationPrefs.storageKey, []).filter((p) => p.userId !== me);
    setStored(COLLECTIONS.notificationPrefs.storageKey, [...all, next]);
    return next;
  }

  static async getDeliveryStatus(): Promise<{ email: boolean; emailAddress: string; push: boolean; publicKey: string; devices: { endpoint: string; userAgent?: string; createdAt: string }[] }> {
    const res = await apiFetch<{ data: any }>('/api/v1/notifications/delivery');
    return res.data;
  }

  static async savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    await apiFetch('/api/v1/notifications/push/subscribe', { method: 'POST', json: { subscription } });
  }

  static async removePushSubscription(endpoint: string): Promise<void> {
    await apiFetch('/api/v1/notifications/push/unsubscribe', { method: 'POST', json: { endpoint } });
  }

  static async sendTestNotification(channel: 'push' | 'email'): Promise<void> {
    await apiFetch('/api/v1/notifications/test', { method: 'POST', json: { channel } });
  }

  // --- DEMO DATA ---
  static async getDemoDataInfo(): Promise<{ counts: Record<string, number>; users: { id: string; fullName: string; email: string }[]; removed: boolean }> {
    const res = await apiFetch<{ data: any }>('/api/v1/admin/demo-data');
    return res.data;
  }

  static async removeDemoData(includeUsers: boolean, confirm: string) {
    const res = await apiFetch<{ data: { removed: Record<string, number>; total: number; setupReviewId?: string } }>('/api/v1/admin/demo-data/remove', { method: 'POST', json: { includeUsers, confirm } });
    await dataStore.pull();
    return res.data;
  }

  // --- PLANNING DIARY ---
  static getDiary(): DiaryEntry[] { return referenceApi.getDiary(); }
  static saveDiaryEntry(data: Partial<DiaryEntry>): DiaryEntry { return referenceApi.saveDiaryEntry(data); }
  static deleteDiaryEntry(id: string): void { return referenceApi.deleteDiaryEntry(id); }
  static getProductionPeople(): import('../shared/productionPeople').ProductionPerson[] { return referenceApi.getProductionPeople(); }
  static saveProductionPerson(data: Partial<import('../shared/productionPeople').ProductionPerson>): import('../shared/productionPeople').ProductionPerson { return referenceApi.saveProductionPerson(data); }

  // --- RESOURCES & BOOKINGS ---
  static getResources(includeInactive = true): Resource[] { return referenceApi.getResources(includeInactive); }
  static saveResource(data: Partial<Resource>): Resource { return referenceApi.saveResource(data); }
  static deleteResource(id: string): void { return referenceApi.deleteResource(id); }
  static getBookings(): Booking[] { return referenceApi.getBookings(); }
  static saveBooking(data: Partial<Booking>): Booking { return referenceApi.saveBooking(data); }
  static cancelBooking(id: string): void { return referenceApi.cancelBooking(id); }
  static getProgramTypes(): ProgramType[] { return referenceApi.getProgramTypes(); }
  static saveProgramType(data: Partial<ProgramType>): ProgramType { return referenceApi.saveProgramType(data); }
  static countProgramsOfType(id: string): number { return referenceApi.countProgramsOfType(id); }
  static deleteProgramType(id: string): void { return referenceApi.deleteProgramType(id); }

  // --- SETTINGS ---
  static getSettings(): SystemSettings { return referenceApi.getSettings(); }
  static saveSettings(settings: Partial<SystemSettings>): SystemSettings { return referenceApi.saveSettings(settings); }

  // --- STORY EDIT LOCKS ---
  static getEditLocks(): EditLock[] {
    return getStored<EditLock[]>(COLLECTIONS.editLocks.storageKey, []);
  }

  /** Active lock on a story held by someone else (null when free or held by me). */
  static getForeignLock(entityId: string, collection: 'news' | 'episodes' | 'bulletinStories' = 'news'): EditLock | null {
    const me = authClient.getSession()?.user.id;
    const lock = this.getEditLocks().find((l) => l.id === lockIdFor(collection, entityId));
    return lock && isLockActive(lock) && lock.userId !== me ? lock : null;
  }

  /**
   * Acquires (or renews / takes over) the edit lock on a story and waits for the server's verdict.
   * Returns the server's lock, null if there is no lock, or undefined if sync is unconfirmed.
   */
  static async acquireNewsLock(entityId: string): Promise<EditLock | null | undefined> {
    return this.acquireEditLock('news', entityId);
  }

  static async acquireEditLock(collection: 'news' | 'episodes' | 'bulletinStories', entityId: string): Promise<EditLock | null | undefined> {
    const id = lockIdFor(collection, entityId);
    const locks = this.getEditLocks().filter((l) => l.id !== id);
    // `heartbeat` makes every renewal a real change; the server recomputes the expiry.
    locks.unshift({ id, collection, entityId, heartbeat: Date.now() } as EditLock);
    setStored(COLLECTIONS.editLocks.storageKey, locks);
    const outcome = await dataStore.awaitWrite('editLocks', id);
    if (outcome.pending) return undefined;
    return this.getEditLocks().find((l) => l.id === id) || null;
  }

  static releaseNewsLock(entityId: string): void {
    void this.releaseEditLock('news', entityId);
  }

  /**
   * Asks the server to drop the lock if, and only if, this user holds it. Works while the page is
   * unloading (keepalive) and before the local data has loaded, when the store cannot write yet.
   */
  static releaseEditLockOnServer(collection: 'news' | 'episodes' | 'bulletinStories', entityId: string): Promise<boolean> {
    return this.releaseLockIdOnServer(lockIdFor(collection, entityId));
  }

  static async releaseLockIdOnServer(id: string): Promise<boolean> {
    try {
      const response = await fetch('/api/v1/data/locks/release', {
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-NRCS-Client': 'web' },
        body: JSON.stringify({ id }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  static async releaseEditLock(collection: 'news' | 'episodes' | 'bulletinStories', entityId: string): Promise<boolean> {
    const id = lockIdFor(collection, entityId);
    const me = authClient.getSession()?.user.id;
    const locks = this.getEditLocks();
    const lock = locks.find((l) => l.id === id);
    // The store may not have received our lease yet. The direct endpoint checks the owner.
    if (!lock) return this.releaseLockIdOnServer(id);
    if (!isOwnLock(lock, me)) return true;
    setStored(COLLECTIONS.editLocks.storageKey, locks.filter((l) => l.id !== id));
    void dataStore.flush();
    return (await dataStore.awaitWrite('editLocks', id)).ok;
  }

  // --- REVISION HISTORY & TRASH ---
  static getNewsHistory(newsId: string): Promise<NewsRevision[]> { return newsApi.getNewsHistory(newsId); }
  static getDeletedNews(): NewsItem[] { return newsApi.getDeletedNews(); }
  static restoreNews(newsId: string): NewsItem { return newsApi.restoreNews(newsId); }

  // --- SHARED BROADCAST STATE ---
  static getBroadcastState(): BroadcastState {
    return getSnapshot<BroadcastState>(COLLECTIONS.broadcastState.storageKey, { liveLock: false });
  }

  /** On-air lock shared by all workstations; the server blocks deleting programs/episodes while set. */
  static setLiveLock(locked: boolean): BroadcastState {
    const user = this.getCurrentUser();
    if (!RbacService.hasPermission(user, 'rundown.lock_override')) {
      throw new Error('صلاحياتك لا تسمح بتغيير قفل البث المباشر');
    }
    const next: BroadcastState = locked
      ? { liveLock: true, lockedById: user.id, lockedByName: user.fullName, lockedAt: new Date().toISOString() }
      : { liveLock: false };
    setStored(COLLECTIONS.broadcastState.storageKey, next);
    // Audited by the server once the change is accepted (BROADCAST_LOCK / BROADCAST_UNLOCK).
    return next;
  }

  // --- INTERNAL CHAT ---
  /** Messages oldest-first (the server stores newest first). */
  static getMessages(): (ChatMessage & { isUrgent?: boolean })[] {
    return [...getSnapshot<ChatMessage[]>(COLLECTIONS.messages.storageKey, [])].reverse();
  }

  static sendMessage(channel: ChatMessage['channel'], text: string, isUrgent = false, extra: { attachments?: ChatAttachment[]; ref?: ChatRef } = {}): string {
    const me = this.getCurrentUser();
    const message = { id: newId('msg'), channel, text: text.trim(), isUrgent, ...(extra.attachments?.length ? { attachments: extra.attachments } : {}), ...(extra.ref ? { ref: extra.ref } : {}) };
    const error = messageError(message);
    if (error) throw new Error(error);
    const all = getStored<any[]>(COLLECTIONS.messages.storageKey, []);
    // Shown at once; the server stamps the author, the time and who may read it.
    all.unshift({ ...message, userId: me.id, userName: me.fullName, userAvatar: me.avatarUrl, timestamp: new Date().toISOString() });
    // keep the local window bounded; the server keeps the full history
    if (all.length > 3000) all.length = 3000;
    setStored(COLLECTIONS.messages.storageKey, all);
    return message.id;
  }

  /** Older messages of one conversation than this browser holds (oldest first). */
  static async loadOlderMessages(channel: string, before: string): Promise<ChatMessage[]> {
    const res = await apiFetch<{ data: ChatMessage[] }>(`/api/v1/chat/history?channel=${encodeURIComponent(channel)}&before=${encodeURIComponent(before)}`);
    return res.data;
  }

  // --- GROUP CONVERSATIONS ---
  static getConversations(): Conversation[] {
    const me = this.getCurrentUser().id;
    return getStored<Conversation[]>(COLLECTIONS.conversations.storageKey, []).filter((c) => !c.deletedAt && c.memberIds.includes(me));
  }

  /** Creates a group or changes its name and members, checked with the rules the server enforces. */
  static saveConversation(data: Pick<Conversation, 'name' | 'memberIds'> & { id?: string }): Conversation {
    const me = this.getCurrentUser();
    const all = getStored<Conversation[]>(COLLECTIONS.conversations.storageKey, []);
    const idx = data.id ? all.findIndex((c) => c.id === data.id) : -1;
    const before = idx === -1 ? null : all[idx];
    const after: Conversation = { ...(before || { id: newId('cnv'), ownerId: me.id, ownerName: me.fullName, createdAt: new Date().toISOString() }), name: data.name.trim(), memberIds: data.memberIds };
    const active = new Set(this.getUsers().filter((u) => u.isActive !== false && !u.deletedAt).map((u) => u.id));
    const error = conversationChangeError(before, after, me.id, RbacService.hasPermission(me, 'messages.groups'), active);
    if (error) throw new Error(error);
    if (idx === -1) setStored(COLLECTIONS.conversations.storageKey, [after, ...all]);
    else {
      all[idx] = after;
      setStored(COLLECTIONS.conversations.storageKey, all);
    }
    return after;
  }

  static leaveConversation(id: string): void {
    const me = this.getCurrentUser();
    const group = this.getConversations().find((c) => c.id === id);
    if (group) this.saveConversation({ id, name: group.name, memberIds: group.memberIds.filter((m) => m !== me.id) });
  }

  static deleteConversation(id: string): void {
    const all = getStored<Conversation[]>(COLLECTIONS.conversations.storageKey, []);
    const group = all.find((c) => c.id === id);
    if (!group || group.ownerId !== this.getCurrentUser().id) throw new Error('يحذف المجموعة منشئها');
    setStored(COLLECTIONS.conversations.storageKey, all.map((c) => (c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c)));
  }

  /** Where I have read up to in each conversation (shared by my devices). */
  static getChatReads(): ChatReads | undefined {
    const me = this.getCurrentUser().id;
    return getStored<ChatReads[]>(COLLECTIONS.chatReads.storageKey, []).find((r) => r.id === me);
  }

  static markChannelRead(channel: string, timestamp: string): void {
    const me = this.getCurrentUser().id;
    const all = getStored<ChatReads[]>(COLLECTIONS.chatReads.storageKey, []);
    const mine = all.find((r) => r.id === me) || { id: me, userId: me, seen: {} };
    if ((mine.seen[channel] || '') >= timestamp) return;
    const next: ChatReads = { ...mine, seen: { ...mine.seen, [channel]: timestamp } };
    if (chatReadsError(next, me)) return;
    setStored(COLLECTIONS.chatReads.storageKey, [next, ...all.filter((r) => r.id !== me)]);
    // Reading the conversation is reading its notification; the next message notifies again.
    this.markNotificationsReadFor(`/messages/${encodeURIComponent(channel)}`);
  }

  // --- NOTIFICATIONS ---
  static getNotifications(): AppNotification[] {
    return getStored<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
  }

  /** Notifications addressed to the signed-in user (the full list also holds ones sent to colleagues). */
  static getMyNotifications(): AppNotification[] {
    const me = this.getCurrentUser().id;
    return this.getNotifications().filter((n) => n.userId === me || n.userId === 'all');
  }

  static addNotification(item: Partial<AppNotification>): AppNotification {
    const all = this.getNotifications();
    const notif: AppNotification = {
      id: newId('notif'),
      userId: item.userId || this.getCurrentUser().id,
      title: item.title || 'إشعار جديد',
      message: item.message || '',
      type: item.type || 'SYSTEM',
      category: item.category || (item.type === 'TASK_ASSIGNED' ? 'assignment' : undefined),
      linkUrl: item.linkUrl,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    all.unshift(notif);
    setStored(STORAGE_KEYS.NOTIFICATIONS, all);
    return notif;
  }

  static markNotificationRead(id: string): void {
    const all = this.getNotifications();
    const me = this.getCurrentUser().id;
    const target = all.find((n) => n.id === id && n.userId === me);
    if (!target || target.isRead) return;
    target.isRead = true;
    setStored(STORAGE_KEYS.NOTIFICATIONS, all);
  }

  /** Marks my unread notifications that lead to one place as read (the place was just opened). */
  static markNotificationsReadFor(linkUrl: string): void {
    const all = this.getNotifications();
    const me = this.getCurrentUser().id;
    const mine = all.filter((n) => n.userId === me && !n.isRead && n.linkUrl === linkUrl && !requiresNotificationAcknowledgment(n));
    if (!mine.length) return;
    mine.forEach((n) => (n.isRead = true));
    setStored(STORAGE_KEYS.NOTIFICATIONS, all);
  }

  static markAllNotificationsRead(): void {
    const all = this.getNotifications();
    const me = this.getCurrentUser().id;
    all.forEach((n) => {
      if (n.userId === me && !requiresNotificationAcknowledgment(n)) n.isRead = true;
    });
    setStored(STORAGE_KEYS.NOTIFICATIONS, all);
  }

  // --- LOGGING ---
  static getActivityLogs(): ActivityLog[] {
    return getStored<ActivityLog[]>(STORAGE_KEYS.ACTIVITY_LOGS, []);
  }

  static logActivity(action: string, entityType: string, entityId: string, entityTitle: string, summaryAr: string): void {
    const all = this.getActivityLogs();
    const user = this.getCurrentUser();
    const newLog: ActivityLog = {
      id: newId('act'),
      userId: user.id,
      userName: user.fullName,
      userRole: user.role,
      userAvatar: user.avatarUrl,
      action,
      entityType,
      entityId,
      entityTitle,
      summaryAr,
      timestamp: new Date().toISOString(),
    };
    all.unshift(newLog);
    // keep max 200 logs
    if (all.length > 200) all.length = 200;
    setStored(STORAGE_KEYS.ACTIVITY_LOGS, all);
  }

  static getAuditLogs(): AuditLog[] {
    return getSnapshot<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  }

  // Audit entries are written by the server alone (see src/server/sync.ts and the auditLogs policy).

  // --- GLOBAL SEARCH ---
  /**
   * Unified search (Ctrl+K): every record type, Arabic-normalised and stem aware, best match first
   * (title matches above body matches, newest first on equal relevance).
   */
  static globalSearch(query: string): GlobalSearchResult {
    if (!query.trim()) {
      return { news: [], programs: [], episodes: [], guests: [], tasks: [], bulletins: [], cards: [] };
    }
    const ranked = <T extends { updatedAt?: string; createdAt?: string }>(index: SearchIndex<T>, items: T[]) =>
      index
        .search(items, query)
        .sort((a, b) => b.score - a.score || String(b.item.updatedAt || b.item.createdAt || '').localeCompare(String(a.item.updatedAt || a.item.createdAt || '')))
        .map((h) => h.item);
    return {
      news: ranked(GLOBAL_INDEX.news, this.getNews()),
      programs: ranked(GLOBAL_INDEX.programs, this.getPrograms() as Array<Program & { createdAt?: string }>),
      episodes: ranked(GLOBAL_INDEX.episodes, this.getEpisodes() as Array<Episode & { createdAt?: string }>),
      guests: ranked(GLOBAL_INDEX.guests, this.getGuests() as Array<Guest & { createdAt?: string }>),
      tasks: ranked(GLOBAL_INDEX.tasks, this.getTasks() as Array<EditorialTask & { createdAt?: string }>),
      bulletins: ranked(GLOBAL_INDEX.bulletins, this.getBulletins()),
      cards: ranked(GLOBAL_INDEX.cards, this.getCards()),
    };
  }

  /** Words of the records the unified search covers, for «هل تقصد» and suggestions. */
  static searchVocabularyTexts(): string[] {
    const out: string[] = [];
    const push = (...v: unknown[]) => v.forEach((x) => { if (Array.isArray(x)) x.forEach((y) => push(y)); else if (x) out.push(String(x)); });
    this.getNews().forEach((n) => push(n.title, n.shortTitle, n.summary, n.keywords, n.locationName, n.categoryName));
    this.getPrograms().forEach((p) => push(p.name, p.presenterName, p.producerName));
    this.getEpisodes().forEach((e) => push(e.title, e.programName));
    this.getGuests().forEach((g) => push(g.fullName, g.organization, g.jobTitle, g.specialty));
    this.getTasks().forEach((t) => push(t.title));
    this.getBulletins().forEach((b) => push(b.title));
    this.getCards().forEach((c) => push(c.title, c.ownerName));
    return out;
  }

  // --- SQLITE DATABASE OPERATIONS (server administration) ---

  static async getDbStats(): Promise<DbStats & { sqlConsoleEnabled?: boolean; resetEnabled?: boolean; confirmationTotpRequired?: boolean }> {
    const res = await apiFetch<{ data: DbStats }>('/api/v1/db/stats');
    return res.data;
  }

  static async executeSqlQuery(query: string): Promise<SqlQueryResult> {
    try {
      const res = await apiFetch<{ data: SqlQueryResult }>('/api/v1/db/query', { method: 'POST', json: { query } });
      return res.data;
    } catch (err: any) {
      return { columns: ['Error'], values: [[err.message]], rowCount: 0, executionTimeMs: 0, error: err.message } as SqlQueryResult;
    }
  }

  static async resetDatabase(confirmationToken: string, localAirEnded: boolean): Promise<DbStats> {
    const res = await apiFetch<{ data: DbStats }>('/api/v1/db/reset', { method: 'POST', json: { confirmationToken, localAirEnded }, confirmationErrors: true });
    await dataStore.pull();
    return res.data;
  }

  static async getBackups(): Promise<DbBackupFileInfo[]> {
    const res = await apiFetch<{ data: DbBackupFileInfo[] }>('/api/v1/db/backups');
    return res.data;
  }
  static async getBackupStatus(): Promise<BackupStatus> {
    return (await apiFetch<{ data: BackupStatus }>('/api/v1/db/backup-status')).data;
  }
  static async getServerErrors(): Promise<RecentServerErrors> {
    return (await apiFetch<{ data: RecentServerErrors }>('/api/v1/db/errors')).data;
  }
  static async getDatabaseDiagnostics(): Promise<DatabaseDiagnosticReport> {
    return (await apiFetch<{ data: DatabaseDiagnosticReport }>('/api/v1/db/diagnostics')).data;
  }
  static async verifyBackup(fileName: string): Promise<BackupVerification> {
    return (await apiFetch<{ data: BackupVerification }>('/api/v1/db/backups/verify', { method: 'POST', json: { fileName } })).data;
  }
  static async rehearseBackup(fileName: string): Promise<BackupRehearsal> {
    return (await apiFetch<{ data: BackupRehearsal }>('/api/v1/db/backups/rehearse', { method: 'POST', json: { fileName } })).data;
  }
  static async confirmDatabaseOperation(input: { action: 'restore' | 'reset'; fileName?: string; password: string; totp?: string }): Promise<{ token: string; expiresAt: string }> {
    return (await apiFetch<{ data: { token: string; expiresAt: string } }>('/api/v1/db/confirm-operation', { method: 'POST', json: input, confirmationErrors: true })).data;
  }

  /** Sends the one-time confirmation in the request body before reading the file. */
  static async downloadConfirmedDatabase(kind: 'download' | 'export', input: { fileName?: string; password: string; totp?: string }) {
    const { token } = (await apiFetch<{ data: { token: string } }>('/api/v1/db/confirm-operation', { method: 'POST', json: { action: kind, ...input }, confirmationErrors: true })).data;
    return downloadDatabaseFile(kind === 'download' ? '/api/v1/db/backups/download' : '/api/v1/db/export', {
      fileName: input.fileName, confirmationToken: token,
    });
  }

  /** Colleagues, general managers and open card steps still belonging to a station. */
  static getStationUsage(stationId: string): Promise<{ members: { id: string; fullName: string }[]; managers: { id: string; fullName: string }[]; openSteps: { cardId: string; cardTitle: string; stepId: string; assigneeName?: string }[]; openCardsOwned: number; localDepartments?: { id: string; name: string }[] }> {
    return referenceApi.getStationUsage(stationId);
  }

  /** Removes a station on the server, moving its colleagues and open work to `replacementId`. */
  static removeStation(stationId: string, replacementId?: string): Promise<{ movedUsers: number; movedSteps: number }> {
    return referenceApi.removeStation(stationId, replacementId);
  }

  static async createBackup(): Promise<DbBackupFileInfo | null> {
    const res = await apiFetch<{ data: DbBackupFileInfo }>('/api/v1/db/backups', { method: 'POST' });
    return res.data;
  }

  static async restoreBackup(fileName: string, confirmationToken: string, localAirEnded: boolean): Promise<DbStats> {
    const res = await apiFetch<{ data: DbStats }>('/api/v1/db/backups/restore', { method: 'POST', json: { fileName, confirmationToken, localAirEnded }, confirmationErrors: true });
    await dataStore.pull();
    return res.data;
  }

  static runSelfHealingDiagnostics(logActivity = true) {
    return selfHealingService.runFullDiagnosticsAndRepair(logActivity);
  }

  static getSelfHealingReport() {
    return selfHealingService.getLastReport();
  }

  static getStorageQuota() {
    return selfHealingService.getStorageMetrics();
  }

  /** Pushes pending local edits now; resolves true when everything reached the server. */
  static async flushSync(): Promise<boolean> {
    await dataStore.flush();
    return dataStore.pendingCount() === 0;
  }

  static getMosExportUrl(episodeId: string): string {
    return `/api/v1/episodes/${encodeURIComponent(episodeId)}/export/mos`;
  }

  // JSON export/import of the collections the current user can see.
  static exportClientBackup(): string {
    const backupData: Record<string, any> = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      station: this.getSettings().organizationName,
      data: {},
    };
    Object.entries(STORAGE_KEYS).forEach(([keyName, storageKey]) => {
      backupData.data[keyName] = getStored<any>(storageKey, null);
    });
    return JSON.stringify(backupData, null, 2);
  }

  /**
   * Imports a JSON backup *additively*: only records whose id does not exist yet are added
   * (through the normal sync path, so server permissions still apply). Existing records,
   * accounts, settings and logs are never overwritten, so newer work by colleagues is safe.
   */
  static restoreClientBackup(jsonString: string): { added: number; skipped: number } {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed.data !== 'object') {
      throw new Error('الملف غير صالح أو لا يحتوي على بنية بيانات صحيحة');
    }
    const NEVER_IMPORT = new Set(['USERS', 'SETTINGS', 'NOTIFICATIONS', 'AUDIT_LOGS', 'ACTIVITY_LOGS']);
    let added = 0;
    let skipped = 0;
    Object.entries(STORAGE_KEYS).forEach(([keyName, storageKey]) => {
      const incoming = parsed.data[keyName];
      if (!Array.isArray(incoming)) return;
      if (NEVER_IMPORT.has(keyName)) {
        skipped += incoming.length;
        return;
      }
      const current = getStored<any[]>(storageKey, []);
      const existing = new Set(current.map((it) => it.id));
      const fresh = incoming.filter((it: any) => it && typeof it.id === 'string' && !existing.has(it.id));
      skipped += incoming.length - fresh.length;
      if (fresh.length) {
        setStored(storageKey, [...current, ...fresh]);
        added += fresh.length;
      }
    });
    return { added, skipped };
  }
}

export const apiService = ApiService;
