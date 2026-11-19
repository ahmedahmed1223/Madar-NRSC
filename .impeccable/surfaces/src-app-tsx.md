---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/layout/Sidebar.tsx","src/components/layout/Topbar.tsx","src/views/DashboardView.tsx"]
---

# App shell and working screens

Scope: the authenticated app of «مدار»: navigation rail, top bar, screen titles, and the data-heavy working screens (home, news list, tasks, المصادر, settings), plus help tours and the administrator's first-run setup. Mode: Operate.

Audience and job: newsroom staff across stations doing whole shifts on large screens by day and night, and on phones in the field; each lands on their own work first and reaches the rest in one step. Physical scene: open-plan newsroom under fluorescent light and dim night shifts, monitors on for eight hours, so a warm low-glare paper ground by day and deep ink at night.

Constraints: Arabic RTL; IBM Plex Sans Arabic / Plex Mono (pinned by the client); day, night and device modes; WCAG AA; no external requests; Tailwind utility classes throughout, so the world lands through palette tokens and a few shared rules.

## Direction contract

THESIS: The newsroom works inside the channel's own on-air identity. It refuses the category default of a grey dashboard with a blue accent and a pile of equal cards: work is read as straps, rails and rules, and only what is on air or urgent is red.

OWN-WORLD: Deep navy ink rail; warm paper ground (hue 85) with warm rules; one cyan-teal signal for every action, link, selection and focus; broadcast red only for live and urgent. Tight broadcast corners (6-10px), rules before shadows, Plex Mono tabular figures for times and counts. Signature: the lower-third strap, an ink band with a signal tab at its start edge, on the screen title and the active rail item only.

STORY: A colleague opens the app and sees, top of the rail, «عملي» with what waits for them, then their own desk's section; the screen title strap says where they are; the dense list below is grouped and ruled so the eye scans it without hunting. They act with the one teal action and never confuse it with an alarm.

FIRST VIEWPORT: Ink rail on the right (role-ordered sections, folded beyond the first two, counts on folded headers, active item as a strap). A quiet paper top bar with clock, sync state, search and create. The screen opens with its title strap and a one-line purpose, then filters as one row, then the content in ruled groups; the primary action sits at the title row's end in signal teal.

FORM: Broadcast graphics package (the on-air lower-third system), position 3 on the ordered list of seven; seed:3bef2b8408272966.

SIGNATURE INTERACTION: Navigating moves the strap: the active rail item and the screen title share the strap form, so the place you are is drawn the same way in both; folding a section collapses it to its header with the sum of what waits inside.
