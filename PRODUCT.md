# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of a news channel spread over several stations (by default Gaza, Beirut and Istanbul, configurable), working in Arabic on desktops in the newsroom and on phones in the field:

- reporters, editors, reports editors and monitoring staff who write, verify and file stories;
- producers, programme researchers, directors and presenters who prepare and air bulletins and programmes;
- montage, graphics, quality and media/archive staff who fulfil requests from other desks;
- station managers, the main-station manager and the chief editor who distribute work, follow the day and judge workloads;
- the system administrator who runs accounts, stations, backups and maintenance.

Each person works inside their role: the sidebar and the home page should open on what that role does most (confirmed by the client: order by each user's role).

## Product Purpose

«مدار» is one shared newsroom for several stations. It replaces WhatsApp and Telegram groups as the place where work is requested, assigned, handed over, documented and aired, so that management can see who works on what, how loads compare between stations, and what each person produced, instead of answering every request for help with "we need more staff".

Success: every item that airs has a visible chain of who did what; managers can see today's state and each station's load at a glance; staff find their own work first and never lose a handover.

## Operating Context

- Used for whole shifts, often on large screens for many hours, by day and by night (the client asked for a modern look suited to intensive, long screen use).
- Field staff use phones on unreliable connections; work must survive going offline.
- On-air moments are time-critical: bulletins, rundowns, the studio screen and the prompter must stay legible and calm under pressure.
- Arabic, right-to-left throughout; station time zone and calendar are configurable.

## Capabilities and Constraints

- News desk (stories, review and approval, breaking ticker, embargo), agency feeds (the client calls this area «المصادر»), coverage diary, bulletins with approval chains, programmes and episodes with rundowns, on-air mode, studio screen, offline air.
- Production cards across stations, workload and performance per station and person, employee records (PDF/CSV), shift handover brief.
- Department requests, tasks, duty roster, resource bookings, media library.
- Messaging: direct, groups, station and department channels with files and references to records.
- Roles with permissions enforced on the server and a per-role list of screens; per-device preferences (theme, text size, reduced motion).
- Self-hosted Node/Express + SQLite server, React SPA, installable PWA; fonts are bundled, no external font or CDN requests (closed networks).

## Brand Commitments

- Name «مدار» and its red on-air mark (client: current identity is good; designer may evaluate).
- IBM Plex Sans Arabic for the interface, IBM Plex Mono for clocks and timecodes (chosen by the client).
- Day and night modes plus «حسب الجهاز».

## Evidence on Hand

Demo data seeded by the server (`src/server/seed.ts`, `src/services/mockData.ts`): ten demo staff, stories, programmes, episodes, bulletins. No real customer content, testimonials or metrics; none may be invented.

## Product Principles

1. My work first: every role lands on what it must do now, and everything else is one step away.
2. One chain per item: requests, handovers and approvals are recorded where the item lives, never in side channels.
3. Calm under pressure: status is read at a glance, urgency is reserved for what is actually urgent.
4. Dense but navigable: large amounts of data stay scannable through grouping, hierarchy and progressive disclosure, not by hiding it.
5. Works everywhere the newsroom works: phone in the field, desk all night, studio screen, offline.

## Accessibility & Inclusion

WCAG 2.2 AA (axe checks run in the test suite by day, night and on phones); keyboard operation throughout; reduced-motion and text-size preferences per device; 44px touch targets on phones.
