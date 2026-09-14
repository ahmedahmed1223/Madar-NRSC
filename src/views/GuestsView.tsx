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
  const [rating, setRating] = useState(5);
  const [avatarUrl, setAvatarUrl] = useState('');

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
    setAvatarUrl('https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80');
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
      avatarUrl: avatarUrl || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80',
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

        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          إضافة ضيف جديد
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، المؤسسة، أو التخصص..."
            className="w-full pr-9 pl-4 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 shrink-0">مجال التخصص:</span>
          <select
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
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
                  <img
                    src={guest.avatarUrl}
                    alt={guest.fullName}
                    className="w-14 h-14 rounded-2xl object-cover ring-2 ring-slate-100"
                  />
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">{guest.fullName}</h3>
                    <p className="text-xs text-slate-500">{guest.jobTitle}</p>
                    <p className="text-xs text-blue-700 font-semibold">{guest.organization}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(guest)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="تعديل بيانات الضيف"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {onDeleteGuest && (
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
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingGuest ? 'تعديل بيانات الضيف' : 'إضافة ضيف جديد للأرشيف'}
        maxWidth="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="الاسم الثلاثي أو اللقب الرسمي"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="مثال: خبير اقتصادي"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">المؤسسة / الجهة</label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="مثال: مركز الدراسات الاستراتيجية"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">مجال التخصص</label>
              <input
                type="text"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="مثال: علاقات دولية، طاقة"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">التقييم (1 - 5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-center font-mono focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+966 50 000 0000"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-left font-mono focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="expert@domain.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-left font-mono focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">رابط الصورة الشخصية (URL)</label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://...jpg"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-left focus:ring-2 focus:ring-blue-500"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات التحرير والتنسيق</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أوقات التوفر المفضلة، اللغات التي يتحدث بها، أي قيود..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs"
            >
              حفظ في الأرشيف
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
