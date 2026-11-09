import {decompress} from './assets/vendor/bzip2.js';
import {HSD_ROOT,readHsd,sampleHsd} from './live-storms-primary.js';
self.onmessage=async({data})=>{
  const {id,frame}=data,controller=new AbortController();
  try{
    const size=frame.band===3?1536:1152;let values=new Float32Array(size*size).fill(NaN),first=Infinity,last=-Infinity,quality=0,downloaded=0,lastProgress=0;
    if(!Array.isArray(frame.files)||!frame.files.length||frame.files.length>5||frame.files.some(url=>typeof url!=='string'||!url.startsWith(HSD_ROOT+'AHI-L1b-FLDK/')||!/^https:\/\/noaa-himawari9\.s3\.amazonaws\.com\/AHI-L1b-FLDK\/[0-9/]+\/HS_H09_\d{8}_\d{4}_B\d{2}_FLDK_R\d{2}_S\d{4}\.DAT\.bz2$/.test(url)))throw Error('Untrusted native scan.');
    const progress=message=>self.postMessage({id,progress:message});
    async function download(url){
      const r=await fetch(url,{cache:'force-cache',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});if(!r.ok)throw Error('A native NOAA segment is not yet available.');
      const reader=r.body.getReader(),parts=[];let length=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;downloaded+=value.length;if(length>65000000){await reader.cancel();throw Error('Native file exceeds the browser limit.');}parts.push(value);if(Date.now()-lastProgress>180){lastProgress=Date.now();progress(`Loading native scan · ${(downloaded/1048576).toFixed(1)} MB received`);}}}finally{reader.releaseLock();}
      const compressed=new Uint8Array(length);let at=0;for(const part of parts){compressed.set(part,at);at+=part.length;}parts.length=0;return compressed;
    }
    // At most two transfers in flight. Fetch the next segment while decoding
    // the current one, rather than serializing network and CPU work.
    const pending=new Map(),start=i=>{if(i<frame.files.length)pending.set(i,download(frame.files[i]).then(bytes=>({bytes}),error=>({error})));};start(0);start(1);
    for(let i=0;i<frame.files.length;i++){
      const result=await pending.get(i);pending.delete(i);if(result.error)throw result.error;start(i+2);progress(`Rendering native scan segment ${i+1} of ${frame.files.length}…`);
      const segment=readHsd(await decompress(result.bytes));if(segment.calibration.band!==frame.band)throw Error('Native band mismatch.');
      values=sampleHsd(segment,frame.bounds,size,values);first=Math.min(first,Date.parse(segment.timestamp));last=Math.max(last,Date.parse(segment.timestamp));quality|=segment.quality;
    }
    if(!values.some(Number.isFinite))throw Error('No valid pixels cover this storm.');
    const grid={width:size,height:size,bounds:frame.bounds,values,validAt:new Date(first).toISOString(),lastSegmentAt:new Date(last).toISOString(),quality};self.postMessage({id,grid},[values.buffer]);
  }catch(error){controller.abort();self.postMessage({id,error:error.message||'The native scan could not be decoded.'});}
};
