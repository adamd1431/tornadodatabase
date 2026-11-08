# Satellite Archive

`satellite-archive.html` is linked directly below Wind–pressure calculator in
the home page's Explore menu. It uses the public SSEC McFETCH API, with an
independently implemented client inspired by GoldStandardBot.

## Access

Register at https://mcfetch.ssec.wisc.edu/#register. SSEC reviews applications
and issues an access key. Enter the key in the Satellite Archive page and
choose Connect. No deployment or database changes are needed to start using
an approved key.

The key is held in page memory only and is sent in a same-origin HTTPS POST
to `/api/mcfetch`. That endpoint sends it to the fixed SSEC McFETCH endpoint.
Keys are never put in browser URLs, transfer records, localStorage, database
rows, response bodies, or application logs. Disconnect forgets the key and
cancels an active request. Navigating away or reloading ends the connection.

## Images

- Enter a name/designation, storm year, UTC date and time. The page reads a
  small, locally hosted annual IBTrACS v04r01 position subset, finds the storm,
  and suggests a satellite from its location and operational era. It does not
  require the storm to exist in the website database.
- Paste commands such as `!mcfetch_nc Jova 2023 0000 07/09/2023` in the command
  field. Dates in commands mean day/month/year. This imports identity and time,
  not the bot's NetCDF plotting or its custom colour-map collection.
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
- Requests use PNG. Returned PNG/GIF/JPEG bytes are validated and passed
  through without resizing or recompression. Requests are capped at 1600 by
  1600 pixels and responses at 4 MiB to fit the existing hosting plan.
- The UI labels date/time as **requested**, since the nearest available scan
  may differ. No observation time is inferred from the requested time.
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
