# Design

<!-- Visual system of «مدار». Product truth lives in PRODUCT.md. -->

## World

**The channel's own on-air graphics package.** The newsroom works inside the same identity it puts on air: a deep ink shell like the studio's branding, a warm paper working ground that is gentle over a full shift, one signal colour for action and selection, broadcast red held back for on-air and urgent states only. The signature move is the **lower-third strap**: the screen title and the active item in the navigation are drawn as an on-air strap, an ink band with a short signal tab at its start edge. Nothing else is decorated.

Mode: Operate. Layout, navigation and controls are the familiar ones of a work tool; the world contributes type, palette, density and the strap, never the organisation of a screen.

## Palette

Defined once in `scripts/palette.mjs`; `scripts/generate-dark-theme.mjs` writes the day palette (`src/styles/theme-light.css`) and the night palette (`src/styles/theme-dark.css`) from it. Components keep using Tailwind's colour names, so the whole app follows the tokens.

| Role | Token (Tailwind name) | Day | Use |
|---|---|---|---|
| Paper | `slate-50`, `slate-100` | warm off-white, hue 85 | page ground, quiet panels |
| Rules | `slate-200`, `slate-300` | warm grey | borders, dividers |
| Ink | `slate-500` … `slate-950` | navy ink, hue 262-266 | text from muted to strongest, the shell |
| Signal | `blue-*` | cyan-teal, hue 200-218 | primary actions, links, selection, focus ring, the strap tab |
| On air / urgent | `red-*` | broadcast red | live, breaking, destructive |
| States | `emerald`, `amber`, `rose`, `violet`, `sky` | Tailwind | done, late/warning, blocked/error, requests, diary |

Night mode mirrors the accent scales and uses deep ink surfaces (`oklch(17%…25% 0.03 264)`). The shell (sidebar) is ink in both modes (`theme-fixed`).

Rules: a single signal hue owns every action and current state; red never decorates; a state colour always comes with a word (never colour alone).

## Type

- IBM Plex Sans Arabic for everything; IBM Plex Mono for clocks, timecodes, counters (`font-mono`, tabular figures).
- Scale (rem, root 17px from 640px, user-adjustable): `text-3xs` 11, `text-2xs` 12, `text-xs` 13, `text-sm` 15, `text-base` 16, `text-lg` 18, `text-xl` 20.
- Weights: 400 body, 600 labels and buttons, 700 titles. No 800/900 in working screens.

## Shape and depth

- Radii are tighter than Tailwind's defaults, closer to broadcast graphics: `rounded-lg` 6px, `rounded-xl` 8px, `rounded-2xl` 10px, `rounded-3xl` 14px.
- Panels are separated by rules and paper tone first; shadows only for things that float (menus, dialogs, toasts).

## The strap (signature)

- `.strap` / the screen title (`#app-main h1`, and the title of a create/edit form page, which is a screen too): ink band, paper text, 6px signal tab at the start edge, square corners (2px). Multi-line titles break the band per line (`box-decoration-break: clone`). At night the band inverts to paper with ink text.
- Active navigation item: a translucent paper band on the ink rail with the same signal tab.
- Never on cards, list rows, alerts or buttons.

## Buttons and badges

One hierarchy everywhere, so a colleague never wonders which button acts:

- **Primary** (one per area): signal fill, white text — `bg-blue-600 hover:bg-blue-700 text-white`, `rounded-lg`, `min-h-10`, `text-xs font-bold`.
- **Secondary**: outline on paper — `bg-white border border-slate-300 text-slate-700 hover:bg-slate-50`, same size and radius.
- **Quiet / link**: text in the signal colour (`text-blue-700`), for «عرض الكل», «فتح» and in-row actions.
- **Destructive**: red fill only where the action deletes or cannot be undone (and asks first); otherwise red text.
- **Selected** (segmented choice, chip, active tab): the signal colour (`bg-blue-600 text-white`, or `bg-blue-50 text-blue-700` for a quiet toggle), or the white pill on grey of `FilterTabs`.
- **Ink** (`bg-slate-900`/`slate-950`) belongs to the shell and to things that float above the paper: the rail, the strap, toasts, a sticky save bar, the intercom drawer, the sign-in and on-air screens. An ink button on a paper screen is off-rule.
- **Counts and badges**: what waits for me is a signal pill (`bg-blue-600 text-white`) placed right after its label; broadcast red only for breaking news, live air and urgent unread; a state chip always carries its word.

## Navigation

- The rail is ordered by the user's role: «عملي» (messages, tasks, production cards, requests) first, then the role's own domain, then the rest, administration last. Every section folds; the fold state is remembered per user on the device, and the section holding the current screen always opens.
- The rail itself collapses to icons on desktop.
- Phone navigation is modal. It moves focus to its close control, keeps Tab inside the rail and returns focus to the menu button on dismissal. The workspace is inert while the rail is open.
- The shared workspace gutter grows from 14px to 32px. Long working screens can use up to 96rem on wide desks. The toolbar keeps a stable four-rem minimum height, wraps its groups when space is tight and offers 44px targets for its icon actions.
- Quick-create actions open the form for the named record with the user's current permissions. Toolbar disclosures use the same spacing, borders and text hierarchy as the workspace.

## Motion

150-200 ms ease-out on state changes only; no entrance choreography. Reduced motion stops everything except spinners.
