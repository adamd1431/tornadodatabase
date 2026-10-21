Tropical cyclones are available in the database's third tab and at `index.html?view=cyclones`.

Setup: run `supabase-tropical-cyclones.sql` in the Supabase SQL Editor. It requires the existing `supabase-user-upload-workflow.sql` helpers and notification table. The migration can be rerun safely.

The migration adds separate cyclone, media, and summary tables, plus the `cyclone-uploads` storage bucket. It does not change tornado records or rankings.

Guest and member cyclone submissions wait for approval. Admin submissions publish immediately. The server determines approval status. Media and summary submissions require a signed-in account and follow the same approval rules. Review all three in Admin → Tropical cyclones.

Members can track their cyclone submissions and cancel pending media from their profiles. Approval decisions use the existing notification system. Approved media also appears in Recent uploads.

Run the local validation tests with `node --test tests/cyclones.test.cjs`.
