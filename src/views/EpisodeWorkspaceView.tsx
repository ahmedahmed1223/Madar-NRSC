import React, { useState } from 'react';
import {
  ArrowRight,
  ListOrdered,
  HelpCircle,
  Users,
  FileText,
  Clock,
  Radio,
  Plus,
  Trash2,
  CheckCircle,
  UserCheck,
  Phone,
  Video as VideoIcon,
  Tv,
  Edit2,
  Save,
  CheckSquare,
  Square,
  AlertCircle,
  X,
  Copy,
  Check,
} from 'lucide-react';
import {
  Episode,
  RundownSegment,
  EpisodeQuestion,
  EpisodeGuest,
  Guest,
  NewsItem,
  User,
  EpisodeStatus,
} from '../types';
import { RundownTable } from '../components/rundown/RundownTable';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { Breadcrumbs } from '../components/layout/Breadcrumbs';

interface EpisodeWorkspaceViewProps {
  episode: Episode;
  allGuests: Guest[];
  allNews: NewsItem[];
  currentUser: User;
  onUpdateRundown: (segments: RundownSegment[]) => void;
  onSaveEpisode: (episodeData: Partial<Episode>) => void;
  onBack: () => void;
}

export const EpisodeWorkspaceView: React.FC<EpisodeWorkspaceViewProps> = ({
  episode,
  allGuests,
  allNews,
  currentUser,
  onUpdateRundown,
  onSaveEpisode,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<'RUNDOWN' | 'QUESTIONS' | 'GUESTS' | 'SCRIPT'>('RUNDOWN');

  // Question modal state
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<EpisodeQuestion | null>(null);
  const [qTopic, setQTopic] = useState('المحور الأول');
  const [qText, setQText] = useState('');
  const [qSpeaker, setQSpeaker] = useState('');
  const [qNotes, setQNotes] = useState('');

  // Guest linking modal state
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState(allGuests[0]?.id || '');
  const [guestConnectionType, setGuestConnectionType] = useState<'STUDIO' | 'SATELLITE' | 'ZOOM_SKYPE' | 'PHONE'>('STUDIO');
  const [guestSegmentTopic, setGuestSegmentTopic] = useState('');
  const [guestArrivalStatus, setGuestArrivalStatus] = useState<'CONFIRMED' | 'PENDING' | 'ARRIVED'>('CONFIRMED');

  // Script state
  const [introScript, setIntroScript] = useState(episode.introScript || '');
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyScript = () => {
    if (!introScript) return;
    navigator.clipboard.writeText(introScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Status updates
  const handleUpdateStatus = (newStatus: EpisodeStatus) => {
    onSaveEpisode({ id: episode.id, status: newStatus });
  };

  // Questions management
  const handleOpenAddQuestion = () => {
    setEditingQuestion(null);
    setQTopic('المحور الرئيسي');
    setQText('');
    setQSpeaker('');
    setQNotes('');
    setIsQuestionModalOpen(true);
  };

  const handleOpenEditQuestion = (q: EpisodeQuestion) => {
    setEditingQuestion(q);
    setQTopic(q.topicName);
    setQText(q.questionText);
    setQSpeaker(q.assignedToName || '');
    setQNotes(q.notes || '');
    setIsQuestionModalOpen(true);
  };

  const handleSaveQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const currentQuestions = [...(episode.questions || [])];

    if (editingQuestion) {
      const updated = currentQuestions.map((q) =>
        q.id === editingQuestion.id
          ? {
              ...q,
              topicName: qTopic,
              questionText: qText,
              assignedToName: qSpeaker,
              notes: qNotes,
            }
          : q
      );
      onSaveEpisode({ id: episode.id, questions: updated });
    } else {
      const newQ: EpisodeQuestion = {
        id: `q-${Date.now()}`,
        episodeId: episode.id,
        topicName: qTopic,
        questionText: qText,
        assignedToName: qSpeaker,
        notes: qNotes,
        orderIndex: currentQuestions.length + 1,
        isAsked: false,
      };
      onSaveEpisode({ id: episode.id, questions: [...currentQuestions, newQ] });
    }
    setIsQuestionModalOpen(false);
  };

  const toggleQuestionAsked = (questionId: string) => {
    const updated = (episode.questions || []).map((q) =>
      q.id === questionId ? { ...q, isAsked: !q.isAsked } : q
    );
    onSaveEpisode({ id: episode.id, questions: updated });
  };

  const handleDeleteQuestion = (questionId: string) => {
    const filtered = (episode.questions || []).filter((q) => q.id !== questionId);
    onSaveEpisode({ id: episode.id, questions: filtered });
  };

  // Guests management
  const handleLinkGuest = (e: React.FormEvent) => {
    e.preventDefault();
    const guestObj = allGuests.find((g) => g.id === selectedGuestId);
    if (!guestObj) return;

    const currentGuests = [...(episode.guests || [])];
    const newEpGuest: EpisodeGuest = {
      guestId: guestObj.id,
      guestName: guestObj.fullName,
      guestAvatar: guestObj.avatarUrl,
      organization: guestObj.organization,
      jobTitle: guestObj.jobTitle,
      connectionType: guestConnectionType,
      segmentTopic: guestSegmentTopic || 'مناقشة محاور الحلقة',
      arrivalStatus: guestArrivalStatus,
    };

    onSaveEpisode({ id: episode.id, guests: [...currentGuests, newEpGuest] });
    setIsGuestModalOpen(false);
  };

  const handleRemoveGuest = (guestId: string) => {
    const filtered = (episode.guests || []).filter(
      (g) => (g.guestId || (g as any).id) !== guestId
    );
    onSaveEpisode({ id: episode.id, guests: filtered });
  };

  const handleSaveIntroScript = () => {
    onSaveEpisode({ id: episode.id, introScript });
  };

  const connectionTypeLabels = {
    STUDIO: { label: 'حضور مباشر في الاستوديو', icon: Tv },
    SATELLITE: { label: 'عبر الأقمار الصناعية (SNG)', icon: Radio },
    ZOOM_SKYPE: { label: 'بث رقمي مرئي مباشر (Live Link)', icon: VideoIcon },
    PHONE: { label: 'اتصال هاتفي مباشر', icon: Phone },
  };

  return (
    <div className="space-y-6">
      {/* Contextual Navigation Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'دليل الحلقات', onClick: onBack },
          { label: episode.programName },
          { label: `حلقة #${episode.episodeNumber}: ${episode.title}` },
        ]}
        statusBadge={{
          label:
            episode.status === 'ON_AIR'
              ? 'على الهواء الآن'
              : episode.status === 'READY_FOR_BROADCAST'
              ? 'جاهزة للبث'
              : episode.status === 'IN_PREPARATION'
              ? 'قيد الإعداد'
              : 'مرحلة التخطيط',
          variant:
            episode.status === 'ON_AIR'
              ? 'danger'
              : episode.status === 'READY_FOR_BROADCAST'
              ? 'success'
              : episode.status === 'IN_PREPARATION'
              ? 'warning'
              : 'default',
        }}
        onBack={onBack}
        backLabel="العودة للحلقات"
      />

      {/* Top Episode Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="العودة للحلقات"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                  {episode.programName}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  حلقة #{episode.episodeNumber} (الموسم {episode.seasonNumber})
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-800 mt-1">
                {episode.title}
              </h1>
            </div>
          </div>

          {/* Episode Live Status Controller */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 font-semibold">حالة الحلقة:</span>
              <select
                value={episode.status}
                onChange={(e) => handleUpdateStatus(e.target.value as EpisodeStatus)}
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="PLANNING">مرحلة التخطيط</option>
                <option value="IN_PREPARATION">قيد الإعداد والتحرير</option>
                <option value="READY_FOR_BROADCAST">جاهز للبث المباشر</option>
                <option value="ON_AIR">على الهواء الآن (ON AIR)</option>
                <option value="BROADCASTED">تم البث</option>
                <option value="ARCHIVED">مؤرشفة</option>
              </select>
            </div>
          </div>
        </div>

        {/* Episode Info Bar */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-8 pt-3 border-t border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>موعد البث:</span>
            <strong className="text-slate-800 font-mono">
              {episode.broadcastDate} ({episode.startTime} - {episode.endTime})
            </strong>
          </div>
          <div className="flex items-center gap-1.5">
            <Tv className="w-4 h-4 text-slate-400" />
            <span>الاستوديو:</span>
            <strong className="text-slate-800">{episode.studioName}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span>المقدم:</span>
            <strong className="text-slate-800">{episode.presenterName}</strong>
          </div>
          <div className="flex items-center gap-1.5">
            <span>المنتج:</span>
            <strong className="text-slate-800">{episode.producerName}</strong>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('RUNDOWN')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'RUNDOWN'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>مخطط الرانداون التلفزيوني ({episode.rundown?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('QUESTIONS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'QUESTIONS'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>محاور النقاش وبنك الأسئلة ({episode.questions?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('GUESTS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'GUESTS'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>الضيوف والمشاركون ({episode.guests?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('SCRIPT')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'SCRIPT'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>سكريبت المقدمة والأوتوكيو</span>
        </button>
      </div>

      {/* TAB 1: RUNDOWN */}
      {activeTab === 'RUNDOWN' && (
        <RundownTable
          segments={episode.rundown || []}
          plannedDurationMinutes={episode.durationMinutes}
          onUpdateRundown={onUpdateRundown}
          guests={allGuests}
          newsList={allNews}
          defaultPresenter={episode.presenterName}
          canEdit={true}
          episodeId={episode.id}
        />
      )}

      {/* TAB 2: QUESTIONS & TOPICS */}
      {activeTab === 'QUESTIONS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div>
              <h3 className="text-sm font-bold text-slate-800">بنك الأسئلة ومحاور الحوار</h3>
              <p className="text-xs text-slate-500">
                قائمة الأسئلة المنظمة للمذيع داخل الاستوديو مع إمكانية التأشير على الأسئلة المطروحة
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenAddQuestion}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Plus className="w-4 h-4" />
              إضافة سؤال جديد
            </button>
          </div>

          <div className="space-y-3">
            {(!episode.questions || episode.questions.length === 0) ? (
              <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-xs">
                لا توجد أسئلة أو محاور مجهزة للحلقة بعد. انقر على "إضافة سؤال جديد" لبدء الإعداد.
              </div>
            ) : (
              episode.questions.map((q, idx) => (
                <div
                  key={q.id ? `q-item-${q.id}` : `q-idx-${idx}`}
                  className={`bg-white p-4 rounded-2xl border transition-all ${
                    q.isAsked ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <button
                        type="button"
                        onClick={() => toggleQuestionAsked(q.id)}
                        className={`mt-0.5 p-1 rounded-md transition-colors ${
                          q.isAsked ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'
                        }`}
                        title={q.isAsked ? 'تم طرح السؤال' : 'تأشير كـ تم طرحه'}
                      >
                        {q.isAsked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                      </button>

                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                            {q.topicName}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">سؤال #{idx + 1}</span>
                          {q.isAsked && (
                            <Badge variant="success" size="sm">
                              تم طرحه على الهواء
                            </Badge>
                          )}
                        </div>

                        <p className={`text-sm font-bold text-slate-800 leading-relaxed ${
                          q.isAsked ? 'line-through text-slate-400' : ''
                        }`}>
                          {q.questionText}
                        </p>

                        {q.notes && (
                          <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                            توجيهات للمذيع: {q.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {q.assignedToName && (
                        <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg">
                          موجه إلى: {q.assignedToName}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEditQuestion(q)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="تعديل السؤال"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        title="حذف السؤال"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: GUESTS */}
      {activeTab === 'GUESTS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div>
              <h3 className="text-sm font-bold text-slate-800">قائمة الضيوف والمشاركين في الحلقة</h3>
              <p className="text-xs text-slate-500">
                إدارة وسيلة الاتصال، الحضور، وتأكيد جاهزية الضيوف قبل وأثناء البث
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsGuestModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Plus className="w-4 h-4" />
              ربط ضيف بالحلقة
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(!episode.guests || episode.guests.length === 0) ? (
              <div className="md:col-span-2 bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-xs">
                لا يوجد ضيوف مرتبطون بهذه الحلقة حتى الآن. انقر على "ربط ضيف بالحلقة".
              </div>
            ) : (
              episode.guests.map((g, idx) => {
                const guestKey = g.guestId || (g as any).id || `ep-gst-${idx}`;
                const conn = connectionTypeLabels[g.connectionType] || connectionTypeLabels.STUDIO;
                const Icon = conn.icon;

                return (
                  <div
                    key={guestKey}
                    className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={g.guestAvatar || '/avatar.svg'}
                          alt={g.guestName}
                          className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-200"
                        />
                        <div>
                          <h4 className="text-sm font-bold text-slate-800">{g.guestName}</h4>
                          <p className="text-xs text-slate-500">
                            {g.jobTitle} - {g.organization}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveGuest(g.guestId || (g as any).id || guestKey)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                        title="إلغاء مشاركة الضيف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-2.5 bg-slate-50 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">وسيلة المشاركة:</span>
                        <span className="flex items-center gap-1 font-semibold text-slate-700">
                          <Icon className="w-3.5 h-3.5 text-blue-600" />
                          {conn.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">حالة التواجد:</span>
                        <Badge
                          variant={g.arrivalStatus === 'ARRIVED' ? 'success' : 'warning'}
                          size="sm"
                        >
                          {g.arrivalStatus === 'ARRIVED'
                            ? 'وصل / جاهز على الخط'
                            : 'مؤكد الحضور'}
                        </Badge>
                      </div>
                      <div className="text-slate-600">
                        <span className="text-slate-400">محور المداخلة: </span>
                        <strong>{g.segmentTopic}</strong>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SCRIPT & AUTOCUE */}
      {activeTab === 'SCRIPT' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                سكريبت المقدمة الترحيبية (Autocue Script)
              </h3>
              <p className="text-xs text-slate-500">
                النص الكامل لقراءة المذيع في افتتاحية الحلقة على شاشة الأوتوكيو
              </p>
            </div>
            <div className="flex items-center gap-2">
              {introScript && (
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                  title="نسخ السكريبت"
                >
                  {copiedScript ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span className="text-emerald-700">تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>نسخ النص</span>
                    </>
                  )}
                </button>
              )}
              {introScript && (
                <button
                  type="button"
                  onClick={() => setIntroScript('')}
                  className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-xl text-xs font-bold transition-all"
                  title="مسح النص"
                >
                  <X className="w-4 h-4" />
                  <span>مسح</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveIntroScript}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
              >
                <Save className="w-4 h-4" />
                حفظ السكريبت
              </button>
            </div>
          </div>

          {/* Quick Script Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 ml-1">قوالب جاهزة:</span>
            {[
              {
                label: 'نشرة الأخبار الرئيسية',
                text: `أهلاً بكم مشاهدينا الكرام في هذه النشرة الإخبارية الرئيسية من برنامج ${episode.programName}، نسلط الضوء الليلة على أبرز الملفات والتطورات السياسية والاقتصادية على الساحتين الإقليمية والدولية. نبدأ معكم بأبرز العناوين...`,
              },
              {
                label: 'تغطية خاصة وعاجلة',
                text: `مشاهدونا الأعزاء، نرحب بكم في هذه التغطية المباشرة والمفتوحة لمواكبة التطورات المتسارعة، حيث نتابع مع شبكة مراسلينا وضيوفنا تفاصيل المشهد والقرارات الحاسمة الصادرة للتو...`,
              },
              {
                label: 'برنامج حواري مسائي',
                text: `مساء الخير وأهلاً بكم في حلقة جديدة من ${episode.programName}. ملفات ساخنة وقراءة في كواليس الأحداث نناقشها الليلة مع ضيوفنا في الاستوديو وعبر الأقمار الصناعية...`,
              },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setIntroScript(preset.text)}
                className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2.5 py-1 rounded-lg transition-colors font-medium"
              >
                +{preset.label}
              </button>
            ))}
          </div>

          <label htmlFor="intro-script-textarea" className="sr-only">اسكريبت مقدمة الحلقة التلفزيونية</label>
          <textarea
            id="intro-script-textarea"
            rows={10}
            value={introScript}
            onChange={(e) => setIntroScript(e.target.value)}
            placeholder="أهلاً بكم مشاهدينا الكرام في حلقة جديدة ومباشرة من برنامج..."
            className="w-full p-4 bg-white border border-slate-300 rounded-xl text-sm leading-loose text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>الكلمات: <strong>{introScript.split(/\s+/).filter(Boolean).length}</strong></span>
            <span>الزمن التقديري للإلقاء: <strong>{Math.ceil(introScript.split(/\s+/).filter(Boolean).length / 2.5)} ثانية</strong></span>
          </div>
        </div>
      )}

      {/* Add / Edit Question Modal */}
      <Modal
        isOpen={isQuestionModalOpen}
        onClose={() => setIsQuestionModalOpen(false)}
        title={editingQuestion ? 'تعديل السؤال' : 'إضافة سؤال ومحور حوار'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveQuestion} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="question-topic-input" className="block text-xs font-bold text-slate-700">المحور العام *</label>
              {qTopic && (
                <button
                  type="button"
                  onClick={() => setQTopic('')}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  مسح
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="question-topic-input"
                type="text"
                required
                value={qTopic}
                onChange={(e) => setQTopic(e.target.value)}
                placeholder="مثال: التداعيات الاقتصادية، المحور المالي"
                className="w-full pr-3.5 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {qTopic && (
                <button
                  type="button"
                  onClick={() => setQTopic('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {['المحور السياسي', 'التداعيات الاقتصادية', 'المسار الدبلوماسي', 'الوضع الميداني', 'سؤال ختامي'].map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setQTopic(tp)}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors"
                >
                  +{tp}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="question-text-textarea" className="block text-xs font-bold text-slate-700">صيغة السؤال المباشر *</label>
              {qText && (
                <button
                  type="button"
                  onClick={() => setQText('')}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  مسح
                </button>
              )}
            </div>
            <textarea
              id="question-text-textarea"
              rows={3}
              required
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="اكتب صيغة السؤال الصحفي بدقة وبشكل مباشر للمذيع..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 leading-relaxed transition-all"
            />
          </div>

          <div>
            <label htmlFor="question-speaker-input" className="block text-xs font-bold text-slate-700 mb-1">الضيف الموجه له (اختياري)</label>
            <div className="relative">
              <input
                id="question-speaker-input"
                type="text"
                value={qSpeaker}
                onChange={(e) => setQSpeaker(e.target.value)}
                placeholder="اسم الضيف المستهدف بالإجابة"
                className="w-full pr-3.5 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {qSpeaker && (
                <button
                  type="button"
                  onClick={() => setQSpeaker('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="question-notes-input" className="block text-xs font-bold text-slate-700 mb-1">توجيهات أو معلومات إضافية للمذيع</label>
            <div className="relative">
              <input
                id="question-notes-input"
                type="text"
                value={qNotes}
                onChange={(e) => setQNotes(e.target.value)}
                placeholder="أرقام وإحصائيات داعمة للمحاورة..."
                className="w-full pr-3.5 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {qNotes && (
                <button
                  type="button"
                  onClick={() => setQNotes('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsQuestionModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              حفظ السؤال
            </button>
          </div>
        </form>
      </Modal>

      {/* Link Guest Modal */}
      <Modal
        isOpen={isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        title="ربط ضيف من الأرشيف بالحلقة"
        maxWidth="md"
      >
        <form onSubmit={handleLinkGuest} className="space-y-4">
          <div>
            <label htmlFor="link-guest-select" className="block text-xs font-bold text-slate-700 mb-1">اختر الضيف من بنك الضيوف *</label>
            <select
              id="link-guest-select"
              value={selectedGuestId}
              onChange={(e) => setSelectedGuestId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              {allGuests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.fullName} ({g.jobTitle} - {g.organization})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="guest-connection-select" className="block text-xs font-bold text-slate-700 mb-1">وسيلة الاتصال والمشاركة</label>
            <select
              id="guest-connection-select"
              value={guestConnectionType}
              onChange={(e) => setGuestConnectionType(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              <option value="STUDIO">حضور مباشر داخل الاستوديو</option>
              <option value="SATELLITE">عبر الأقمار الصناعية (SNG / Satellite)</option>
              <option value="ZOOM_SKYPE">بث رقمي مرئي مباشر (Live Video Link)</option>
              <option value="PHONE">اتصال هاتفي مباشر</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="guest-topic-input" className="block text-xs font-bold text-slate-700">موضوع المداخلة أو الفقرة</label>
              {guestSegmentTopic && (
                <button
                  type="button"
                  onClick={() => setGuestSegmentTopic('')}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  مسح
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="guest-topic-input"
                type="text"
                value={guestSegmentTopic}
                onChange={(e) => setGuestSegmentTopic(e.target.value)}
                placeholder="مثال: مناقشة تقرير أسواق المال"
                className="w-full pr-3.5 pl-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              {guestSegmentTopic && (
                <button
                  type="button"
                  onClick={() => setGuestSegmentTopic('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {['تحليل التطورات السياسية', 'قراءة في المؤشرات الاقتصادية', 'المتابعة الميدانية والشهادات', 'حوار طاولة مستديرة'].map((top) => (
                <button
                  key={top}
                  type="button"
                  onClick={() => setGuestSegmentTopic(top)}
                  className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-2 py-0.5 rounded-md transition-colors"
                >
                  +{top}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="guest-arrival-select" className="block text-xs font-bold text-slate-700 mb-1">حالة التواجد والتأكيد</label>
            <select
              id="guest-arrival-select"
              value={guestArrivalStatus}
              onChange={(e) => setGuestArrivalStatus(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              <option value="CONFIRMED">تم تأكيد الموعد مع الضيف</option>
              <option value="ARRIVED">وصل للاستوديو / متصل على الخط</option>
              <option value="PENDING">قيد المتابعة والتأكيد</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsGuestModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              ربط بالحلقة
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
