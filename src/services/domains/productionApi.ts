import { COLLECTIONS, type EntityRow } from '../../shared/collections';
import { localDateString } from '../../shared/dates';
import { newId } from '../../shared/ids';
import { recalculateRundown } from '../../shared/rundown';
import { DeptRequest, requestChangeError, requestTypeOf } from '../../shared/production';
import { handlesSupport, supportRecipient, supportTrack } from '../../shared/trackSupport';
import { departmentIdOf, findDepartmentId } from '../../shared/departments';
import { cardChangeError, cardContextOf, sendBackCard, timeLogMinutes, type CardActor, type CardStep, type ProductionCard } from '../../shared/productionCards';
import { cardWorkflowAccess, workflowAccess } from '../../shared/workflowAccess';
import { mayManageTemplate } from '../../shared/workflowPublication';
import { WORKFLOW_TRACKS } from '../../shared/workflowTracks';
import { templateChangeError, type WorkflowTemplate } from '../../shared/workflowTemplates';
import {
  Bulletin,
  bulletinAsShow,
  bulletinError,
  BulletinFormat,
  bulletinFromFormat,
  BulletinStory,
  byRank,
  formatError,
  isApprover,
  nextApprovalStep,
  isScheduledOn,
  rankBetween,
  scheduledBulletinId,
  storyContentChanged,
  storyError,
  storyStatusError,
} from '../../shared/bulletins';
import { scheduledBulletinExists } from '../../shared/bulletinReadiness';
import { dataStore } from '../dataStore';
import { apiFetch } from '../http';
import { RbacService } from '../rbacService';
import type { Episode, EpisodeQuestion, Guest, Program, RundownSegment, User } from '../../types';
import { ApiDomainDeps, getSnapshot, getStored, setStored, STORAGE_KEYS } from './storeContext';

export interface GuestEpisodeSummary {
  totalAppearances: number;
  lastAppearanceDate?: string;
  appearanceHistory: NonNullable<Guest['appearanceHistory']>;
  monthlyAppearanceCounts: Record<string, number>;
}

export interface EpisodeSummaries {
  available: boolean;
  programCounts: Record<string, number>;
  guestSummaries: Record<string, GuestEpisodeSummary>;
}

export function createProductionApi(deps: ApiDomainDeps) {
  async function getEpisodeSummaries(signal?: AbortSignal): Promise<EpisodeSummaries> {
    const { data } = await apiFetch<{ data: EpisodeSummaries }>('/api/v1/data/episode-summaries', { signal });
    return {
      ...data,
      programCounts: Object.assign(Object.create(null), data.programCounts),
      guestSummaries: Object.assign(Object.create(null), data.guestSummaries),
    };
  }

  // --- PROGRAMS & EPISODES ---
  function getPrograms(): Program[] {
    const items = getSnapshot<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    // Episode counts are derived from the episodes themselves (never a stale stored counter).
    const counts = new Map<string, number>();
    getSnapshot<Episode[]>(STORAGE_KEYS.EPISODES, []).forEach((e) => {
      if (!e.deletedAt) counts.set(e.programId, (counts.get(e.programId) || 0) + 1);
    });
    return items.filter((p) => !p.deletedAt).map((p) => ({ ...p, episodesCount: counts.get(p.id) || 0 }));
  }

  function getProgramById(id: string): Program | undefined {
    return getPrograms().find((p) => p.id === id);
  }

  function saveProgram(program: Partial<Program>, user?: User): Program {
    const all = getStored<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    const currentUser = user || deps.getCurrentUser();
    const now = new Date().toISOString();

    if (program.id) {
      const idx = all.findIndex((p) => p.id === program.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...program };
        setStored(STORAGE_KEYS.PROGRAMS, all);
        deps.logActivity('تعديل برنامج', 'PROGRAM', program.id, all[idx].name, `تم تعديل بيانات برنامج: ${all[idx].name}`);
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
      studioName: program.studioName || '',
      status: 'ACTIVE',
      episodesCount: 0,
      createdAt: now,
    };

    all.unshift(newPrg);
    setStored(STORAGE_KEYS.PROGRAMS, all);
    deps.logActivity('إنشاء برنامج', 'PROGRAM', newPrg.id, newPrg.name, `تم إضافة برنامج جديد: ${newPrg.name}`);
    return newPrg;
  }

  function deleteProgram(id: string, user?: User): void {
    const all = getStored<Program[]>(STORAGE_KEYS.PROGRAMS, []);
    const idx = all.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const progName = all[idx].name;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.PROGRAMS, all);
      const currentUser = user || deps.getCurrentUser();
      deps.logActivity('حذف برنامج', 'PROGRAM', id, progName, `قام ${currentUser.fullName} بحذف البرنامج: ${progName}`);
    }
  }

  function getEpisodes(): Episode[] {
    const items = getSnapshot<Episode[]>(STORAGE_KEYS.EPISODES, []);
    // Episodes of a deleted program disappear with it (calendar, lists, search).
    const deletedPrograms = new Set(getSnapshot<Program[]>(STORAGE_KEYS.PROGRAMS, []).filter((p) => p.deletedAt).map((p) => p.id));
    return items.filter((e) => !e.deletedAt && !deletedPrograms.has(e.programId));
  }

  function getEpisodeById(id: string): Episode | undefined {
    return getEpisodes().find((e) => e.id === id);
  }

  function saveEpisode(episodeData: Partial<Episode>, user?: User): Episode {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const currentUser = user || deps.getCurrentUser();
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
        deps.logActivity('تعديل حلقة', 'EPISODE', all[idx].id, all[idx].title, `قام ${currentUser.fullName} بتحديث بيانات الحلقة.`);
        return all[idx];
      }
    }

    const newEp: Episode = {
      ...(episodeData.topics ? { topics: episodeData.topics } : {}),
      id: episodeData.id || newId('ep'),
      programId: episodeData.programId || '',
      programName: episodeData.programName || '',
      seasonNumber: episodeData.seasonNumber || 1,
      episodeNumber: episodeData.episodeNumber || 1,
      title: episodeData.title || 'حلقة جديدة',
      description: episodeData.description || '',
      recordingDate: episodeData.recordingDate || localDateString(),
      broadcastDate: episodeData.broadcastDate || localDateString(),
      startTime: episodeData.startTime || '21:00',
      endTime: episodeData.endTime || '21:50',
      durationMinutes: episodeData.durationMinutes || 50,
      presenterId: episodeData.presenterId || currentUser.id,
      presenterName: episodeData.presenterName || currentUser.fullName,
      producerId: episodeData.producerId || currentUser.id,
      producerName: episodeData.producerName || currentUser.fullName,
      directorName: episodeData.directorName || '',
      studioName: episodeData.studioName || '',
      introScript: episodeData.introScript || '',
      discussionTopics: episodeData.discussionTopics || [],
      status: episodeData.status || 'PLANNING',
      guests: episodeData.guests || [],
      questions: episodeData.questions || [],
      rundown: recalculateRundown(episodeData.rundown || []),
      linkedNewsIds: episodeData.linkedNewsIds || [],
      attachments: episodeData.attachments || [],
      createdAt: now,
      updatedAt: now,
    };

    all.unshift(newEp);
    setStored(STORAGE_KEYS.EPISODES, all);
    deps.logActivity('إنشاء حلقة جديدة', 'EPISODE', newEp.id, newEp.title, `تم إنشاء حلقة جديدة برقم ${newEp.episodeNumber}`);
    return newEp;
  }

  function deleteEpisode(id: string, user?: User): void {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const idx = all.findIndex((e) => e.id === id);
    if (idx !== -1) {
      const epTitle = all[idx].title;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.EPISODES, all);
      const currentUser = user || deps.getCurrentUser();
      deps.logActivity('حذف حلقة', 'EPISODE', id, epTitle, `قام ${currentUser.fullName} بحذف الحلقة: ${epTitle}`);
    }
  }

  // --- RUNDOWN MANAGEMENT ---
  function updateEpisodeRundown(episodeId: string, rundown: RundownSegment[], user?: User): Episode {
    const all = getStored<Episode[]>(STORAGE_KEYS.EPISODES, []);
    const idx = all.findIndex((e) => e.id === episodeId);
    if (idx === -1) throw new Error('الحلقة غير موجودة');

    const calculated = recalculateRundown(rundown);
    all[idx].rundown = calculated;
    all[idx].updatedAt = new Date().toISOString();
    setStored(STORAGE_KEYS.EPISODES, all);

    const currentUser = user || deps.getCurrentUser();
    deps.logActivity(
      'تحديث جدول الرانداون',
      'EPISODE',
      episodeId,
      all[idx].title,
      `قام ${currentUser.fullName} بتحديث فقرات الرانداون (${calculated.length} فقرة)`
    );

    return all[idx];
  }

  function addRundownSegment(episodeId: string, segment: Partial<RundownSegment>): Episode {
    const episode = getEpisodeById(episodeId);
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
    return updateEpisodeRundown(episodeId, updatedRundown);
  }

  function deleteRundownSegment(episodeId: string, segmentId: string): Episode {
    const episode = getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const filtered = (episode.rundown || []).filter((s) => s.id !== segmentId);
    return updateEpisodeRundown(episodeId, filtered);
  }

  // --- QUESTIONS & TOPICS ---
  function saveEpisodeQuestion(episodeId: string, question: Partial<EpisodeQuestion>): Episode {
    const episode = getEpisodeById(episodeId);
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

    return saveEpisode({ id: episodeId, questions });
  }

  function deleteEpisodeQuestion(episodeId: string, questionId: string): Episode {
    const episode = getEpisodeById(episodeId);
    if (!episode) throw new Error('الحلقة غير موجودة');

    const questions = (episode.questions || []).filter((q) => q.id !== questionId);
    return saveEpisode({ id: episodeId, questions });
  }

  // --- GUESTS ---
  function getGuests(): Guest[] {
    const items = getSnapshot<Guest[]>(STORAGE_KEYS.GUESTS, []);
    // Appearances are derived from the episodes each guest is linked to (newest first).
    const history = new Map<string, NonNullable<Guest['appearanceHistory']>>();
    getEpisodes().forEach((e) =>
      (e.guests || []).forEach((g: any) => {
        const id = g.guestId || g.id;
        if (!id) return;
        const list = history.get(id) || [];
        list.push({ episodeId: e.id, episodeTitle: e.title, programName: e.programName, date: e.broadcastDate });
        history.set(id, list);
      })
    );
    return items
      .filter((g) => !g.deletedAt)
      .map((g) => {
        const appearances = (history.get(g.id) || []).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return { ...g, appearanceHistory: appearances, totalAppearances: appearances.length, lastAppearanceDate: appearances[0]?.date };
      });
  }

  function saveGuest(guest: Partial<Guest>, user?: User): Guest {
    const all = getStored<Guest[]>(STORAGE_KEYS.GUESTS, []);
    const currentUser = user || deps.getCurrentUser();
    const now = new Date().toISOString();

    if (guest.id) {
      const idx = all.findIndex((g) => g.id === guest.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...guest };
        setStored(STORAGE_KEYS.GUESTS, all);
        deps.logActivity('تعديل ضيف', 'GUEST', all[idx].id, all[idx].fullName, `تم تحديث بيانات الضيف: ${all[idx].fullName}`);
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
      totalAppearances: 0,
      createdAt: now,
    };

    all.unshift(newGuest);
    setStored(STORAGE_KEYS.GUESTS, all);
    deps.logActivity('إضافة ضيف', 'GUEST', newGuest.id, newGuest.fullName, `تم إضافة ضيف جديد إلى الأرشيف المركزي.`);
    return newGuest;
  }

  function deleteGuest(id: string, user?: User): void {
    const all = getStored<Guest[]>(STORAGE_KEYS.GUESTS, []);
    const idx = all.findIndex((g) => g.id === id);
    if (idx !== -1) {
      const guestName = all[idx].fullName;
      all[idx].deletedAt = new Date().toISOString();
      setStored(STORAGE_KEYS.GUESTS, all);
      const currentUser = user || deps.getCurrentUser();
      deps.logActivity('حذف ضيف', 'GUEST', id, guestName, `قام ${currentUser.fullName} بحذف الضيف: ${guestName}`);
    }
  }

  // --- BULLETINS ---
  function getBulletins(): Bulletin[] {
    return getSnapshot<Bulletin[]>(COLLECTIONS.bulletins.storageKey, []).filter((b) => !b.deletedAt);
  }

  function getBulletinStories(bulletinId?: string): BulletinStory[] {
    return getSnapshot<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, [])
      .filter((s) => !s.deletedAt && (!bulletinId || s.bulletinId === bulletinId))
      .sort(byRank);
  }

  function getBulletinFormats(): BulletinFormat[] {
    return getStored<BulletinFormat[]>(COLLECTIONS.bulletinFormats.storageKey, []).filter((f) => !f.deletedAt);
  }

  function bulletinActor() {
    const me = deps.getCurrentUser();
    return { id: me.id, canApprove: RbacService.hasPermission(me, 'bulletins.approve'), canEdit: RbacService.hasPermission(me, 'bulletins.edit'), role: me.role };
  }

  function saveBulletin(data: Partial<Bulletin>): Bulletin {
    const all = getStored<Bulletin[]>(COLLECTIONS.bulletins.storageKey, []);
    const now = new Date().toISOString();
    const idx = data.id ? all.findIndex((b) => b.id === data.id) : -1;
    const editor = data.editorId ? deps.getUsers().find((u) => u.id === data.editorId) : undefined;
    const next: Bulletin = {
      ...(idx >= 0 ? all[idx] : { id: data.id || newId('bul'), status: 'PLANNING', anchors: [], createdAt: now }),
      ...data,
      ...(data.editorId !== undefined ? { editorName: editor?.fullName } : {}),
      updatedAt: now,
    } as Bulletin;
    const err = bulletinError(next);
    if (err) throw new Error(err);
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.bulletins.storageKey, all);
    return next;
  }

  function deleteBulletin(id: string): void {
    const all = getStored<Bulletin[]>(COLLECTIONS.bulletins.storageKey, []);
    setStored(COLLECTIONS.bulletins.storageKey, all.map((b) => (b.id === id ? { ...b, deletedAt: new Date().toISOString() } : b)));
  }

  function saveBulletinStory(data: Partial<BulletinStory> & { bulletinId: string }, base?: EntityRow): BulletinStory {
    const all = getStored<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, []);
    const now = new Date().toISOString();
    const me = deps.getCurrentUser();
    const idx = data.id ? all.findIndex((x) => x.id === data.id) : -1;
    if (base && (base.c !== 'bulletinStories' || base.id !== data.id || idx < 0)) throw new Error('نسخة القصة غير متاحة');
    const before = base ? (base.d as BulletinStory) : idx >= 0 ? all[idx] : null;
    const bulletin = getBulletins().find((b) => b.id === data.bulletinId);
    const actor = bulletinActor();
    const siblings = getBulletinStories(data.bulletinId);
    const next: BulletinStory = {
      ...(before || {
        rank: rankBetween(siblings[siblings.length - 1]?.rank),
        status: 'DRAFT',
        script: '',
        type: 'READER',
        writerId: me.id,
        writerName: me.fullName,
        createdAt: now,
      }),
      ...data,
      id: before?.id ?? data.id ?? newId('bst'),
      updatedAt: now,
    } as BulletinStory;
    // Same approval chain as the server: one sign-off per step, in order.
    const err = storyError(next) || storyStatusError(before, next, bulletin, actor) || (!actor.canEdit && !isApprover(bulletin, actor) ? 'صلاحياتك لا تسمح بتعديل قصص النشرة' : null);
    if (err) throw new Error(err);
    let approvals = [...(before?.approvals || [])];
    if (before && storyContentChanged(before, next) && !isApprover(bulletin, actor, before)) {
      approvals = [];
      if (next.status === 'APPROVED') next.status = 'READY';
    }
    if (next.status === 'DRAFT') approvals = [];
    if (next.status === 'APPROVED' && (before?.status !== 'APPROVED' || nextApprovalStep(bulletin, { approvals }))) {
      const step = nextApprovalStep(bulletin, { approvals });
      if (step) approvals = [...approvals, { stepId: step.id, byId: me.id, byName: me.fullName, at: now }];
      // Keep the requested signoff transition: the server records the signature and
      // returns READY when later steps remain. Sending READY here loses the signoff.
    }
    next.approvals = approvals;
    if (next.status === 'APPROVED' && before?.status !== 'APPROVED') Object.assign(next, { approvedById: me.id, approvedByName: me.fullName, approvedAt: now });
    if (next.status !== 'APPROVED') Object.assign(next, { approvedById: undefined, approvedByName: undefined, approvedAt: undefined });
    if (base) dataStore.queueVersionedRow({ ...base, d: next });
    else {
      if (idx >= 0) all[idx] = next;
      else all.push(next);
      setStored(COLLECTIONS.bulletinStories.storageKey, all);
    }
    return next;
  }

  function deleteBulletinStory(id: string): void {
    const all = getStored<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, []);
    setStored(COLLECTIONS.bulletinStories.storageKey, all.map((x) => (x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x)));
  }

  function moveBulletinStory(id: string, dir: -1 | 1): void {
    const story = getStored<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, []).find((x) => x.id === id);
    if (!story) return;
    const list = getBulletinStories(story.bulletinId);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const rank = dir < 0 ? rankBetween(list[j - 1]?.rank, list[j].rank) : rankBetween(list[j].rank, list[j + 1]?.rank);
    saveBulletinStory({ id, bulletinId: story.bulletinId, rank });
  }

  function copyStoriesToBulletin(storyIds: string[], bulletinId: string): number {
    const source = getStored<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, []).filter((x) => storyIds.includes(x.id));
    source.sort(byRank).forEach((x) => {
      const { id: _id, rank: _r, status: _s, approvedById: _a, approvedByName: _n, approvedAt: _t, writerId: _w, writerName: _wn, createdAt: _c, floated: _f, killed: _k, approvals: _ap, returnNote: _rn, deletedAt: _d, ...rest } = x;
      saveBulletinStory({ ...rest, bulletinId, sourceStoryId: x.id, status: 'DRAFT' });
    });
    return source.length;
  }

  function saveBulletinFormat(data: Partial<BulletinFormat>): BulletinFormat {
    const all = getStored<BulletinFormat[]>(COLLECTIONS.bulletinFormats.storageKey, []);
    const now = new Date().toISOString();
    const idx = data.id ? all.findIndex((f) => f.id === data.id) : -1;
    const editor = data.editorId ? deps.getUsers().find((u) => u.id === data.editorId) : undefined;
    const next = {
      ...(idx >= 0 ? all[idx] : { id: newId('fmt'), days: [], autoCreate: false, stories: [], anchors: [], createdAt: now }),
      ...data,
      ...(data.editorId !== undefined ? { editorName: editor?.fullName } : {}),
      updatedAt: now,
    } as BulletinFormat;
    const err = formatError(next);
    if (err) throw new Error(err);
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    setStored(COLLECTIONS.bulletinFormats.storageKey, all);
    return next;
  }

  function deleteBulletinFormat(id: string): void {
    const all = getStored<BulletinFormat[]>(COLLECTIONS.bulletinFormats.storageKey, []);
    setStored(COLLECTIONS.bulletinFormats.storageKey, all.map((f) => (f.id === id ? { ...f, deletedAt: new Date().toISOString() } : f)));
  }

  function createBulletinFromFormat(formatId: string, date: string, opts: { scheduled?: boolean; overrides?: Partial<Bulletin> } = {}): Bulletin {
    const f = getBulletinFormats().find((x) => x.id === formatId);
    if (!f) throw new Error('القالب غير موجود');
    const id = opts.scheduled ? scheduledBulletinId(f.id, date) : newId('bul');
    const stored = getStored<Bulletin[]>(COLLECTIONS.bulletins.storageKey, []);
    // A scheduled day is matched by format and date too, not only by id (a hand-made or imported copy counts).
    if (stored.some((b) => b.id === id) || (opts.scheduled && scheduledBulletinExists(f, date, stored))) throw new Error('هذه النشرة موجودة مسبقاً');
    const { bulletin, stories } = bulletinFromFormat(f, date, id, newId);
    const saved = saveBulletin({ ...bulletin, ...opts.overrides, id });
    const all = getStored<BulletinStory[]>(COLLECTIONS.bulletinStories.storageKey, []);
    const me = deps.getCurrentUser();
    setStored(COLLECTIONS.bulletinStories.storageKey, [...all, ...stories.map((x) => ({ ...x, writerId: me.id, writerName: me.fullName }))]);
    return saved;
  }

  function missingScheduledBulletins(date: string): BulletinFormat[] {
    const existing = getStored<Bulletin[]>(COLLECTIONS.bulletins.storageKey, []);
    return getBulletinFormats().filter((f) => isScheduledOn(f, date) && !scheduledBulletinExists(f, date, existing));
  }

  function getAirShows(): any[] {
    const stories = getBulletinStories();
    const current = new Map(deps.getOnAirStates().filter((state) => state.status === 'LIVE').map((state) => [state.episodeId, state.currentSegmentId]));
    return [
      ...getEpisodes(),
      ...getBulletins().map((b) => bulletinAsShow(b, stories.filter((x) => x.bulletinId === b.id), current.get(b.id))),
    ];
  }

  // --- DEPARTMENT REQUESTS ---
  function getRequests(): DeptRequest[] {
    return getSnapshot<DeptRequest[]>(COLLECTIONS.requests.storageKey, []).filter((r) => !r.deletedAt);
  }

  function createRequest(data: Pick<DeptRequest, 'type' | 'title'> & Partial<DeptRequest>): DeptRequest {
    const me = deps.getCurrentUser();
    if (!RbacService.hasPermission(me, 'requests.create')) throw new Error('صلاحياتك لا تسمح بإرسال طلبات للأقسام');
    const pending = data.id && getStored<DeptRequest[]>(COLLECTIONS.requests.storageKey, []).find((r) => r.id === data.id);
    if (pending) return pending;
    const type = requestTypeOf(data.type);
    if (!type) throw new Error('نوع الطلب غير معروف');
    if (!data.title?.trim()) throw new Error('عنوان الطلب مطلوب');
    const now = new Date().toISOString();
    const req: DeptRequest = {
      id: data.id || newId('req'),
      type: type.id,
      ...(data.supportCardId ? { supportCardId: data.supportCardId } : {}),
      departmentId: type.departmentId,
      title: data.title.trim(),
      details: data.details?.trim() || '',
      priority: data.priority === 'URGENT' ? 'URGENT' : 'NORMAL',
      status: 'OPEN',
      requesterId: me.id,
      requesterName: me.fullName,
      link: data.link,
      lines: data.lines?.filter((l) => l.trim()),
      sourceMediaIds: type.id === 'MONTAGE' && data.sourceMediaIds?.length ? data.sourceMediaIds : undefined,
      messageOrigin: data.messageOrigin,
      dueAt: data.dueAt,
      ...(data.addressedToId ? { addressedToId: data.addressedToId, addressedToName: data.addressedToName } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const all = getStored<DeptRequest[]>(COLLECTIONS.requests.storageKey, []);
    setStored(COLLECTIONS.requests.storageKey, [req, ...all]);
    return req;
  }

  function updateRequest(id: string, changes: Partial<DeptRequest>): DeptRequest {
    const me = deps.getCurrentUser();
    const all = getStored<DeptRequest[]>(COLLECTIONS.requests.storageKey, []);
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('الطلب غير موجود');
    const before = all[idx];
    const after: DeptRequest = { ...before, ...changes };
    if (changes.status === 'ACCEPTED' && before.status === 'OPEN') {
      after.assigneeId = me.id;
      after.assigneeName = me.fullName;
    }
    const err = requestChangeError(before, after, {
      id: me.id,
      departmentId: departmentIdOf(me),
      canManage: !supportTrack(before.type) && RbacService.hasPermission(me, 'requests.manage'),
      handlesSupport: handlesSupport(before, me),
      routesSupport: !!supportTrack(before.type) && supportRecipient(me, supportTrack(before.type)!, true),
    });
    if (err) throw new Error(err);
    all[idx] = { ...after, updatedAt: new Date().toISOString() };
    setStored(COLLECTIONS.requests.storageKey, all);
    return all[idx];
  }

  function deleteRequest(id: string): void {
    const all = getStored<DeptRequest[]>(COLLECTIONS.requests.storageKey, []);
    setStored(COLLECTIONS.requests.storageKey, all.filter((r) => r.id !== id));
  }

  // --- PRODUCTION CARDS ---
  function getCards(): ProductionCard[] {
    return getSnapshot<ProductionCard[]>(COLLECTIONS.productionCards.storageKey, []).filter((c) => !c.deletedAt);
  }

  function getCard(id: string): ProductionCard | undefined {
    return getCards().find((c) => c.id === id);
  }

  function cardActor(card?: Pick<ProductionCard, 'kind' | 'target'> & Partial<Pick<ProductionCard, 'steps'>>, existing = true): CardActor {
    const me = deps.getCurrentUser();
    const legacy = { view: RbacService.hasPermission(me, 'cards.view'), manage: RbacService.hasPermission(me, 'cards.manage'), work: RbacService.hasPermission(me, 'cards.work') };
    const access = card
      ? cardWorkflowAccess(me, card, legacy, existing)
      : {
          canManage: WORKFLOW_TRACKS.some((track) => workflowAccess(me, track, legacy, existing).canManage),
          canWork: WORKFLOW_TRACKS.some((track) => workflowAccess(me, track, legacy, existing).canWork),
        };
    return { id: me.id, stationId: me.stationId, managedStationIds: me.managedStationIds, managedGroupIds: me.managedGroupIds, role: me.role, departmentId: findDepartmentId(me), ...access };
  }

  function saveCard(card: ProductionCard): ProductionCard {
    const all = getStored<ProductionCard[]>(COLLECTIONS.productionCards.storageKey, []);
    const idx = all.findIndex((c) => c.id === card.id);
    const before = idx === -1 ? null : all[idx];
    const error = cardChangeError(before, card, cardActor(card, !!before), cardContextOf(deps.getSettings(), deps.getUsers()));
    if (error) throw new Error(error);
    const saved = { ...card, updatedAt: new Date().toISOString() };
    if (idx === -1) setStored(COLLECTIONS.productionCards.storageKey, [saved, ...all]);
    else {
      all[idx] = saved;
      setStored(COLLECTIONS.productionCards.storageKey, all);
    }
    return saved;
  }

  function updateCard(id: string, change: (card: ProductionCard) => ProductionCard): ProductionCard {
    const card = getCard(id);
    if (!card) throw new Error('التكليف غير موجود');
    return saveCard(change(card));
  }

  function updateCardStep(cardId: string, stepId: string, changes: Partial<CardStep>): ProductionCard {
    return updateCard(cardId, (card) => ({ ...card, steps: card.steps.map((s) => (s.id === stepId ? { ...s, ...changes } : s)) }));
  }

  function addCardNote(cardId: string, text: string, stepId?: string, decision = false): ProductionCard {
    const me = deps.getCurrentUser();
    return updateCard(cardId, (card) => ({
      ...card,
      log: [
        ...(card.log || []),
        {
          id: newId('log'),
          kind: 'NOTE',
          text: text.trim(),
          stepId,
          ...(decision ? { decision: true } : {}),
          byId: me.id,
          byName: me.fullName,
          stationId: me.stationId,
          at: new Date().toISOString(),
        },
      ],
    }));
  }

  function sendBackCardStep(cardId: string, targetStepId: string, reason: string, fromStepId?: string, dueAt?: string): ProductionCard {
    return updateCard(cardId, (card) => {
      const target = card.steps.find((step) => step.id === targetStepId);
      if (!target?.reviewerId) return sendBackCard(card, targetStepId, reason, fromStepId);
      return {
        ...card,
        steps: card.steps.map((step) =>
          step.id === target.id
            ? { ...step, status: step.assigneeId ? 'IN_PROGRESS' : 'TODO', returnedReason: reason.trim(), dueAt }
            : step
        ),
      };
    });
  }

  function finishCardStep(cardId: string, stepId: string, note: string | undefined, sessionMinutes?: number): ProductionCard {
    const me = deps.getCurrentUser();
    return updateCard(cardId, (card) => {
      const step = card.steps.find((item) => item.id === stepId);
      if (!step) throw new Error('المهمة غير موجودة');
      const text = note?.trim() || undefined;
      const review = !!step.reviewerId;
      if (review && !text && !card.mediaIds?.length && !card.links?.length) throw new Error('أضف ملاحظة التسليم أو أرفق المخرجات قبل المراجعة');
      const session = sessionMinutes && sessionMinutes > 0 ? [{ id: newId('tim'), minutes: Math.min(1440, Math.round(sessionMinutes)), byId: me.id, byName: me.fullName, at: new Date().toISOString() }] : [];
      const finished: CardStep = {
        ...step,
        status: review ? 'IN_REVIEW' : 'DONE',
        note: text,
        blockedReason: undefined,
        waitingOnId: undefined,
        timeLog: session.length ? [...(step.timeLog || []), ...session] : step.timeLog,
        spentMinutes: (step.spentMinutes || 0) + timeLogMinutes(session) || undefined,
      };
      return {
        ...card,
        steps: card.steps.map((item) => (item.id === stepId ? finished : item)),
        log: review
          ? [
              ...(card.log || []),
              {
                id: newId('log'),
                kind: 'NOTE',
                delivery: 'FINAL',
                stepId,
                text: text || 'أُرفقت مخرجات التسليم',
                mediaIds: card.mediaIds,
                deliveryLinks: card.links,
              },
            ]
          : card.log,
      };
    });
  }

  function deleteCard(id: string): void {
    if (!cardActor().canManage) throw new Error('حذف التكليفات لمسؤولي التكليف');
    const all = getStored<ProductionCard[]>(COLLECTIONS.productionCards.storageKey, []);
    setStored(COLLECTIONS.productionCards.storageKey, all.map((c) => (c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c)));
  }

  // --- WORKFLOW TEMPLATES ---
  function getWorkflowTemplates(): WorkflowTemplate[] {
    return getStored<WorkflowTemplate[]>(COLLECTIONS.workflowTemplates.storageKey, []).filter((t) => !t.deletedAt);
  }

  function saveWorkflowTemplate(template: WorkflowTemplate): WorkflowTemplate {
    const all = getStored<WorkflowTemplate[]>(COLLECTIONS.workflowTemplates.storageKey, []);
    const idx = all.findIndex((t) => t.id === template.id);
    const before = idx === -1 ? null : all[idx];
    const me = deps.getCurrentUser();
    const error = templateChangeError(before, template, mayManageTemplate(me, before || template, RbacService.hasPermission(me, 'cards.manage')));
    if (error) throw new Error(error);
    const saved = { ...template, name: template.name.trim(), updatedAt: new Date().toISOString() };
    if (idx === -1) setStored(COLLECTIONS.workflowTemplates.storageKey, [saved, ...all]);
    else {
      all[idx] = saved;
      setStored(COLLECTIONS.workflowTemplates.storageKey, all);
    }
    return saved;
  }

  function deleteWorkflowTemplate(id: string): void {
    if (!cardActor().canManage) throw new Error('قوالب سير العمل لمسؤولي التكليف');
    const all = getStored<WorkflowTemplate[]>(COLLECTIONS.workflowTemplates.storageKey, []);
    setStored(COLLECTIONS.workflowTemplates.storageKey, all.map((t) => (t.id === id ? { ...t, deletedAt: new Date().toISOString() } : t)));
  }

  return {
    getEpisodeSummaries,
    getPrograms,
    getProgramById,
    saveProgram,
    deleteProgram,
    getEpisodes,
    getEpisodeById,
    saveEpisode,
    deleteEpisode,
    updateEpisodeRundown,
    addRundownSegment,
    deleteRundownSegment,
    saveEpisodeQuestion,
    deleteEpisodeQuestion,
    getGuests,
    saveGuest,
    deleteGuest,
    getBulletins,
    getBulletinStories,
    getBulletinFormats,
    saveBulletin,
    deleteBulletin,
    saveBulletinStory,
    deleteBulletinStory,
    moveBulletinStory,
    copyStoriesToBulletin,
    saveBulletinFormat,
    deleteBulletinFormat,
    createBulletinFromFormat,
    missingScheduledBulletins,
    getAirShows,
    getRequests,
    createRequest,
    updateRequest,
    deleteRequest,
    getCards,
    getCard,
    cardActor,
    saveCard,
    updateCard,
    updateCardStep,
    addCardNote,
    sendBackCardStep,
    finishCardStep,
    deleteCard,
    getWorkflowTemplates,
    saveWorkflowTemplate,
    deleteWorkflowTemplate,
  };
}
