# Send to Tornado Database

## Install in Chrome

1. Deploy the website changes, including `image-import.html`, its JS/CSS, `image-import-bridge.js`, and this extension folder. The existing tornado and cyclone page changes must be deployed too. No SQL migration is needed.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder, the one containing `manifest.json`.
5. Right-click a normal image on a website and choose **Send image to Tornado Database**.
6. The destination defaults to `https://tornadodatabase.vercel.app/`. On the first use of an image host, click **Continue to database** and grant the requested access. Later images from an approved host transfer automatically.
7. Sign in on the database, choose **Tornado** or **Tropical cyclone**, find the storm, choose a category, and click **Continue to upload**. Pressing Enter in the search field selects the first matching storm.
8. The storm page starts duplicate scanning automatically, then uploads the image if it is clear. Possible duplicates still show the usual choices. Normal approval rules still apply. If the upload fails or is canceled, the image stays available with a **Retry upload** button.

The picker remembers your previous storm and category. The original page link is shown in the review; it is not added as a new database metadata field. The image itself is uploaded through the existing storage workflow.

## Permissions and data

- `contextMenus`: adds the right-click image command.
- `storage`: remembers the database address and temporarily holds the clicked image address.
- `scripting`: passes the selected image to the database's image-import page.
- Optional website access: requested for the image host and the configured database, rather than granted to every website at installation.

The extension does not read database cookies or login tokens. It downloads only the image you select. Transfers are limited to 20 MB and JPEG, PNG, GIF, WebP, AVIF, and BMP files. Temporary copies in the database website's browser storage expire after 30 minutes and are removed after a successful upload or when discarded.

Some protected images, `blob:` URLs, and websites that block downloads require the usual save-and-upload flow. For image search results, open the original image rather than sending a small thumbnail.

For local testing, set the database address to `http://127.0.0.1:8765/`. To update the installed extension after changing its files, click **Reload** on its card in `chrome://extensions`.

Chrome installation instructions: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
