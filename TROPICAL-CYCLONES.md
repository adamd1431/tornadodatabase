Tropical cyclones are available in the database's third tab and at `index.html?view=cyclones`.

Setup: run `supabase-tropical-cyclones.sql` in the Supabase SQL Editor. It requires the existing `supabase-user-upload-workflow.sql` helpers and notification table. The migration can be rerun safely.

For owner estimates, also run `supabase-cyclone-estimates.sql`. On a cyclone page, the owner can choose **Edit owner estimates** to set or clear independent peak-wind and lowest-pressure estimates. Everyone can view saved estimates alongside the official figures. A database trigger prevents other accounts, including admins, from changing the estimate fields.

Cyclone cards and detail pages use official peak winds for the Saffir–Simpson category: 1 starts at 74 mph, 2 at 96, 3 at 111, 4 at 130, and 5 at 157. Category 1–5 colors match EF1–EF5 exactly. Storms below hurricane strength retain a separate tropical storm/depression label. Source: [National Hurricane Center](https://www.nhc.noaa.gov/aboutsshws.php).

The migration adds separate cyclone, media, and summary tables, plus the `cyclone-uploads` storage bucket. It does not change tornado records or rankings.

Guest and member cyclone submissions wait for approval. Admin submissions publish immediately. The server determines approval status. Media and summary submissions require a signed-in account and follow the same approval rules. Review all three in Admin → Tropical cyclones.

Media tabs are Pictures, Satellite imagery, Damage, Radar, Models, and Misc, in that order. Existing installations should run `supabase-cyclone-media-categories.sql` once to allow the new categories. It moves Environment, Research / Survey, and Text / Accounts uploads to Misc without deleting files or changing their approval status. Those uploads remain visible in Misc even before the migration runs.

Members can track their cyclone submissions and cancel pending media from their profiles. Approval decisions use the existing notification system. Approved media also appears in Recent uploads.

Run the local validation tests with `node --test tests/cyclones.test.cjs`.
