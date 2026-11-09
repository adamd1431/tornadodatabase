// Decoded observations stay in this tab's memory only. No database writes.
export function createFrameCache({maxBytes=64*1024*1024,maxEntries=12}={}){
  const entries=new Map();let bytes=0;
  function get(key){const row=entries.get(key);if(!row)return null;entries.delete(key);entries.set(key,row);return row.value;}
  function set(key,value){
    const size=value.values?.byteLength||0,old=entries.get(key);if(old){bytes-=old.size;entries.delete(key);}if(!size||size>maxBytes)return;
    entries.set(key,{value,size});bytes+=size;
    while(bytes>maxBytes||entries.size>maxEntries){const first=entries.keys().next().value;bytes-=entries.get(first).size;entries.delete(first);}
  }
  return {get,set,clear(){entries.clear();bytes=0;},get bytes(){return bytes;},get size(){return entries.size;}};
}
export const observationContext=(storm,product)=>JSON.stringify([storm.id,storm.validAt,storm.latitude,storm.longitude,product]);
export const observationKey=(context,frame)=>context+'|'+JSON.stringify([frame.files||frame.scan||frame.validAt,frame.bounds||null]);
