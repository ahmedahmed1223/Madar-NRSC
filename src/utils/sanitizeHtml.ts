import DOMPurify from 'dompurify';

/**
 * Sanitises rich text before it is injected with dangerouslySetInnerHTML.
 * Content is written by many users (and by the AI co-pilot), so scripts, event
 * handlers and javascript: URLs must never reach the DOM.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  return DOMPurify.sanitize(html || '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  });
}
