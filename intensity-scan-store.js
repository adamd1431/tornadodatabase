// Calibrated observations stay on this browser; no image upload or server storage.
const DB='td-calibrated-scans',STORE='scans',TTL=2*3600000;
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Local scan storage is unavailable. Open the estimator and fetch the scan there.'));});}
export async function storeIntensityScan(scan){
  if(!scan?.grid?.temperature||scan.grid.temperature.length>1500000)throw Error('Load a calibrated infrared scan first.');
  const db=await open(),record={...scan,id:crypto.randomUUID(),createdAt:Date.now()};
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.getAll();r.onsuccess=()=>{const old=r.result.sort((a,b)=>b.createdAt-a.createdAt);for(const [i,item]of old.entries())if(i>=3||Date.now()-item.createdAt>TTL)store.delete(item.id);store.put(record);};tx.oncomplete=resolve;tx.onerror=()=>reject(Error('The scan could not be saved locally.'));});return record.id;}finally{db.close();}
}
export async function readIntensityScan(id){
  if(!/^[\da-f-]{36}$/i.test(id||''))throw Error('This scan link is invalid.');const db=await open();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE),r=tx.objectStore(STORE).get(id);r.onsuccess=()=>{const row=r.result;if(!row||Date.now()-row.createdAt>TTL)reject(Error('This local scan has expired. Fetch it again in Satellite Archive.'));else resolve(row);};r.onerror=()=>reject(Error('The local scan could not be read.'));});}finally{db.close();}
}
