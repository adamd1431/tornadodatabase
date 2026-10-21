// Parent records are deleted only after the server confirms the current owner.
// Keep media cleanup after the confirmed DELETE so a denied request cannot
// remove files from a cyclone that still exists.
async function requireOwner(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error('Sign in as the owner to delete this record.');
  const permission = await client.rpc('utwx_is_owner', { check_user_id: data.user.id });
  if (permission.error) throw permission.error;
  if (permission.data !== true) throw new Error('Only the owner can delete this record.');
}

async function deleteRecord(client, table, id) {
  const { data, error } = await client.from(table).delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (data?.id !== id) throw new Error('Deletion was not confirmed. Refresh the page and check that you are signed in as the owner.');
}

export async function deleteOutbreak(client, id) {
  await requireOwner(client);
  // Outbreaks only group tornadoes by date. Leave the tornadoes and uploads alone.
  await deleteRecord(client, 'outbreaks', id);
}

export async function cleanupCycloneFiles(client, paths) {
  const pending = [];
  const unique = [...new Set(paths.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 1000) {
    const batch = unique.slice(offset, offset + 1000);
    try {
      const { error } = await client.storage.from('cyclone-uploads').remove(batch);
      if (error) pending.push(...batch);
    } catch {
      pending.push(...batch);
    }
  }
  return pending;
}

export async function deleteTropicalCyclone(client, id) {
  await requireOwner(client);
  const paths = [];
  // Include pending and rejected uploads, even if they are not displayed. Page
  // through the API's default 1,000-row limit before the parent DELETE cascades.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('cyclone_uploads').select('id,storage_path')
      .eq('cyclone_id', id).order('id').range(offset, offset + 999);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Could not load cyclone media. Nothing was deleted; please try again.');
    paths.push(...data.map(row => row.storage_path));
    if (data.length < 1000) break;
  }
  await deleteRecord(client, 'tropical_cyclones', id);
  return cleanupCycloneFiles(client, paths);
}

export function ownerDeletionError(error) {
  if (error?.code === '42501') return 'Only the owner can delete this record. Check your account and run supabase-owner-record-deletion.sql if needed.';
  return error?.message || 'Could not delete this record. Please try again.';
}
