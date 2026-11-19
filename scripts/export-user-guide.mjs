#!/usr/bin/env node
/**
 * Writes docs/USER_GUIDE.md from the in-app guide (src/content/userGuide.ts), so the printed and
 * the in-app guide never drift apart. Run after changing the guide:
 *
 *   node scripts/export-user-guide.mjs
 *
 * tests/content/userGuide.test.ts fails when the committed file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

const unregister = register();
try {
  const { guideToMarkdown } = await import('../src/shared/userGuideTools.ts');
  const out = fileURLToPath(new URL('../docs/USER_GUIDE.md', import.meta.url));
  const markdown = guideToMarkdown();
  writeFileSync(out, markdown);
  console.log(`docs/USER_GUIDE.md: ${markdown.split('\n').length} lines`);
} finally {
  await unregister();
}
