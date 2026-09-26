import { Avatar } from '../common/Avatar';
import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { User, UserRole, SecurityClearance, ShiftType } from '../../types';
import { RbacService, RoleDefinition } from '../../services/rbacService';
import {
  User as UserIcon,
  Mail,
  Phone,
  Shield,
  Briefcase,
  Building,
  Clock,
  KeyRound,
  Sparkles,
  Check,
  AlertCircle,
} from 'lucide-react';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (userData: Partial<User>, initialPassword?: string) => void;
  userToEdit?: User | null;
  roles: RoleDefinition[];
}


const DEPARTMENTS = [
  'غرفة الأخبار',
  'الإدارة العامة والتحرير',
  'القسم الدولي',
  'القسم الاقتصادي',
  'الإنتاج والبرامج',
  'المذيعين والتقديم',
  'المراسلين الميدانيين',
  'الوسائط والمكتبة',
  'إدارة البث والعمليات',
  'التحقيقات والتقارير الخاصة',
];

export const UserFormModal: React.FC<UserFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  userToEdit,
  roles,
}) => {
  const [fullName, setFullName] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('JOURNALIST');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [staffId, setStaffId] = useState('');
  const [securityClearance, setSecurityClearance] = useState<SecurityClearance>('CONFIDENTIAL');
  const [shift, setShift] = useState<ShiftType>('MORNING');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('/avatar.svg');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [initialPassword, setInitialPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (userToEdit) {
      setFullName(userToEdit.fullName || '');
      setFullNameEn(userToEdit.fullNameEn || '');
      setEmail(userToEdit.email || '');
      setPhone(userToEdit.phone || '');
      setRole(userToEdit.role || 'JOURNALIST');
      setJobTitle(userToEdit.jobTitle || '');
      setDepartment(userToEdit.department || DEPARTMENTS[0]);
      setStaffId(userToEdit.staffId || '');
      setSecurityClearance(userToEdit.securityClearance || 'CONFIDENTIAL');
      setShift(userToEdit.shift || 'MORNING');
      setBio(userToEdit.bio || '');
      setAvatarUrl(userToEdit.avatarUrl || '/avatar.svg');
      setTwoFactorEnabled(userToEdit.twoFactorEnabled ?? false);
      setIsActive(userToEdit.isActive !== undefined ? userToEdit.isActive : true);
    } else {
      setFullName('');
      setFullNameEn('');
      setEmail('');
      setPhone('');
      setRole('JOURNALIST');
      setJobTitle('');
      setDepartment(DEPARTMENTS[0]);
      setStaffId('');
      setSecurityClearance('CONFIDENTIAL');
      setShift('MORNING');
      setBio('');
      setAvatarUrl('/avatar.svg');
      setTwoFactorEnabled(false);
      setIsActive(true);
    }
    setInitialPassword('');
    setErrors({});
  }, [userToEdit, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) newErrors.fullName = 'الاسم الكامل بالعربية مطلوب';
    if (!email.trim()) {
      newErrors.email = 'البريد الإلكتروني مطلوب';
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      newErrors.email = 'صيغة البريد الإلكتروني غير صحيحة';
    }
    if (!jobTitle.trim()) newErrors.jobTitle = 'المسمى الوظيفي مطلوب';
    if (!userToEdit) {
      if (initialPassword.length < 10 || !/\d/.test(initialPassword) || !/[A-Za-z\u0600-\u06FF]/.test(initialPassword)) {
        newErrors.initialPassword = 'كلمة المرور الأولية: 10 أحرف على الأقل وتحتوي على حروف وأرقام';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave({
      id: userToEdit?.id,
      fullName: fullName.trim(),
      fullNameEn: fullNameEn.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role,
      jobTitle: jobTitle.trim(),
      department,
      staffId: staffId.trim(),
      securityClearance,
      shift,
      bio: bio.trim(),
      avatarUrl,
      isActive,
    }, userToEdit ? undefined : initialPassword);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={userToEdit ? 'تعديل بيانات المستخدم والصلاحيات' : 'إضافة مستخدم جديد لطاقم الأخبار'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-right font-sans" dir="rtl">
        {/* Avatar Preset Selector */}
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <label htmlFor="user-form-modal-field-1" className="block text-xs font-bold text-slate-700 mb-2">
            الصورة الشخصية والرمز التعريفي:
          </label>
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={fullName} className="w-16 h-16 rounded-2xl border-2 border-blue-600 shadow-md shrink-0" />
            <div className="flex-1">
              <div className="mt-2">
                <input id="user-form-modal-field-1"
                  type="text"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="أو الصق رابط صورة مخصص (URL)..."
                  className="w-full text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Basic Info Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="user-form-modal-field-2" className="block text-xs font-bold text-slate-700 mb-1.5">
              الاسم الكامل (بالعربية) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input id="user-form-modal-field-2"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                placeholder="مثال: أحمد المنصوري"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none ${
                  errors.fullName ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
              />
            </div>
            {errors.fullName && <p className="text-[10px] text-red-600 mt-1 font-bold">{errors.fullName}</p>}
          </div>

          <div>
            <label htmlFor="user-form-modal-field-3" className="block text-xs font-bold text-slate-700 mb-1.5">
              الاسم بالإنجليزية (English Full Name)
            </label>
            <input id="user-form-modal-field-3"
              type="text"
              value={fullNameEn}
              onChange={(e) => setFullNameEn(e.target.value)}
              placeholder="e.g. Ahmed Al-Mansouri"
              className="w-full text-xs px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-sans"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="user-form-modal-field-4" className="block text-xs font-bold text-slate-700 mb-1.5">
              البريد الإلكتروني المهني <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input id="user-form-modal-field-4"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                }}
                placeholder="user@akhbar.tv"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none text-left ${
                  errors.email ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
                dir="ltr"
              />
            </div>
            {errors.email && <p className="text-[10px] text-red-600 mt-1 font-bold">{errors.email}</p>}
          </div>

          {!userToEdit && (
            <div>
              <label htmlFor="user-form-modal-field-5" className="block text-xs font-bold text-slate-700 mb-1.5">
                كلمة المرور الأولية <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input id="user-form-modal-field-5"
                  type="password"
                  autoComplete="new-password"
                  value={initialPassword}
                  onChange={(e) => {
                    setInitialPassword(e.target.value);
                    if (errors.initialPassword) setErrors((prev) => ({ ...prev, initialPassword: '' }));
                  }}
                  className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none text-left ${
                    errors.initialPassword ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                  }`}
                  dir="ltr"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">سيُطلب من المستخدم تغييرها عند أول تسجيل دخول.</p>
              {errors.initialPassword && <p className="text-[10px] text-red-600 mt-1 font-bold">{errors.initialPassword}</p>}
            </div>
          )}

          <div>
            <label htmlFor="user-form-modal-field-6" className="block text-xs font-bold text-slate-700 mb-1.5">
              رقم الهاتف المباشر / الاتصال
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input id="user-form-modal-field-6"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+966 50 000 0000"
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 text-left font-mono"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        {/* Professional & Security Parameters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label htmlFor="user-form-modal-field-7" className="block text-xs font-bold text-slate-700 mb-1.5">
              الدور والصلاحية (Role) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Shield className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <select id="user-form-modal-field-7"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-bold text-slate-800"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.roleCode}>
                    {r.nameAr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="user-form-modal-field-8" className="block text-xs font-bold text-slate-700 mb-1.5">
              المسمى الوظيفي (Job Title) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Briefcase className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input id="user-form-modal-field-8"
                type="text"
                value={jobTitle}
                onChange={(e) => {
                  setJobTitle(e.target.value);
                  if (errors.jobTitle) setErrors((prev) => ({ ...prev, jobTitle: '' }));
                }}
                placeholder="مثال: رئيس تحرير نشرة التاسعة"
                className={`w-full text-xs pr-9 pl-3 py-2.5 bg-white border rounded-xl focus:outline-none ${
                  errors.jobTitle ? 'border-red-500 bg-red-50/20' : 'border-slate-200 focus:border-blue-500'
                }`}
              />
            </div>
            {errors.jobTitle && <p className="text-[10px] text-red-600 mt-1 font-bold">{errors.jobTitle}</p>}
          </div>

          <div>
            <label htmlFor="user-form-modal-field-9" className="block text-xs font-bold text-slate-700 mb-1.5">
              القسم التحريري / الإداري
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <select id="user-form-modal-field-9"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full text-xs pr-9 pl-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
              >
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Broadcast Shifts, Clearance & Security Flags */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
          <div>
            <label htmlFor="user-form-modal-field-10" className="block text-xs font-bold text-slate-700 mb-1.5">
              التصنيف الأمني للمواد (Security Clearance)
            </label>
            <select id="user-form-modal-field-10"
              value={securityClearance}
              onChange={(e) => setSecurityClearance(e.target.value as SecurityClearance)}
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="TOP_SECRET">سري للغاية (Top Secret - سيادي)</option>
              <option value="RESTRICTED">مقيد / حساس (Restricted)</option>
              <option value="CONFIDENTIAL">خاص بغرفة الأخبار (Confidential)</option>
              <option value="PUBLIC">عام للجمهور (Public)</option>
            </select>
          </div>

          <div>
            <label htmlFor="user-form-modal-field-11" className="block text-xs font-bold text-slate-700 mb-1.5">
              وردية العمل التلفزيونية (Shift)
            </label>
            <div className="relative">
              <Clock className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
              <select id="user-form-modal-field-11"
                value={shift}
                onChange={(e) => setShift(e.target.value as ShiftType)}
                className="w-full text-xs pr-8 pl-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-medium"
              >
                <option value="MORNING">الوردية الصباحية (06:00 - 14:00)</option>
                <option value="EVENING">الوردية المسائية (14:00 - 22:00)</option>
                <option value="NIGHT_ON_CALL">المناوبة الليلية / الطوارئ (22:00 - 06:00)</option>
                <option value="FLEXIBLE">مرن / تغطية مفتوحة</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="user-form-modal-field-12" className="block text-xs font-bold text-slate-700 mb-1.5">
              الرقم الوظيفي (Staff ID)
            </label>
            <input id="user-form-modal-field-12"
              type="text"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              placeholder="EMP-001"
              className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        {/* Bio / Description */}
        <div>
          <label htmlFor="user-form-modal-field-13" className="block text-xs font-bold text-slate-700 mb-1.5">
            نبذة مهنية وسجل التخصص التحريري (Bio & Specialization)
          </label>
          <textarea id="user-form-modal-field-13"
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="اكتب نبذة مختصرة عن مسؤوليات وتخصص الموظف في شبكة الأخبار..."
            className="w-full text-xs p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 leading-relaxed"
          />
        </div>

        {/* Security & Active Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-slate-100/70 rounded-xl">
          {/* 2FA is enrolled by each user from their own account menu; admins can only reset it. */}
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
            <span>التحقق بخطوتين:</span>
            <span className={twoFactorEnabled ? 'text-emerald-700' : 'text-slate-500'}>
              {twoFactorEnabled ? 'مفعّل' : 'غير مفعّل (يفعّله المستخدم من قائمة حسابه)'}
            </span>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
            />
            <span className={isActive ? 'text-emerald-700' : 'text-slate-500'}>
              الحساب نشط ومصرح له بالدخول للنظام
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>{userToEdit ? 'حفظ التعديلات' : 'تسجيل المستخدم'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
