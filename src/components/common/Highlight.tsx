import React from 'react';
import { highlightSegments } from '../../shared/arabicSearch';

/** Text with the words matched by a search query in bold (Arabic-normalised, stem aware). */
export const Highlight: React.FC<{ text: string | undefined | null; query: string }> = ({ text, query }) => {
  const value = text || '';
  if (!query.trim() || !value) return <>{value}</>;
  return (
    <>
      {highlightSegments(value, query).map((s, i) =>
        s.match ? (
          <mark key={i} className="bg-amber-100 text-inherit font-bold rounded-[2px]">{s.text}</mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </>
  );
};
