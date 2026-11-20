import { ShowMore, useIncremental } from '../components/common/ShowMore';
import { arabicDate } from '../shared/dates';
import { confirmDialog } from '../services/dialogs';
import { matchesQuery } from '../shared/search';
import { FormPage } from '../components/common/FormPage';
import { useFormDraft } from '../hooks/useFormDraft';
import { Avatar } from '../components/common/Avatar';
import { RbacService } from '../services/rbacService';
import React, { useState } from 'react';
import { Plus, Search, Phone, Mail, Edit2, Trash2 } from 'lucide-react';
import { Guest, User } from '../types';
import { Badge } from '../components/common/Badge';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('ALL');
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


  const specialties = Array.from(new Set(guests.map((g) => g.specialty)));

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

  const filteredGuests = guests.filter((g) => {
    if (selectedSpecialty !== 'ALL' && g.specialty !== selectedSpecialty) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, g.fullName, g.organization, g.jobTitle, g.specialty, g.email, g.phone);
    }
    return true;
  });
  const guestPage = useIncremental(filteredGuests, 48, `${searchQuery}|${selectedSpecialty}`);

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
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة ضيف جديد
        </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="guests-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، المؤسسة، أو التخصص..."
            autoComplete="off"
            spellCheck="false"
            className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="guests-specialty-filter" className="text-xs text-slate-500 shrink-0 font-medium">مجال التخصص:</label>
          <select
            id="guests-specialty-filter"
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            className="px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all w-full sm:w-auto"
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {guestPage.visible.map((guest) => (
          <div
            key={guest.id}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between hover:shadow-md transition-all group"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={guest.avatarUrl} name={guest.fullName} className="w-14 h-14 shrink-0 rounded-2xl ring-2 ring-slate-100" />
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-800 text-sm">{guest.fullName}</h3>
                    <p className="text-xs text-slate-500">{guest.jobTitle}</p>
                    <p className="text-xs text-blue-700 font-semibold">{guest.organization}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {canManage && (
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(guest)}
                    className="min-h-10 min-w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label={`تعديل بيانات الضيف: ${guest.fullName}`}
                    title="تعديل بيانات الضيف"
                  >
                    <Edit2 className="w-4 h-4" aria-hidden />
                  </button>
                  )}

                  {canManage && onDeleteGuest && (
                    <button
                      type="button"
                      onClick={async () => {
                        if ((await confirmDialog(`هل أنت متأكد من حذف الضيف: "${guest.fullName}"؟`))) {
                          onDeleteGuest(guest.id);
                        }
                      }}
                      className="min-h-10 min-w-10 inline-flex items-center justify-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      aria-label={`حذف الضيف: ${guest.fullName}`}
                      title="حذف الضيف من الأرشيف"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </button>
                  )}
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
                  {guest.lastAppearanceDate ? `آخر ظهور: ${arabicDate(guest.lastAppearanceDate)}` : 'لم يظهر بعد'}
                </p>
              </div>

              {/* Contact Info */}
              <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                {guest.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden />
                    <a href={`tel:${guest.phone.replace(/[^\d+]/g, '')}`} className="font-mono text-left hover:text-blue-700 hover:underline" dir="ltr" aria-label={`اتصال بـ ${guest.fullName}: ${guest.phone}`}>{guest.phone}</a>
                  </div>
                )}
                {guest.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden />
                    <a href={`mailto:${guest.email}`} className="min-w-0 text-left truncate hover:text-blue-700 hover:underline" dir="ltr" title={guest.email}>{guest.email}</a>
                  </div>
                )}
                {guest.notes && (
                  <p className="text-2xs text-slate-500 mt-1 line-clamp-2">
                    {guest.notes}
                  </p>
                )}
              </div>
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
          </div>
        ))}
      </div>
      <ShowMore remaining={guestPage.remaining} onMore={guestPage.showMore} onAll={guestPage.showAll} noun="ضيف" />

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
