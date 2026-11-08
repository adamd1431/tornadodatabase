# Satellite Archive

`satellite-archive.html` is linked directly below Wind–pressure calculator in
the home page's Explore menu. It uses the public SSEC McFETCH API, with an
independently implemented client inspired by GoldStandardBot.

## Access

Register at https://mcfetch.ssec.wisc.edu/#register. SSEC reviews applications
and issues an access key. Enter the key in the Satellite Archive page and
choose Use key. No deployment or database changes are needed to start using
an approved key. The page labels it unverified until SSEC accepts an image request.

The key is held in page memory only and is sent in a same-origin HTTPS POST
to `/api/mcfetch`. That endpoint sends it to the fixed SSEC McFETCH endpoint.
Keys are never put in browser URLs, transfer records, localStorage, database
rows, response bodies, or application logs. Forget key removes the key and
cancels an active request. Navigating away or reloading ends the connection.

## Images and temperature plots

- UTC input uses exactly four digits, 0000 through 2359. It does not use the
  browser's locale-dependent AM/PM time picker.
- Enter the cyclone name/designation, year, UTC date and time, or paste
  `!mcfetch_nc Durian 2006 1200 29/11/2006 bd`. Command dates are day/month/year.
  All command variants choose the temperature-plot format, including plain
  `!mcfetch`. BD is the default; explicit grayscale is also supported. The page
  offers only calibrated infrared plots. MB commands report the supported choices.
  A mismatched date year offers an explicit correction only when the name and
  requested time resolve on that date in the storm year. Southern seasons spanning
  calendar years remain valid; no date or cyclone is changed silently.
- NetCDF mode requests calibrated `UNIT=TEMP` data, native 1-by-1 sampling,
  350 samples for older satellites or 500 for modern ones. It plots the native
  curvilinear grid in geographic coordinates, with a Celsius scale, coastlines,
  actual acquisition timestamp and maximum within one degree of the requested
  storm center. The center statistic is not necessarily the eye temperature.
- Plot mode uses the requested-time track position and default extent of
  +/-6.5 degrees for older satellites or +/-5 degrees for modern ones, matching
  the bot's centering convention. For MTSAT-1R, northern centers at 0000, 0600,
  1200 and 1800 prefer NH coverage. Other modern satellites use full disk.
  Users can override coverage, native sampling and geographic extent.
- The independent NetCDF classic reader validates bounds, dimensions, units,
  fill values and the embedded scan timestamp. It supports CDF-1 and CDF-2
  fixed grids and rejects unsupported record or HDF5 files explicitly. Data
  in Kelvin are converted to Celsius; the GOES-7 tenths-K quirk is handled only
  for that sensor. A real Durian subset is included as a regression fixture.
- The BD palette reproduces the supplied reference colour bar. Natural Earth
  1:50m coastlines are public domain. Native flat-colour cells are rasterized
  without antialiasing seams. Plots export as lossless 1000-by-920 PNG files.
- The internal API retains its original image request support for compatibility;
  the Satellite Archive page always previews and exports a temperature plot.
- SSEC's key-free public inventory is checked before downloading. Scan matches
  are filtered by satellite, band, coverage, hemisphere and geometric visibility
  within three hours. If the automatic satellite has no scan, one all-satellite
  inventory request finds another supported sensor with its own infrared band.
  The closest viewing geometry is preferred, with explicit satellite and band
  selections kept strict. Automatic hemisphere preferences can use full disk when
  needed. Public inventory responses are bounded to 4 MiB and cached for ten minutes.
  Requested, selected and NetCDF acquisition times are clearly distinguished.
- The reference Durian command produces MTSAT-1R band 2, NH at 2006-11-29
  11:16:00 UTC and a 1.51 C center maximum. Original image mode instead selects
  the nearer 11:33 full-disk scan. These are different acquisitions and views.
- McFETCH's legacy CGI requires literal time colons; percent-encoded %3A may
  silently select a scan near midnight. The upstream request preserves colons.
- Credentials, upstream URLs and raw upstream error text are never returned or
  logged. Fixed errors distinguish rejected keys, quotas, format and image
  failures. NetCDF/image payloads are capped at 4 MiB for the hosting limit.
- Cyclone lookup uses the locally hosted annual IBTrACS v04r01 position subsets.
  USA positions take precedence, with explicitly labelled merged fallbacks.
  Interpolation uses consecutive same-source points at most six hours apart,
  taking the shorter dateline path. It never extrapolates outside a track.
- Storms need not exist in the website database. A matching database destination
  is selected by name/year, or cleared to avoid retaining a different cyclone.
- Misspelled names offer nearby names active in the requested year and date.
  Choosing a suggestion corrects the lookup and matching pasted command while
  retaining its time, date and palette. Suggestions never silently replace a
  cyclone, change designation IDs, or override a correct name at the wrong date.
- Previews are not uploaded. Gallery and generator transfers use the existing
  authenticated image-import bridge and carry only the rendered PNG or original
  image and public metadata. The access key is never part of a transfer.

References: https://mcfetch.ssec.wisc.edu/#help,
https://github.com/Sohum09/GoldStandardBot,
https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html,
https://www.naturalearthdata.com/about/terms-of-use/.

## Position data refresh

`node scripts/refresh-satellite-tracks.mjs` exports positions from NOAA's ALL
CSV for calendar years 1974 onward. It streams the source without saving the
large original file and keeps no wind/pressure estimates. The annual files
total about 7.3 MiB and use website hosting, with no Supabase storage or query.
Each page visit fetches only the requested calendar year and reuses it in
memory. Metadata and position-source definitions are in
`satellite-tracks/index.json`.

Normal deployments run `--recent --keep-on-error`: when the snapshot is over
24 hours old, the script refreshes the current and previous calendar years
from NOAA's last-three-years CSV. If NOAA is unavailable, the deployment keeps
the last good snapshot. Archived years can be refreshed with the full command.
This is a deployment-time refresh, not a background scheduled job.

Satellite-era references: https://www.data.jma.go.jp/mscweb/en/oper/status.html,
https://www.jma.go.jp/jma/jma-eng/satellite/introduction/20250912_chronologicaltable.pdf,
https://www.ncei.noaa.gov/products/satellite/goes-r and
https://ospo.noaa.gov/operations/goes/status.html.

## Current storms

`live-storms.html` is linked immediately below Satellite archive in Explore and
from the archive navigation. It uses public feeds without a McFETCH key:
NHC/CPHC CurrentStorms.json, JTWC RSS plus each active warning, NOAA OSPO
floaters, and NASA JPL MUR SST v4.1 through NOAA CoastWatch ERDDAP.

`api/live-storms.js` validates the selected active storm and product. It never
accepts a caller-supplied source URL. Public advisories are cached for five
minutes, satellite metadata for four minutes, and daily ocean grids for thirty
minutes. All fetches have timeouts and bounded bodies; individual source failures
are reported without hiding working sources. NHC/CPHC takes precedence in its
basins. Warnings older than 36 hours are excluded, and those over 12 hours are
labelled older. JTWC observation and issue times remain distinct; forecast winds
are separate from current intensity. Missing pressure is never inferred.

The page refreshes every five minutes while visible, with an optional pause and
manual refresh. Images load directly from NOAA/JTWC, including optional loops;
no image copies or new database records are stored. The SST display uses the
latest daily MUR analysis, including its timestamp, a regional 0.5-degree sample,
and the sea pixel at the advisory position. Land/missing data remain blank.
Dateline regions are split into valid longitude queries. Ocean and image failures
are independent. Wind units can be changed without fetching the sources again.

The current-conditions overview places satellite imagery, a geodesic quadrant
wind-radius chart and the SST map side by side, with enlarged chart dialogs and
a one-click satellite loop. Wind units default to knots. GFS and ECMWF buttons
link to their official model-chart viewers; they are separate from the agency's
storm forecast.

The structure endpoint reads NHC/CPHC operational B-decks or the public NCAR
mirror of JTWC/NCEP ATCF records, retaining the source URL and fix time. RMW,
POCI and ROCI are reported as recorded, without adding a pressure offset. Only
records at or before the advisory, within six hours, qualify for structure.
A missing advisory pressure is filled only by an exact-time ATCF record with
matching wind and position. Older structure cannot silently replace a current
advisory pressure. Wind-radius charts use the advisory radii and center when
available, otherwise the timestamped ATCF radii and center. RMW is overlaid only
at the same fix time. Quadrant radii are plotted with great-circle distances.
