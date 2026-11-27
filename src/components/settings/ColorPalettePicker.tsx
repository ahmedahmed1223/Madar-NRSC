import { COLOR_PALETTES, type ColorPalette } from '../../shared/appearancePalette';

const palettes = Object.entries(COLOR_PALETTES) as [ColorPalette, (typeof COLOR_PALETTES)[ColorPalette]][];

export function ColorPalettePicker({ value, onChange, disabled }: { value: ColorPalette; onChange: (palette: ColorPalette) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-1 text-sm font-bold text-slate-700">ألوان الواجهة</legend>
      <p className="text-xs leading-relaxed text-slate-600">تُطبّق لوحة الألوان على واجهة المؤسسة بعد الحفظ. يبقى الوضع النهاري والليلي من تفضيلات الجهاز.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {palettes.map(([id, palette]) => (
          <label key={id} className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-900 ${value === id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <input type="radio" name="colorPalette" checked={value === id} onChange={() => onChange(id)} className="size-4 shrink-0 accent-blue-700" />
            <span className="flex-1">{palette.label}</span>
            <span className="size-5 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: palette.swatch }} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
