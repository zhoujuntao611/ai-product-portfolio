# Browser verification

On 2026-10-19, the current v2.1 code was rechecked with disposable storage: the original workflow script passed 11/11 checks and `browser_review_20261019.cjs` passed 9/9 review checks, with no browser JavaScript errors. `browser-report.json` and `browser-review-20261019.json` contain the actual run timestamps. The first review run's history-item lookup failure is retained in `browser-first-run-20261019.json`; the same-second ordering defect was separately reproduced against frozen source and fixed. These are synthetic workflow checks, not user study participants or model quality scores.

`python verification/review_regression.py` reproduces the current 26-case comparison against the frozen local v2.0. `review-before-engineering.txt` records the pre-fix 109 engineering tests; `review-after-engineering.txt` records the final 118. See `docs/ITERATION_EVIDENCE.md` for the problem, alternatives, decision and measured limits.

The existing SupportFlow application was verified in a headless Chromium browser at 1440 × 1050 and 390 × 844. All 11 workflow checks passed; no browser JavaScript errors or horizontal overflow were detected. `browser-report.json` contains the dated result, and the four PNG files show the verified desktop and mobile screens.

The run uses synthetic policies and tickets. `isolated_server.py` points both SQLite and the knowledge store to a disposable system temporary directory, leaving the local working database unchanged.

To reproduce, start `python verification/isolated_server.py --port 8897`, then run `node verification/browser_smoke.cjs` with `SUPPORTFLOW_BASE=http://127.0.0.1:8897`. Playwright Core must be available through `PLAYWRIGHT_CORE` or the normal Node module search path; `CHROME_PATH` can select an installed Chrome executable. The verification adds no runtime dependencies to SupportFlow. Start a fresh isolated server for each full run.

The checks cover rule-mode availability, per-claim sources and versions, question coverage, saving edits before escalation, review reasons, redacted JSON and Markdown export, missing import metadata, JSON file import, new-version history, retrieval of the imported current policy, deactivation, region clarification, and mobile layout. The model adapter and server security behavior have separate Python tests. No real-model quality or business benefit is measured by this browser run.
