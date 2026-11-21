export function AirSourceStatus({ connected, control, local }: { connected?: boolean; control?: boolean; local?: boolean }) {
  const controlLabel = control ? local ? 'على هذا الجهاز' : connected ? 'متاح لك' : 'معلّق حتى عودة الاتصال' : 'متابعة فقط';
  return <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
    <div className="flex gap-2"><dt>المصدر</dt><dd className="font-bold">{local ? 'حزمة الهواء المحلية' : 'خادم مدار'}</dd></div>
    <div className="flex gap-2"><dt>الاتصال</dt><dd className="font-bold">{local ? 'تشغيل محلي' : connected ? 'متصل' : 'منقطع · آخر حالة معروفة'}</dd></div>
    <div className="flex gap-2"><dt>التحكم</dt><dd className="font-bold">{controlLabel}</dd></div>
  </dl>;
}
