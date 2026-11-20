import type { NewsItem, NewsWorkflowLog, User, WireItem } from '../types';
import { COLLECTIONS } from '../shared/collections';
import { newId } from '../shared/ids';
import { dmChannel } from '../shared/chat';
import {
  claimDenial,
  contentDenial,
  contentSignature,
  qualityPassDenial,
  canRequestBreaking,
  type NewsBreakingRequest,
} from '../shared/newsWorkflow';
import { MANUAL_SOURCE_ID, MANUAL_WIRE_PREFIX, manualWireError, toggleHandled } from '../shared/wires';
import { dataStore } from './dataStore';
import { apiService } from './api';
import { RbacService } from './rbacService';

/**
 * Review bookkeeping on stories (quality pass, claiming a review, breaking requests from the
 * field) and the monitoring desk's actions on «المصادر». Each write is checked here with the
 * rules the server applies (shared/newsWorkflow, shared/wires) and then synchronised.
 */

const NEWS_KEY = COLLECTIONS.news.storageKey;
const WIRES_KEY = COLLECTIONS.wires.storageKey;

const can = (user: User) => (perm: string) => RbacService.hasPermission(user, perm);

function updateNews(id: string, change: (item: NewsItem) => NewsItem): NewsItem {
  const all = dataStore.get<NewsItem[]>(NEWS_KEY, []);
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0) throw new Error('الخبر غير موجود');
  const next = change(all[idx]);
  const copy = [...all];
  copy[idx] = next;
  dataStore.set(NEWS_KEY, copy);
  return next;
}

const logEntry = (item: NewsItem, user: User, action: NewsWorkflowLog['action'], comment: string, at: string): NewsWorkflowLog => ({
  id: newId('log'),
  newsId: item.id,
  fromStatus: item.status,
  toStatus: item.status,
  changedBy: { id: user.id, name: user.fullName, role: user.role },
  comment,
  timestamp: at,
  action,
});

/** «أراجعها الآن»: marks the story as being reviewed by this user (an approver may take it over). */
export function claimReview(newsId: string, user: User = apiService.getCurrentUser()): NewsItem {
  return updateNews(newsId, (item) => {
    const denial = claimDenial(can(user), user.id, item);
    if (denial) throw new Error(denial);
    const at = new Date().toISOString();
    const takeover = item.reviewClaim && item.reviewClaim.userId !== user.id;
    return {
      ...item,
      reviewClaim: { userId: user.id, userName: user.fullName, at },
      workflowLogs: [...(item.workflowLogs || []), logEntry(item, user, 'REVIEW_CLAIMED', takeover ? `تولّى المراجعة من ${item.reviewClaim!.userName}` : 'بدأ مراجعة الخبر', at)],
      updatedAt: at,
    };
  });
}

/** Gives the story back to the review queue. */
export function releaseReview(newsId: string, user: User = apiService.getCurrentUser()): NewsItem {
  return updateNews(newsId, (item) => {
    if (!item.reviewClaim) return item;
    const at = new Date().toISOString();
    const { reviewClaim: _c, ...rest } = item;
    return { ...rest, workflowLogs: [...(item.workflowLogs || []), logEntry(item, user, 'REVIEW_RELEASED', 'أعاد الخبر إلى طابور المراجعة', at)], updatedAt: at } as NewsItem;
  });
}

/** «اجتازت التدقيق»: records the pass (who, when, which text) without approving the story. */
export function passQuality(newsId: string, note = '', user: User = apiService.getCurrentUser()): NewsItem {
  return updateNews(newsId, (item) => {
    const denial = qualityPassDenial(can(user), user.id, item);
    if (denial) throw new Error(denial);
    const at = new Date().toISOString();
    const clean = note.trim().slice(0, 500);
    const { reviewClaim: _c, ...rest } = item;
    return {
      ...rest,
      // The pass ends this reviewer's claim: the story moves on to the approver.
      qualityCheck: { byId: user.id, byName: user.fullName, at, signature: contentSignature(item), ...(clean ? { note: clean } : {}) },
      workflowLogs: [...(item.workflowLogs || []), logEntry(item, user, 'QUALITY_PASSED', clean ? `اجتازت التدقيق: ${clean}` : 'اجتازت التدقيق', at)],
      updatedAt: at,
    } as NewsItem;
  });
}

export interface FieldBreakingInput {
  title: string;
  locationName: string;
  line: string;
  mediaIds: string[];
  categoryId?: string;
  sourceId?: string;
}

/**
 * «خبر عاجل» from the field: a short story sent straight to review as urgent, flagged as a
 * breaking request. The desk is alerted; putting it on the breaking ticker stays theirs.
 */
export function sendFieldBreaking(input: FieldBreakingInput, user: User = apiService.getCurrentUser()): NewsItem {
  if (!canRequestBreaking(can(user))) throw new Error('صلاحياتك لا تسمح بإرسال عاجل للمراجعة');
  const title = input.title.trim();
  const line = input.line.trim();
  if (title.length < 5) throw new Error('اكتب عنواناً للعاجل (5 أحرف على الأقل)');
  if (!line) throw new Error('اكتب سطراً واحداً عمّا يحدث');
  const location = input.locationName.trim();
  const content = `<p>${escapeHtml(location ? `${location} — ${line}` : line)}</p>`;
  // The review gate needs a real body; a breaking line is short, so the editors complete it.
  const body = contentDenial({ title, content }, 'UNDER_REVIEW') ? `${content}<p>${escapeHtml('[عاجل من الميدان: يُستكمل النص في الديسك]')}</p><p>${escapeHtml(`أرسله ${user.fullName} من ${location || 'الميدان'}.`)}</p>` : content;
  const created = apiService.saveNews(
    {
      title,
      shortTitle: title.slice(0, 120),
      summary: line,
      content: body,
      locationName: location,
      mediaIds: input.mediaIds,
      categoryId: input.categoryId,
      sourceId: input.sourceId,
      priority: 'URGENT',
      status: 'UNDER_REVIEW',
      keywords: ['عاجل'],
      eventDate: new Date().toISOString(),
    },
    user
  );
  const at = new Date().toISOString();
  const request: NewsBreakingRequest = { byId: user.id, byName: user.fullName, at };
  const item = updateNews(created.id, (n) => ({
    ...n,
    breakingRequest: request,
    workflowLogs: [...(n.workflowLogs || []), logEntry(n, user, 'BREAKING_REQUESTED', `عاجل من الميدان${location ? ` (${location})` : ''}`, at)],
  }));
  // Everyone who may put it on air hears at once.
  for (const colleague of apiService.getUsers()) {
    if (colleague.id === user.id || colleague.isActive === false) continue;
    if (!RbacService.hasPermission(colleague, 'news.breaking_push')) continue;
    apiService.addNotification({
      userId: colleague.id,
      title: `عاجل من الميدان: ${title.slice(0, 80)}`,
      message: `${user.fullName}${location ? ` — ${location}` : ''}: ${line.slice(0, 160)}`,
      type: 'SYSTEM',
      category: 'news',
      linkUrl: `/news/${item.id}`,
    } as any);
  }
  return item;
}

/** Closes a breaking request (the editor decided: on air, or not). */
export function closeBreakingRequest(newsId: string): NewsItem {
  return updateNews(newsId, (item) => {
    const { breakingRequest: _r, ...rest } = item;
    return { ...rest, updatedAt: new Date().toISOString() } as NewsItem;
  });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- «المصادر»: the monitoring desk -------------------------------------------------------------

function updateWire(id: string, change: (w: WireItem) => WireItem): WireItem {
  const all = dataStore.get<WireItem[]>(WIRES_KEY, []);
  const idx = all.findIndex((w) => w.id === id);
  if (idx < 0) throw new Error('المادة لم تعد موجودة');
  const copy = [...all];
  copy[idx] = change(all[idx]);
  dataStore.set(WIRES_KEY, copy);
  return copy[idx];
}

/** «تمت المتابعة» on / off for this user. */
export function toggleWireHandled(wireId: string, user: User = apiService.getCurrentUser()): WireItem {
  return updateWire(wireId, (w) => toggleHandled(w, user));
}

export interface ManualObservation {
  sourceName: string;
  medium: NonNullable<WireItem['medium']>;
  publishedAt: string;
  title: string;
  summary: string;
  link?: string;
}

/** «رصد يدوي»: a TV / social observation stored with the agency items so the desk sees it. */
export function addManualObservation(input: ManualObservation, user: User = apiService.getCurrentUser()): WireItem {
  if (!RbacService.hasPermission(user, 'news.create')) throw new Error('إضافة رصد يدوي لمن يكتب الأخبار');
  const now = new Date().toISOString();
  const wire: WireItem = {
    id: `${MANUAL_WIRE_PREFIX}${newId('m').replace(/[^A-Za-z0-9_-]/g, '')}`,
    sourceId: MANUAL_SOURCE_ID,
    sourceName: input.sourceName.trim().replace(/\s+/g, ' '),
    title: input.title.trim(),
    summary: input.summary.trim(),
    ...(input.link?.trim() ? { link: input.link.trim() } : {}),
    categories: [],
    publishedAt: input.publishedAt,
    fetchedAt: now,
    manual: true,
    medium: input.medium,
    createdById: user.id,
    createdByName: user.fullName,
  };
  const error = manualWireError(wire);
  if (error) throw new Error(error);
  dataStore.set(WIRES_KEY, [wire, ...dataStore.get<WireItem[]>(WIRES_KEY, [])]);
  return wire;
}

/** Removes a manual observation (its author, or a system administrator; the server checks). */
export function deleteManualObservation(wireId: string): WireItem {
  return updateWire(wireId, (w) => {
    if (!w.manual) throw new Error('مواد الوكالات لا تُحذف يدوياً');
    return { ...w, deletedAt: new Date().toISOString() };
  });
}

/** «إرسال لزميل»: a direct message pointing at the item. */
export function sendWireToColleague(wire: WireItem, colleagueId: string, note: string, user: User = apiService.getCurrentUser()) {
  const lines = [
    note.trim(),
    `📡 من المصادر (${wire.sourceName}): «${wire.title}»`,
    wire.link ? wire.link : '',
    `/wires/${wire.id}`,
  ].filter(Boolean);
  apiService.sendMessage(dmChannel(user.id, colleagueId), lines.join('\n').slice(0, 3900));
}

/** «إضافة إلى بطاقة»: a note on a production card that cites the item (cards keep their own rules). */
export function addWireToCard(wire: WireItem, cardId: string, note: string) {
  const text = [note.trim(), `من المصادر — ${wire.sourceName}: «${wire.title}»${wire.link ? `\n${wire.link}` : ''}`].filter(Boolean).join('\n');
  return apiService.addCardNote(cardId, text.slice(0, 2000));
}
