import {
  NewsItem,
  Story,
  NewsStatus,
  NewsPriority,
  Program,
  Episode,
  RundownSegment,
  Guest,
  EditorialTask,
  MediaFile,
  BreakingNews,
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
  ProgramEvaluation,
} from '../types';

import { INITIAL_SETTINGS } from './mockData';
import { dataStore } from './dataStore';
import { authClient } from './authClient';
import { apiFetch } from './http';
import { newId } from '../shared/ids';
import { COLLECTIONS, BroadcastState, ChatMessage } from '../shared/collections';
import { RbacService } from './rbacService';
export { formatSecondsToTime, parseTimeToSeconds, recalculateRundown } from '../shared/rundown';
import { recalculateRundown } from '../shared/rundown';

import { selfHealingService } from './selfHealingService';

// Storage keys of the server-synchronised collections (see src/shared/collections.ts).
const STORAGE_KEYS = {
  USERS: COLLECTIONS.users.storageKey,
  NEWS: COLLECTIONS.news.storageKey,
  STORIES: COLLECTIONS.stories.storageKey,
  BREAKING: COLLECTIONS.breaking.storageKey,
  PROGRAMS: COLLECTIONS.programs.storageKey,
  PROGRAM_EVALUATIONS: COLLECTIONS.programEvaluations.storageKey,
  EPISODES: COLLECTIONS.episodes.storageKey,
  GUESTS: COLLECTIONS.guests.storageKey,
  TASKS: COLLECTIONS.tasks.storageKey,
  MEDIA: COLLECTIONS.media.storageKey,
  CATEGORIES: COLLECTIONS.categories.storageKey,
  SOURCES: COLLECTIONS.sources.storageKey,
  PROGRAM_TYPES: COLLECTIONS.programTypes.storageKey,
  NOTIFICATIONS: COLLECTIONS.notifications.storageKey,
  ACTIVITY_LOGS: COLLECTIONS.activityLogs.storageKey,
  AUDIT_LOGS: COLLECTIONS.auditLogs.storageKey,
  SETTINGS: COLLECTIONS.settings.storageKey,
};

/**
 * Reads come from the in-memory mirror of the server database; writes are diffed
 * and synchronised to SQLite on the server (with conflict detection).
 */
function getStored<T>(key: string, defaultVal: T): T {
  return dataStore.get<T>(key, defaultVal);
}

function setStored<T>(key: string, val: T): void {
  dataStore.set(key, val);
}

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

export class ApiService {
  // --- AUTH & CURRENT USER ---
  /** The signed-in user (kept fresh from the synchronised users collection). */
  static getCurrentUser(): User {
    const session = authClient.getSession();
    if (!session) throw new Error('لا توجد جلسة دخول نشطة');
    const fresh = this.getUsers().find((u) => u.id === session.user.id);
    return fresh || session.user;
  }

  static getUsers(): User[] {
    return getStored<User[]>(STORAGE_KEYS.USERS, []);
  }

  static getUserById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  }

  static saveUser(user: Partial<User> & { id?: string }): User {
    const users = this.getUsers();
    if (user.id) {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx !== -1) {
        users[idx] = { ...users[idx], ...user };
        setStored(STORAGE_KEYS.USERS, users);
        this.logAudit('SETTINGS_UPDATE', 'USER', user.id, 'INFO', `تحديث بيانات المستخدم: ${user.fullName}`);
        return users[idx];
      }
    }
    const newUser: User = {
      id: user.id || newId('usr'),
      fullName: user.fullName || 'مستخدم جديد',
      fullNameEn: user.fullNameEn,
      email: user.email || `user${Date.now()}@akhbar.tv`,
      phone: user.phone || '',
      role: user.role || 'JOURNALIST',
      customRoleId: user.customRoleId,
      avatarUrl: user.avatarUrl || '/avatar.svg',
      jobTitle: user.jobTitle || 'صحفي',
      department: user.department || 'غرفة الأخبار',
      staffId: user.staffId || '',
      securityClearance: user.securityClearance || 'CONFIDENTIAL',
      shift: user.shift || 'MORNING',
      bio: user.bio || '',
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      lastLogin: new Date().toISOString(),
      customPermissions: user.customPermissions || [],
      isActive: user.isActive !== undefined ? user.isActive : true,
      createdAt: user.createdAt || new Date().toISOString(),
    };
    users.push(newUser);
    setStored(STORAGE_KEYS.USERS, users);
    this.logAudit('SETTINGS_UPDATE', 'USER', newUser.id, 'INFO', `إضافة مستخدم جديد: ${newUser.fullName} (${newUser.role})`);
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
    this.logAudit('SETTINGS_UPDATE', 'USER', id, 'WARNING', `تم حذف حساب المستخدم: ${target.fullName}`);
    return true;
  }

  static toggleUserStatus(id: string): User | null {
    const users = this.getUsers();
    const current = this.getCurrentUser();
    if (current.id === id) {
      throw new Error('لا يمكن تجميد حسابك النشط');
    }
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;

    users[idx].isActive = !users[idx].isActive;
    setStored(STORAGE_KEYS.USERS, users);
    this.logAudit(
      'SETTINGS_UPDATE',
      'USER',
      id,
      'INFO',
      `تم ${users[idx].isActive ? 'تنشيط' : 'تجميد'} حساب المستخدم: ${users[idx].fullName}`
    );
    return users[idx];
  }

  // --- NEWS CRUD & WORKFLOW ---
  static getNews(): NewsItem[] {
    const items = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    return items.filter((n) => !n.deletedAt);
  }

  static getNewsById(id: string): NewsItem | undefined {
    return this.getNews().find((n) => n.id === id);
  }

  static saveNews(newsData: Partial<NewsItem>, user?: User): NewsItem {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    // --- RBAC Validation ---
    const requestedStatus = newsData.status;
    if (requestedStatus) {
      if (requestedStatus === 'APPROVED' && !RbacService.hasPermission(currentUser, 'news.approve')) {
         this.logAudit('SECURITY_VIOLATION', 'NEWS', newsData.id || 'new', 'CRITICAL', `محاولة غير مصرح بها لحفظ الخبر كمعتمد من قبل: ${currentUser.fullName} (${currentUser.role})`);
         throw new Error('عذراً، صلاحياتك لا تسمح بحفظ الخبر كمعتمد.');
      }
      if (requestedStatus === 'PUBLISHED' && !RbacService.hasPermission(currentUser, 'news.publish')) {
         this.logAudit('SECURITY_VIOLATION', 'NEWS', newsData.id || 'new', 'CRITICAL', `محاولة غير مصرح بها لنشر الخبر مباشرة من قبل: ${currentUser.fullName} (${currentUser.role})`);
         throw new Error('عذراً، صلاحياتك لا تسمح بنشر الخبر.');
      }
    }
    const existing = newsData.id ? all.find((n) => n.id === newsData.id) : undefined;
    if (newsData.isBreaking && !existing?.isBreaking && !RbacService.hasPermission(currentUser, 'news.breaking_push')) {
      throw new Error('عذراً، صلاحياتك لا تسمح بإطلاق الأخبار العاجلة.');
    }
    // -----------------------

    if (newsData.id) {
      const idx = all.findIndex((n) => n.id === newsData.id);
      if (idx !== -1) {
        const old = all[idx];
        const updated: NewsItem = {
          ...old,
          ...newsData,
          updatedAt: now,
        };
        all[idx] = updated;
        setStored(STORAGE_KEYS.NEWS, all);
        this.logActivity('تعديل خبر', 'NEWS', updated.id, updated.title, `قام ${currentUser.fullName} بتحديث محتوى الخبر.`);
        return updated;
      }
    }

    const newsId = newId('nws');
    const newItem: NewsItem = {
      id: newsId,
      title: newsData.title || 'عنوان الخبر بدون اسم',
      shortTitle: newsData.shortTitle || newsData.title || '',
      slug: (newsData.title || 'news-item').toLowerCase().replace(/\s+/g, '-'),
      content: newsData.content || '',
      summary: newsData.summary || '',
      mainImageUrl: newsData.mainImageUrl || '',
      videoUrl: newsData.videoUrl,
      sourceId: newsData.sourceId || 'src-1',
      sourceName: newsData.sourceName || 'المراسل الميداني',
      categoryId: newsData.categoryId || 'cat-1',
      categoryName: newsData.categoryName || 'سياسة',
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      priority: newsData.priority || 'NORMAL',
      status: newsData.status || 'DRAFT',
      keywords: newsData.keywords || [],
      locationName: newsData.locationName || 'المقر الرئيسي',
      eventDate: newsData.eventDate || now,
      isBreaking: !!newsData.isBreaking,
      breakingUntil: newsData.breakingUntil,
      internalNotes: newsData.internalNotes || '',
      workflowLogs: [
        {
          id: newId('log'),
          newsId,
          fromStatus: 'DRAFT',
          toStatus: newsData.status || 'DRAFT',
          changedBy: { id: currentUser.id, name: currentUser.fullName, role: currentUser.role },
          comment: 'إنشاء الخبر لأول مرة',
          timestamp: now,
        },
      ],
      viewsCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    all.unshift(newItem);
    setStored(STORAGE_KEYS.NEWS, all);
    this.logActivity('إنشاء خبر', 'NEWS', newItem.id, newItem.title, `قام ${currentUser.fullName} بإنشاء خبر جديد.`);

    if (newItem.isBreaking) {
      this.addBreakingNews({
        title: newItem.title,
        newsId: newItem.id,
        priority: newItem.priority === 'URGENT' ? 'CRITICAL' : 'HIGH',
      });
    }

    return newItem;
  }

  static updateNewsStatus(newsId: string, toStatus: NewsStatus, userOrComment?: User | string, optionalComment?: string): NewsItem {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx === -1) throw new Error('الخبر غير موجود');

    const currentUser = typeof userOrComment === 'object' && userOrComment !== null ? userOrComment : this.getCurrentUser();
    const comment = typeof userOrComment === 'string' ? userOrComment : optionalComment;

    // --- RBAC Validation ---
    if (toStatus === 'APPROVED' && !RbacService.hasPermission(currentUser, 'news.approve')) {
      this.logAudit('SECURITY_VIOLATION', 'NEWS', newsId, 'CRITICAL', `محاولة غير مصرح بها لاعتماد الخبر من قبل: ${currentUser.fullName} (${currentUser.role})`);
      throw new Error('عذراً، صلاحياتك لا تسمح باعتماد الأخبار. يتطلب ذلك صلاحية EDITOR.');
    }

    if (toStatus === 'PUBLISHED' && !RbacService.hasPermission(currentUser, 'news.publish')) {
      this.logAudit('SECURITY_VIOLATION', 'NEWS', newsId, 'CRITICAL', `محاولة غير مصرح بها لنشر الخبر من قبل: ${currentUser.fullName} (${currentUser.role})`);
      throw new Error('عذراً، صلاحياتك لا تسمح بنشر الأخبار. يتطلب ذلك صلاحية PUBLISHER أو EDITOR.');
    }
    // -----------------------

    const item = all[idx];
    const fromStatus = item.status;
    const now = new Date().toISOString();

    const logEntry = {
      id: newId('log'),
      newsId: item.id,
      fromStatus,
      toStatus,
      changedBy: { id: currentUser.id, name: currentUser.fullName, role: currentUser.role },
      comment: comment || `تغيير الحالة إلى ${toStatus}`,
      timestamp: now,
    };

    const updated: NewsItem = {
      ...item,
      status: toStatus,
      workflowLogs: [...item.workflowLogs, logEntry],
      publishDate: toStatus === 'PUBLISHED' && !item.publishDate ? now : item.publishDate,
      editorId: ['APPROVED', 'PUBLISHED'].includes(toStatus) ? currentUser.id : item.editorId,
      editorName: ['APPROVED', 'PUBLISHED'].includes(toStatus) ? currentUser.fullName : item.editorName,
      updatedAt: now,
    };

    all[idx] = updated;
    setStored(STORAGE_KEYS.NEWS, all);

    this.logActivity(
      'تحديث حالة الخبر',
      'NEWS',
      item.id,
      item.title,
      `قام ${currentUser.fullName} بنقل الخبر من [${fromStatus}] إلى [${toStatus}]`
    );

    if (toStatus === 'PUBLISHED') {
      this.logAudit('PUBLISH', 'NEWS', item.id, 'INFO', `نشر الخبر رسمياً: ${item.title}`);
    } else if ((fromStatus as string) === 'PUBLISHED' && (toStatus as string) !== 'PUBLISHED') {
      this.logAudit('UNPUBLISH', 'NEWS', item.id, 'WARNING', `إلغاء نشر الخبر: ${item.title}`);
    }

    return updated;
  }

  static deleteNews(newsId: string, user?: User): void {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const idx = all.findIndex((n) => n.id === newsId);
    if (idx !== -1) {
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.NEWS, all);
      const currentUser = user || this.getCurrentUser();
      this.logAudit('DELETE', 'NEWS', newsId, 'WARNING', `حذف (Soft Delete) للخبر بواسطة ${currentUser.fullName}`);
    }
  }

  static bulkActionNews(newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE'): void {
    const all = getStored<NewsItem[]>(STORAGE_KEYS.NEWS, []);
    const currentUser = this.getCurrentUser();
    const now = new Date().toISOString();

    all.forEach((item) => {
      if (newsIds.includes(item.id)) {
        if (action === 'DELETE') {
          item.deletedAt = now;
        } else if (action === 'PUBLISH') {
          item.status = 'PUBLISHED';
          item.publishDate = now;
        } else if (action === 'APPROVE') {
          item.status = 'APPROVED';
        } else if (action === 'ARCHIVE') {
          item.status = 'ARCHIVED';
        }
        item.updatedAt = now;
      }
    });

    setStored(STORAGE_KEYS.NEWS, all);
    this.logActivity(
      'عملية مجمعة على الأخبار',
      'NEWS',
      'bulk',
      `${newsIds.length} أخبار`,
      `قام ${currentUser.fullName} بتطبيق الإجراء (${action}) على ${newsIds.length} من الأخبار.`
    );
  }

  // --- BREAKING NEWS ---
  static getBreakingNews(): BreakingNews[] {
    return getStored<BreakingNews[]>(STORAGE_KEYS.BREAKING, []);
  }

  static getActiveBreakingNews(): BreakingNews[] {
    return this.getBreakingNews().filter((b) => b.isActive);
  }

  static addBreakingNews(item: Partial<BreakingNews>): BreakingNews {
    const all = this.getBreakingNews();
    const currentUser = this.getCurrentUser();
    const now = new Date();
    const expires = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours

    const newBrk: BreakingNews = {
      id: newId('brk'),
      title: item.title || 'خبر عاجل بدون نص',
      newsId: item.newsId,
      priority: item.priority || 'HIGH',
      isActive: true,
      startedAt: now.toISOString(),
      expiresAt: item.expiresAt || expires.toISOString(),
      createdBy: currentUser.fullName,
    };

    all.unshift(newBrk);
    setStored(STORAGE_KEYS.BREAKING, all);
    this.logActivity('إضافة خبر عاجل', 'BREAKING_NEWS', newBrk.id, newBrk.title, `تم إطلاق خبر عاجل جديد على شريط البث.`);
    return newBrk;
  }

  static toggleBreakingNews(id: string): BreakingNews | undefined {
    const all = this.getBreakingNews();
    const item = all.find((b) => b.id === id);
    if (item) {
      item.isActive = !item.isActive;
      setStored(STORAGE_KEYS.BREAKING, all);
      this.logActivity('تبديل حالة خبر عاجل', 'BREAKING_NEWS', id, item.title, `تم ${item.isActive ? 'تفعيل' : 'إيقاف'} الخبر العاجل.`);
      return item;
    }
    return undefined;
  }

  // --- PROGRAMS & EPISODES ---
  static getPrograms(): Program[] {
    const items = getStored<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    return items.filter((p) => !p.deletedAt);
  }

  static getProgramById(id: string): Program | undefined {
    return this.getPrograms().find((p) => p.id === id);
  }

  static saveProgram(program: Partial<Program>, user?: User): Program {
    const all = getStored<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    if (program.id) {
      const idx = all.findIndex((p) => p.id === program.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...program };
        setStored(STORAGE_KEYS.PROGRAMS, all);
        this.logActivity('تعديل برنامج', 'PROGRAM', program.id, all[idx].name, `تم تعديل بيانات برنامج: ${all[idx].name}`);
        return all[idx];
      }
    }

    const newPrg: Program = {
      id: newId('prg'),
      name: program.name || 'برنامج جديد',
      shortName: program.shortName || program.name || '',
      description: program.description || '',
      coverImageUrl: program.coverImageUrl || '',
      typeId: program.typeId || 'pt-1',
      typeName: program.typeName || 'نشرة إخبارية',
      presenterId: program.presenterId || currentUser.id,
      presenterName: program.presenterName || currentUser.fullName,
      producerId: program.producerId || currentUser.id,
      producerName: program.producerName || currentUser.fullName,
      teamMembers: program.teamMembers || [currentUser.fullName],
      broadcastDays: program.broadcastDays || ['الأحد'],
      broadcastTime: program.broadcastTime || '20:00',
      durationMinutes: program.durationMinutes || 50,
      channelName: program.channelName || 'القناة الإخبارية الأولى',
      studioName: program.studioName || 'استوديو الأخبار الرئيسي (A1)',
      status: 'ACTIVE',
      episodesCount: 0,
      createdAt: now,
    };

    all.unshift(newPrg);
    setStored(STORAGE_KEYS.PROGRAMS, all);
    this.logActivity('إنشاء برنامج', 'PROGRAM', newPrg.id, newPrg.name, `تم إضافة برنامج جديد: ${newPrg.name}`);
    return newPrg;
  }

  static deleteProgram(id: string, user?: User): void {
    const all = getStored<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    const idx = all.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const progName = all[idx].name;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.PROGRAMS, all);
      const currentUser = user || this.getCurrentUser();
      this.logActivity('حذف برنامج', 'PROGRAM', id, progName, `قام ${currentUser.fullName} بحذف البرنامج: ${progName}`);
    }
  }

  // --- PROGRAM EVALUATIONS ---
  static getProgramEvaluations(programId: string): ProgramEvaluation[] {
    const all = getStored<ProgramEvaluation[]>(STORAGE_KEYS.PROGRAM_EVALUATIONS, []);
    return all.filter((e) => e.programId === programId).sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime());
  }

  static getAllProgramEvaluations(): ProgramEvaluation[] {
    return getStored<ProgramEvaluation[]>(STORAGE_KEYS.PROGRAM_EVALUATIONS, []);
  }

  static addProgramEvaluation(evalData: Partial<ProgramEvaluation>, user?: User): ProgramEvaluation {
    const all = this.getAllProgramEvaluations();
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    const criteria = evalData.criteria || {
      editorialQuality: 5,
      timeCommitment: 5,
      guestRelevance: 5,
      visualDirection: 5,
      viewerEngagement: 5,
    };

    // Calculate overall rating from criteria if not explicitly set
    const values = Object.values(criteria);
    const calculatedAvg = values.length > 0 ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 5;
    const overallRating = evalData.overallRating || calculatedAvg;

    const newEval: ProgramEvaluation = {
      id: newId('eval'),
      programId: evalData.programId || 'prg-1',
      episodeId: evalData.episodeId,
      evaluatorId: currentUser.id,
      evaluatorName: currentUser.fullName,
      evaluatorRole: currentUser.jobTitle || 'عضو هيئة التحرير والتقييم',
      overallRating,
      criteria,
      strengths: evalData.strengths || [],
      improvements: evalData.improvements || [],
      notes: evalData.notes || '',
      evaluatedAt: now,
    };

    all.unshift(newEval);
    setStored(STORAGE_KEYS.PROGRAM_EVALUATIONS, all);

    const prog = this.getProgramById(newEval.programId);
    this.logActivity(
      'تقييم برنامج',
      'PROGRAM',
      newEval.programId,
      prog ? prog.name : 'برنامج',
      `أضاف ${currentUser.fullName} تقييماً تحريرياً جديداً للبرنامج (${overallRating}/5)`
    );

    return newEval;
  }

  static getProgramRatingSummary(programId: string): {
    average: number;
    count: number;
    criteriaAverages: {
      editorialQuality: number;
      timeCommitment: number;
      guestRelevance: number;
      visualDirection: number;
      viewerEngagement: number;
    };
  } {
    const evals = this.getProgramEvaluations(programId);
    if (evals.length === 0) {
      return {
        average: 4.5,
        count: 0,
        criteriaAverages: {
          editorialQuality: 4.5,
          timeCommitment: 4.5,
          guestRelevance: 4.5,
          visualDirection: 4.5,
          viewerEngagement: 4.5,
        },
      };
    }

    const avg = Number((evals.reduce((sum, e) => sum + e.overallRating, 0) / evals.length).toFixed(1));

    const criteriaTotals = {
      editorialQuality: 0,
      timeCommitment: 0,
      guestRelevance: 0,
      visualDirection: 0,
      viewerEngagement: 0,
    };

    evals.forEach((e) => {
      criteriaTotals.editorialQuality += e.criteria.editorialQuality;
      criteriaTotals.timeCommitment += e.criteria.timeCommitment;
      criteriaTotals.guestRelevance += e.criteria.guestRelevance;
      criteriaTotals.visualDirection += e.criteria.visualDirection;
      criteriaTotals.viewerEngagement += e.criteria.viewerEngagement;
    });

    return {
      average: avg,
      count: evals.length,
      criteriaAverages: {
        editorialQuality: Number((criteriaTotals.editorialQuality / evals.length).toFixed(1)),
        timeCommitment: Number((criteriaTotals.timeCommitment / evals.length).toFixed(1)),
        guestRelevance: Number((criteriaTotals.guestRelevance / evals.length).toFixed(1)),
        visualDirection: Number((criteriaTotals.visualDirection / evals.length).toFixed(1)),
        viewerEngagement: Number((criteriaTotals.viewerEngagement / evals.length).toFixed(1)),
      },
    };
  }

  static getEpisodes(): Episode[] {
    const items = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    return items.filter((e) => !e.deletedAt);
  }

  static getEpisodeById(id: string): Episode | undefined {
    return this.getEpisodes().find((e) => e.id === id);
  }

  static saveEpisode(episodeData: Partial<Episode>, user?: User): Episode {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    if (episodeData.id) {
      const idx = all.findIndex((e) => e.id === episodeData.id);
      if (idx !== -1) {
        all[idx] = {
          ...all[idx],
          ...episodeData,
          updatedAt: now,
        };
        setStored(STORAGE_KEYS.EPISODES, all);
        this.logActivity('تعديل حلقة', 'EPISODE', all[idx].id, all[idx].title, `قام ${currentUser.fullName} بتحديث بيانات الحلقة.`);
        return all[idx];
      }
    }

    const newEp: Episode = {
      id: newId('ep'),
      programId: episodeData.programId || 'prg-1',
      programName: episodeData.programName || 'المشهد السياسي',
      seasonNumber: episodeData.seasonNumber || 1,
      episodeNumber: episodeData.episodeNumber || 1,
      title: episodeData.title || 'حلقة جديدة',
      description: episodeData.description || '',
      recordingDate: episodeData.recordingDate || now.slice(0, 10),
      broadcastDate: episodeData.broadcastDate || now.slice(0, 10),
      startTime: episodeData.startTime || '21:00',
      endTime: episodeData.endTime || '21:50',
      durationMinutes: episodeData.durationMinutes || 50,
      presenterId: episodeData.presenterId || currentUser.id,
      presenterName: episodeData.presenterName || currentUser.fullName,
      producerId: episodeData.producerId || currentUser.id,
      producerName: episodeData.producerName || currentUser.fullName,
      directorName: episodeData.directorName || 'مخرج الحلقة',
      studioName: episodeData.studioName || 'استوديو A1',
      introScript: episodeData.introScript || '',
      discussionTopics: episodeData.discussionTopics || [],
      status: episodeData.status || 'PLANNING',
      guests: episodeData.guests || [],
      questions: episodeData.questions || [],
      rundown: episodeData.rundown || [],
      linkedNewsIds: episodeData.linkedNewsIds || [],
      attachments: episodeData.attachments || [],
      createdAt: now,
      updatedAt: now,
    };

    all.unshift(newEp);
    setStored(STORAGE_KEYS.EPISODES, all);
    this.logActivity('إنشاء حلقة جديدة', 'EPISODE', newEp.id, newEp.title, `تم إنشاء حلقة جديدة برقم ${newEp.episodeNumber}`);
    return newEp;
  }

  static deleteEpisode(id: string, user?: User): void {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const idx = all.findIndex((e) => e.id === id);
    if (idx !== -1) {
      const epTitle = all[idx].title;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.EPISODES, all);
      const currentUser = user || this.getCurrentUser();
      this.logActivity('حذف حلقة', 'EPISODE', id, epTitle, `قام ${currentUser.fullName} بحذف الحلقة: ${epTitle}`);
    }
  }

  // --- RUNDOWN MANAGEMENT ---
  static updateEpisodeRundown(episodeId: string, rundown: RundownSegment[], user?: User): Episode {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const idx = all.findIndex((e) => e.id === episodeId);
    if (idx === -1) throw new Error('الحلقة غير موجودة');

    const calculated = recalculateRundown(rundown);
    all[idx].rundown = calculated;
    all[idx].updatedAt = new Date().toISOString();
    setStored(STORAGE_KEYS.EPISODES, all);

    const currentUser = user || this.getCurrentUser();
    this.logActivity(
      'تحديث جدول الرانداون',
      'EPISODE',
      episodeId,
      all[idx].title,
      `قام ${currentUser.fullName} بتحديث فقرات الرانداون (${calculated.length} فقرة)`
    );

    return all[idx];
  }

  static addRundownSegment(episodeId: string, segment: Partial<RundownSegment>): Episode {
    const episode = this.getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const newSegment: RundownSegment = {
      id: newId('seg'),
      episodeId,
      orderIndex: (episode.rundown?.length || 0) + 1,
      title: segment.title || 'فقرة جديدة',
      segmentType: segment.segmentType || 'REPORT',
      startTimeOffset: '00:00:00',
      durationSeconds: segment.durationSeconds || 180,
      endTimeOffset: '00:03:00',
      presenterName: segment.presenterName || episode.presenterName,
      guestId: segment.guestId,
      guestName: segment.guestName,
      scriptText: segment.scriptText || '',
      videoAssetUrl: segment.videoAssetUrl,
      newsId: segment.newsId,
      newsTitle: segment.newsTitle,
      notes: segment.notes || '',
      isCompleted: false,
    };

    const updatedRundown = [...(episode.rundown || []), newSegment];
    return this.updateEpisodeRundown(episodeId, updatedRundown);
  }

  static deleteRundownSegment(episodeId: string, segmentId: string): Episode {
    const episode = this.getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const filtered = (episode.rundown || []).filter((s) => s.id !== segmentId);
    return this.updateEpisodeRundown(episodeId, filtered);
  }

  // --- QUESTIONS & TOPICS ---
  static saveEpisodeQuestion(episodeId: string, question: Partial<EpisodeQuestion>): Episode {
    const episode = this.getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const questions = [...(episode.questions || [])];
    if (question.id) {
      const qIdx = questions.findIndex((q) => q.id === question.id);
      if (qIdx !== -1) {
        questions[qIdx] = { ...questions[qIdx], ...question };
      }
    } else {
      questions.push({
        id: newId('q'),
        episodeId,
        topicName: question.topicName || 'محور عام',
        questionText: question.questionText || '',
        orderIndex: questions.length + 1,
        assignedToName: question.assignedToName || '',
        notes: question.notes || '',
        isAsked: false,
      });
    }

    return this.saveEpisode({ id: episodeId, questions });
  }

  static deleteEpisodeQuestion(episodeId: string, questionId: string): Episode {
    const episode = this.getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const questions = (episode.questions || []).filter((q) => q.id !== questionId);
    return this.saveEpisode({ id: episodeId, questions });
  }

  // --- GUESTS ---
  static getGuests(): Guest[] {
    const items = getStored<Guest[]>(STORAGE_KEYS.GUESTS, []);
    return items.filter((g) => !g.deletedAt);
  }

  static saveGuest(guest: Partial<Guest>, user?: User): Guest {
    const all = getStored<Guest[]>(STORAGE_KEYS.GUESTS, []);
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    if (guest.id) {
      const idx = all.findIndex((g) => g.id === guest.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...guest };
        setStored(STORAGE_KEYS.GUESTS, all);
        this.logActivity('تعديل ضيف', 'GUEST', all[idx].id, all[idx].fullName, `تم تحديث بيانات الضيف: ${all[idx].fullName}`);
        return all[idx];
      }
    }

    const newGuest: Guest = {
      id: newId('gst'),
      fullName: guest.fullName || 'ضيف جديد',
      avatarUrl: guest.avatarUrl || '/avatar.svg',
      organization: guest.organization || 'مستقل',
      jobTitle: guest.jobTitle || 'خبير ومحلل',
      specialty: guest.specialty || 'شؤون عامة',
      phone: guest.phone || '',
      email: guest.email || '',
      notes: guest.notes || '',
      rating: guest.rating || 5,
      totalAppearances: 0,
      createdAt: now,
    };

    all.unshift(newGuest);
    setStored(STORAGE_KEYS.GUESTS, all);
    this.logActivity('إضافة ضيف', 'GUEST', newGuest.id, newGuest.fullName, `تم إضافة ضيف جديد إلى الأرشيف المركزي.`);
    return newGuest;
  }

  static deleteGuest(id: string, user?: User): void {
    const all = getStored<Guest[]>(STORAGE_KEYS.GUESTS, []);
    const idx = all.findIndex((g) => g.id === id);
    if (idx !== -1) {
      const guestName = all[idx].fullName;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.GUESTS, all);
      const currentUser = user || this.getCurrentUser();
      this.logActivity('حذف ضيف', 'GUEST', id, guestName, `قام ${currentUser.fullName} بحذف الضيف: ${guestName}`);
    }
  }

  // --- TASKS ---
  static getTasks(): EditorialTask[] {
    return getStored<EditorialTask[]>(STORAGE_KEYS.TASKS, []);
  }

  static saveTask(task: Partial<EditorialTask>, user?: User): EditorialTask {
    const all = this.getTasks();
    const currentUser = user || this.getCurrentUser();
    const now = new Date().toISOString();

    if (task.id) {
      const idx = all.findIndex((t) => t.id === task.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...task };
        setStored(STORAGE_KEYS.TASKS, all);
        this.logActivity('تحديث مهمة', 'TASK', task.id, all[idx].title, `تحديث حالة المهمة إلى: ${all[idx].status}`);
        return all[idx];
      }
    }

    const newTask: EditorialTask = {
      id: newId('tsk'),
      title: task.title || 'مهمة جديدة',
      description: task.description || '',
      assigneeId: task.assigneeId || currentUser.id,
      assigneeName: task.assigneeName || currentUser.fullName,
      assigneeAvatar: task.assigneeAvatar,
      creatorId: currentUser.id,
      creatorName: currentUser.fullName,
      priority: task.priority || 'MEDIUM',
      status: task.status || 'TODO',
      startDate: task.startDate || now,
      dueDate: task.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      relatedEntityType: task.relatedEntityType || 'GENERAL',
      relatedEntityId: task.relatedEntityId,
      relatedEntityTitle: task.relatedEntityTitle,
      notes: task.notes || '',
      createdAt: now,
    };

    all.unshift(newTask);
    setStored(STORAGE_KEYS.TASKS, all);
    this.logActivity('إنشاء مهمة', 'TASK', newTask.id, newTask.title, `تم إسناد مهمة جديدة إلى ${newTask.assigneeName}`);

    // Create Notification for assignee
    this.addNotification({
      userId: newTask.assigneeId,
      title: 'مهمة تحريرية جديدة مسندة إليك',
      message: `قام ${currentUser.fullName} بإسناد مهمة: "${newTask.title}" إليك.`,
      type: 'TASK_ASSIGNED',
      linkUrl: '/tasks',
    });

    return newTask;
  }

  static deleteTask(taskId: string, user?: User): void {
    const all = this.getTasks();
    const filtered = all.filter((t) => t.id !== taskId);
    setStored(STORAGE_KEYS.TASKS, filtered);
    const currentUser = user || this.getCurrentUser();
    this.logActivity('حذف مهمة', 'TASK', taskId, 'مهمة محذوفة', `قام ${currentUser.fullName} بحذف المهمة.`);
  }

  // --- MEDIA ---
  static getMedia(): MediaFile[] {
    return getStored<MediaFile[]>(STORAGE_KEYS.MEDIA, []);
  }

  static getMediaAssets(): MediaFile[] {
    return this.getMedia();
  }

  static getMediaFiles(): MediaFile[] {
    return this.getMedia();
  }

  static saveMedia(file: Partial<MediaFile>, user?: User): MediaFile {
    const all = this.getMedia();
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
    const all = this.getMedia();
    const filtered = all.filter((m) => m.id !== mediaId);
    setStored(STORAGE_KEYS.MEDIA, filtered);
    const currentUser = user || this.getCurrentUser();
    this.logActivity('حذف ملف وسائط', 'MEDIA', mediaId, 'ملف وسائط', `قام ${currentUser.fullName} بحذف ملف الوسائط.`);
  }

  static deleteMediaAsset(mediaId: string, user?: User): void {
    this.deleteMedia(mediaId, user);
  }

  // --- TAXONOMY & CONFIG ---
  static getCategories(): Category[] {
    return getStored<Category[]>(STORAGE_KEYS.CATEGORIES, []);
  }

  // --- STORIES ---
  static getStories(): Story[] {
    return getStored<Story[]>(STORAGE_KEYS.STORIES, []);
  }

  static getStory(id: string): Story | undefined {
    return this.getStories().find((s) => s.id === id);
  }

  static saveStory(data: Partial<Story>, currentUser: User): Story {
    const stories = this.getStories();
    let savedStory: Story;
    
    if (data.id) {
      const idx = stories.findIndex(s => s.id === data.id);
      if (idx !== -1) {
         savedStory = { ...stories[idx], ...data, updatedAt: new Date().toISOString() } as Story;
         stories[idx] = savedStory;
         this.logActivity('UPDATE', 'STORY', savedStory.id, savedStory.title, 'تحديث تغطية إخبارية');
      } else {
         throw new Error('Story not found');
      }
    } else {
       savedStory = {
         id: newId('s'),
         ...data,
         createdAt: new Date().toISOString(),
         updatedAt: new Date().toISOString(),
         createdBy: currentUser.id
       } as Story;
       stories.unshift(savedStory);
       this.logActivity('CREATE', 'STORY', savedStory.id, savedStory.title, 'إنشاء تغطية إخبارية جديدة');
    }

    setStored(STORAGE_KEYS.STORIES, stories);
    return savedStory;
  }

  static deleteStory(id: string, currentUser: User): void {
     const stories = this.getStories();
     const idx = stories.findIndex(s => s.id === id);
     if (idx !== -1) {
         const story = stories[idx];
         // Soft delete
         story.status = 'ARCHIVED';
         setStored(STORAGE_KEYS.STORIES, stories);
         this.logActivity('DELETE', 'STORY', id, story.title, 'أرشفة قصة إخبارية');
     }
  }

  static saveCategory(cat: Partial<Category>): Category {
    const all = this.getCategories();
    const colorVal = cat.colorCode || cat.color || '#2563eb';

    if (cat.id) {
      const idx = all.findIndex((c) => c.id === cat.id);
      if (idx !== -1) {
        const oldNameAr = all[idx].nameAr;
        const updated: Category = {
          ...all[idx],
          ...cat,
          color: colorVal,
          colorCode: colorVal,
        };
        all[idx] = updated;
        setStored(STORAGE_KEYS.CATEGORIES, all);

        // Synchronize categoryName in news items if name changed
        if (cat.nameAr && cat.nameAr !== oldNameAr) {
          try {
            const news = this.getNews();
            let hasNewsChanges = false;
            news.forEach((item) => {
              if (item.categoryId === cat.id) {
                item.categoryName = cat.nameAr!;
                hasNewsChanges = true;
              }
            });
            if (hasNewsChanges) {
              setStored(STORAGE_KEYS.NEWS, news);
            }
          } catch (e) {
            console.warn('Could not cascade category name update to news items:', e);
          }
        }

        this.logActivity('تعديل قسم إخباري', 'CATEGORY', updated.id, updated.nameAr, `تم تحديث بيانات ولون تصنيف (${updated.nameAr})`);
        return updated;
      }
    }

    const newCat: Category = {
      id: newId('cat'),
      nameAr: cat.nameAr || 'قسم جديد',
      nameEn: cat.nameEn || 'New Category',
      slug: (cat.slug || cat.nameEn || 'new-cat').toLowerCase().replace(/\s+/g, '-'),
      color: colorVal,
      colorCode: colorVal,
      description: cat.description || '',
      orderIndex: cat.orderIndex || all.length + 1,
    };
    all.push(newCat);
    setStored(STORAGE_KEYS.CATEGORIES, all);
    this.logActivity('إضافة قسم إخباري جديد', 'CATEGORY', newCat.id, newCat.nameAr, `تم إنشاء تصنيف إخباري جديد (${newCat.nameAr}) باللون المخصص.`);
    return newCat;
  }

  static deleteCategory(id: string): void {
    const all = this.getCategories();
    const target = all.find((c) => c.id === id);
    const filtered = all.filter((c) => c.id !== id);
    setStored(STORAGE_KEYS.CATEGORIES, filtered);
    if (target) {
      this.logActivity('حذف قسم إخباري', 'CATEGORY', target.id, target.nameAr, `تم حذف تصنيف (${target.nameAr}) من النظام.`);
    }
  }

  static getSources(): NewsSource[] {
    return getStored<NewsSource[]>(STORAGE_KEYS.SOURCES, []);
  }

  static getNewsSources(): NewsSource[] {
    return this.getSources();
  }

  static saveSource(src: Partial<NewsSource>): NewsSource {
    const all = this.getSources();
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
    };
    all.push(newSrc);
    setStored(STORAGE_KEYS.SOURCES, all);
    return newSrc;
  }

  static saveNewsSource(src: Partial<NewsSource>): NewsSource {
    return this.saveSource(src);
  }

  static deleteSource(id: string): void {
    const all = this.getSources();
    const filtered = all.filter((s) => s.id !== id);
    setStored(STORAGE_KEYS.SOURCES, filtered);
  }

  static deleteNewsSource(id: string): void {
    this.deleteSource(id);
  }

  static getProgramTypes(): ProgramType[] {
    return getStored<ProgramType[]>(STORAGE_KEYS.PROGRAM_TYPES, []);
  }

  // --- SETTINGS ---
  static getSettings(): SystemSettings {
    return getStored<SystemSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
  }

  static saveSettings(settings: Partial<SystemSettings>): SystemSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    setStored(STORAGE_KEYS.SETTINGS, updated);
    this.logAudit('SETTINGS_UPDATE', 'SETTINGS', 'global', 'INFO', 'تم تحديث الإعدادات العامة للمؤسسة.');
    return updated;
  }

  // --- SHARED BROADCAST STATE ---
  static getBroadcastState(): BroadcastState {
    return getStored<BroadcastState>(COLLECTIONS.broadcastState.storageKey, { liveLock: false });
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
    this.logAudit('SETTINGS_UPDATE', 'BROADCAST', 'live-lock', 'WARNING', locked ? 'تفعيل قفل البث المباشر' : 'رفع قفل البث المباشر');
    return next;
  }

  // --- INTERNAL CHAT ---
  /** Messages oldest-first (the server stores newest first). */
  static getMessages(): (ChatMessage & { isUrgent?: boolean })[] {
    return [...getStored<ChatMessage[]>(COLLECTIONS.messages.storageKey, [])].reverse();
  }

  static sendMessage(channel: ChatMessage['channel'], text: string, isUrgent = false): void {
    const all = getStored<any[]>(COLLECTIONS.messages.storageKey, []);
    all.unshift({ id: newId('msg'), channel, text: text.slice(0, 2000), isUrgent });
    // keep the local window bounded; the server keeps the full history
    if (all.length > 500) all.length = 500;
    setStored(COLLECTIONS.messages.storageKey, all);
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
      linkUrl: item.linkUrl,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    all.unshift(notif);
    setStored(STORAGE_KEYS.NOTIFICATIONS, all);
    return notif;
  }

  static markAllNotificationsRead(): void {
    const all = this.getNotifications();
    const me = this.getCurrentUser().id;
    all.forEach((n) => {
      if (n.userId === me) n.isRead = true;
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
    return getStored<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  }

  static logAudit(
    actionType: AuditLog['actionType'],
    targetEntity: string,
    targetId: string,
    severity: AuditLog['severity'],
    details: string
  ): void {
    const all = this.getAuditLogs();
    const user = this.getCurrentUser();
    const newAudit: AuditLog = {
      id: newId('aud'),
      userId: user.id,
      userName: user.fullName,
      userRole: user.role,
      actionType,
      targetEntity,
      targetId,
      severity,
      details,
      ipAddress: '192.168.1.15',
      timestamp: new Date().toISOString(),
    };
    all.unshift(newAudit);
    if (all.length > 200) all.length = 200;
    setStored(STORAGE_KEYS.AUDIT_LOGS, all);
  }

  // --- GLOBAL SEARCH ---
  static globalSearch(query: string): {
    news: NewsItem[];
    programs: Program[];
    episodes: Episode[];
    guests: Guest[];
    tasks: EditorialTask[];
  } {
    if (!query.trim()) {
      return { news: [], programs: [], episodes: [], guests: [], tasks: [] };
    }
    const q = query.toLowerCase().trim();

    const news = this.getNews().filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.keywords.some((k) => k.toLowerCase().includes(q))
    );

    const programs = this.getPrograms().filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );

    const episodes = this.getEpisodes().filter(
      (e) => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );

    const guests = this.getGuests().filter(
      (g) =>
        g.fullName.toLowerCase().includes(q) ||
        g.organization.toLowerCase().includes(q) ||
        g.specialty.toLowerCase().includes(q)
    );

    const tasks = this.getTasks().filter(
      (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );

    return { news, programs, episodes, guests, tasks };
  }

  // --- SQLITE DATABASE OPERATIONS (server administration) ---

  static async getDbStats(): Promise<DbStats & { sqlConsoleEnabled?: boolean; resetEnabled?: boolean }> {
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

  static async resetDatabase(): Promise<DbStats> {
    const res = await apiFetch<{ data: DbStats }>('/api/v1/db/reset', { method: 'POST' });
    await dataStore.pull();
    return res.data;
  }

  static getExportDbUrl(): string {
    return '/api/v1/db/export';
  }

  static async getBackups(): Promise<DbBackupFileInfo[]> {
    const res = await apiFetch<{ data: DbBackupFileInfo[] }>('/api/v1/db/backups');
    return res.data;
  }

  static async createBackup(): Promise<DbBackupFileInfo | null> {
    const res = await apiFetch<{ data: DbBackupFileInfo }>('/api/v1/db/backups', { method: 'POST' });
    return res.data;
  }

  static async restoreBackup(fileName: string): Promise<DbStats> {
    const res = await apiFetch<{ data: DbStats }>('/api/v1/db/backups/restore', { method: 'POST', json: { fileName } });
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

  /** Imports through the normal sync path, so server permissions and conflict checks still apply. */
  static restoreClientBackup(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed.data !== 'object') {
        throw new Error('الملف غير صالح أو لا يحتوي على بنية بيانات صحيحة');
      }
      Object.entries(STORAGE_KEYS).forEach(([keyName, storageKey]) => {
        const incoming = parsed.data[keyName];
        if (incoming === undefined || incoming === null || keyName === 'AUDIT_LOGS' || keyName === 'ACTIVITY_LOGS') return;
        if (Array.isArray(incoming)) {
          // Merge by id: imported rows overwrite, existing rows not in the file are kept.
          const current = getStored<any[]>(storageKey, []);
          const byId = new Map(current.map((it) => [it.id, it]));
          incoming.forEach((it: any) => it && typeof it.id === 'string' && byId.set(it.id, it));
          setStored(storageKey, [...byId.values()]);
        } else {
          setStored(storageKey, incoming);
        }
      });
      return true;
    } catch (e) {
      console.error('Failed to restore backup:', e);
      return false;
    }
  }
}

export const apiService = ApiService;
