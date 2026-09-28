import React, { useEffect, useState } from 'react';

const COLORS = ['bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600'];

/** First letters of the first two words (skips titles such as «د.» and «م.»). */
export function initialsOf(name?: string): string {
  const words = (name || '').replace(/^(د|م|أ|ا)\.\s*/u, '').trim().split(/\s+/).filter(Boolean);
  // Skip the Arabic definite article so «المنصوري» gives «م», not «ا».
  const letter = (w: string) => [...(w.length > 3 && w.startsWith('ال') ? w.slice(2) : w)][0];
  return words.slice(0, 2).map(letter).join(' ') || '؟';
}

function colorFor(name?: string) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

interface AvatarProps {
  src?: string | null;
  name?: string;
  className?: string;
}

/**
 * Profile picture over coloured initials: the initials show until the image has actually
 * loaded, and stay when there is no image or it fails (no empty box on a slow network).
 */
export const Avatar: React.FC<AvatarProps> = ({ src, name, className = 'w-8 h-8 rounded-full' }) => {
  const usable = !!src && !/\/avatar\.svg$/.test(src);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  return (
    <span
      role="img"
      aria-label={name || 'صورة شخصية'}
      className={`${className} ${colorFor(name)} relative inline-flex items-center justify-center shrink-0 text-white font-bold text-[0.7em] leading-none select-none overflow-hidden`}
    >
      {initialsOf(name)}
      {usable && !failed && (
        <img
          src={src!}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
};
