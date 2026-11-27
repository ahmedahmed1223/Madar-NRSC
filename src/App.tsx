import { appLocale, zoneOptions } from './shared/dateFormat';
import { confirmSaved } from './services/confirmSave';
import { confirmDialog } from './services/dialogs';
import { onNotify } from './services/notify';
import { lazyWithRetry } from './services/lazyWithRetry';
import { ViewErrorBoundary } from './components/common/ViewErrorBoundary';
import { PrintPreviewHost } from './components/common/PrintPreview';
import { CueAlertOverlay } from './components/common/CueAlertOverlay';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import {
  NewsItem, Story,
  Program,
  Episode,
  Guest,
  EditorialTask,
  MediaAsset,
  AuditLog,
  User,
  Category,
  NewsSource,
  WireItem,
  NewsDraftSeed,
  NewsStatus,
  RundownSegment,
} from './types';
import { RbacService } from './services/rbacService';
import { apiService } from './services/api';
import { authClient } from './services/authClient';
import { NEWS_STATUS_LABELS, isBreakingLive } from './shared/newsWorkflow';
import { dataStore } from './services/dataStore';
import type { CollectionName } from './shared/collections';
import { registerServiceWorker } from './services/push';
import { Sidebar, personalBadgeCounts } from './components/layout/Sidebar';
import { cardProductionAssignment } from './shared/productionCards';
import { assignedWorkOnly } from './shared/assignedWork';
import { Topbar } from './components/layout/Topbar';
import { BreakingNewsTicker } from './components/layout/BreakingNewsTicker';
import { CommandPalette } from './components/layout/CommandPalette';

// Views are code-split so the first load only ships what is on screen.
const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const WiresView = lazyWithRetry(() => import('./views/WiresView').then((m) => ({ default: m.WiresView })));
const NewsListView = lazyWithRetry(() => import('./views/NewsListView').then((m) => ({ default: m.NewsListView })));
const NewsEditorView = lazyWithRetry(() => import('./views/NewsEditorView').then((m) => ({ default: m.NewsEditorView })));
const ProgramsView = lazyWithRetry(() => import('./views/ProgramsView').then((m) => ({ default: m.ProgramsView })));
const EpisodesView = lazyWithRetry(() => import('./views/EpisodesView').then((m) => ({ default: m.EpisodesView })));
const EpisodeWorkspaceView = lazyWithRetry(() => import('./views/EpisodeWorkspaceView').then((m) => ({ default: m.EpisodeWorkspaceView })));
const GuestsView = lazyWithRetry(() => import('./views/GuestsView').then((m) => ({ default: m.GuestsView })));
const TasksView = lazyWithRetry(() => import('./views/TasksView').then((m) => ({ default: m.TasksView })));
const CalendarView = lazyWithRetry(() => import('./views/CalendarView').then((m) => ({ default: m.CalendarView })));
const MediaLibraryView = lazyWithRetry(() => import('./views/MediaLibraryView').then((m) => ({ default: m.MediaLibraryView })));
const ReportsView = lazyWithRetry(() => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })));
const AuditLogsView = lazyWithRetry(() => import('./views/AuditLogsView').then((m) => ({ default: m.AuditLogsView })));
const UsersView = lazyWithRetry(() => import('./views/UsersView').then((m) => ({ default: m.UsersView })));
import type { SettingsSection } from './views/SettingsView';
const SettingsView = lazyWithRetry(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));
const TestingView = lazyWithRetry(() => import('./views/TestingView').then((m) => ({ default: m.TestingView })));
const OnAirView = lazyWithRetry(() => import('./views/OnAirView').then((m) => ({ default: m.OnAirView })));
const StudioScreenView = lazyWithRetry(() => import('./views/StudioScreenView').then((m) => ({ default: m.StudioScreenView })));
const WallboardView = lazyWithRetry(() => import('./views/WallboardView').then((m) => ({ default: m.WallboardView })));
const HelpView = lazyWithRetry(() => import('./views/HelpView').then((m) => ({ default: m.HelpView })));
const GuideView = lazyWithRetry(() => import('./views/GuideView').then((m) => ({ default: m.GuideView })));
const WhatsNewView = lazyWithRetry(() => import('./views/WhatsNewView').then((m) => ({ default: m.WhatsNewView })));
const PersonalNotesView = lazyWithRetry(() => import('./views/PersonalNotesView').then((m) => ({ default: m.PersonalNotesView })));
const PersonalTasksView = lazyWithRetry(() => import('./views/PersonalTasksView').then((m) => ({ default: m.PersonalTasksView })));
const RequestsView = lazyWithRetry(() => import('./views/RequestsView').then((m) => ({ default: m.RequestsView })));
const RosterView = lazyWithRetry(() => import('./views/RosterView').then((m) => ({ default: m.RosterView })));
const BulletinsView = lazyWithRetry(() => import('./views/BulletinsView').then((m) => ({ default: m.BulletinsView })));
const BulletinRundownView = lazyWithRetry(() => import('./views/BulletinRundownView').then((m) => ({ default: m.BulletinRundownView })));
const DatabaseManagerView = lazyWithRetry(() => import('./views/DatabaseManagerView').then((m) => ({ default: m.DatabaseManagerView })));
const ProgramDetailView = lazyWithRetry(() => import('./views/ProgramDetailView').then((m) => ({ default: m.ProgramDetailView })));
const StoriesView = lazyWithRetry(() => import('./views/StoriesView').then((m) => ({ default: m.StoriesView })));
const DiaryView = lazyWithRetry(() => import('./views/DiaryView').then((m) => ({ default: m.DiaryView })));
const BookingsView = lazyWithRetry(() => import('./views/BookingsView').then((m) => ({ default: m.BookingsView })));
const ProductionCardsView = lazyWithRetry(() => import('./views/ProductionCardsView').then((m) => ({ default: m.ProductionCardsView })));
const MessagesView = lazyWithRetry(() => import('./views/MessagesView').then((m) => ({ default: m.MessagesView })));
const WorkloadView = lazyWithRetry(() => import('./views/WorkloadView').then((m) => ({ default: m.WorkloadView })));
const NotificationSettingsView = lazyWithRetry(() => import('./views/NotificationSettingsView').then((m) => ({ default: m.NotificationSettingsView })));

import { ToastContainer, ToastMessage } from './components/common/Toast';
import { NewsroomIntercomDrawer } from './components/common/NewsroomIntercomDrawer';
import { NetworkStatusBanner } from './components/common/NetworkStatusBanner';
import { KeyboardShortcutsModal } from './components/common/KeyboardShortcutsModal';
import { isEditingTarget, matchesShortcutKey } from './shared/keyboard';
import { isKnownScreen, notificationAddress, parsePath, routeToPath, sameScreenAddress, screenTitle } from './services/router';
import { browserAddress, writeBrowserHistory } from './services/browserHistory';
import { navigateTo, routeChanged, setupCommand, type SetupCommand } from './services/uiEvents';
import { TourHost } from './components/help/TourHost';
import { SetupWizard } from './components/setup/SetupWizard';
import { configureDateFormat, onDateFormat } from './shared/dateFormat';

interface AppProps {
  onLogout: () => void;
  onChangePassword: () => void;
}

export default function App({ onLogout, onChangePassword }: AppProps) {
  const [activeNav, setActiveNavState] = useState('dashboard');
  const activeNavRef = useRef(activeNav);
  activeNavRef.current = activeNav;
  const permissionDirty = useRef(false);
  const permissionNavigationPending = useRef(false);
  const confirmPermissionNavigation = (navigate: () => void) => {
    if (permissionNavigationPending.current) return;
    permissionNavigationPending.current = true;
    void confirmDialog({
      title: 'تغييرات صلاحيات غير محفوظة',
      message: 'هل تريد مغادرة الصفحة وإلغاء مسودة الصلاحيات؟',
      confirmLabel: 'مغادرة وإلغاء المسودة',
      cancelLabel: 'متابعة التحرير',
      danger: true,
    }).then(accepted => {
      if (accepted) { permissionDirty.current = false; navigate(); }
      else writeBrowserHistory('replace', { nrcsRoute: '/users' }, '/users');
    }).finally(() => { permissionNavigationPending.current = false; });
  };
  const setActiveNav = (target: string) => {
    if (target === activeNavRef.current || !permissionDirty.current) { setActiveNavState(target); return; }
    confirmPermissionNavigation(() => setActiveNavState(target));
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (permissionDirty.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  /** Item opened from a notification link (wire, diary entry, booking). */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<'programs' | 'episodes' | 'tasks' | 'cards' | null>(null);
  const clearCreateTarget = useCallback(() => setCreateTarget(null), []);
  const openCreate = (target: NonNullable<typeof createTarget>, programId: string | null = null) => {
    if (target === 'episodes') setFilterProgramId(programId);
    if (target === 'programs') setEditProgramId(null);
    setFocusId(null);
    setCreateTarget(target);
    setActiveNav(target);
  };
  /** Set when the server answers from different databases (misconfigured multi-instance hosting). */
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User>(() => apiService.getCurrentUser());
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // Shared across all workstations and enforced by the server.
  const [isLiveLockActive, setIsLiveLockActive] = useState(() => apiService.getBroadcastState().liveLock);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  };

  const handleToggleLiveLock = () => {
    // Reads the current shared state (this also runs from a keyboard listener registered once).
    const next = !apiService.getBroadcastState().liveLock;
    try {
      apiService.setLiveLock(next);
      setIsLiveLockActive(next);
      addToast(
        next
          ? {
              type: 'warning',
              title: 'تم تفعيل قفل البث المباشر',
              message: 'لا يمكن لأي مستخدم حذف البرامج أو الحلقات حتى يُرفع القفل.',
            }
          : { type: 'info', title: 'تم رفع قفل البث المباشر', message: 'عاد الحذف متاحاً حسب الصلاحيات.' }
      );
    } catch (err: any) {
      addToast({ type: 'error', title: 'قفل البث المباشر', message: err.message });
    }
  };

  /** Runs a data action; a refused action shows its reason instead of crashing the view. */
  const attempt = (title: string, action: () => unknown): boolean => {
    try {
      action();
      return true;
    } catch (err: any) {
      addToast({ type: 'error', title, message: err?.message || 'تعذر تنفيذ العملية' });
      return false;
    }
  };

  // Toasts raised from anywhere in the app (drag-and-drop undo, background actions).
  useEffect(() => onNotify((n) => addToast(n)), []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Entities state
  const [stories, setStories] = useState<Story[]>([]);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [reviewQueueIds, setReviewQueueIds] = useState<string[]>([]);
  const [newsReturnDesk, setNewsReturnDesk] = useState<'news' | 'breaking'>('news');
  const [newBreaking, setNewBreaking] = useState(false);
  const [requestSegmentId, setRequestSegmentId] = useState<string | undefined>();
  useEffect(() => {
    if (activeNav !== 'requests') setRequestSegmentId(undefined);
  }, [activeNav]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [tasks, setTasks] = useState<EditorialTask[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [wires, setWires] = useState<WireItem[]>([]);
  const [studioEpisodeId, setStudioEpisodeId] = useState<string | null>(null);
  const [activeBulletinId, setActiveBulletinId] = useState<string | null>(null);
  const [onAirShowId, setOnAirShowId] = useState<string | null>(null);
  const openBulletin = (id: string | null) => {
    setActiveBulletinId(id);
    setActiveNav('bulletins');
  };
  // Prefilled fields for a new story written from an agency wire.
  const [newsSeed, setNewsSeed] = useState<NewsDraftSeed | null>(null);
  const [programTypes, setProgramTypes] = useState(() => apiService.getProgramTypes());
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Selection state
  const [selectedNewsItem, setSelectedNewsItem] = useState<NewsItem | null>(null);
  const [newNewsStoryId, setNewNewsStoryId] = useState<string | null>(null);
  const [editProgramId, setEditProgramId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [episodeSegmentId, setEpisodeSegmentId] = useState<string>();
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [filterProgramId, setFilterProgramId] = useState<string | null>(null);
  // Some child views read smaller collections directly from the store on render.
  const [, renderCollectionReaders] = useState(0);
  useEffect(() => {
    const refreshData = (changed?: ReadonlySet<CollectionName>) => {
      const includes = (...names: CollectionName[]) => !changed || names.some(name => changed.has(name));
      if (includes('settings')) configureDateFormat(apiService.getSettings());
      if (includes('users')) {
        setAllUsers(apiService.getUsers());
        setCurrentUser(apiService.getCurrentUser());
      }
      if (includes('broadcastState')) setIsLiveLockActive(apiService.getBroadcastState().liveLock);
      if (includes('programTypes')) setProgramTypes(apiService.getProgramTypes());
      if (includes('stories')) setStories(apiService.getStories());
      if (includes('news')) setNewsList(apiService.getNews());
      // Program counts and guest appearances depend on episode records.
      if (includes('programs', 'episodes')) {
        setPrograms(apiService.getPrograms());
        setEpisodes(apiService.getEpisodes());
        setGuests(apiService.getGuests());
      } else if (includes('guests')) {
        setGuests(apiService.getGuests());
      }
      if (includes('tasks')) setTasks(apiService.getTasks());
      if (includes('media')) setMediaAssets(apiService.getMediaAssets());
      if (includes('auditLogs')) setAuditLogs(apiService.getAuditLogs());
      if (includes('categories')) setCategories(apiService.getCategories());
      if (includes('sources')) setSources(apiService.getNewsSources());
      if (includes('wires')) setWires(apiService.getWires());
      if (changed) renderCollectionReaders(revision => revision + 1);
    };

    refreshData();
    let frame: number | undefined;
    let changed = new Set<CollectionName>();
    const unsubscribe = dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed') {
        // Editing screens already subscribe directly to their lock collection.
        evt.collections.forEach(collection => { if (collection !== 'editLocks') changed.add(collection); });
        if (changed.size && frame === undefined) frame = requestAnimationFrame(() => {
          const batch = changed;
          changed = new Set();
          frame = undefined;
          refreshData(batch);
        });
      } else if (evt.type === 'sync-error') {
        const titles: Record<string, string> = {
          CONFLICT: 'تعارض في التعديل',
          RETRY: 'تعذر الحفظ على الخادم مؤقتاً',
          FORBIDDEN: 'لم يُحفظ التغيير: صلاحياتك لا تسمح',
          INVALID: 'لم يُحفظ التغيير',
        };
        addToast({
          type: evt.code === 'CONFLICT' || evt.code === 'RETRY' ? 'warning' : 'error',
          title: titles[evt.code] || 'تم رفض العملية من الخادم',
          message: evt.message,
        });
      } else if (evt.type === 'storage-warning') {
        setStorageWarning(evt.message);
      }
    });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, []);

  // Breaking news ticker items
  // Only published, non-expired breaking stories go on air.
  const breakingNewsItems = newsList
    .filter((n) => isBreakingLive(n))
    .map((n) => ({
      id: n.id,
      newsId: n.id,
      title: n.title,
      time: n.publishDate ? new Date(n.publishDate).toLocaleTimeString(appLocale(), { ...zoneOptions(), hour: '2-digit', minute: '2-digit' }) : 'الآن',
    }));

  // --- NEWS ACTIONS ---
  /** Returns the saved story, or null when the save was refused. `stay` keeps the editor open. */
  /** No connection: the news write is kept on this device (awaitWrite answers at once, `queued`). */
  const queuedOffline = async (newsId: string) => {
    const state = dataStore.syncState();
    if (state.browserOnline && state.online) return false;
    // A short wait: only the immediate «queued» answer counts here; confirmSaved does the real wait.
    return !!(await dataStore.awaitWrite('news', newsId, 1)).queued;
  };

  const handleSaveNews = async (newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, opts: { stay?: boolean } = {}): Promise<NewsItem | null> => {
    try {
      const saved = apiService.saveNews(newsData, currentUser);
      // Offline the write waits on this device; the editor says so once (no «تعذر الحفظ»).
      if (await queuedOffline(saved.id)) return null;
      // «تم الحفظ» only once the server has stored it (the sync layer reports refusals).
      if (!await confirmSaved('news', saved.id, `تم حفظ الخبر: «${saved.title?.slice(0, 40)}»`)) return null;
      setSelectedNewsItem(saved);
      return saved;
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'خطأ في الحفظ',
        message: err.message || 'حدث خطأ أثناء حفظ الخبر',
      });
      return null;
    }
  };

  const handleUpdateNewsStatus = async (newsId: string, toStatus: NewsStatus, comment?: string, scheduledDate?: string): Promise<boolean> => {
    try {
      apiService.updateNewsStatus(newsId, toStatus, currentUser, comment, { scheduledDate });
      if (await queuedOffline(newsId)) return false;
      return await confirmSaved('news', newsId, `أصبحت حالة الخبر: ${NEWS_STATUS_LABELS[toStatus] || toStatus}`);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'فشل التحديث',
        message: err.message || 'حدث خطأ أثناء تحديث حالة الخبر',
      });
      return false;
    }
  };

  const handleDeleteNews = (newsId: string) => {
    try {
      apiService.deleteNews(newsId, currentUser);
      if (selectedNewsItem?.id === newsId) {
        setSelectedNewsItem(null);
      }
      addToast({
        type: 'warning',
        title: 'حذف الخبر',
        message: 'نُقل الخبر إلى سلة المحذوفات؛ يستعيده من يملك صلاحية الحذف.',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'خطأ في الحذف',
        message: err.message || 'تعذر حذف الخبر',
      });
    }
  };

  /** Applies the action only where the workflow and permissions allow it, and reports what was skipped. */
  const handleBulkAction = async (newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => {
    const target: Record<string, NewsStatus> = { PUBLISH: 'PUBLISHED', APPROVE: 'APPROVED', ARCHIVE: 'ARCHIVED' };
    const comment: Record<string, string> = { PUBLISH: 'نشر جماعي', APPROVE: 'اعتماد جماعي', ARCHIVE: 'أرشفة جماعية' };
    let done = 0;
    const skipped: string[] = [];
    const failures: { id: string; title: string; reason: string }[] = [];
    for (const id of newsIds) {
      try {
        if (action === 'DELETE') apiService.deleteNews(id, currentUser);
        else apiService.updateNewsStatus(id, target[action], currentUser, comment[action]);
        const outcome = await dataStore.awaitWrite('news', id);
        if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم تنفيذ الإجراء');
        done++;
      } catch (err: any) {
        const title = newsList.find((n) => n.id === id)?.title || id;
        failures.push({ id, title, reason: err.message || 'تعذر تنفيذ الإجراء' });
        skipped.push(`«${title.slice(0, 30)}»: ${err.message}`);
      }
    }
    if (done > 0) {
      addToast({ type: 'success', title: 'إجراء جماعي', message: `تم تنفيذ الإجراء على ${done} من ${newsIds.length} خبراً` });
    }
    if (skipped.length > 0) {
      addToast({
        type: 'warning',
        title: `تم تخطي ${skipped.length} خبراً`,
        message: skipped.slice(0, 3).join(' — ') + (skipped.length > 3 ? ' …' : ''),
      });
    }
    return { done, failures };
  };

  /** Opens a notification/deep link path ("/tasks", "/episodes/<id>", "/wires/<id>", ...). */
  const openLink = (nav: string) => {
    const route = parsePath(nav);
    const { view, id } = route;
    // Confirm before changing selected-record context, which can remount a page.
    if (permissionDirty.current && view !== activeNavRef.current) {
      confirmPermissionNavigation(() => openLinkRef.current(nav));
      return;
    }
    setFocusId(id);
    if (view === 'requests') setRequestSegmentId(route.requestSegmentId);
    if (view === 'episodes' && !id) setFilterProgramId(route.episodeProgramId || null);
    if (view === 'on-air') setOnAirShowId(id);
    if (view === 'studio-screen') setStudioEpisodeId(id);
    if (view === 'episodes' && id) handleSelectEpisode(id, route.episodeSegmentId);
    else if (view === 'bulletins') openBulletin(id);
    else if (view === 'news' && id === 'new') openNewStory(!!route.newsBreaking);
    else if (view === 'news' && id) handleEditNewsClick(id);
    else if (view === 'programs' && id) handleSelectProgram(id);
    else setActiveNav(isKnownScreen(view) ? view : 'dashboard');
    setIsMobileSidebarOpen(false);
  };
  /** The next address change replaces the entry (start-up deep link) instead of adding one. */
  const replaceNextRoute = useRef(false);
  /** Address to push once a closing form page has left its history entry. */
  const pendingRoute = useRef<string | null>(null);
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;
  useEffect(() => {
    const currentAddress = browserAddress();
    const target = notificationAddress(currentAddress);
    if (target) writeBrowserHistory('replace', window.history.state, target);
    // Deep link (address typed, bookmarked, reloaded or from a notification): open that screen.
    const deep = target || currentAddress;
    let canonicalize: number | undefined;
    if (!sameScreenAddress(deep, '/')) {
      replaceNextRoute.current = true;
      openLinkRef.current(deep);
      // A link to something gone or not allowed stays on the current screen: fix the address.
      canonicalize = window.setTimeout(() => {
        if (!replaceNextRoute.current) return;
        replaceNextRoute.current = false;
        if (!sameScreenAddress(browserAddress(), routePathRef.current)) writeBrowserHistory('replace', window.history.state, routePathRef.current);
      }, 300);
    }
    registerServiceWorker();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'open-link' || typeof e.data.url !== 'string') return;
      const path = notificationAddress(e.data.url);
      if (path) openLinkRef.current(path);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(canonicalize);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  const handleConvertWire = (wire: WireItem) => {
    setNewBreaking(false);
    setNewsReturnDesk('news');
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = (wire.summary || '').split('\n').filter(Boolean).map((p) => `<p>${escape(p)}</p>`).join('');
    const known = sources.find((s) => s.id === wire.sourceId);
    setSelectedNewsItem(null);
    setNewNewsStoryId(null);
    setNewsSeed({
      wireId: wire.id,
      title: wire.title,
      summary: (wire.summary || '').slice(0, 400),
      content: `${paragraphs}<p><em>المصدر: ${escape(wire.sourceName)}</em></p>`,
      sourceId: known?.id,
      internalNotes: `محرر من مادة ${wire.sourceName} (${new Date(wire.publishedAt).toLocaleString(appLocale(), zoneOptions())})${wire.link ? `\n${wire.link}` : ''}`,
    });
    setActiveNav('news-editor');
  };

  const openNewStory = (breaking: boolean) => {
    setNewBreaking(breaking);
    setNewsReturnDesk(activeNav === 'breaking' ? 'breaking' : 'news');
    setNewsSeed(null);
    setNewNewsStoryId(null);
    setSelectedNewsItem(null);
    setActiveNav('news-editor');
  };
  const handleCreateNewNewsClick = () => openNewStory(false);
  const shortcuts = useRef({ toggleLiveLock: handleToggleLiveLock, createNews: handleCreateNewNewsClick });
  shortcuts.current = { toggleLiveLock: handleToggleLiveLock, createNews: handleCreateNewNewsClick };

  // Keyboard shortcuts (Ctrl+K, ?, Ctrl+Alt+L, Ctrl+Alt+N)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || document.querySelector('[role=dialog], [role=alertdialog]') || document.body.classList.contains('form-page-open') || isEditingTarget(e.target)) return;
      // Command Palette (Ctrl+K or Cmd+K)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && matchesShortcutKey(e, 'k')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Help / Keyboard shortcuts reference (?)
      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      const isInputting = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      if (e.key === '?' && !isInputting) {
        e.preventDefault();
        setIsKeyboardShortcutsOpen((prev) => !prev);
        return;
      }

      // Live Lock Toggle (Ctrl+Alt+L)
      if ((e.ctrlKey || e.metaKey) && e.altKey && matchesShortcutKey(e, 'l')) {
        e.preventDefault();
        shortcuts.current.toggleLiveLock();
        return;
      }

      // Quick New News (Ctrl+Alt+N)
      if ((e.ctrlKey || e.metaKey) && e.altKey && matchesShortcutKey(e, 'n')) {
        e.preventDefault();
        shortcuts.current.createNews();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);


  const handleEditNewsClick = (itemOrId: NewsItem | string, reviewing = false) => {
    if (activeNav !== 'news-editor') setNewsReturnDesk(activeNav === 'breaking' ? 'breaking' : 'news');
    if (!reviewing) setReviewQueueIds([]);
    // The list may not be in state yet when a deep link opens the story at start-up.
    const found = typeof itemOrId === 'string' ? newsList.find((n) => n.id === itemOrId) || apiService.getNews().find((n) => n.id === itemOrId) : itemOrId;
    if (!found) {
      addToast({ type: 'warning', title: 'الخبر غير متاح', message: 'ربما حُذف الخبر أو لا تملك صلاحية الوصول إليه' });
      return;
    }
    setNewNewsStoryId(null);
    setNewsSeed(null);
    setSelectedNewsItem(found);
    setActiveNav('news-editor');
  };

  const handleCreateNewsForStory = (storyId: string) => {
    setNewBreaking(false);
    setNewsReturnDesk('news');
    setNewsSeed(null);
    setSelectedNewsItem(null);
    setNewNewsStoryId(storyId);
    setActiveNav('news-editor');
  };

  const handleToggleBreaking = (item: NewsItem) => {
    try {
      const on = !isBreakingLive(item);
      apiService.setBreaking(item.id, on);
      addToast(
        on
          ? { type: 'warning', title: 'خبر عاجل على الهواء', message: `«${item.title.slice(0, 40)}» على شريط العاجل لمدة ${apiService.getSettings().breakingDurationHours ?? 4} ساعات` }
          : { type: 'info', title: 'أُوقف الخبر العاجل', message: 'أُزيل الخبر من شريط العاجل' }
      );
    } catch (err: any) {
      addToast({ type: 'error', title: 'شريط العاجل', message: err.message });
    }
  };

  // --- PROGRAMS & EPISODES ACTIONS ---
  const handleSaveProgram = async (progData: Partial<Program>): Promise<boolean> => {
    let saved: Program | null = null;
    if (!attempt('حفظ البرنامج', () => (saved = apiService.saveProgram(progData, currentUser)))) return false;
    return confirmSaved('programs', saved!.id, 'حُفظ البرنامج');
  };

  const handleDeleteProgram = (programId: string) => {
    if (isLiveLockActive) {
      addToast({
        title: 'قفل البث المباشر نشط',
        message: 'لا يمكن حذف البرامج أثناء تفعيل وضع البث المباشر (On-Air Lock). قم بتعطيل القفل أولاً.',
        type: 'warning',
      });
      return;
    }
    if (!attempt('حذف البرنامج', () => apiService.deleteProgram(programId, currentUser))) return;
  };

  const handleSelectProgramEpisodes = (programId: string) => {
    setFilterProgramId(programId);
    setActiveNav('episodes');
  };

  const handleSaveEpisode = async (epData: Partial<Episode>): Promise<boolean> => {
    let saved: Episode | null = null;
    if (!attempt('حفظ الحلقة', () => (saved = apiService.saveEpisode(epData, currentUser)))) return false;
    return confirmSaved('episodes', saved!.id, 'حُفظت الحلقة');
  };

  const handleDeleteEpisode = (episodeId: string) => {
    if (isLiveLockActive) {
      addToast({
        title: 'قفل البث المباشر نشط',
        message: 'لا يمكن حذف الحلقات والرانداون أثناء وضع البث المباشر (On-Air Lock). قم بتعطيل القفل أولاً.',
        type: 'warning',
      });
      return;
    }
    if (!attempt('حذف الحلقة', () => apiService.deleteEpisode(episodeId, currentUser))) return;
    if (selectedEpisodeId === episodeId) {
      setSelectedEpisodeId(null);
      setActiveNav('episodes');
    }
  };

  const handleSelectEpisode = (episodeId: string, segmentId?: string) => {
    setSelectedEpisodeId(episodeId);
    setEpisodeSegmentId(segmentId);
    setActiveNav('episode-workspace');
  };

  const handleUpdateRundown = (episodeId: string, segments: RundownSegment[]) => {
    if (!attempt('تحديث الرانداون', () => apiService.updateEpisodeRundown(episodeId, segments, currentUser))) return;
  };

  // --- GUESTS ACTIONS ---
  const handleSaveGuest = async (guestData: Partial<Guest>): Promise<boolean> => {
    let saved: Guest | null = null;
    if (!attempt('حفظ الضيف', () => (saved = apiService.saveGuest(guestData, currentUser)))) return false;
    return confirmSaved('guests', saved!.id, 'حُفظ الضيف');
  };

  const handleDeleteGuest = (guestId: string) => {
    if (!attempt('حذف الضيف', () => apiService.deleteGuest(guestId, currentUser))) return;
  };

  // --- TASKS ACTIONS ---
  const handleSaveTask = async (taskData: Partial<EditorialTask>): Promise<boolean> => {
    const existing = taskData.id && apiService.getTasks().some(task => task.id === taskData.id);
    let saved: EditorialTask | null = null;
    if (!attempt('حفظ المهمة', () => (saved = apiService.saveTask(taskData, currentUser)))) return false;
    // Quick status moves confirm quietly; creating or editing a task waits for the server.
    const quickMove = Object.keys(taskData).length <= 2;
    return confirmSaved('tasks', saved!.id, quickMove ? undefined : existing ? 'حُفظت المهمة' : `أُسندت المهمة «${saved!.title}»`);
  };

  const handleDeleteTask = (taskId: string) => {
    if (!attempt('حذف المهمة', () => apiService.deleteTask(taskId, currentUser))) return;
  };

  // --- STORIES ACTIONS ---
  const handleSaveStory = async (storyData: Partial<Story>): Promise<boolean> => {
    try {
      const saved = apiService.saveStory(storyData, currentUser);
      return await confirmSaved('stories', saved.id, `حُفظت التغطية «${saved.title}»`);
    } catch (err: any) {
      addToast({ title: 'تعذر حفظ التغطية', message: err?.message || 'حاول مرة أخرى', type: 'error' });
      return false;
    }
  };

  const handleDeleteStory = (id: string) => {
    try {
      apiService.deleteStory(id, currentUser);
      addToast({
        title: 'حُذفت التغطية',
        message: 'تم حذف التغطية؛ بقيت أخبارها في قائمة الأخبار.',
        type: 'info',
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'تعذر حذف التغطية', message: err?.message || 'رفض الخادم العملية' });
    }
  };

  // --- MEDIA ACTIONS ---
  /** True once the server has stored the new library item; the upload page stays open otherwise. */
  const handleUploadMedia = async (mediaData: Partial<MediaAsset>): Promise<boolean> => {
    try {
      const saved = apiService.saveMediaAsset(mediaData, currentUser);
      return await confirmSaved('media', saved.id, 'حُفظت المادة في مكتبة الوسائط');
    } catch (err: any) {
      addToast({ type: 'error', title: 'تعذر حفظ المادة', message: err.message || 'حدث خطأ' });
      return false;
    }
  };

  const handleDeleteMedia = (id: string) => {
    if (!attempt('حذف الوسائط', () => apiService.deleteMediaAsset(id, currentUser))) return;
  };

  // --- SETTINGS ACTIONS ---
  /** True once the server has stored the category (a refusal is announced by the sync layer). */
  const handleSaveCategory = async (cat: Partial<Category>): Promise<boolean> => {
    try {
      const isNew = !cat.id;
      const saved = apiService.saveCategory(cat);
      return await confirmSaved('categories', saved.id, isNew ? `أُضيف القسم «${saved.nameAr}»` : `حُفظ القسم «${saved.nameAr}»`);
    } catch (err: any) {
      addToast({
        title: 'خطأ في حفظ القسم',
        message: err.message || 'تعذر حفظ التصنيف',
        type: 'error',
      });
      return false;
    }
  };

  const handleDeleteCategory = (id: string) => {
    try {
      apiService.deleteCategory(id);
      addToast({
        title: 'تم حذف التصنيف',
        message: 'تم حذف التصنيف بنجاح من النظام',
        type: 'info',
      });
    } catch (err: any) {
      addToast({
        title: 'خطأ في حذف التصنيف',
        message: err.message || 'تعذر حذف التصنيف',
        type: 'error',
      });
    }
  };

  const handleSaveSource = async (source: Partial<NewsSource>) => {
    const saved = apiService.saveNewsSource(source);
    const outcome = await dataStore.awaitWrite('sources', saved.id);
    if (!outcome.ok) throw new Error(outcome.message || 'لم يؤكد الخادم حفظ المصدر');
    return true;
  };

  const handleDeleteSource = (id: string) => {
    if (!attempt('حذف المصدر', () => apiService.deleteNewsSource(id))) return;
  };

  // Program selection handler
  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setActiveNav('program-detail');
  };

  // The editor always receives the latest server copy of the selected story.
  const editorNewsItem = selectedNewsItem?.id ? newsList.find((n) => n.id === selectedNewsItem.id) || selectedNewsItem : selectedNewsItem;
  const reviewIndex = reviewQueueIds.indexOf(editorNewsItem?.id || '');
  const nextReviewId = [...reviewQueueIds.slice(reviewIndex + 1), ...reviewQueueIds.slice(0, Math.max(0, reviewIndex))].find(id => id !== editorNewsItem?.id && newsList.some(n => n.id === id && n.status === 'UNDER_REVIEW'));

  // Resolve current active episode and active program
  // Never fall back to another record: if the open one was deleted, say so instead of editing a different one.
  const activeEpisode = selectedEpisodeId ? episodes.find((e) => e.id === selectedEpisodeId) : undefined;

  // --- Browser history: the address follows the screen; Back/Forward move between screens. ---
  const routePath = routeToPath({
    nav: activeNav,
    newsId: selectedNewsItem?.id,
    newsBreaking: newBreaking,
    episodeId: selectedEpisodeId,
    episodeSegmentId,
    programId: selectedProgramId,
    bulletinId: activeBulletinId,
    episodeProgramId: filterProgramId,
    requestSegmentId,
    airShowId: activeNav === 'studio-screen' ? studioEpisodeId : onAirShowId,
    focusId,
  });
  const routePathRef = useRef(routePath);
  routePathRef.current = routePath;
  const workspaceScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (workspaceScroll.current) workspaceScroll.current.scrollTop = 0;
  }, [activeNav]);
  useEffect(() => routeChanged.emit(routePath), [routePath]);
  useEffect(() => navigateTo.on((path) => openLinkRef.current(path)), []);
  const [setupOpen, setSetupOpen] = useState<SetupCommand | null>(() => {
    const reviewId = authClient.getSession()?.setupReviewId;
    return reviewId ? { reviewId } : null;
  });
  /** Settings opened on a section from another screen (e.g. «المصادر» → feed settings); cleared on leaving. */
  const [settingsTarget, setSettingsTarget] = useState<{ section: SettingsSection; sourceId?: string } | null>(null);
  useEffect(() => {
    if (activeNav !== 'settings') setSettingsTarget(null);
  }, [activeNav]);
  useEffect(() => setupCommand.on(setSetupOpen), []);
  // Every date and time on screen is formatted during render: redraw when the conventions change.
  const [, setDateFormatTick] = useState(0);
  useEffect(() => onDateFormat(() => setDateFormatTick((t) => t + 1)), []);
  const previousRoute = useRef(routePath);
  useEffect(() => {
    // The first render is still the dashboard. A startup deep link is resolved separately.
    if (previousRoute.current === routePath) return;
    previousRoute.current = routePath;
    if (sameScreenAddress(browserAddress(), routePath)) {
      replaceNextRoute.current = false;
      return;
    }
    if (replaceNextRoute.current) {
      replaceNextRoute.current = false;
      writeBrowserHistory('replace', window.history.state, routePath);
    } else if (window.history.state?.nrcsFormPage) {
      // A form page that just closed is stepping back off its history entry; push after it lands.
      pendingRoute.current = routePath;
      const t = window.setTimeout(() => {
        if (pendingRoute.current === routePath) {
          pendingRoute.current = null;
          writeBrowserHistory('push', { nrcsRoute: routePath }, routePath);
        }
      }, 400);
      return () => window.clearTimeout(t);
    } else writeBrowserHistory('push', { nrcsRoute: routePath }, routePath);
  }, [routePath]);
  useEffect(() => {
    const onPop = () => {
      if (pendingRoute.current) {
        const path = pendingRoute.current;
        pendingRoute.current = null;
        writeBrowserHistory('push', { nrcsRoute: path }, path);
        return;
      }
      // Entries a form page added share the screen's address; the form handles those itself.
      const address = browserAddress();
      if (window.history.state?.nrcsFormPage || sameScreenAddress(address, routePathRef.current)) return;
      openLinkRef.current(notificationAddress(address) || address);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const routeItemTitle =
    activeNav === 'news-editor'
      ? selectedNewsItem?.title || 'خبر جديد'
      : activeNav === 'episode-workspace'
        ? activeEpisode?.title
        : activeNav === 'program-detail'
          ? programs.find((p) => p.id === selectedProgramId)?.name
          : activeNav === 'bulletins' && activeBulletinId
            ? apiService.getBulletins().find((b) => b.id === activeBulletinId)?.title
            : null;
  useEffect(() => {
    document.title = screenTitle(activeNav, routeItemTitle);
  }, [activeNav, routeItemTitle]);
  // A role opens only its own screens, whether reached from the sidebar, a link or the address bar.
  const assignedProduction = activeNav === 'episode-workspace' && activeEpisode
    ? `episode:${activeEpisode.id}`
    : activeNav === 'bulletins' && activeBulletinId && apiService.getBulletins().some((bulletin) => bulletin.id === activeBulletinId)
      ? `bulletin:${activeBulletinId}`
      : null;
  const screenModuleAvailable = RbacService.isScreenModuleAvailable(currentUser, activeNav);
  const screenAllowed = screenModuleAvailable && (RbacService.canOpenScreen(currentUser, activeNav) ||
    !!assignedProduction && RbacService.canUseModule(currentUser, 'assignments') &&
    !assignedWorkOnly((permission) => RbacService.hasPermission(currentUser, permission)) &&
    apiService.getCards().some((card) => cardProductionAssignment(card, currentUser.id) === assignedProduction));
  const activeProgram = selectedProgramId ? programs.find((p) => p.id === selectedProgramId) : programs[0];

  if (activeNav === 'wallboard' && screenAllowed) {
    return <ViewErrorBoundary key={activeNav}><Suspense fallback={<p role="status">جارٍ تحميل شاشة غرفة الأخبار…</p>}><WallboardView /></Suspense></ViewErrorBoundary>;
  }

  return (
    <div className="app-shell h-dvh overflow-hidden bg-slate-100 flex flex-col font-sans" dir="rtl">
      <a
        href="#app-main"
        onClick={(e) => {
          e.preventDefault();
          const forms = document.querySelectorAll<HTMLElement>('#form-page-root .form-page');
          (forms[forms.length - 1] || document.getElementById('app-main'))?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-blue-600 focus:text-white focus:text-sm focus:font-bold"
      >
        تخطٍّ إلى المحتوى
      </a>
      {/* Network Connectivity & Offline Resilience Banner */}
      <NetworkStatusBanner />

      {/* Breaking News Ticker (Topmost) */}
      {/* Shown only when there is real breaking news */}
      {breakingNewsItems.length > 0 && (
        <BreakingNewsTicker items={breakingNewsItems} onOpenNews={(newsId) => newsId && handleEditNewsClick(newsId)} />
      )}

      <div className="app-body flex flex-1 overflow-hidden relative">
        {/* Main Application Sidebar */}
        <Sidebar
          activeNav={activeNav}
          currentUser={currentUser}
          breakingCount={breakingNewsItems.length}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          onSelectNav={(navId) => openLink(`/${navId}`)}
          badgeCounts={personalBadgeCounts(currentUser, newsList, tasks, episodes)}
        />

        {/* Center Content Area */}
        <div ref={workspaceScroll} inert={isMobileSidebarOpen || undefined} className="app-scroll flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
          {/* Topbar */}
          <Topbar
            currentUser={currentUser}
            onLogout={onLogout}
            onChangePassword={onChangePassword}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenShortcuts={() => setIsKeyboardShortcutsOpen(true)}
            isLiveLockActive={isLiveLockActive}
            onToggleLiveLock={handleToggleLiveLock}
            onNavigate={openLink}
            onToggleMobileMenu={() => setIsMobileSidebarOpen((prev) => !prev)}
            isMobileMenuOpen={isMobileSidebarOpen}
            onCreateNews={handleCreateNewNewsClick}
            onCreateProgram={() => openCreate('programs')}
            onCreateEpisode={() => openCreate('episodes')}
            onCreateTask={() => openCreate('tasks')}
            onCreateCard={() => openCreate('cards')}
          />

          {/* Dynamic Page Views */}
          {storageWarning && (
            <div role="alert" className="mx-4 sm:mx-6 mt-3 p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-xs font-bold leading-relaxed">
              تحذير تخزين: {storageWarning}
            </div>
          )}
          <main id="app-main" tabIndex={-1} className="workspace-content flex-1 w-full mx-auto pb-12">
            <ViewErrorBoundary key={`${activeNav}:${activeBulletinId || ''}:${selectedEpisodeId || ''}`} onHome={() => setActiveNav('dashboard')}>
            <Suspense
              fallback={<div role="status" className="workspace-loading text-sm font-semibold text-slate-600">جارٍ تحميل {screenTitle(activeNav).split(' · ')[0]}…</div>}
            >
            {!screenAllowed && (
              <div className="max-w-xl mx-auto text-center space-y-3 py-20">
                <h1 className="text-lg font-bold text-slate-900">{screenModuleAvailable ? 'هذه الصفحة ليست ضمن صفحات دورك' : 'هذه الوحدة غير متاحة لهذا الحساب'}</h1>
                <p className="text-sm text-slate-600">{screenModuleAvailable
                  ? 'تُحدَّد صفحات كل دور من «المستخدمون والصلاحيات». إن احتجت إليها في عملك فاطلبها من مدير النظام.'
                  : 'يتحكم مدير النظام في إتاحة الوحدات من الإعدادات العامة.'}</p>
                <button type="button" onClick={() => setActiveNav('dashboard')} className="min-h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-bold">
                  العودة إلى الرئيسية
                </button>
              </div>
            )}
            {screenAllowed && (<>
            {activeNav === 'dashboard' && (
              <DashboardView
                newsList={newsList}
                episodes={episodes}
                programs={programs}
                tasks={tasks}
                guests={guests}
                categories={categories}
                currentUser={currentUser}
                breakingNews={newsList
                  .filter((n) => isBreakingLive(n))
                  .map((n) => ({
                    id: n.id,
                    newsId: n.id,
                    title: n.title,
                    priority: 'CRITICAL' as const,
                    isActive: true,
                    startedAt: n.publishDate || n.updatedAt,
                    expiresAt: n.breakingUntil || '',
                    createdBy: n.editorName || n.authorName,
                  }))}
                onSelectNews={(id) => handleEditNewsClick(id)}
                onCreateNews={handleCreateNewNewsClick}
                onCreateEpisode={() => openCreate('episodes')}
                onNavigate={(view: any) => {
                  if (String(view).includes('/')) { openLink(String(view).startsWith('/') ? String(view) : `/${view}`); return; }
                  const map: Record<string, string> = { NEWS_LIST: 'news', BREAKING_NEWS: 'breaking' };
                  openLink(`/${map[view] || String(view).toLowerCase().replace(/_/g, '-')}`);
                }}
                onSelectEpisode={handleSelectEpisode}
                onOpenBulletin={(id) => openBulletin(id)}
              />
            )}

            {activeNav === 'stories' && (
              <StoriesView
                stories={stories}
                newsList={newsList}
                categories={categories}
                currentUser={currentUser}
                onSaveStory={handleSaveStory}
                onDeleteStory={handleDeleteStory}
                onSelectNews={(id) => handleEditNewsClick(id)}
                onSelectEpisode={handleSelectEpisode}
                onCreateNewsForStory={handleCreateNewsForStory}
              />
            )}
            {(activeNav === 'news' || activeNav === 'breaking') && (
              <NewsListView
                newsList={newsList}
                categories={categories}
                sources={sources}
                currentUser={currentUser}
                onCreateNews={handleCreateNewNewsClick}
                onEditNews={handleEditNewsClick}
                onDeleteNews={handleDeleteNews}
                onUpdateStatus={handleUpdateNewsStatus}
                onBulkAction={handleBulkAction}
                onReviewNews={(id, queue) => { setReviewQueueIds(queue); handleEditNewsClick(id, true); }}
                onToggleBreaking={handleToggleBreaking}
                initialTab={activeNav === 'breaking' ? 'BREAKING' : 'ALL'}
                key={activeNav}
              />
            )}

            {activeNav === 'wires' && (
              <WiresView
                wires={wires}
                sources={sources}
                newsList={newsList}
                currentUser={currentUser}
                onConvert={handleConvertWire}
                onOpenNews={handleEditNewsClick}
                onOpenSettings={(section, sourceId) => {
                  setSettingsTarget(section ? { section: section as SettingsSection, sourceId } : null);
                  setActiveNav('settings');
                }}
                onOpenAlerts={() => setActiveNav('alerts')}
                focusWireId={focusId}
              />
            )}

            {activeNav === 'diary' && (
              <DiaryView
                currentUser={currentUser}
                users={allUsers}
                categories={categories}
                stories={stories}
                newsList={newsList}
                focusId={focusId}
                onCreateNews={(seed) => {
                  setNewBreaking(false);
                  setSelectedNewsItem(null);
                  setNewNewsStoryId(null);
                  setNewsSeed(seed);
                  setNewsReturnDesk('news');
                  setActiveNav('news-editor');
                }}
                onOpenNews={handleEditNewsClick}
              />
            )}

            {activeNav === 'bookings' && <BookingsView currentUser={currentUser} users={allUsers} focusId={focusId} />}

            {activeNav === 'alerts' && <NotificationSettingsView currentUser={currentUser} />}

            {activeNav === 'news-editor' && (
              <NewsEditorView
                key={editorNewsItem?.id || `new-${newBreaking}-${newNewsStoryId || ''}-${newsSeed?.wireId || ''}-${newsSeed?.diaryId || ''}`}
                initialBreaking={newBreaking}
                newsItem={editorNewsItem}
                seed={editorNewsItem ? undefined : newsSeed || undefined}
                defaultStoryId={newNewsStoryId || undefined}
                stories={stories}
                currentUser={currentUser}
                categories={categories}
                sources={sources}
                onSave={handleSaveNews}
                onUpdateStatus={handleUpdateNewsStatus}
                onCancel={() => setActiveNav(newsReturnDesk)}
                nextReviewId={nextReviewId}
                reviewing={reviewQueueIds.includes(editorNewsItem?.id || '')}
                onNextReview={id => handleEditNewsClick(id, true)}
                reviewQueue={reviewQueueIds}
              />
            )}

            {activeNav === 'programs' && (
              <ProgramsView
                programs={programs}
                programTypes={programTypes}
                currentUser={currentUser}
                onSaveProgram={handleSaveProgram}
                onSelectProgramEpisodes={handleSelectProgramEpisodes}
                onSelectProgram={handleSelectProgram}
                onDeleteProgram={handleDeleteProgram}
                initialEditProgramId={editProgramId}
                onInitialEditHandled={() => setEditProgramId(null)}
                openNewRequest={createTarget === 'programs'}
                onOpenNewHandled={clearCreateTarget}
              />
            )}

            {(activeNav === 'program-detail' || activeNav === 'program_detail') && activeProgram && (
              <ProgramDetailView
                program={activeProgram}
                allPrograms={programs}
                allEpisodes={episodes}
                currentUser={currentUser}
                onBack={() => setActiveNav('programs')}
                onSelectEpisode={handleSelectEpisode}
                onEditProgram={(p) => {
                  setEditProgramId(p.id);
                  setActiveNav('programs');
                }}
                onCreateEpisodeForProgram={(prgId) => openCreate('episodes', prgId)}
                onOpenWorkspace={(ep) => {
                  setSelectedEpisodeId(ep.id);
                  setActiveNav('episode-workspace');
                }}
                onSwitchProgram={handleSelectProgram}
              />
            )}

            {activeNav === 'episodes' && (
              <EpisodesView
                episodes={episodes}
                programs={programs}
                currentUser={currentUser}
                onSelectEpisode={handleSelectEpisode}
                onSaveEpisode={handleSaveEpisode}
                filterProgramId={filterProgramId}
                onFilterProgramChange={setFilterProgramId}
                onDeleteEpisode={handleDeleteEpisode}
                openNewRequest={createTarget === 'episodes'}
                onOpenNewHandled={clearCreateTarget}
              />
            )}

            {activeNav === 'episode-workspace' && !activeEpisode && (
              <div className="py-24 text-center space-y-3">
                <p className="text-sm font-bold text-slate-700">هذه الحلقة لم تعد متاحة (ربما حُذفت).</p>
                <button type="button" onClick={() => setActiveNav('episodes')} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">
                  العودة لقائمة الحلقات
                </button>
              </div>
            )}

            {activeNav === 'episode-workspace' && activeEpisode && (
              <EpisodeWorkspaceView
                key={activeEpisode.id}
                episode={activeEpisode}
                initialSegmentId={episodeSegmentId}
                allGuests={guests}
                allNews={newsList}
                currentUser={currentUser}
                onUpdateRundown={(segments) => handleUpdateRundown(activeEpisode.id, segments)}
                onSaveEpisode={handleSaveEpisode}
                onBack={() => setActiveNav('episodes')}
                onOpenNews={(id) => handleEditNewsClick(id)}
                onOpenRequests={segmentId => { setRequestSegmentId(segmentId); setFocusId(null); setActiveNav('requests'); }}
              />
            )}

            {activeNav === 'guests' && (
              <GuestsView
                guests={guests}
                currentUser={currentUser}
                onSaveGuest={handleSaveGuest}
                onDeleteGuest={handleDeleteGuest}
              />
            )}

            {(activeNav === 'tasks' || activeNav === 'personal-tasks') && RbacService.canOpenScreen(currentUser, 'tasks') && (
              <nav aria-label="أنواع المهام" className="mb-4 flex flex-wrap gap-2">
                {[{ id: 'tasks', label: 'مهام العمل' }, { id: 'personal-tasks', label: 'مهامي الشخصية' }].map(({ id, label }) => (
                  <button key={id} type="button" aria-current={activeNav === id ? 'page' : undefined} onClick={() => openLink(`/${id}`)}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${activeNav === id ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {activeNav === 'personal-tasks' && (
              <PersonalTasksView key={currentUser.id} userId={currentUser.id} focusId={focusId} onClearFocus={() => setFocusId(null)} />
            )}
            {activeNav === 'tasks' && (
              <TasksView
                focusId={focusId}
                onClearFocus={() => setFocusId(null)}
                tasks={tasks}
                currentUser={currentUser}
                onSaveTask={handleSaveTask}
                onDeleteTask={handleDeleteTask}
                onOpenLink={openLink}
                openNewRequest={createTarget === 'tasks'}
                onOpenNewHandled={clearCreateTarget}
              />
            )}

            {activeNav === 'calendar' && (
              <CalendarView
                episodes={episodes}
                programs={programs}
                onSelectEpisode={handleSelectEpisode}
                onOpenBulletin={(id) => openBulletin(id)}
                onOpenBulletins={() => openBulletin(null)}
              />
            )}

            {activeNav === 'media' && (
              <MediaLibraryView
                mediaAssets={mediaAssets}
                currentUser={currentUser}
                onUploadMedia={handleUploadMedia}
                onDeleteMedia={handleDeleteMedia}
                focusId={focusId}
              />
            )}

            {activeNav === 'reports' && (
              <ReportsView
                onOpenNews={id => openLink(`/news/${encodeURIComponent(id)}`)}
                episodes={episodes}
                guests={guests}
                categories={categories}
              />
            )}

            {activeNav === 'audit' && <AuditLogsView logs={auditLogs} />}

            {activeNav === 'users' && (
              <UsersView currentUser={currentUser} onPermissionDirtyChange={dirty => { permissionDirty.current = dirty; }} />
            )}

            {['settings', 'database', 'tests'].includes(activeNav) && (
              <div className="space-y-5">
                {(RbacService.hasPermission(currentUser, 'system.database_manage') || RbacService.hasPermission(currentUser, 'system.self_healing')) && (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-1.5 sm:flex sm:flex-wrap" role="tablist" aria-label="أقسام الإعدادات">
                    {[
                      { id: 'settings', label: 'الإعدادات العامة', show: RbacService.hasPermission(currentUser, 'system.settings') },
                      { id: 'database', label: 'النسخ الاحتياطي وقاعدة البيانات', show: RbacService.hasPermission(currentUser, 'system.database_manage') },
                      { id: 'tests', label: 'حالة النظام', show: RbacService.hasPermission(currentUser, 'system.self_healing') },
                    ]
                      .filter((t) => t.show)
                      .map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="tab"
                          aria-selected={activeNav === t.id}
                          onClick={() => setActiveNav(t.id)}
                          className={`min-h-11 px-2 py-2 sm:px-4 rounded-lg text-xs font-bold leading-tight border transition-colors ${
                            activeNav === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                  </div>
                )}
            {activeNav === 'settings' && (
              <SettingsView
                categories={categories}
                sources={sources}
                users={allUsers}
                newsList={newsList}
                onSaveCategory={handleSaveCategory}
                onDeleteCategory={handleDeleteCategory}
                onSaveSource={handleSaveSource}
                onDeleteSource={handleDeleteSource}
                onOpenUsers={() => setActiveNav('users')}
                initialSection={focusId === 'monitor' ? 'monitor' : settingsTarget?.section}
                onSectionChange={section => {
                  setFocusId(section === 'monitor' ? 'monitor' : null);
                  setSettingsTarget(null);
                }}
                focusSourceId={settingsTarget?.sourceId}
              />
            )}

            {activeNav === 'database' && <DatabaseManagerView />}

            {activeNav === 'tests' && <TestingView />}
              </div>
            )}

            {activeNav === 'roster' && <RosterView users={allUsers} currentUser={currentUser} onNavigate={openLink} focusId={focusId} />}

            {activeNav === 'bulletins' &&
              (activeBulletinId ? (
                <BulletinRundownView
                  key={activeBulletinId}
                  bulletinId={activeBulletinId}
                  currentUser={currentUser}
                  onBack={() => setActiveBulletinId(null)}
                  onOpenNews={(id) => handleEditNewsClick(id)}
                  onOpenOnAir={(id) => {
                    setOnAirShowId(id);
                    setActiveNav('on-air');
                  }}
                />
              ) : (
                <BulletinsView currentUser={currentUser} onOpenBulletin={(id) => setActiveBulletinId(id)} />
              ))}

            {activeNav === 'on-air' && (
              <OnAirView
                currentUser={currentUser}
                selectedShowId={onAirShowId}
                onSelectShow={setOnAirShowId}
                onOpenStudioScreen={(id) => {
                  setStudioEpisodeId(id);
                  setActiveNav('studio-screen');
                }}
              />
            )}

            {activeNav === 'studio-screen' && <StudioScreenView currentUser={currentUser} selectedShowId={studioEpisodeId} onSelectShow={setStudioEpisodeId} />}

            {activeNav === 'help' && (
              <HelpView currentUser={currentUser} onOpenWhatsNew={() => setActiveNav('whats-new')} onOpenShortcuts={() => setIsKeyboardShortcutsOpen(true)} />
            )}

            {activeNav === 'guide' && <GuideView currentUser={currentUser} focusId={focusId} onFocus={setFocusId} />}

            {activeNav === 'whats-new' && <WhatsNewView currentUser={currentUser} />}
            {activeNav === 'personal-notes' && <PersonalNotesView key={currentUser.id} currentUser={currentUser} />}

            {activeNav === 'messages' && <MessagesView currentUser={currentUser} users={allUsers} channel={focusId} onChannel={setFocusId} onOpenLink={openLink} />}

            {activeNav === 'cards' && (
              <ProductionCardsView currentUser={currentUser} users={allUsers} focusId={focusId} onFocus={setFocusId} onOpenNews={handleEditNewsClick} onOpenEpisode={handleSelectEpisode} openNewRequest={createTarget === 'cards'} onOpenNewHandled={clearCreateTarget} />
            )}

            {activeNav === 'workload' && (
              <WorkloadView
                currentUser={currentUser}
                users={allUsers}
                onOpen={(ref) => {
                  if (ref.nav === 'news-editor') handleEditNewsClick(ref.id);
                  else openLink(`/${ref.nav}/${encodeURIComponent(ref.id)}`);
                }}
              />
            )}

            {activeNav === 'requests' && (
              <RequestsView currentUser={currentUser} onOpenNews={handleEditNewsClick} onOpenEpisode={handleSelectEpisode} focusId={focusId} focusSegmentId={requestSegmentId} onClearFocus={() => { setRequestSegmentId(undefined); setFocusId(null); }} />
            )}
            </>)}
            </Suspense>
            </ViewErrorBoundary>
          </main>
          <div id="form-page-root" className="workspace-content flex-1 pb-12 w-full empty:hidden" />
        </div>
      </div>

      <TourHost currentUser={currentUser} />
      {setupOpen && RbacService.hasPermission(currentUser, 'system.settings') && (
        <SetupWizard isOpen startAtOrganization={setupOpen !== 'open'} reviewId={typeof setupOpen === 'object' ? setupOpen.reviewId : undefined} onClose={() => setSetupOpen(null)} currentUser={currentUser} />
      )}

      {/* Global Command Palette (Ctrl + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(nav) => openLink(`/${nav}`)}
        onQuickCreateNews={handleCreateNewNewsClick}
        onOpenLink={openLink}
        newsList={newsList}
        programs={programs}
        episodes={episodes}
        guests={guests}
        onSelectNews={handleEditNewsClick}
        onSelectEpisode={handleSelectEpisode}
        onSelectProgram={handleSelectProgram}
        onSelectGuest={() => openLink('/guests')}
        onSelectTask={(taskId) => openLink(`/tasks/${encodeURIComponent(taskId)}`)}
        currentUser={currentUser}
      />

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <PrintPreviewHost />


      {/* Keyboard Shortcuts Reference Modal */}
      <KeyboardShortcutsModal
        isOpen={isKeyboardShortcutsOpen}
        onClose={() => setIsKeyboardShortcutsOpen(false)}
      />

      {/* Global Newsroom Intercom & Audio Production Drawer */}
      {RbacService.canOpenScreen(currentUser, 'messages') && <NewsroomIntercomDrawer currentUser={currentUser} />}
      <CueAlertOverlay currentUser={currentUser} />
    </div>
  );
}
