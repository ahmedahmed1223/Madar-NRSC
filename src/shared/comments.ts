/** Team comments on stories, episodes, segments and coverage files, with @mentions. */
export interface CommentTarget {
  kind: 'news' | 'episode' | 'segment' | 'story' | 'bulletinStory';
  id: string;
  /** For segments: the episode that holds them. */
  episodeId?: string;
  title: string;
}

export interface TeamComment {
  id: string;
  target: CommentTarget;
  text: string;
  mentions: string[];
  authorId: string;
  authorName: string;
  createdAt: string;
  threadId?: string;
}

export const targetKey = (t: Pick<CommentTarget, 'kind' | 'id'>) => `${t.kind}:${t.id}`;

export function commentError(c: any): string | null {
  if (!c?.target || !['news', 'episode', 'segment', 'story', 'bulletinStory'].includes(c.target.kind) || typeof c.target.id !== 'string') return 'موضع التعليق غير صالح';
  if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000) return 'نص التعليق غير صالح';
  if (c.mentions !== undefined && (!Array.isArray(c.mentions) || c.mentions.length > 20)) return 'الإشارات غير صالحة';
  return null;
}

/** Where a notification about a comment should take the reader. */
export function commentLink(t: CommentTarget): string {
  if (t.kind === 'news') return `/news/${t.id}`;
  if (t.kind === 'episode') return `/episodes/${t.id}`;
  if (t.kind === 'segment') return `/episodes/${t.episodeId || ''}`;
  if (t.kind === 'bulletinStory') return '/bulletins';
  return '/stories';
}
