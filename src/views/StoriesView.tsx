import React, { useState } from 'react';
import { Search, Plus, Filter, FolderGit2, Calendar as CalendarIcon, Clock, Link as LinkIcon, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Story, NewsItem } from '../types';
import { Badge } from '../components/common/Badge';

interface StoriesViewProps {
  stories: Story[];
  newsList: NewsItem[];
  onSelectStory: (id: string) => void;
  onCreateStory: () => void;
}

export const StoriesView: React.FC<StoriesViewProps> = ({
  stories = [],
  newsList = [],
  onSelectStory,
  onCreateStory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'RESOLVED' | 'ARCHIVED'>('ACTIVE');

  const filteredStories = stories.filter(story => {
    if (story.status !== activeTab) return false;
    if (searchQuery && !story.title.includes(searchQuery) && !story.description.includes(searchQuery)) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <FolderGit2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">القصص الإخبارية والأحداث المركزية</h1>
            <p className="text-xs text-slate-500 mt-1">
              إدارة التغطيات المستمرة والملفات الإخبارية المجمعة.
            </p>
          </div>
        </div>
        <button
          onClick={onCreateStory}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إنشاء تغطية / قصة جديدة
        </button>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          {(['ACTIVE', 'RESOLVED', 'ARCHIVED'] as const).map(tab => (
             <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl transition-colors shrink-0 text-xs font-bold ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab === 'ACTIVE' ? 'التغطيات النشطة' : tab === 'RESOLVED' ? 'منتهية/مغلقة' : 'الأرشيف'}
                <span className={`mr-2 px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === tab ? 'bg-white/30' : 'bg-slate-200'}`}>
                  {stories.filter(s => s.status === tab).length}
                </span>
             </button>
          ))}
        </div>
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في القصص..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Stories Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredStories.map(story => {
          const linkedArticles = newsList.filter(n => n.storyId === story.id);
          const publishedArticles = linkedArticles.filter(n => n.status === 'PUBLISHED').length;

          return (
            <div key={story.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs hover:shadow-md transition-shadow group flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={story.priority === 'CRITICAL' ? 'danger' : story.priority === 'HIGH' ? 'warning' : 'primary'} size="sm">
                    {story.priority === 'CRITICAL' ? 'أولوية قصوى' : story.priority === 'HIGH' ? 'هامة' : 'تغطية مستمرة'}
                  </Badge>
                  {story.categoryName && (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{story.categoryName}</span>
                  )}
                </div>
                <button 
                  onClick={() => onSelectStory(story.id)}
                  className="p-2 bg-slate-50 text-indigo-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-50"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>

              <h3 className="text-lg font-bold text-slate-800 mb-2 group-hover:text-indigo-700 transition-colors">{story.title}</h3>
              <p className="text-xs text-slate-600 line-clamp-2 mb-4 leading-relaxed">{story.description}</p>
              
              <div className="mt-auto pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" /> بدأت: {new Date(story.startedAt).toLocaleDateString('ar-SA')}</span>
                  <span className="flex items-center gap-1 text-indigo-600 font-bold bg-indigo-50 px-2 py-1 rounded-lg">
                    <LinkIcon className="w-3 h-3" /> {linkedArticles.length} خبر مرتبط
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        
        {filteredStories.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <FolderGit2 className="w-12 h-12 mb-3 text-slate-300" />
            <p className="font-semibold text-sm">لا توجد قصص مطابقة</p>
          </div>
        )}
      </div>
    </div>
  );
};
