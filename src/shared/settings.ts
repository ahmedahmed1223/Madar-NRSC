import type { SystemSettings } from '../types';
import { validZone } from './dateFormat';

export function settingsError(settings: Partial<SystemSettings>): string | null {
  if (typeof settings.organizationName !== 'string' || !settings.organizationName.trim() || settings.organizationName.length > 120) return 'اسم المؤسسة مطلوب وبحد أقصى 120 حرفاً';
  if (typeof settings.defaultTimezone !== 'string' || !validZone(settings.defaultTimezone)) return 'المنطقة الزمنية غير معروفة';
  if (settings.defaultSegmentDurationSeconds !== undefined && (!Number.isInteger(settings.defaultSegmentDurationSeconds) || settings.defaultSegmentDurationSeconds < 10 || settings.defaultSegmentDurationSeconds > 3600)) return 'مدة الفقرة بين 10 و3600 ثانية';
  if (settings.breakingDurationHours !== undefined && (!Number.isFinite(settings.breakingDurationHours) || settings.breakingDurationHours < 0.25 || settings.breakingDurationHours > 24)) return 'مدة العاجل بين ربع ساعة و24 ساعة';
  if (settings.defaultNewsPriority !== undefined && !['LOW', 'NORMAL', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'].includes(settings.defaultNewsPriority)) return 'أولوية الخبر غير معروفة';
  if (settings.dateTime !== undefined) {
    const value = settings.dateTime;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'إعدادات التاريخ والوقت غير صالحة';
    const options: Record<string, unknown[]> = { digits: ['latn', 'arab'], calendar: ['gregory', 'islamic-umalqura'], hourCycle: ['h23', 'h12'], dateStyle: ['long', 'numeric'], clockSeconds: [true, false], timeBasis: ['station', 'device'] };
    if (Object.entries(value).some(([key, item]) => !options[key]?.includes(item))) return 'خيارات التاريخ والوقت غير صالحة';
  }
  if (settings.enableAuditLog !== true) return 'سجل التدقيق إلزامي ولا يمكن تعطيله';
  if (settings.newsTemplates !== undefined) {
    if (!Array.isArray(settings.newsTemplates) || settings.newsTemplates.length > 20) return 'الحد الأقصى 20 قالب أخبار';
    if (settings.newsTemplates.reduce((total, item) => total + (typeof item?.body === 'string' ? item.body.length : 0), 0) > 50000) return 'مجموع نصوص القوالب يتجاوز 50000 حرف';
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const template of settings.newsTemplates) {
      if (!template || typeof template.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(template.id) || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80 || typeof template.body !== 'string' || !template.body.trim() || template.body.length > 20000) return 'اسم القالب ونصه مطلوبان؛ الاسم حتى 80 حرفاً والنص حتى 20000 حرف';
      const name = template.name.trim().toLocaleLowerCase();
      if (ids.has(template.id) || names.has(name)) return 'اسم القالب أو معرفه مكرر';
      ids.add(template.id); names.add(name);
    }
  }
  for (const key of ['organizationNameEn', 'primaryChannelName'] as const) {
    if (settings[key] !== undefined && (typeof settings[key] !== 'string' || settings[key]!.length > 120)) return 'اسم المؤسسة أو القناة يتجاوز 120 حرفاً';
  }
  return null;
}
