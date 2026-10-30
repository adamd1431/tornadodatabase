# Website-hosted media

`media-archive/` contains exact copies of approved public database images, named
by their SHA-256 digest. Keep this folder in future website deployments. These
files are image data, not generated previews: pixels, metadata and animation
remain unchanged.

`media-archive-batch.json` records each source, hash and destination. The Owner
panel verifies every deployed file before offering the storage move. It updates
and rereads media and cover links before removing a Supabase object. Interrupted
work can resume from the Owner's browser recovery database.

New uploads continue to use Supabase. A new archive batch can move more approved
images when needed. Removing a database upload does not automatically remove a
file from this source folder; remove unreferenced archive files in a subsequent
website deployment when permanent removal is requested.

The public image delivery function caches unchanged Supabase image streams on
the website CDN. It accepts only image files in the two public media buckets,
forwards no account credentials and drops upstream cookies. Failed requests are
not cached, and images above the CDN size limit load directly from Supabase.
