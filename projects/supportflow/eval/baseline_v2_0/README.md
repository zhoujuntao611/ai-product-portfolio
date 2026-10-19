# Frozen local v2.0 before the 2026-10-19 review fixes

These five files were copied unchanged from the visible local v2.0 immediately before the v2.1 review fixes. `manifest.json` records their SHA-256 values and freeze time. This is distinct from the original GitHub v1 baseline frozen in `../baseline_v1_*`.

Run `python verification/review_regression.py` from the project root. It verifies these bytes, loads the frozen core/store/server, binds the server's absolute module imports to their frozen counterparts, and runs both versions on identical synthetic questions and disposable databases. No historical source is edited and no provider API is called.

The comparison includes controls that already passed in local v2.0. Both datasets were used during development; the reports do not claim an unseen accuracy estimate or real user impact.
