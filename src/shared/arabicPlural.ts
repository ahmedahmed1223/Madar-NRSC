/**
 * Arabic number agreement for counted nouns.
 *
 *   countLabel(1,  { one: 'نقطة واحدة', two: 'نقطتان', few: 'نقاط', many: 'نقطة' }) → «نقطة واحدة»
 *   countLabel(2,  …) → «نقطتان»
 *   countLabel(4,  …) → «4 نقاط»        (3–10: plural noun)
 *   countLabel(14, …) → «14 نقطة»       (11 and above: singular noun)
 *   countLabel(103, …) → «103 نقاط»     (the rule follows the last two digits)
 *   countLabel(0,  …) → «0 نقاط», or `zero` when given («لا نقاط»)
 *
 * `one` and `two` are whole phrases (no digit), `few` and `many` are the noun
 * that follows the digit. Keep forms short; callers add the rest of the sentence.
 */
export interface CountForms {
  /** Whole phrase for 1, e.g. «مهمة واحدة». */
  one: string;
  /** Whole phrase for 2 (the dual), e.g. «مهمتان». */
  two: string;
  /** Noun after a number from 3 to 10, e.g. «مهام». */
  few: string;
  /** Noun after 11 and above (and 0 when no `zero`), e.g. «مهمة». */
  many: string;
  /** Optional whole phrase for 0, e.g. «لا مهام». */
  zero?: string;
}

export function countLabel(n: number, forms: CountForms): string {
  const value = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (value === 0) return forms.zero ?? `0 ${forms.few}`;
  const abs = Math.abs(value);
  if (abs === 1) return forms.one;
  if (abs === 2) return forms.two;
  const lastTwo = abs % 100;
  return `${value} ${lastTwo >= 3 && lastTwo <= 10 ? forms.few : forms.many}`;
}

/**
 * Same as countLabel but always keeps the digit, for compact chips and table
 * cells where «1 مهمة» / «2 مهمتان» scan better than words. Uses `one`/`two`
 * as the noun after the digit, so pass the bare noun there (e.g. one: 'مهمة', two: 'مهمة').
 */
export function countWithNumber(n: number, forms: Omit<CountForms, 'zero'>): string {
  const value = Number.isFinite(n) ? Math.trunc(n) : 0;
  const abs = Math.abs(value);
  const lastTwo = abs % 100;
  const noun = abs === 1 ? forms.one : abs === 2 ? forms.two : lastTwo >= 3 && lastTwo <= 10 ? forms.few : abs === 0 ? forms.few : forms.many;
  return `${value} ${noun}`;
}

/** Frequent nouns in the newsroom, ready to pass to countLabel. */
export const AR = {
  task: { one: 'مهمة واحدة', two: 'مهمتان', few: 'مهام', many: 'مهمة' },
  card: { one: 'بطاقة واحدة', two: 'بطاقتان', few: 'بطاقات', many: 'بطاقة' },
  story: { one: 'قصة واحدة', two: 'قصتان', few: 'قصص', many: 'قصة' },
  news: { one: 'خبر واحد', two: 'خبران', few: 'أخبار', many: 'خبراً' },
  point: { one: 'نقطة واحدة', two: 'نقطتان', few: 'نقاط', many: 'نقطة' },
  hour: { one: 'ساعة واحدة', two: 'ساعتان', few: 'ساعات', many: 'ساعة' },
  minute: { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' },
  day: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يوماً' },
  blocker: { one: 'مانع واحد', two: 'مانعان', few: 'موانع', many: 'مانعاً' },
  warning: { one: 'تنبيه واحد', two: 'تنبيهان', few: 'تنبيهات', many: 'تنبيهاً' },
  item: { one: 'مادة واحدة', two: 'مادتان', few: 'مواد', many: 'مادة' },
  episode: { one: 'حلقة واحدة', two: 'حلقتان', few: 'حلقات', many: 'حلقة' },
  bulletin: { one: 'نشرة واحدة', two: 'نشرتان', few: 'نشرات', many: 'نشرة' },
  review: { one: 'مراجعة واحدة', two: 'مراجعتان', few: 'مراجعات', many: 'مراجعة' },
  person: { one: 'فرد واحد', two: 'فردان', few: 'أفراد', many: 'فرداً' },
} as const satisfies Record<string, CountForms>;
