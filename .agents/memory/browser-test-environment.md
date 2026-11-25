---
name: Browser test environment
description: Local compatibility-test limitations and the distinction between engine coverage and viewport emulation.
---

Do not claim WebKit compatibility from Chromium checks or from narrow viewport emulation.

**Why:** The workspace could download Playwright's WebKit bundle but could not launch it: the required Ubuntu shared libraries were absent, the dependency installer could not elevate, and the system package catalog did not contain the attempted Playwright browser packages. Download success was not browser availability. A compatible system Chromium is available at `/repl/tools/bin/chromium` when Playwright's managed Chromium bundle is absent.

**How to apply:** Recheck browser availability before assuming this limitation persists; for Chromium tests, try `/repl/tools/bin/chromium` via `PLAYWRIGHT_CHROMIUM` before installing another bundle. Use an environment with the engine's supported dependencies for actual WebKit verification; clearly distinguish tested results from configured-but-unexecuted coverage. Mobile viewports do not replace physical-device clipboard checks.
