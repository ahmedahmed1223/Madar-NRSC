import { FormPage } from '../components/common/FormPage';
import { Avatar } from '../components/common/Avatar';
import { RbacService } from '../services/rbacService';
import React, { useState } from 'react';
import {
  Plus,
  Users,
  Search,
  Star,
  Phone,
  Mail,
  Building,
  Edit2,
  Calendar,
  MessageSquare,
  Award,
  Trash2,
  X,
  Check,
  Sparkles,
} from 'lucide-react';
import { Guest, User } from '../types';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';

interface GuestsViewProps {
  guests: Guest[];
  currentUser: User;
  onSaveGuest: (guest: Partial<Guest>) => void;
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
  const [rating, setRating] = useState<number>(5);
  const [avatarUrl, setAvatarUrl] = useState('');

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
    setRating(5);
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
    setRating(guest.rating || 5);
    setAvatarUrl(guest.avatarUrl || '');
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveGuest({
      id: editingGuest?.id,
      fullName,
      organization,
      jobTitle,
      specialty,
      phone,
      email,
      notes,
      rating: Number(rating) || 5,
      avatarUrl: avatarUrl || '/avatar.svg',
    });
    setIsModalOpen(false);
  };

  const filteredGuests = guests.filter((g) => {
    if (selectedSpecialty !== 'ALL' && g.specialty !== selectedSpecialty) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        g.fullName.toLowerCase().includes(q) ||
        g.organization.toLowerCase().includes(q) ||
        g.jobTitle.toLowerCase().includes(q) ||
        g.specialty.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            أرشيف وبنك الضيوف والخبراء
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            سجل شامل للمحللين والخبراء والمسؤولين مع بيانات التواصل والتقييم وسجل المشاركات
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
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
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
        {filteredGuests.map((guest) => (
          <div
            key={guest.id}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between hover:shadow-md transition-all group"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar src={guest.avatarUrl} name={guest.fullName} className="w-14 h-14 rounded-2xl ring-2 ring-slate-100" />
                  <div>
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
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="تعديل بيانات الضيف"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  )}

                  {canManage && onDeleteGuest && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`هل أنت متأكد من حذف الضيف: "${guest.fullName}"؟`)) {
                          onDeleteGuest(guest.id);
                        }
                      }}
                      className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      title="حذف الضيف من الأرشيف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Badges & Rating */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <Badge variant="primary" size="sm">
                  {guest.specialty}
                </Badge>
                <div className="flex items-center gap-1 text-amber-500 font-bold font-mono">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{guest.rating} / 5</span>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                {guest.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono text-left" dir="ltr">{guest.phone}</span>
                  </div>
                )}
                {guest.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono text-left truncate" dir="ltr">{guest.email}</span>
                  </div>
                )}
                {guest.notes && (
                  <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-2">
                    {guest.notes}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>إجمالي المشاركات: <strong className="text-slate-800 font-mono">{guest.totalAppearances}</strong></span>
              <span className="text-blue-600 font-semibold">سجل معتمد</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      <FormPage
        isOpen={isModalOpen}
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
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
            <span className="text-[10px] text-slate-400 font-bold">مقترحات جهات:</span>
            {ORG_PRESETS.map((org) => (
              <button
                key={org}
                type="button"
                onClick={() => setOrganization(org)}
                className="text-[10px] bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-1.5 py-0.5 rounded transition-colors"
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
                  className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
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

          {/* Star Rating Interactive Selector */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <span className="block text-xs font-bold text-slate-700">تقييم الموثوقية والأداء التلفزيوني</span>
            <div className="flex items-center gap-1" role="group" aria-label="تقييم الضيف من 1 إلى 5">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  aria-label={`${s} نجوم`}
                  className="p-1 hover:scale-125 transition-transform focus:outline-hidden focus:ring-1 focus:ring-amber-400 rounded"
                >
                  <Star
                    className={`w-5 h-5 ${
                      s <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                    }`}
                  />
                </button>
              ))}
              <span className="text-xs font-mono font-bold text-slate-700 mr-2">
                ({rating} من 5)
              </span>
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
              <label htmlFor="guest-avatar-input" className="block text-xs font-bold text-slate-700">رابط الصورة الشخصية (Avatar URL)</label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="text-[10px] text-slate-400 hover:text-rose-500"
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
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
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
