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

## Images

- Enter a name/designation, storm year, UTC date and time. The page reads a
  small, locally hosted annual IBTrACS v04r01 position subset, finds the storm,
  and suggests a satellite from its location and operational era. It does not
  require the storm to exist in the website database.
- Paste commands such as `!mcfetch_nc Durian 2006 1200 29/11/2006 bd`.
  Dates mean day/month/year. The final bd/mb/grayscale argument sets the
  enhancement. Unknown palettes show a clear error instead of being silently
  ignored. This is an image-rendering client, not the bot’s NetCDF plotting
  or its full custom colour-map collection.
- USA positions take precedence; missing pairs fall back to IBTrACS merged
  positions with explicit labels. Interpolation uses the shorter longitude
  path across the dateline and only consecutive same-source points no more
  than six hours apart. It never extrapolates beyond a track or substitutes
  peak coordinates. Ambiguous matches require a track selection.
- Coordinates and a satellite can still be entered manually. Suggestions do
  not guarantee scan availability; SSEC inventory remains authoritative.
- The optional database picker sets the gallery destination and generator
  details. A successful new lookup matches that destination by name/year or
  clears it to avoid keeping a different, previously selected cyclone.
- Coordinates use positive north/east in the form. The request builder flips
  longitude once for McFETCH's west-positive convention.
- Satellite presets provide common visible and longwave IR band numbers.
  Custom bands are available. Check the SSEC inventory for actual availability,
  scan schedules, and coverage. Recent-data access depends on the account.
- Requests use the documented lossless GIF output. Returned GIF/PNG/JPEG
  bytes are validated by file signature (even with a generic Content-Type) and passed
  through without resizing or recompression. Requests are capped at 1600 by
  1600 pixels and responses at 4 MiB to fit the existing hosting plan.
- Before image retrieval, a key-free `action: scan` POST to `/api/mcfetch`
  checks SSEC’s public inventory within three hours of the requested time.
  It filters by satellite, band, hemisphere and geometric satellite visibility,
  and respects an explicit coverage override. Automatic coverage uses only
  full-disk or hemispheric scans, avoiding unverified mesoscale footprints.
  Public inventory responses are cached for ten minutes (up to 32 entries).
- The selected inventory scan time and the requested time are displayed
  separately. Automatic centering interpolates the track at the selected scan
  time. A listing is not a decoded acquisition timestamp; the returned image
  remains the authority.
- Example verified against SSEC’s inventory: the Durian command above selects
  MTSAT-1R band 2, full disk at 2006-11-29 11:33:00 UTC, 27 minutes before the
  requested time. The 12:00 UTC listing covers the Southern Hemisphere.
- Credential, quota, format and missing-image errors use fixed messages. Raw
  upstream HTML/text is never returned, as it may echo the user’s access key.
  A syntactically valid string is not proof of an approved McFETCH account.
- McFETCH's legacy CGI requires literal colons in the upstream `time` query
  value. Percent-encoded `%3A` separators can silently return a scan near
  midnight. The request builder preserves colons; an authenticated LIST
  request verified the exact Durian scan as 2006-11-29 11:33:00 UTC.
- Previews are not uploaded. Gallery transfers use the existing IndexedDB
  bridge, 30-minute expiry, authentication, duplicate scan, and upload approval
  flow. Generator transfers retain the same original image bytes and carry
  the selected cyclone's public metadata.

References: https://mcfetch.ssec.wisc.edu/#help and
https://github.com/Sohum09/GoldStandardBot

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
