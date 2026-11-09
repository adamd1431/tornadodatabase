# Published observation charts

Live Storms defaults to credited CyclonicWx plots, loaded directly from their publisher. The scientific plots retain the original scan caption, band, temperature/reflectance legend, geographic axes and source credits. Their underlying products and timestamps differ from the previous NOAA display recoloring and local JPL MUR rendering.

* Infrared, water vapor, visible, RGB, Dvorak and AVN choices discover the publisher's current files. Acquisition time is parsed from the timestamped filename, not an HTTP modification time.
* Animation uses at most twelve recent scans. The enlarged viewer follows the current frame. Playback stops when the page is hidden and resumes when it is shown.
* Sea-temperature charts are the publisher's NOAA Coral Reef Watch plots. The analysis date remains printed on the chart. The separate numeric summary is explicitly labeled **JPL MUR point SST**, with its own analysis time; the image is not color-sampled to invent a numeric observation.
* Wind-radii charts retain the publisher's valid-time caption. Local fallback charts use published NHC/JTWC quadrant radii and their original timestamps.

The metadata endpoint is `api/live-storms?view=charts&storm=ID&product=spectrum&animated=0`. It accepts only storm IDs from the current agency catalog and a fixed list of product codes. It reads the public inventory at <https://cyclonicwx.com/storms/> and the corresponding floater page. Both full season ID and storm name must match the inventory; a reused short designation alone is insufficient. Stale inventories, future scans, foreign paths and unrecognized products are rejected. Page scripts are never evaluated.

Only small metadata responses pass through website hosting. Plot images load directly from CyclonicWx without mirroring, removing credits, recompressing, storing in Supabase or caching an image archive. The site depends on the publisher's public inventory layout and availability. Four-minute metadata caching coalesces concurrent inventory reads. A changed publisher layout fails closed and the UI identifies its NOAA/local fallback. The user can also choose **NOAA + local charts** explicitly.

The existing approximate Storm Spectrum palette remains a NOAA fallback, labeled as approximate. It recolors an 8-bit 720×480 display and cannot recover the raw satellite precision or resolution of the published scientific plot. Local JPL MUR maps still use the documented 0.5° display sample; the original CRW chart uses its own analysis.

Published observation images do not modify the experimental forecast model or its frozen calibration. Agency advisories remain the source of numerical storm estimates.

Verification covers parser identity/date/path checks, bounded frame inventories, direct-image delivery and API allowlists, plus browser checks of IR, water vapor, visible reflectance, animation, enlargement, provider switching and a simulated publisher outage.

Sources: [CyclonicWx current storms](https://cyclonicwx.com/storms/), [CyclonicWx satellite products](https://cyclonicwx.com/sat/), [CyclonicWx SST dataset description](https://cyclonicwx.com/sst/), [NOAA OSPO floaters](https://ospo.noaa.gov/products/ocean/tropical/floaters.html), [NOAA CoastWatch JPL MUR](https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html).
