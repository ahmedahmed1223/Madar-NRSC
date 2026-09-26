import { CueAlertOverlay } from './components/common/CueAlertOverlay';
import React, { useState, useEffect, lazy, Suspense } from 'react';
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
import { NEWS_STATUS_LABELS, isBreakingLive } from './shared/newsWorkflow';
import { dataStore } from './services/dataStore';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { BreakingNewsTicker } from './components/layout/BreakingNewsTicker';
import { CommandPalette } from './components/layout/CommandPalette';

// Views are code-split so the first load only ships what is on screen.
const DashboardView = lazy(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const WiresView = lazy(() => import('./views/WiresView').then((m) => ({ default: m.WiresView })));
const NewsListView = lazy(() => import('./views/NewsListView').then((m) => ({ default: m.NewsListView })));
const NewsEditorView = lazy(() => import('./views/NewsEditorView').then((m) => ({ default: m.NewsEditorView })));
const ProgramsView = lazy(() => import('./views/ProgramsView').then((m) => ({ default: m.ProgramsView })));
const EpisodesView = lazy(() => import('./views/EpisodesView').then((m) => ({ default: m.EpisodesView })));
const EpisodeWorkspaceView = lazy(() => import('./views/EpisodeWorkspaceView').then((m) => ({ default: m.EpisodeWorkspaceView })));
const GuestsView = lazy(() => import('./views/GuestsView').then((m) => ({ default: m.GuestsView })));
const TasksView = lazy(() => import('./views/TasksView').then((m) => ({ default: m.TasksView })));
const CalendarView = lazy(() => import('./views/CalendarView').then((m) => ({ default: m.CalendarView })));
const MediaLibraryView = lazy(() => import('./views/MediaLibraryView').then((m) => ({ default: m.MediaLibraryView })));
const ReportsView = lazy(() => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })));
const AuditLogsView = lazy(() => import('./views/AuditLogsView').then((m) => ({ default: m.AuditLogsView })));
const UsersView = lazy(() => import('./views/UsersView').then((m) => ({ default: m.UsersView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));
const TestingView = lazy(() => import('./views/TestingView').then((m) => ({ default: m.TestingView })));
const OnAirView = lazy(() => import('./views/OnAirView').then((m) => ({ default: m.OnAirView })));
const StudioScreenView = lazy(() => import('./views/StudioScreenView').then((m) => ({ default: m.StudioScreenView })));
const HelpView = lazy(() => import('./views/HelpView').then((m) => ({ default: m.HelpView })));
const WhatsNewView = lazy(() => import('./views/WhatsNewView').then((m) => ({ default: m.WhatsNewView })));
const RequestsView = lazy(() => import('./views/RequestsView').then((m) => ({ default: m.RequestsView })));
const RosterView = lazy(() => import('./views/RosterView').then((m) => ({ default: m.RosterView })));
const DatabaseManagerView = lazy(() => import('./views/DatabaseManagerView').then((m) => ({ default: m.DatabaseManagerView })));
const ProgramDetailView = lazy(() => import('./views/ProgramDetailView').then((m) => ({ default: m.ProgramDetailView })));
const StoriesView = lazy(() => import('./views/StoriesView').then((m) => ({ default: m.StoriesView })));

import { ToastContainer, ToastMessage } from './components/common/Toast';
import { NewsroomIntercomDrawer } from './components/common/NewsroomIntercomDrawer';
import { NetworkStatusBanner } from './components/common/NetworkStatusBanner';
import { KeyboardShortcutsModal } from './components/common/KeyboardShortcutsModal';

interface AppProps {
  onLogout: () => void;
  onChangePassword: () => void;
}

export default function App({ onLogout, onChangePassword }: AppProps) {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<User>(apiService.getCurrentUser());
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

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Entities state
  const [stories, setStories] = useState<Story[]>([]);
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
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
  // Prefilled fields for a new story written from an agency wire.
  const [newsSeed, setNewsSeed] = useState<NewsDraftSeed | null>(null);
  const [programTypes, setProgramTypes] = useState(apiService.getProgramTypes());
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Selection state
  const [selectedNewsItem, setSelectedNewsItem] = useState<NewsItem | null>(null);
  const [newNewsStoryId, setNewNewsStoryId] = useState<string | null>(null);
  const [editProgramId, setEditProgramId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [filterProgramId, setFilterProgramId] = useState<string | null>(null);
  // Load all initial data from apiService
  const refreshData = () => {
    setCurrentUser(apiService.getCurrentUser());
    setIsLiveLockActive(apiService.getBroadcastState().liveLock);
    setProgramTypes(apiService.getProgramTypes());
    setStories(apiService.getStories());
    setNewsList(apiService.getNews());
    setPrograms(apiService.getPrograms());
    setEpisodes(apiService.getEpisodes());
    setGuests(apiService.getGuests());
    setTasks(apiService.getTasks());
    setMediaAssets(apiService.getMediaAssets());
    setAuditLogs(apiService.getAuditLogs());
    setCategories(apiService.getCategories());
    setSources(apiService.getNewsSources());
    setWires(apiService.getWires());
    setAllUsers(apiService.getUsers());
  };

  useEffect(() => {
    refreshData();
    // Re-render when this or another user changes shared data; surface rejected writes.
    let frame = 0;
    return dataStore.subscribe((evt) => {
      if (evt.type === 'data-changed') {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(refreshData);
      } else if (evt.type === 'sync-error') {
        addToast({
          type: evt.code === 'CONFLICT' ? 'warning' : 'error',
          title: evt.code === 'CONFLICT' ? 'تعارض في التعديل' : 'تم رفض العملية من الخادم',
          message: evt.message,
        });
      }
    });
  }, []);

  // Keyboard shortcuts (Ctrl+K, ?, Ctrl+Alt+L, Ctrl+Alt+N)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command Palette (Ctrl+K or Cmd+K)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
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
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        handleToggleLiveLock();
        return;
      }

      // Quick New News (Ctrl+Alt+N)
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleCreateNewNewsClick();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Breaking news ticker items
  // Only published, non-expired breaking stories go on air.
  const breakingNewsItems = newsList
    .filter((n) => isBreakingLive(n))
    .map((n) => ({
      id: n.id,
      newsId: n.id,
      title: n.title,
      time: n.publishDate ? new Date(n.publishDate).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : 'الآن',
    }));

  // --- NEWS ACTIONS ---
  /** Returns the saved story, or null when the save was refused. `stay` keeps the editor open. */
  const handleSaveNews = (newsData: Partial<NewsItem> & { expectedUpdatedAt?: string }, opts: { stay?: boolean } = {}): NewsItem | null => {
    try {
      const saved = apiService.saveNews(newsData, currentUser);
      refreshData();
      setSelectedNewsItem(saved);
      if (!opts.stay) setActiveNav('news');
      addToast({
        type: 'success',
        title: 'تم الحفظ بنجاح',
        message: `تم حفظ الخبر: "${saved.title?.slice(0, 40)}..."`,
      });
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

  const handleUpdateNewsStatus = (newsId: string, toStatus: NewsStatus, comment?: string, scheduledDate?: string) => {
    try {
      apiService.updateNewsStatus(newsId, toStatus, currentUser, comment, { scheduledDate });
      refreshData();
      addToast({
        type: 'success',
        title: 'تحديث الحالة',
        message: `أصبحت حالة الخبر: ${NEWS_STATUS_LABELS[toStatus] || toStatus}`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'فشل التحديث',
        message: err.message || 'حدث خطأ أثناء تحديث حالة الخبر',
      });
    }
  };

  const handleDeleteNews = (newsId: string) => {
    try {
      apiService.deleteNews(newsId, currentUser);
      refreshData();
      if (selectedNewsItem?.id === newsId) {
        setSelectedNewsItem(null);
      }
      addToast({
        type: 'warning',
        title: 'حذف الخبر',
        message: 'تم نقل الخبر إلى الأرشيف (Soft Delete)',
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
  const handleBulkAction = (newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => {
    const target: Record<string, NewsStatus> = { PUBLISH: 'PUBLISHED', APPROVE: 'APPROVED', ARCHIVE: 'ARCHIVED' };
    const comment: Record<string, string> = { PUBLISH: 'نشر جماعي', APPROVE: 'اعتماد جماعي', ARCHIVE: 'أرشفة جماعية' };
    let done = 0;
    const skipped: string[] = [];
    newsIds.forEach((id) => {
      try {
        if (action === 'DELETE') apiService.deleteNews(id, currentUser);
        else apiService.updateNewsStatus(id, target[action], currentUser, comment[action]);
        done++;
      } catch (err: any) {
        const title = newsList.find((n) => n.id === id)?.title || id;
        skipped.push(`«${title.slice(0, 30)}»: ${err.message}`);
      }
    });
    refreshData();
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
  };

  const handleConvertWire = (wire: WireItem) => {
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
      internalNotes: `محرر من برقية ${wire.sourceName} (${new Date(wire.publishedAt).toLocaleString('ar-EG')})${wire.link ? `\n${wire.link}` : ''}`,
    });
    setActiveNav('news-editor');
  };

  const handleCreateNewNewsClick = () => {
    setNewsSeed(null);
    setNewNewsStoryId(null);
    setSelectedNewsItem(null);
    setActiveNav('news-editor');
  };

  const handleEditNewsClick = (itemOrId: NewsItem | string) => {
    const found = typeof itemOrId === 'string' ? newsList.find((n) => n.id === itemOrId) : itemOrId;
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
    setNewsSeed(null);
    setSelectedNewsItem(null);
    setNewNewsStoryId(storyId);
    setActiveNav('news-editor');
  };

  const handleToggleBreaking = (item: NewsItem) => {
    try {
      const on = !isBreakingLive(item);
      apiService.setBreaking(item.id, on);
      refreshData();
      addToast(
        on
          ? { type: 'warning', title: 'خبر عاجل على الهواء', message: `«${item.title.slice(0, 40)}» على شريط العاجل لمدة 4 ساعات` }
          : { type: 'info', title: 'أُوقف الخبر العاجل', message: 'أُزيل الخبر من شريط العاجل' }
      );
    } catch (err: any) {
      addToast({ type: 'error', title: 'شريط العاجل', message: err.message });
    }
  };

  // --- PROGRAMS & EPISODES ACTIONS ---
  const handleSaveProgram = (progData: Partial<Program>) => {
    if (!attempt('حفظ البرنامج', () => apiService.saveProgram(progData, currentUser))) return;
    refreshData();
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
    refreshData();
  };

  const handleSelectProgramEpisodes = (programId: string) => {
    setFilterProgramId(programId);
    setActiveNav('episodes');
  };

  const handleSaveEpisode = (epData: Partial<Episode>) => {
    if (!attempt('حفظ الحلقة', () => apiService.saveEpisode(epData, currentUser))) return;
    refreshData();
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
    refreshData();
    if (selectedEpisodeId === episodeId) {
      setSelectedEpisodeId(null);
      setActiveNav('episodes');
    }
  };

  const handleSelectEpisode = (episodeId: string) => {
    setSelectedEpisodeId(episodeId);
    setActiveNav('episode-workspace');
  };

  const handleUpdateRundown = (episodeId: string, segments: RundownSegment[]) => {
    if (!attempt('تحديث الرانداون', () => apiService.updateEpisodeRundown(episodeId, segments, currentUser))) return;
    refreshData();
  };

  // --- GUESTS ACTIONS ---
  const handleSaveGuest = (guestData: Partial<Guest>) => {
    if (!attempt('حفظ الضيف', () => apiService.saveGuest(guestData, currentUser))) return;
    refreshData();
  };

  const handleDeleteGuest = (guestId: string) => {
    if (!attempt('حذف الضيف', () => apiService.deleteGuest(guestId, currentUser))) return;
    refreshData();
  };

  // --- TASKS ACTIONS ---
  const handleSaveTask = (taskData: Partial<EditorialTask>) => {
    if (!attempt('حفظ المهمة', () => apiService.saveTask(taskData, currentUser))) return;
    refreshData();
  };

  const handleDeleteTask = (taskId: string) => {
    if (!attempt('حذف المهمة', () => apiService.deleteTask(taskId, currentUser))) return;
    refreshData();
  };

  // --- STORIES ACTIONS ---
  const handleSaveStory = (storyData: Partial<Story>) => {
    try {
      const saved = apiService.saveStory(storyData, currentUser);
      refreshData();
      addToast({
        title: 'تم حفظ القصة التحريرية',
        message: `تم حفظ قصة "${saved.title}" بنجاح`,
        type: 'success',
      });
    } catch {
      addToast({
        title: 'خطأ في الحفظ',
        message: 'تعذر حفظ القصة الإخبارية',
        type: 'error',
      });
    }
  };

  const handleDeleteStory = (id: string) => {
    try {
      apiService.deleteStory(id, currentUser);
      refreshData();
      addToast({
        title: 'تمت أرشفة القصة',
        message: 'تم نقل التغطية إلى الأرشيف بنجاح',
        type: 'info',
      });
    } catch {
      // ignore
    }
  };

  // --- MEDIA ACTIONS ---
  const handleUploadMedia = (mediaData: Partial<MediaAsset>) => {
    try {
      apiService.saveMediaAsset(mediaData, currentUser);
      refreshData();
      addToast({ type: 'success', title: 'تمت إضافة المادة', message: 'حُفظت المادة في مكتبة الوسائط' });
    } catch (err: any) {
      addToast({ type: 'error', title: 'تعذر حفظ المادة', message: err.message || 'حدث خطأ' });
    }
  };

  const handleDeleteMedia = (id: string) => {
    if (!attempt('حذف الوسائط', () => apiService.deleteMediaAsset(id, currentUser))) return;
    refreshData();
  };

  // --- SETTINGS ACTIONS ---
  const handleSaveCategory = (cat: Partial<Category>) => {
    try {
      const isNew = !cat.id;
      const saved = apiService.saveCategory(cat);
      refreshData();
      addToast({
        title: isNew ? 'تمت إضافة القسم بنجاح' : 'تم تحديث بيانات ولون القسم',
        message: `تم حفظ وتطبيق قسم "${saved.nameAr}" على غرفة الأخبار ولوحة التحكم`,
        type: 'success',
      });
    } catch (err: any) {
      addToast({
        title: 'خطأ في حفظ القسم',
        message: err.message || 'تعذر حفظ القسم الصحفي',
        type: 'error',
      });
    }
  };

  const handleDeleteCategory = (id: string) => {
    try {
      apiService.deleteCategory(id);
      refreshData();
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

  const handleSaveSource = (source: Partial<NewsSource>) => {
    if (!attempt('حفظ المصدر', () => apiService.saveNewsSource(source))) return;
    refreshData();
  };

  const handleDeleteSource = (id: string) => {
    if (!attempt('حذف المصدر', () => apiService.deleteNewsSource(id))) return;
    refreshData();
  };

  // Program selection handler
  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setActiveNav('program-detail');
  };

  // The editor always receives the latest server copy of the selected story.
  const editorNewsItem = selectedNewsItem?.id ? newsList.find((n) => n.id === selectedNewsItem.id) || selectedNewsItem : selectedNewsItem;

  // Resolve current active episode and active program
  // Never fall back to another record: if the open one was deleted, say so instead of editing a different one.
  const activeEpisode = selectedEpisodeId ? episodes.find((e) => e.id === selectedEpisodeId) : undefined;
  const activeProgram = selectedProgramId ? programs.find((p) => p.id === selectedProgramId) : programs[0];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans" dir="rtl">
      {/* Network Connectivity & Offline Resilience Banner */}
      <NetworkStatusBanner />

      {/* Breaking News Ticker (Topmost) */}
      {/* Shown only when there is real breaking news */}
      {breakingNewsItems.length > 0 && (
        <BreakingNewsTicker items={breakingNewsItems} onOpenNews={(newsId) => newsId && handleEditNewsClick(newsId)} />
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Application Sidebar */}
        <Sidebar
          activeNav={activeNav}
          currentUser={currentUser}
          breakingCount={newsList.filter((n) => n.isBreaking && !n.deletedAt).length}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          onSelectNav={(navId) => {
            if (navId === 'episodes') {
              setFilterProgramId(null);
            }
            setActiveNav(navId);
            setIsMobileSidebarOpen(false);
          }}
          badgeCounts={{
            news: (newsList || []).filter((n) => n.status === 'UNDER_REVIEW').length,
            tasks: (tasks || []).filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS').length,
            episodes: (episodes || []).filter((e) => e.status === 'READY_FOR_BROADCAST').length,
          }}
        />

        {/* Center Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Topbar */}
          <Topbar
            currentUser={currentUser}
            onLogout={onLogout}
            onChangePassword={onChangePassword}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenShortcuts={() => setIsKeyboardShortcutsOpen(true)}
            isLiveLockActive={isLiveLockActive}
            onToggleLiveLock={handleToggleLiveLock}
            onNavigate={(nav) => {
              // Notification links are stored as paths ("/tasks", "/episodes/<id>").
              const [view, id] = nav.replace(/^\/+/, '').split('/');
              if (view === 'episodes' && id) handleSelectEpisode(id);
              else if (view === 'news' && id) handleEditNewsClick(id);
              else if (view === 'programs' && id) handleSelectProgram(id);
              else setActiveNav(view || 'dashboard');
              setIsMobileSidebarOpen(false);
            }}
            onToggleMobileMenu={() => setIsMobileSidebarOpen((prev) => !prev)}
            onCreateNews={handleCreateNewNewsClick}
            onCreateProgram={() => {
              setActiveNav('programs');
            }}
            onCreateEpisode={() => {
              setActiveNav('episodes');
            }}
            onCreateTask={() => {
              setActiveNav('tasks');
            }}
          />

          {/* Dynamic Page Views */}
          <main id="app-main" className="flex-1 p-4 sm:p-6 pb-24 sm:pb-24 max-w-7xl w-full mx-auto">
            <Suspense
              fallback={<div className="py-24 text-center text-sm font-semibold text-slate-400">جارٍ التحميل...</div>}
            >
            {activeNav === 'dashboard' && (
              <DashboardView
                newsList={newsList}
                episodes={episodes}
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
                onCreateEpisode={() => {
                  setFilterProgramId(null);
                  setActiveNav('episodes');
                }}
                onNavigate={(view: any) => {
                  const map: Record<string, string> = { NEWS_LIST: 'news', BREAKING_NEWS: 'breaking' };
                  if (view === 'episodes' || view === 'EPISODES') setFilterProgramId(null);
                  setActiveNav(map[view] || String(view).toLowerCase().replace(/_/g, '-'));
                }}
                onSelectEpisode={handleSelectEpisode}
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
                onOpenSettings={() => setActiveNav('settings')}
              />
            )}

            {activeNav === 'news-editor' && (
              <NewsEditorView
                key={editorNewsItem?.id || `new-${newNewsStoryId || ''}-${newsSeed?.wireId || ''}`}
                newsItem={editorNewsItem}
                seed={editorNewsItem ? undefined : newsSeed || undefined}
                defaultStoryId={newNewsStoryId || undefined}
                stories={stories}
                currentUser={currentUser}
                categories={categories}
                sources={sources}
                onSave={handleSaveNews}
                onUpdateStatus={handleUpdateNewsStatus}
                onCancel={() => setActiveNav('news')}
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
                onCreateEpisodeForProgram={(prgId) => {
                  setFilterProgramId(prgId);
                  setActiveNav('episodes');
                }}
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
                onDeleteEpisode={handleDeleteEpisode}
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
                allGuests={guests}
                allNews={newsList}
                currentUser={currentUser}
                onUpdateRundown={(segments) => handleUpdateRundown(activeEpisode.id, segments)}
                onSaveEpisode={handleSaveEpisode}
                onBack={() => setActiveNav('episodes')}
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

            {activeNav === 'tasks' && (
              <TasksView
                tasks={tasks}
                currentUser={currentUser}
                onSaveTask={handleSaveTask}
                onDeleteTask={handleDeleteTask}
              />
            )}

            {activeNav === 'calendar' && (
              <CalendarView
                episodes={episodes}
                programs={programs}
                onSelectEpisode={handleSelectEpisode}
              />
            )}

            {activeNav === 'media' && (
              <MediaLibraryView
                mediaAssets={mediaAssets}
                currentUser={currentUser}
                onUploadMedia={handleUploadMedia}
                onDeleteMedia={handleDeleteMedia}
              />
            )}

            {activeNav === 'reports' && (
              <ReportsView
                newsList={newsList}
                episodes={episodes}
                guests={guests}
                categories={categories}
              />
            )}

            {activeNav === 'audit' && <AuditLogsView logs={auditLogs} />}

            {activeNav === 'users' && (
              <UsersView currentUser={currentUser} />
            )}

            {['settings', 'database', 'tests'].includes(activeNav) && (
              <div className="space-y-5">
                {(RbacService.hasPermission(currentUser, 'system.database_manage') || RbacService.hasPermission(currentUser, 'system.self_healing')) && (
                  <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="أقسام الإعدادات">
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
                          className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition-colors ${
                            activeNav === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
              />
            )}

            {activeNav === 'database' && <DatabaseManagerView />}

            {activeNav === 'tests' && <TestingView />}
              </div>
            )}

            {activeNav === 'roster' && <RosterView users={allUsers} currentUser={currentUser} />}

            {activeNav === 'on-air' && (
              <OnAirView
                currentUser={currentUser}
                onOpenStudioScreen={(id) => {
                  setStudioEpisodeId(id);
                  setActiveNav('studio-screen');
                }}
              />
            )}

            {activeNav === 'studio-screen' && <StudioScreenView currentUser={currentUser} initialEpisodeId={studioEpisodeId} />}

            {activeNav === 'help' && (
              <HelpView currentUser={currentUser} onOpenWhatsNew={() => setActiveNav('whats-new')} onOpenShortcuts={() => setIsKeyboardShortcutsOpen(true)} />
            )}

            {activeNav === 'whats-new' && <WhatsNewView currentUser={currentUser} />}

            {activeNav === 'requests' && (
              <RequestsView currentUser={currentUser} onOpenNews={handleEditNewsClick} onOpenEpisode={handleSelectEpisode} />
            )}
            </Suspense>
          </main>
          <div id="form-page-root" className="flex-1 p-4 sm:p-6 pb-24 w-full empty:hidden" />
        </div>
      </div>

      {/* Global Command Palette (Ctrl + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(nav) => setActiveNav(nav)}
        onQuickCreateNews={handleCreateNewNewsClick}
        newsList={newsList}
        programs={programs}
        episodes={episodes}
        guests={guests}
        onSelectNews={handleEditNewsClick}
        onSelectEpisode={handleSelectEpisode}
        onSelectProgram={handleSelectProgram}
        onSelectGuest={() => setActiveNav('guests')}
        onSelectTask={() => setActiveNav('tasks')}
      />

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />


      {/* Keyboard Shortcuts Reference Modal */}
      <KeyboardShortcutsModal
        isOpen={isKeyboardShortcutsOpen}
        onClose={() => setIsKeyboardShortcutsOpen(false)}
      />

      {/* Global Newsroom Intercom & Audio Production Drawer */}
      <NewsroomIntercomDrawer currentUser={currentUser} />
      <CueAlertOverlay currentUser={currentUser} />
    </div>
  );
}
