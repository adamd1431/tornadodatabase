# Website-hosted media

`media-archive/` contains exact copies of approved public database images, named
by their SHA-256 digest. Keep this folder in future website deployments. These
files are image data, not generated previews: pixels, metadata and animation
remain unchanged.

`media-archive-batch.json` records each source, hash and destination. Previous
batches are retained in `media-archive-batches/`. `media-archive-index.json` maps
old public image paths to their exact website copies so cached pages continue
to work after a move. Keep the index and all archived assets in deployments.
The Owner
panel verifies every deployed file before offering the storage move. It updates
and rereads media and cover links before removing a Supabase object. Interrupted
work can resume from the Owner's browser recovery database.

Cyclone rows also support a website-hosted `/storage/v1/object/public/cyclone-uploads/`
delivery alias. It preserves the URL shape required by older cyclone database
constraints, while resolving to the same verified hash-named static asset. Keep
that rewrite: no database constraint or security policy needs to be weakened.

New uploads continue to use Supabase. A new archive batch can move more approved
images when needed. Removing a database upload does not automatically remove a
file from this source folder; remove unreferenced archive files in a subsequent
website deployment when permanent removal is requested.

The public image delivery function caches unchanged Supabase image streams on
the website CDN. It accepts only image files in the two public media buckets,
forwards no account credentials and drops upstream cookies. Failed requests are
not cached, and images above the CDN size limit load directly from Supabase.

Public index records and upload counts use an anonymous, approved-data-only CDN
cache for five minutes. Count responses contain totals rather than image URLs.
Account data, owner review, and all writes still use authenticated requests.
No Supabase logging or security settings are weakened. These changes reduce new
requests; they do not reset accumulated egress or ingestion in the billing UI.
