# Local portfolio fonts

Noto Sans SC and Noto Serif SC, provided by Google / The Noto Project and Adobe.

Upstream sources:
- https://github.com/google/fonts/tree/main/ofl/notosanssc
- https://github.com/google/fonts/tree/main/ofl/notoserifsc

License: SIL Open Font License 1.1. Complete upstream license notices are included beside the font files.

The current website uses only Noto Sans SC, regenerated on 2026-10-27 from the visible text across all eight static pages, plus the image viewer labels and basic Latin. Its variable weight range is 100–900. The Noto Serif SC subset is retained from the previous design but is not requested by the current pages.

Fonts are hosted in this repository and never require a runtime request to Google Fonts. When editing copy, regenerate the Sans subset from the official source TTF with FontTools; characters outside the subset use the declared system fallback. Update the font URL version in both the stylesheet and preload links when changing the subset.
