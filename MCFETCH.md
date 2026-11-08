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

- The cyclone picker sets the destination and generator details. Scan
  coordinates are entered separately for the chosen UTC date and time.
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
