# Work controls browser regression matrix

## Run

```sh
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e:work-controls
```

The focused configuration runs **28 cases**: seven journeys in each of
Chromium desktop, Chromium mobile, WebKit desktop and WebKit mobile.
Desktop is 1440×900; narrow mobile is 360×800. Both use Arabic UI and a
device timezone of `America/Los_Angeles`. These are browser-engine/viewport
checks, not certification on physical iPhones.

To run a subset:

```sh
PLAYWRIGHT_CHROMIUM=/path/to/chromium npm run test:e2e:work-controls -- --project chromium-mobile
npm run test:e2e:work-controls -- --project webkit-desktop
```

`PLAYWRIGHT_CHROMIUM` applies only to Chromium. The compatibility file is
excluded from the default configuration because its timezone and viewport
assumptions require the matrix configuration.

## Coverage

| Journey | Assertions in all four projects |
| --- | --- |
| Personal notes | Search AND pinned-only excludes independent distractors; clearing both restores notes; Arabic multiline text survives actual copy/paste; focus returns; temporary textarea is removed; copy refusal shows an error. |
| Personal tasks | Search AND overdue AND completion state; completed tasks are not overdue; switching/clearing controls restores tasks; rendered task copy includes Arabic notes and due date; denied copy shows an error. Uses mobile dropdown or desktop tabs as rendered. |
| Team tasks | Search, status, priority, assignee, overdue, period and “mine” combined; independent distractors do not leak through; reset clears every control and restores records. |
| Shift handovers | Department filter limits both list and copied summary; clearing department restores the excluded draft; detail copy includes only the opened handover; denied copy shows an error. Uses real source-roster authority. |
| Station midnight | At `2030-06-12T22:30Z`, Riyadh is already June 13: “tomorrow 09:00” is June 14 at `06:00Z`. |
| Device midnight | At the same instant, Los Angeles is still June 12: device-based “tomorrow 09:00” is June 13 at `16:00Z`. |
| Daylight saving | New York “tomorrow 09:00” across the March 10, 2030 spring transition saves as `13:00Z`, not `14:00Z`. |

Date journeys check the form input, server-confirmed due/reminder timestamps,
rendered 09:00 display, and reopening after reload. Station settings are
restored in `finally`. Layout assertions catch horizontal overflow and
off-screen visible controls, including date forms.

## Clipboard test boundaries

The host contains the **real application** inside a same-origin sandboxed
iframe with `clipboard-write 'none'` and a restrictive Permissions Policy.
The modern clipboard API is also made to reject with `NotAllowedError` so
the fallback is exercised consistently in WebKit, where that policy is not
implemented identically. The success path leaves browser selection,
`document.execCommand('copy')`, and keyboard paste **unmocked**. It compares
the pasted value, not just a success message or a spy invocation.

The refusal path separately makes the legacy operation return false and
checks the user-facing failure. Offline service workers are disabled for
this focused matrix: otherwise they may serve the SPA instead of the
synthetic embedding host. Offline regression coverage remains in the
existing offline suites.

## Isolation and evidence

The runner starts the production build on port 3990 with a freshly seeded,
disposable database in `tests/e2e/.data/<port>`. It does not use the
development newsroom database. Do not set `E2E_EXTERNAL_SERVER=true` against
a real newsroom: these tests create records and temporarily update station
settings. Tests run serially and use project-specific fixture IDs.

CI installs both browser engines and their Ubuntu dependencies, runs the
whole matrix, and retains failure traces for seven days. WebKit launch
failures caused by missing system libraries are failures, **never skips**
or automatic Chromium substitutions.

## Local verification

Chromium can use the Replit-provided executable. The current workspace
cannot launch the downloaded WebKit bundle because its required shared
libraries (including ICU 74 and libavif 16) are absent. Its normal
dependency installer is unavailable here, and the system package catalog
does not provide the attempted Playwright browser packages. Therefore
local Chromium results do **not** establish WebKit compatibility: a
successful WebKit run in the configured Ubuntu CI environment is still
required before claiming that.
