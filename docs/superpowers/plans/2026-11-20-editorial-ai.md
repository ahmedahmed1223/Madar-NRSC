# Editorial AI Implementation Plan

**Goal** Add configurable providers and editorial planning modes to the existing newsroom workflow.

**Spec** `docs/superpowers/specs/2026-11-20-editorial-ai-design.md`

- [x] Test provider selection, structured result validation and permission gates with mocked provider calls. Extend `src/server/ai.ts`, `src/server/config.ts` and the existing copilot routes.
- [x] Test the provider picker, suggestions, unchanged editor text and explicit review of question drafts in Playwright. Extend `AiNewsCoPilotModal` and integrate it with episode questions and guests.
- [x] Document server environment variables and the editorial workflow. Run TypeScript, server tests, the production build and Chromium against isolated local fixtures.
