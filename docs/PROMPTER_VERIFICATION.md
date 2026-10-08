# Prompter controls verification - 2026-10-08

Scope: improve the existing Arabic reading surface, without changing shared on-air commands.

- Time-based scrolling at 6-180 pixels/second; delta capped after suspended frames.
- Space play/pause; RTL left/right segment navigation; up/down speed; +/- font; Home reset; Page Up/Down manual text navigation; F fullscreen; M mirror; Escape close.
- Native inputs/selects/buttons, modifiers and composition retain their own keyboard behavior.
- Wheel/touch/pointer interaction pauses scrolling. End of text and hidden document stop scrolling.
- Manual segment selection disables local director following; explicit checkbox restores following.
- Responsive wrapping toolbar, direct segment selector, 44px targets, focus containment/restoration, accessible labels and improved contrast.
- Help content updated. Existing sanitization retained.

Verification:
- RED: missing prompter controls module, then GREEN 2/2 focused tests.
- Browser tests: 390px/1440px mouse, keyboard, speed/font, native field guards, segment selection, scroll pause, overflow, screenshots and WCAG A/AA.
- Contrast findings reproduced and corrected; final browser run 3/3 including text-only air regression.
- TypeScript and production build passed; unit/server suite 253/253 passed.

Offline preparation/viewer, encrypted drafts and separate journal imports are now implemented. Their verification and limits are recorded separately in docs/OFFLINE_AIR_VERIFICATION.md; remote video and hardware broadcast output are not guaranteed offline.
