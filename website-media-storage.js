import { requireStorageOwner, readMediaSnapshot, mediaReferencePatches, updateMediaReference, mediaReferences, losslessSourceMatches } from './lossless-storage.js';
import { readStorageBucket } from './storage-cleanup.js';

const PROJECT = 'https://kxhqfwlfendphhwurhcg.supabase.co';
const SITE = 'https://tornadodatabase.vercel.app';
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

function validate(plan) {
  if (plan?.version !== 1 || plan.identicalBytes !== true || plan.projectUrl !== PROJECT || plan.siteUrl !== SITE || !Array.isArray(plan.entries) || !plan.entries.length || plan.entries.length > 5000) throw Error('No verified website media batch is available.');
  const paths = new Set();
  for (const entry of plan.entries) {
    const source = new URL(entry.sourceUrl), archive = new URL(entry.archiveUrl);
    const prefix = '/storage/v1/object/public/' + entry.bucket + '/';
    const sourcePath = decodeURIComponent(source.pathname.slice(prefix.length));
    const sourceKey = entry.bucket + '/' + sourcePath;
    if (!['uploads', 'cyclone-uploads'].includes(entry.bucket) || source.origin !== PROJECT || source.username || source.password || source.search || source.hash
      || !source.pathname.startsWith(prefix) || sourcePath !== entry.sourcePath || paths.has(sourceKey)
      || sourcePath.split(/[\/\\]/).some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(entry.originalSHA256) || entry.originalSHA256 !== entry.replacementSHA256
      || archive.origin !== SITE || archive.username || archive.password || archive.search || archive.hash
      || !new RegExp('^/media-archive/' + entry.originalSHA256 + '\\.(?:jpe?g|png|webp|gif|avif)$', 'i').test(archive.pathname)
      || !Number.isSafeInteger(entry.originalBytes) || entry.originalBytes <= 0 || entry.originalBytes > 50 * 1024 * 1024
      || entry.replacementBytes !== entry.originalBytes || !entry.sourceETag || !/^image\/(?:jpeg|png|webp|gif|avif)$/.test(entry.replacementMimeType)) throw Error('The website media batch contains an invalid copy.');
    paths.add(sourceKey);
  }
  return plan.entries;
}

async function verifyCopy(entry, read) {
  // An interrupted static download can be retried safely. A changed or missing
  // file always fails verification and cannot authorize removing its source.
  for (let attempt = 0; attempt < 4; attempt++) {
    let response, bytes;
    try { response = await read(entry.archiveUrl); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 60) throw Error('Website hosting is busy. Try the copy check again later. Supabase copies are kept.');
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
      continue;
    }
    if (!response.ok || (response.headers.get('content-type') || '').split(';')[0] !== entry.replacementMimeType) throw Error('A website copy is missing or has the wrong type.');
    try { bytes = await response.arrayBuffer(); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (bytes.byteLength !== entry.originalBytes || await digest(bytes) !== entry.originalSHA256) throw Error('A website copy differs from its original. Supabase copies are kept.');
    return;
  }
}

export async function prepareWebsiteMediaBatch(client, plan, { read = fetch, onProgress = () => {} } = {}) {
  await requireStorageOwner(client);
  const entries = validate(plan);
  // These are static CDN reads. Database writes below remain limited to three
  // workers so verification does not slow the small database's connection pool.
  const readers = 12;
  for (let offset = 0; offset < entries.length; offset += readers) {
    await Promise.all(entries.slice(offset, offset + readers).map(entry => verifyCopy(entry, read)));
    onProgress({ done: Math.min(offset + readers, entries.length), total: entries.length });
  }
  return { plan, entries, savedBytes: entries.reduce((sum, entry) => sum + entry.originalBytes, 0) };
}

const confirmed = (tables, changes) => changes.length > 0 && changes.every(change => {
  const row = tables[change.table].find(row => row.id === change.id);
  return row && Object.entries(change.after).every(([field, value]) => row[field] === value);
});

export async function applyWebsiteMediaBatch(client, batch, { read = fetch, onProgress = () => {}, onReceipt = async () => { throw Error('Recovery storage is required.'); }, previous = [] } = {}) {
  await requireStorageOwner(client);
  const entries = validate(batch.plan), receipts = structuredClone(previous), failures = [];
  const selected = new Set(entries.map(entry => entry.sourceUrl));
  // Persistent recovery must work before changing any database links.
  await onReceipt(receipts);
  let persistence = Promise.resolve();
  const persist = (changed = receipts) => {
    const snapshot = structuredClone(changed);
    const saved = persistence.then(() => onReceipt(snapshot));
    persistence = saved.catch(() => {});
    return saved;
  };
  const save = async receipt => {
    const at = receipts.findIndex(item => item.sourceUrl === receipt.sourceUrl);
    if (at < 0) receipts.push(receipt); else receipts[at] = receipt;
    await persist([receipt]);
  };
  let tables = await readMediaSnapshot(client);
  const sourceObjects = new Map();
  for (const bucket of new Set(entries.map(entry => entry.bucket))) {
    for (const file of await readStorageBucket(client, bucket)) sourceObjects.set(bucket + '/' + file.path, file.item);
  }
  const staged = [];
  for (let offset = 0; offset < entries.length; offset += 3) {
    await Promise.all(entries.slice(offset, offset + 3).map(async (entry, step) => {
    const index = offset + step;
    onProgress({ done: index, total: entries.length, phase: 'linking' });
    const old = receipts.find(item => item.sourceUrl === entry.sourceUrl);
    if (old?.status === 'finished') return;
    try {
      if (old && (old.originalSHA256 !== entry.originalSHA256 || old.archiveUrl !== entry.archiveUrl)) throw Error('Recovery belongs to a different copy.');
      if (index % 25 === 0) await requireStorageOwner(client);
      // Recheck the deployed copy at action time, including resumed batches.
      await verifyCopy(entry, read);
      const original = sourceObjects.get(entry.bucket + '/' + entry.sourcePath);
      if (!original && old?.status === 'references-updated' && confirmed(tables, old.changes)) {
        old.status = 'finished'; await save(old); return;
      }
      if (!losslessSourceMatches(entry, original) || (old && old.originalObjectId !== original.id)) throw Error('The stored source changed.');
      // Keep the non-null cyclone locator valid without retaining a reference
      // to the Supabase object that will be removed.
      const changes = old?.changes || mediaReferencePatches(tables, entry, PROJECT, entry.archiveUrl, entry.archiveUrl);
      const receipt = old || { sourceUrl: entry.sourceUrl, sourcePath: entry.sourcePath, bucket: entry.bucket, originalObjectId: original.id, sourceETag: entry.sourceETag, originalSHA256: entry.originalSHA256, originalBytes: entry.originalBytes, archiveUrl: entry.archiveUrl, changes, status: 'prepared' };
      await save(receipt);
      for (const change of changes) {
        if (confirmed(tables, [change])) continue;
        await updateMediaReference(client, change);
        Object.assign(tables[change.table].find(row => row.id === change.id), change.after);
      }
      receipt.status = 'references-updated'; await save(receipt); staged.push(receipt);
    } catch (error) { failures.push(`${entry.originalFilename}: ${error.message} Supabase copy kept.`); }
    }));
  }
  // Read every current reference again, including covers and embedded links.
  tables = await readMediaSnapshot(client);
  const referenced = mediaReferences(tables, PROJECT), removable = [];
  for (const receipt of staged) {
    if (!referenced.has(receipt.bucket + '/' + receipt.sourcePath) && confirmed(tables, receipt.changes)) removable.push(receipt);
    else failures.push(`${receipt.sourcePath}: a link changed. Supabase copy kept.`);
  }
  for (const bucket of new Set(removable.map(receipt => receipt.bucket))) {
  const bucketReceipts = removable.filter(receipt => receipt.bucket === bucket);
  for (let offset = 0; offset < bucketReceipts.length; offset += 1000) {
    await requireStorageOwner(client);
    const candidates = bucketReceipts.slice(offset, offset + 1000), matching = [];
    const currentObjects = new Map((await readStorageBucket(client, bucket)).map(file => [file.path, file.item]));
    for (const receipt of candidates) {
      const original = currentObjects.get(receipt.sourcePath);
      if (original?.id === receipt.originalObjectId && losslessSourceMatches(receipt, original)) matching.push(receipt);
      else failures.push(`${receipt.sourcePath}: source changed before removal.`);
    }
    // Recheck links immediately before each removal batch, after object checks.
    tables = await readMediaSnapshot(client);
    const currentReferences = mediaReferences(tables, PROJECT);
    const group = matching.filter(receipt => {
      if (!currentReferences.has(receipt.bucket + '/' + receipt.sourcePath) && confirmed(tables, receipt.changes)) return true;
      failures.push(`${receipt.sourcePath}: a link changed before removal. Supabase copy kept.`);
      return false;
    });
    if (!group.length) continue;
    const removed = await client.storage.from(bucket).remove(group.map(item => item.sourcePath));
    if (removed.error) { failures.push(removed.error.message); continue; }
    const remaining = new Set((await readStorageBucket(client, bucket)).map(file => file.path));
    for (const receipt of group) {
      if (remaining.has(receipt.sourcePath)) { failures.push(`${receipt.sourcePath}: removal was not confirmed.`); continue; }
      receipt.status = 'finished';
    }
    await persist(group);
    onProgress({ done: receipts.filter(item => item.status === 'finished' && selected.has(item.sourceUrl)).length, total: entries.length, phase: 'freeing' });
  }
  }
  return { failures, receipts, savedBytes: receipts.filter(item => item.status === 'finished' && selected.has(item.sourceUrl)).reduce((sum, item) => sum + item.originalBytes, 0) };
}

const recoveryVersions = new Map();
export async function websiteMediaRecovery(ownerId, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('utwx-website-media-recovery', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('entries')) request.result.createObjectStore('entries');
    };
    request.onerror = () => reject(Error('Recovery storage is unavailable. No originals will be removed.'));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    if (value === undefined) {
      let records = await new Promise((resolve, reject) => {
        const transaction = db.transaction('entries', 'readonly');
        const request = transaction.objectStore('entries').getAll(IDBKeyRange.bound([ownerId, ''], [ownerId, '\uffff']));
        transaction.oncomplete = () => resolve(request.result || []);
        transaction.onerror = transaction.onabort = () => reject(Error('Could not read recovery progress.'));
      });
      // Retain receipts created by the first deployed version.
      if (!records.length && db.objectStoreNames.contains('receipts')) {
        records = await new Promise((resolve, reject) => {
          const transaction = db.transaction('receipts', 'readonly'), request = transaction.objectStore('receipts').get(ownerId);
          transaction.oncomplete = () => resolve(request.result || []);
          transaction.onerror = transaction.onabort = () => reject(Error('Could not read recovery progress.'));
        });
      }
      recoveryVersions.set(ownerId, new Map());
      return records;
    }
    const versions = recoveryVersions.get(ownerId) || new Map();
    const changed = value.map(record => [record, JSON.stringify(record)]).filter(([record, version]) => versions.get(record.sourceUrl) !== version);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('entries', 'readwrite'), store = transaction.objectStore('entries');
      for (const [record] of changed) store.put(record, [ownerId, record.sourceUrl]);
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(Error('Could not save recovery progress. Supabase copies are kept.'));
    });
    changed.forEach(([record, version]) => versions.set(record.sourceUrl, version));
    recoveryVersions.set(ownerId, versions);
    return value;
  } finally { db.close(); }
}
