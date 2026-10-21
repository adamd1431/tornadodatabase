function missingTable(error) {
  return ['42P01', 'PGRST205'].includes(error?.code);
}

async function loadRows(client, table, columns, parent = false, accountId = '') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = client.from(table).select(columns).eq('status', 'approved').order('id').range(from, from + 999);
    if (parent) query = query.eq('tropical_cyclones.status', 'approved');
    if (accountId) query = query.eq(parent ? 'user_id' : 'created_by', accountId);
    const { data, error } = await query;
    if (error) {
      if (missingTable(error)) return { rows: [], unavailable: true };
      throw error;
    }
    rows.push(...(data || []));
    if (!data || data.length < 1000) return { rows, unavailable: false };
  }
}

export async function loadCycloneLeaderboardContributions(client, accountId = '') {
  const [cyclones, uploads] = await Promise.all([
    loadRows(client, 'tropical_cyclones', 'id,created_by,submitted_by,status', false, accountId),
    loadRows(client, 'cyclone_uploads', 'id,user_id,uploaded_by,status,category,mime_type,file_url,tropical_cyclones!inner(status)', true, accountId)
  ]);
  return { cyclones: cyclones.rows, uploads: uploads.rows, unavailable: cyclones.unavailable || uploads.unavailable };
}
