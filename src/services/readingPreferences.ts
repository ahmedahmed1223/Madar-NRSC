export interface ReadingPreferences {
  fontSize: number;
  speed: number;
  color: 'yellow' | 'white' | 'cyan';
  mirrored: boolean;
}

export const READING_DEFAULTS: ReadingPreferences = { fontSize: 36, speed: 48, color: 'yellow', mirrored: false };
export const READING_FONT_MIN = 22;
export const READING_FONT_MAX = 72;

type ReadingStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const readingPreferencesKey = (userId: string) => `nrcs-reading-preferences-v1:${userId}`;

function sanitize(value: unknown): ReadingPreferences {
  if (!value || typeof value !== 'object') return READING_DEFAULTS;
  const { fontSize, speed, color, mirrored } = value as Partial<ReadingPreferences>;
  return {
    fontSize: Number.isInteger(fontSize) && fontSize >= READING_FONT_MIN && fontSize <= READING_FONT_MAX ? fontSize : READING_DEFAULTS.fontSize,
    speed: Number.isInteger(speed) && speed >= 6 && speed <= 180 && speed % 6 === 0 ? speed : READING_DEFAULTS.speed,
    color: color === 'white' || color === 'cyan' ? color : READING_DEFAULTS.color,
    mirrored: mirrored === true,
  };
}

export function readReadingPreferences(storage: ReadingStorage | null, userId: string): ReadingPreferences {
  try { return sanitize(JSON.parse(storage?.getItem(readingPreferencesKey(userId)) || 'null')); }
  catch { return READING_DEFAULTS; }
}

export function writeReadingPreferences(storage: ReadingStorage | null, userId: string, value: ReadingPreferences): boolean {
  if (!storage || !userId) return false;
  try { storage.setItem(readingPreferencesKey(userId), JSON.stringify(sanitize(value))); return true; }
  catch { return false; }
}
