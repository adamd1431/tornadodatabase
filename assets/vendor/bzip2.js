// Browser ESM wrapper for @foxglove/wasm-bz2 0.3.0 (MIT) / libbzip2.
// module.js changes: ESM export, relative wasm URL, browser/worker loader only.
// JMA concatenates complete bzip2 streams. Split at byte-aligned BZh headers
// followed by the 48-bit block marker; libbzip2 validates every stream's CRC.
import createModule from './bzip2-module.js';
let ready;
export async function initBzip2(wasmBinary){if(!ready)ready=createModule(wasmBinary?{wasmBinary}:{});return ready;}
function signature(b,i){return b[i]===66&&b[i+1]===90&&b[i+2]===104&&b[i+3]>=49&&b[i+3]<=57&&b[i+4]===49&&b[i+5]===65&&b[i+6]===89&&b[i+7]===38&&b[i+8]===83&&b[i+9]===89;}
export async function decompress(input,maxOutput=110000000){
  if(!Number.isInteger(maxOutput)||maxOutput<1||maxOutput>110000000||!signature(input,0))throw Error('Invalid bounded bzip2 input.');
  const starts=[0];for(let i=10;i<input.length-9;i++)if(signature(input,i))starts.push(i);starts.push(input.length);if(starts.length>1000)throw Error('Too many compressed streams.');
  const m=await initBzip2(),src=m._malloc(input.length),dest=m._malloc(maxOutput);if(!src||!dest)throw Error('Bzip2 allocation failed.');
  try{
    m.HEAPU8.set(input,src);let length=0;
    for(let i=0;i<starts.length-1;i++){const result=m.decompress(dest+length,maxOutput-length,src+starts[i],starts[i+1]-starts[i],0);if(result.code!==0||!result.buffer)throw Error('Bzip2 data failed integrity or output limit checks.');length+=result.buffer.length;}
    return m.HEAPU8.slice(dest,dest+length);
  }finally{m._free(src);m._free(dest);}
}
