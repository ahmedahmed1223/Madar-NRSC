import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { arabicDate, stationTimeZone } from '../shared/dates';
import { confirmDialog } from '../services/dialogs';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { useFormDraft } from '../hooks/useFormDraft';
import { Avatar } from '../components/common/Avatar';
import { RbacService } from '../services/rbacService';
import React, { useEffect, useState } from 'react';
import { Plus, Search, Phone, Mail, Edit2, Trash2 } from 'lucide-react';
import { Guest, User } from '../types';
import { Badge } from '../components/common/Badge';
import { apiService } from '../services/api';
import { dataStore } from '../services/dataStore';
import { navigateTo } from '../services/uiEvents';
import { useLiveData } from '../hooks/useLiveData';
import { bookingStatusName, bookingStatusOf, connectionName, episodeGuestList, guestKey } from '../shared/episodePlan';
import { stationWall } from '../shared/stationTime';
import { airedGuestAppearances, guestAppearanceHistory, type GuestAppearance } from '../shared/guestAppearances';
import type { Episode, EpisodeGuest } from '../types';

interface GuestsViewProps {
  guests: Guest[];
  currentUser: User;
  onSaveGuest: (guest: Partial<Guest>) => boolean | Promise<boolean>;
  onDeleteGuest?: (guestId: string) => void;
}

export const GuestsView: React.FC<GuestsViewProps> = ({
  guests,
  currentUser,
  onSaveGuest,
  onDeleteGuest,
}) => {
  const canManage = RbacService.hasPermission(currentUser, 'guests.manage');
  const canSeeEpisode = RbacService.canOpenScreen(currentUser, 'episode-workspace');
  const canSeeBulletins = RbacService.canOpenScreen(currentUser, 'bulletins');
  useLiveData(['episodes', 'bulletins', 'bulletinStories', 'onAir', 'users', 'settings'], 60_000);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('ALL');
  const [searchedGuests, setSearchedGuests] = useState<Guest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const draft = useFormDraft(`guest:${currentUser.id}:${editingGuest?.id || 'new'}`, isModalOpen,
    { fullName, organization, jobTitle, specialty, phone, email, notes, avatarUrl }, value => {
      setFullName(value.fullName); setOrganization(value.organization); setJobTitle(value.jobTitle);
      setSpecialty(value.specialty); setPhone(value.phone); setEmail(value.email);
      setNotes(value.notes); setAvatarUrl(value.avatarUrl);
    });

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchedGuests([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void dataStore.searchCollection('guests', searchQuery, controller.signal)
        .then(rows => setSearchedGuests(rows.map(row => row.d as Guest)))
        .catch(() => { if (!controller.signal.aborted) setSearchedGuests([]); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchQuery]);

  const SPECIALTY_PRESETS = [
    'علاقات دولية ودبلوماسية',
    'اقتصاد وأسواق مالية',
    'أمن ودفاع واستراتيجيا',
    'طاقة ونفط ومناخ',
    'ذكاء اصطناعي وتقنية',
    'قانون دستوري وتشريع',
    'شؤون اجتماعية وصحة',
  ];

  const ORG_PRESETS = [
    'مركز الدراسات الاستراتيجية',
    'جامعة الملك سعود',
    'منظمة الصحة العالمية',
    'صندوق النقد والبنك الدولي',
    'هيئة الفضاء والتقنية',
  ];


  const allGuests = Array.from(new Map([...guests, ...searchedGuests].map(guest => [guest.id, guest])).values());
  const specialties = Array.from(new Set(allGuests.map((g) => g.specialty).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));

  const handleOpenAdd = () => {
    setEditingGuest(null);
    setFullName('');
    setOrganization('');
    setJobTitle('');
    setSpecialty('شؤون سياسية');
    setPhone('');
    setEmail('');
    setNotes('');
    setAvatarUrl('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (guest: Guest) => {
    setEditingGuest(guest);
    setFullName(guest.fullName);
    setOrganization(guest.organization);
    setJobTitle(guest.jobTitle);
    setSpecialty(guest.specialty);
    setPhone(guest.phone || '');
    setEmail(guest.email || '');
    setNotes(guest.notes || '');
    setAvatarUrl(guest.avatarUrl || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
    const saved = await onSaveGuest({
      id: editingGuest?.id,
      fullName,
      organization,
      jobTitle,
      specialty,
      phone,
      email,
      notes,
      avatarUrl: avatarUrl || '/avatar.svg',
    });
    if (saved) { draft.clearDraft(); setIsModalOpen(false); }
    } finally { setSaving(false); }
  };

  const filteredGuests = allGuests.filter((g) => {
    if (selectedSpecialty !== 'ALL' && g.specialty !== selectedSpecialty) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, g.fullName, g.organization, g.jobTitle, g.specialty, ...(canManage ? [g.email, g.phone] : []));
    }
    return true;
  });
  const guestPage = useIncremental(filteredGuests, 48, `${searchQuery}|${selectedSpecialty}`);
  const zone = stationTimeZone(apiService.getSettings().defaultTimezone);
  const today = stationWall(Date.now(), zone).date;
  const episodes = canSeeEpisode ? apiService.getEpisodes() : [];
  const bulletins = canSeeBulletins ? apiService.getAirShows().filter(show => show.kind === 'bulletin') : [];
  const showPaths = new Map<string, string>([
    ...episodes.map(episode => [episode.id, `/episodes/${encodeURIComponent(episode.id)}`] as const),
    ...bulletins.map(bulletin => [bulletin.id, `/bulletins/${encodeURIComponent(bulletin.id)}`] as const),
  ]);
  const airedAppearances = airedGuestAppearances([...episodes, ...bulletins], apiService.getOnAirStates(), zone);
  const followUps = new Map<string, { episode: Episode; booking: EpisodeGuest }>();
  if (canSeeEpisode) {
    const upcoming = episodes.filter(episode => episode.broadcastDate >= today && !['CANCELLED', 'BROADCASTED', 'ARCHIVED'].includes(episode.status))
      .sort((a, b) => `${a.broadcastDate}${a.startTime}`.localeCompare(`${b.broadcastDate}${b.startTime}`));
    for (const episode of upcoming) for (const booking of episodeGuestList(episode) as EpisodeGuest[]) {
      const key = guestKey(booking);
      if (key && !followUps.has(key)) followUps.set(key, { episode, booking });
    }
  }
  const ownerNames = new Map(followUps.size ? apiService.getUsers().map(user => [user.id, user.fullName]) : []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">
            الضيوف
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            الخبراء والمحللون وبيانات تواصلهم وسجل ظهورهم.
          </p>
        </div>

        {canManage && (
        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 min-h-11 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة ضيف جديد
        </button>
        )}
      </div>

      {/* Filter Bar */}
      <div role="group" aria-label="تصفية دليل الضيوف" className="bg-white p-3 rounded-xl border border-slate-200 grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-end gap-3">
        <div className="relative min-w-0">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="guests-search-input"
            type="search"
            aria-label="البحث في دليل الضيوف"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، المؤسسة، أو التخصص..."
            autoComplete="off"
            spellCheck="false"
            className="w-full min-h-11 pr-10 pl-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>

        <div className="grid gap-1 min-w-0">
          <label htmlFor="guests-specialty-filter" className="text-xs text-slate-700 font-semibold">مجال التخصص</label>
          <select
            id="guests-specialty-filter"
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            className="w-full min-w-0 min-h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="ALL">جميع المجالات</option>
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Guests Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {guestPage.visible.map((guest) => {
          const followUp = followUps.get(guest.id);
          const history = guestAppearanceHistory(guest, airedAppearances.get(guest.id));
          const latest = history[0]?.date || guest.lastAppearanceDate;
          return (
          <article
            key={guest.id}
            className="min-w-0 bg-white rounded-xl border border-slate-200 p-3 sm:p-4 flex flex-col"
          >
            <div className="space-y-3 flex-1">
              <div className="flex items-start gap-3 min-w-0">
                <Avatar src={guest.avatarUrl} name={guest.fullName} className="w-14 h-14 shrink-0 rounded-xl ring-2 ring-slate-100" />
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h2 className="font-bold text-slate-900 text-base leading-snug">{guest.fullName}</h2>
                  <p className="text-xs text-slate-500">{guest.jobTitle}</p>
                  <p className="text-xs text-blue-700 font-semibold">{guest.organization}</p>
                </div>
              </div>

              {/* Specialty & last appearance */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                {guest.specialty && (
                  <Badge variant="primary" size="sm" className="max-w-full whitespace-normal! leading-snug">
                    {guest.specialty}
                  </Badge>
                )}
                <p className="text-2xs text-slate-500">
                  {latest ? `آخر ظهور: ${arabicDate(latest)}` : 'لم يُسجل ظهور'}
                </p>
              </div>
              <AppearanceHistory entries={history} month={today.slice(0, 7)} showPaths={showPaths} />

              {followUp && <div className="space-y-1 pt-2 border-t border-slate-200 text-xs text-slate-700" aria-label="متابعة الظهور">
                <p className="font-bold">{bookingStatusName(bookingStatusOf(followUp.booking))}{followUp.booking.connectionType ? ` · ${connectionName(followUp.booking.connectionType)}` : ''}</p>
                <p>مسؤول التواصل {ownerNames.get(followUp.booking.contactOwnerId || '') || 'غير مسند'}</p>
                <p>{arabicDate(followUp.episode.broadcastDate)} · {followUp.episode.startTime}{zone ? ` · ${zone}` : ''}</p>
                <button type="button" onClick={() => navigateTo.emit(`/episodes/${encodeURIComponent(followUp.episode.id)}`)} className="min-h-11 font-semibold text-blue-700 hover:underline break-words">{followUp.episode.title}</button>
              </div>}
              {/* Contact Info */}
              {canManage && (guest.phone || guest.email || guest.notes) && (
              <div className="text-xs text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                {guest.phone && (
                  <a href={`tel:${guest.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 min-h-11 sm:min-h-8 hover:text-blue-700 hover:underline" aria-label={`اتصال بـ ${guest.fullName}: ${guest.phone}`}>
                    <Phone className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden />
                    <span dir="ltr" className="min-w-0 tabular-nums [overflow-wrap:anywhere]">{guest.phone}</span>
                  </a>
                )}
                {guest.email && (
                  <a href={`mailto:${guest.email}`} className="flex items-center gap-2 min-h-11 sm:min-h-8 hover:text-blue-700 hover:underline" title={guest.email}>
                    <Mail className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden />
                    <span dir="ltr" className="min-w-0 [overflow-wrap:anywhere]">{guest.email}</span>
                  </a>
                )}
                {guest.notes && (
                  <p className="py-1 text-xs text-slate-600 line-clamp-2 [overflow-wrap:anywhere]">
                    {guest.notes}
                  </p>
                )}
              </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 mt-4 space-y-1.5 text-xs text-slate-500">
              <span>عدد مرات الظهور: <strong className="text-slate-800 font-mono">{guest.totalAppearances}</strong></span>
              {(guest.appearanceHistory || []).slice(0, 3).map((a) => (
                <div key={a.episodeId} className="flex items-center justify-between gap-2 text-2xs">
                  <span className="truncate text-slate-700">{a.programName} — {a.episodeTitle}</span>
                  <span className="tabular-nums shrink-0">{arabicDate(a.date)}</span>
                </div>
              ))}
            </div>
            {canManage && (
              <div className="flex items-center gap-1 border-t border-slate-100 mt-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(guest)}
                  className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label={`تعديل بيانات الضيف: ${guest.fullName}`}
                  title="تعديل بيانات الضيف"
                >
                  <Edit2 className="w-4 h-4" aria-hidden />
                </button>

                {onDeleteGuest && (
                  <button
                    type="button"
                    onClick={async () => {
                      if ((await confirmDialog(`هل أنت متأكد من حذف الضيف: "${guest.fullName}"؟`))) {
                        onDeleteGuest(guest.id);
                      }
                    }}
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 inline-flex items-center justify-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    aria-label={`حذف الضيف: ${guest.fullName}`}
                    title="حذف الضيف من الأرشيف"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                )}
              </div>
            )}
          </article>
        ); })}
        {filteredGuests.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center">
            <p role="status" className="text-sm text-slate-700">{guests.length ? 'لا ضيوف يطابقون البحث أو التخصص.' : 'لا ضيوف في الدليل بعد.'}</p>
            {guests.length > 0 && <button type="button" onClick={() => { setSearchQuery(''); setSelectedSpecialty('ALL'); }} className="min-h-11 px-3 text-sm font-semibold text-blue-700 hover:underline">مسح الفلاتر</button>}
          </div>
        )}
      </div>
      <ShowMore
        remaining={guestPage.remaining + (searchQuery.trim()
          ? Number(dataStore.collectionSearchHasMore('guests', searchQuery))
          : Number(dataStore.collectionHasMore('guests')))}
        onMore={() => {
          guestPage.showMore();
          if (searchQuery.trim()) void dataStore.loadMoreSearchCollection('guests', searchQuery);
          else void dataStore.loadMoreCollection('guests');
        }}
        noun="ضيف"
      />

      {/* Add/Edit Modal */}
      <FormPage
        isOpen={isModalOpen}
        draft={draft}
        onClose={() => setIsModalOpen(false)}
        title={editingGuest ? 'تعديل بيانات الضيف' : 'إضافة ضيف جديد للأرشيف'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="guest-fullname-input" className="block text-xs font-bold text-slate-700">الاسم الكامل واللقب العلمي *</label>
              {fullName && (
                <button
                  type="button"
                  onClick={() => setFullName('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="guest-fullname-input"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="مثال: د. عبد الله السعيد أو سعادة السفير..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="guest-jobtitle-input" className="block text-xs font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
              <input
                id="guest-jobtitle-input"
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="مثال: كبير المحللين الماليين"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="guest-organization-input" className="block text-xs font-bold text-slate-700 mb-1">المؤسسة / الجهة</label>
              <input
                id="guest-organization-input"
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="مثال: مركز الدراسات الدولية"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Quick Organization Presets */}
          <div className="flex flex-wrap gap-1">
            <span className="text-2xs text-slate-500 font-bold">مقترحات جهات:</span>
            {ORG_PRESETS.map((org) => (
              <button
                key={org}
                type="button"
                onClick={() => setOrganization(org)}
                className="text-2xs bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
              >
                {org}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="guest-specialty-input" className="block text-xs font-bold text-slate-700 mb-1">مجال التخصص والخبرة</label>
            <input
              id="guest-specialty-input"
              type="text"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="مثال: علاقات دولية، نفط وغاز، ذكاء اصطناعي"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            {/* Quick Specialty Chips */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SPECIALTY_PRESETS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpecialty(sp)}
                  className={`text-2xs px-2 py-0.5 rounded-full transition-all ${
                    specialty === sp
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="guest-phone-input" className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف والتواصل المباشر</label>
              <input
                id="guest-phone-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+966 50 000 0000"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                dir="ltr"
              />
            </div>
            <div>
              <label htmlFor="guest-email-input" className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
              <input
                id="guest-email-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="expert@domain.com"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="guest-avatar-input" className="block text-xs font-bold text-slate-700">رابط الصورة الشخصية</label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="text-2xs text-slate-500 hover:text-rose-500"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              id="guest-avatar-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck="false"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://...jpg"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-left font-mono text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="guest-notes-textarea" className="block text-xs font-bold text-slate-700 mb-1">ملاحظات التحرير والتنسيق والتوفر</label>
            <textarea
              id="guest-notes-textarea"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أوقات التوفر المفضلة، اللغات التي يتحدث بها، أي قيود أو اشتراطات..."
              className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void draft.close(() => setIsModalOpen(false))}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-xs"
            >
              حفظ في الأرشيف
            </button>
          </div>
        </form>
      </FormPage>
    </div>
  );
};

function AppearanceHistory({ entries, month, showPaths }: {
  entries: GuestAppearance[];
  month: string;
  showPaths: ReadonlyMap<string, string>;
}) {
  const thisMonth = entries.filter(entry => entry.date.startsWith(month)).length;
  return (
    <details className="border-t border-slate-100 text-xs text-slate-700">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 font-semibold">
        <span>سجل الظهور</span><span className="text-slate-600">هذا الشهر <bdi>{thisMonth}</bdi></span>
      </summary>
      {entries.length === 0 ? <p className="pb-2">لا توجد مشاركات موثقة.</p> : (
        <ul className="space-y-2 pb-2">
          {entries.slice(0, 5).map(entry => (
            <li key={entry.episodeId} className="min-w-0 rounded-md bg-slate-50 p-2 [overflow-wrap:anywhere]">
              <p>{arabicDate(entry.date)}{entry.programName ? ` · ${entry.programName}` : ''}</p>
              {showPaths.has(entry.episodeId) ? (
                <button type="button" className="min-h-11 text-start font-semibold text-blue-700 hover:underline" onClick={() => navigateTo.emit(showPaths.get(entry.episodeId)!)}>{entry.episodeTitle}</button>
              ) : <p className="mt-1 font-semibold">{entry.episodeTitle}</p>}
              {entry.topics.length > 0 && <p>{entry.topics.join('، ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
