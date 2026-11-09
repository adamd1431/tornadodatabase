# IBTrACS Explorer

`ibtracs.html` is linked immediately below Satellite Archive in the homepage's Explore menu. It searches the full NOAA NCEI IBTrACS v04r01 CSV archive, including unnamed cyclones, pre-satellite storms, provisional tracks and alternate/spur tracks. SIDs distinguish storms with repeated names. The initial snapshot contains 13,635 storms, 730,532 rows and all 174 source columns, covering seasons 1842–2027 (the latest Southern Hemisphere season).

## Data and updates

Source: <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ALL.list.v04r01.csv>

Run `node scripts/refresh-ibtracs.mjs` for a full refresh. The script streams the source, retains every CSV value as a string (including blanks and original flags), stores lossless compressed season files in `ibtracs-data/`, and creates a search index. Readers download only the chosen season. The entire initial compressed archive is about 25.6 MiB, plus its index, and uses existing website hosting. No Supabase tables, storage, credentials or paid service are required.

The existing Vercel build runs `--recent --keep-on-error` to update NOAA's last-three-years subset once the snapshot is at least a day old. A recent refresh preserves older storms, validates the column schema and refuses to truncate an existing storm's history. Failed downloads or validation retain the previous snapshot. The page labels the snapshot date; this is an archive browser, not a real-time advisory feed.

## Values and plots

Agency-specific wind and pressure values are never merged into a strongest-agency estimate. The USA, WMO, JMA, CMA, HKO and other available agencies can be selected independently. Averaging-period labels distinguish 1-minute USA winds, 10-minute JMA winds and native values from other sources. The original IFLAG and TRACK_TYPE fields remain visible. WMO is explicitly a reporting-agency aggregate, not another 1-minute record.

Peak wind and lowest pressure are independently dated buttons. Every observation has its own wind, pressure, POCI, ROCI, RMW, eye diameter, position and available fields. Missing source cells stay missing. Zero pressure is excluded from the minimum-pressure summary. The full field browser includes missing cells by default and can filter by field or source. CSV and JSON exports always contain all columns and rows, regardless of display filters.

The track map and intensity plots use the chosen source, retain gaps, and allow selecting records. Track longitude is unwrapped across the dateline. If the selected agency has no coordinate at a time, the merged IBTrACS position is explicitly labelled. A separate, labelled 6-hour motion estimate uses positions three hours before and three hours after, distance divided by six, rounded to the nearest 0.01 kt. It interpolates positions only across gaps of six hours or less and never replaces STORM_SPEED.

Column definitions: <https://www.ncei.noaa.gov/sites/default/files/2025-09/IBTrACS_v04r01_column_documentation.pdf>

## Imagery

Imagery is separate from IBTrACS tabular data. Where a unique approved database cyclone matches name and season, up to six existing images are displayed with filenames, alongside a link to its gallery. The page states that their acquisition times may differ from the chosen observation. Images retain their existing URLs; no copies are uploaded.

The selected record can open Satellite Archive at its exact SID, time and selected position agency. That page loads the record from the hosted IBTrACS snapshot, rather than trusting URL coordinates or a same-name storm. It preselects a period-appropriate satellite and retains the existing SSEC inventory and McFETCH access checks. Opening the link does not request image bytes, transfer a key, store credentials or upload anything. Archive scan retrieval requires the user's approved McFETCH access. Pre-1974 records have an explicit coverage message; curated database imagery may still exist.

The NCICS browser link is provided for comparison. The values in this page and its exports come from the NOAA CSV snapshot, rather than scraping NCICS tables or interpreting images.

## Validation

Tests check full-snapshot field and record integrity, name/SID/designation search, native agency values and missing data, independent extrema, dateline-aware motion, proportional track geometry, exact archive handoff and complete lossless CSV/JSON exports. Browser checks cover search/Enter, agency selection, timeline, field filters, imagery, downloads, archive prefill. Responsive breakpoints are included in the stylesheet.
