import { StoriesView } from './views/StoriesView';
import React, { useState, useEffect } from 'react';
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
  NewsStatus,
  RundownSegment,
} from './types';
import { apiService } from './services/api';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { BreakingNewsTicker } from './components/layout/BreakingNewsTicker';
import { CommandPalette } from './components/layout/CommandPalette';

// Views
import { DashboardView } from './views/DashboardView';
import { NewsListView } from './views/NewsListView';
import { NewsEditorView } from './views/NewsEditorView';
import { ProgramsView } from './views/ProgramsView';
import { EpisodesView } from './views/EpisodesView';
import { EpisodeWorkspaceView } from './views/EpisodeWorkspaceView';
import { GuestsView } from './views/GuestsView';
import { TasksView } from './views/TasksView';
import { CalendarView } from './views/CalendarView';
import { MediaLibraryView } from './views/MediaLibraryView';
import { ReportsView } from './views/ReportsView';
import { AuditLogsView } from './views/AuditLogsView';
import { SettingsView } from './views/SettingsView';
import { TestingView } from './views/TestingView';
import { DatabaseManagerView } from './views/DatabaseManagerView';
import { ProgramDetailView } from './views/ProgramDetailView';

import { ToastContainer, ToastMessage } from './components/common/Toast';

export default function App() {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<User>(apiService.getCurrentUser());
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(3);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
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
  const [programTypes, setProgramTypes] = useState(apiService.getProgramTypes());
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Selection state
  const [selectedNewsItem, setSelectedNewsItem] = useState<NewsItem | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>('prg-1');
  const [filterProgramId, setFilterProgramId] = useState<string | null>(null);

  // Load all initial data from apiService
  const refreshData = () => {
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
    setAllUsers(apiService.getUsers());
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Keyboard shortcut for Command Palette (Ctrl+K or Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // User Switcher
  const handleSwitchUser = (user: User) => {
    apiService.setCurrentUser(user);
    setCurrentUser(user);
    addToast({
      type: 'info',
      title: 'تبديل المستخدم',
      message: `تم التبديل إلى: ${user.fullName} (${user.role})`,
    });
  };

  // Breaking news ticker items
  const breakingNewsItems = newsList
    .filter((n) => n.isBreaking)
    .map((n) => ({ id: n.id, title: n.title, time: n.publishedAt ? n.publishedAt.slice(11, 16) : 'الآن' }));

  // --- NEWS ACTIONS ---
  const handleSaveNews = (newsData: Partial<NewsItem>) => {
    try {
      const saved = apiService.saveNews(newsData, currentUser);
      refreshData();
      setSelectedNewsItem(saved);
      setActiveNav('news');
      addToast({
        type: 'success',
        title: 'تم الحفظ بنجاح',
        message: `تم حفظ الخبر: "${saved.title?.slice(0, 40)}..."`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'خطأ في الحفظ',
        message: err.message || 'حدث خطأ أثناء حفظ الخبر',
      });
    }
  };

  const handleUpdateNewsStatus = (newsId: string, toStatus: NewsStatus, comment?: string) => {
    try {
      apiService.updateNewsStatus(newsId, toStatus, currentUser, comment);
      refreshData();
      addToast({
        type: 'success',
        title: 'تحديث الحالة',
        message: `تم تحديث حالة الخبر إلى: ${toStatus}`,
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

  const handleBulkAction = (newsIds: string[], action: 'PUBLISH' | 'APPROVE' | 'ARCHIVE' | 'DELETE') => {
    try {
      newsIds.forEach(id => {
        if (action === 'DELETE') {
          apiService.deleteNews(id, currentUser);
        } else if (action === 'ARCHIVE') {
          apiService.updateNewsStatus(id, 'ARCHIVED', currentUser, 'أرشفة جماعية');
        } else if (action === 'APPROVE') {
          apiService.updateNewsStatus(id, 'APPROVED', currentUser, 'اعتماد جماعي');
        } else if (action === 'PUBLISH') {
          apiService.updateNewsStatus(id, 'PUBLISHED', currentUser, 'نشر جماعي');
        }
      });
      refreshData();
      addToast({
        type: 'success',
        title: 'إجراء جماعي مكتمل',
        message: `تم تنفيذ عملية (${action}) على ${newsIds.length} من الأخبار المحددة`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'خطأ في الإجراء الجماعي',
        message: err.message || 'حدث خطأ أثناء تنفيذ الإجراء الجماعي',
      });
    }
  };

  const handleCreateNewNewsClick = () => {
    setSelectedNewsItem(null);
    setActiveNav('news-editor');
  };

  const handleEditNewsClick = (item: NewsItem) => {
    setSelectedNewsItem(item);
    setActiveNav('news-editor');
  };

  // --- PROGRAMS & EPISODES ACTIONS ---
  const handleSaveProgram = (progData: Partial<Program>) => {
    apiService.saveProgram(progData, currentUser);
    refreshData();
  };

  const handleDeleteProgram = (programId: string) => {
    apiService.deleteProgram(programId, currentUser);
    refreshData();
  };

  const handleSelectProgramEpisodes = (programId: string) => {
    setFilterProgramId(programId);
    setActiveNav('episodes');
  };

  const handleSaveEpisode = (epData: Partial<Episode>) => {
    apiService.saveEpisode(epData, currentUser);
    refreshData();
  };

  const handleDeleteEpisode = (episodeId: string) => {
    apiService.deleteEpisode(episodeId, currentUser);
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
    apiService.updateEpisodeRundown(episodeId, segments, currentUser);
    refreshData();
  };

  // --- GUESTS ACTIONS ---
  const handleSaveGuest = (guestData: Partial<Guest>) => {
    apiService.saveGuest(guestData, currentUser);
    refreshData();
  };

  const handleDeleteGuest = (guestId: string) => {
    apiService.deleteGuest(guestId, currentUser);
    refreshData();
  };

  // --- TASKS ACTIONS ---
  const handleSaveTask = (taskData: Partial<EditorialTask>) => {
    apiService.saveTask(taskData, currentUser);
    refreshData();
  };

  const handleDeleteTask = (taskId: string) => {
    apiService.deleteTask(taskId, currentUser);
    refreshData();
  };

  // --- MEDIA ACTIONS ---
  const handleUploadMedia = (mediaData: Partial<MediaAsset>) => {
    apiService.saveMediaAsset(mediaData, currentUser);
    refreshData();
  };

  const handleDeleteMedia = (id: string) => {
    apiService.deleteMediaAsset(id, currentUser);
    refreshData();
  };

  // --- SETTINGS ACTIONS ---
  const handleSaveCategory = (cat: Partial<Category>) => {
    apiService.saveCategory(cat);
    refreshData();
  };

  const handleDeleteCategory = (id: string) => {
    apiService.deleteCategory(id);
    refreshData();
  };

  const handleSaveSource = (source: Partial<NewsSource>) => {
    apiService.saveNewsSource(source);
    refreshData();
  };

  const handleDeleteSource = (id: string) => {
    apiService.deleteNewsSource(id);
    refreshData();
  };

  // Program selection handler
  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setActiveNav('program-detail');
  };

  // Resolve current active episode and active program
  const activeEpisode = episodes.find((e) => e.id === selectedEpisodeId) || episodes[0];
  const activeProgram = programs.find((p) => p.id === selectedProgramId) || programs[0];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans" dir="rtl">
      {/* Breaking News Ticker (Topmost) */}
      <BreakingNewsTicker
        items={
          breakingNewsItems.length > 0
            ? breakingNewsItems
            : [{ id: 'live-default', title: 'البث الإخباري الحي مستمر على مدار 24 ساعة - تغطية شاملة لكافة الأحداث المحلية والإقليمية والدولية', time: 'مباشر' }]
        }
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Application Sidebar */}
        <Sidebar
          activeNav={activeNav}
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
            onSwitchUser={handleSwitchUser}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onNavigate={(nav) => {
              setActiveNav(nav);
              setIsMobileSidebarOpen(false);
            }}
            unreadNotificationsCount={unreadNotificationsCount}
            onToggleMobileMenu={() => setIsMobileSidebarOpen((prev) => !prev)}
            onCreateNews={() => {
              setSelectedNewsItem(null);
              setActiveNav('news_create');
            }}
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
          <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
            {activeNav === 'dashboard' && (
              <DashboardView
                newsList={newsList}
                episodes={episodes}
                tasks={tasks}
                guests={guests}
                currentUser={currentUser}
                onNavigate={(view) => {
                  if (view === 'episodes') setFilterProgramId(null);
                  setActiveNav(view);
                }}
                onSelectEpisode={handleSelectEpisode}
              />
            )}

            {activeNav === 'stories' && (
              <StoriesView
                stories={stories}
                newsList={newsList}
                onSelectStory={(id) => console.log('Selected story', id)}
                onCreateStory={() => console.log('Create story')}
              />
            )}
            {activeNav === 'news' && (
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
                onToggleBreaking={(newsItem) => {
                  handleSaveNews({ ...newsItem, isBreaking: !newsItem.isBreaking });
                }}
              />
            )}

            {activeNav === 'news-editor' && (
              <NewsEditorView
                newsItem={selectedNewsItem}
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
                onEditProgram={handleSaveProgram}
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

            {activeNav === 'episode-workspace' && activeEpisode && (
              <EpisodeWorkspaceView
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

            {activeNav === 'settings' && (
              <SettingsView
                categories={categories}
                sources={sources}
                users={allUsers}
                onSaveCategory={handleSaveCategory}
                onDeleteCategory={handleDeleteCategory}
                onSaveSource={handleSaveSource}
                onDeleteSource={handleDeleteSource}
              />
            )}

            {activeNav === 'database' && <DatabaseManagerView />}

            {activeNav === 'tests' && <TestingView />}
          </main>
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
      />

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
