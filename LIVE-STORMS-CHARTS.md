# Live observation charts and satellite loops

The Live Storms overview renders primary JMA/NOAA calibrated satellite observations, NOAA Coral Reef Watch sea-temperature grids, and agency ATCF wind radii. Its primary-data endpoints and experimental forecast calibration are unchanged by the dedicated loop's published-image option.

## Dedicated satellite loop

`satellite-loop.html` prefers ready-made CyclonicWx infrared, water-vapor and visible PNGs. Original pixels, aspect ratio, caption, timestamp, geographic axes, legend and embedded credits remain intact. The surrounding Tornado Database viewer retains its layout and labels; its footer identifies CyclonicWx as the image publisher and links to the original loop. No attribution is replaced with a claim that Tornado Database created these plots.

Defaults are **30 frames, 10 frames per second, skip 0**. A recent still appears first. Six bounded image requests prepare the remaining images; playback starts only after the inventory has finished loading. Unavailable frames are not duplicated or progressively added to a playing loop. Switching bands cancels obsolete work. Pausing while loading is respected.

`api/live-storms?view=published-loop&storm=ID&product=spectrum&frames=30&skip=0` reads the public inventory at <https://cyclonicwx.com/storms/> and the matching floater. Full season ID, storm name, advisory freshness, scan freshness, band and fixed filename paths must match. Page scripts are never evaluated. Arbitrary caller URLs and file paths are rejected. Metadata is coalesced and cached for two minutes.

The publisher's images do not provide browser CORS headers. To allow canvas playback, PNG downloads and local GIF export, `view=published-frame` passes through only a PNG filename found in that verified inventory, byte for byte, with a 3 MB limit, timeout, PNG signature check and one-day CDN cache. This is a fixed-source image route, not an open proxy. Images are never stored in Supabase or added to database uploads.

Completed original PNGs can be reused from a bounded browser cache: at most 120 images / 100 MiB, expiring after 24 hours. Save PNG downloads the original source bytes. GIF export preserves the original rectangular dimensions by default; the optional 1200-pixel long-edge setting scales proportionally. GIF uses its format's 256-color palette and does not crop captions or credits.

If published imagery is unavailable or its identity cannot be verified, the viewer falls back to calibrated JMA/NOAA observations with an explicit primary-data credit. Native rendering keeps its lossless 1800 × 1800 plots, two preparation workers and bounded browser cache. The original NOAA loop remains linked as an additional fallback.

Verification covers inventory identity/date/path checks, frame selection, byte-identical delivery, endpoint bounds, buffered playback, proportional export dimensions and browser checks of imagery, product switching and exports.

Sources: [CyclonicWx current storms](https://cyclonicwx.com/storms/), [CyclonicWx satellite products](https://cyclonicwx.com/sat/), [NOAA OSPO floaters](https://ospo.noaa.gov/products/ocean/tropical/floaters.html). Primary-data details remain in the native satellite modules and their tests.
