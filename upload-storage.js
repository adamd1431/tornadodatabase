// Repack PNG compression only: dimensions, pixels, metadata, and colour profiles
// are unchanged. Other formats (including animated images) keep their bytes.
const PNG_SIGNATURE = [137,80,78,71,13,10,26,10];
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const crcTable = Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngChunk(type,data) {
  const result = new Uint8Array(data.length+12), view = new DataView(result.buffer);
  view.setUint32(0,data.length);
  result.set([...type].map(character=>character.charCodeAt(0)),4);
  result.set(data,8);
  let crc = 0xffffffff;
  for(const byte of result.subarray(4,-4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(result.length-4,(crc ^ 0xffffffff) >>> 0);
  return result;
}

async function collectLimited(stream,limit) {
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    while(true) {
      const {value,done} = await reader.read();
      if(done) break;
      size += value.length;
      if(size > limit) { await reader.cancel(); throw new Error('Image is too large to optimize locally.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks);
}

export async function optimizeUploadFile(file) {
  if(!file || file.size < 32768 || file.size > 50*1024*1024
    || !(/image\/png/i.test(file.type || '') || /\.png$/i.test(file.name || ''))
    || typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return file;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if(!PNG_SIGNATURE.every((value,index)=>bytes[index] === value)) return file;
    const view = new DataView(bytes.buffer), chunks = [], imageData = [];
    let ended = false;
    for(let offset=8;offset<bytes.length;) {
      if(offset+12 > bytes.length) return file;
      const length = view.getUint32(offset), end = offset+length+12;
      if(end > bytes.length) return file;
      const type = String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      // APNG frame data must never be flattened or silently discarded.
      if(type === 'acTL') return file;
      chunks.push({type,bytes:bytes.subarray(offset,end)});
      if(type === 'IDAT') imageData.push(bytes.subarray(offset+8,end-4));
      offset = end;
      if(type === 'IEND') { ended = offset === bytes.length; break; }
    }
    if(!ended || chunks[0]?.type !== 'IHDR' || !imageData.length) return file;
    const inflated = await collectLimited(new Blob(imageData).stream().pipeThrough(new DecompressionStream('deflate')),MAX_INFLATED_BYTES);
    const compressed = new Uint8Array(await new Response(inflated.stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const parts = [bytes.subarray(0,8)]; let written = false;
    for(const chunk of chunks) {
      if(chunk.type !== 'IDAT') parts.push(chunk.bytes);
      else if(!written) { parts.push(pngChunk('IDAT',compressed)); written = true; }
    }
    const optimized = new File(parts,file.name,{type:'image/png',lastModified:file.lastModified});
    return optimized.size+1024 < file.size ? optimized : file;
  } catch { return file; }
}

export async function prepareUploadFileBundle(file) {
  return {displayFile:await optimizeUploadFile(file),originalFile:null,originalPreserved:false};
}
