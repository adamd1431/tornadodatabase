import {decompress} from './assets/vendor/bzip2.js';
import {HSD_ROOT,readHsd,sampleHsd} from './live-storms-primary.js';
self.onmessage=async({data})=>{
  try{
    const {frame}=data,size=700;let values=new Float32Array(size*size).fill(NaN),first=Infinity,last=-Infinity,quality=0;
    if(!Array.isArray(frame.files)||frame.files.length>5)throw Error('Invalid native scan.');
    for(let i=0;i<frame.files.length;i++){
      const url=frame.files[i];if(!url.startsWith(HSD_ROOT+'AHI-L1b-FLDK/')||!/^https:\/\/noaa-himawari9\.s3\.amazonaws\.com\/AHI-L1b-FLDK\/[0-9/]+\/HS_H09_\d{8}_\d{4}_B\d{2}_FLDK_R\d{2}_S\d{4}\.DAT\.bz2$/.test(url))throw Error('Untrusted native file.');
      self.postMessage({progress:`Reading native scan segment ${i+1} of ${frame.files.length}…`});
      const r=await fetch(url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('A native NOAA segment is not yet available.');
      const reader=r.body.getReader(),parts=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65000000){await reader.cancel();throw Error('Native file exceeds the browser limit.');}parts.push(value);}
      const compressed=new Uint8Array(length);let at=0;for(const part of parts){compressed.set(part,at);at+=part.length;}
      const segment=readHsd(await decompress(compressed));if(segment.calibration.band!==frame.band)throw Error('Native band mismatch.');
      values=sampleHsd(segment,frame.bounds,size,values);first=Math.min(first,Date.parse(segment.timestamp));last=Math.max(last,Date.parse(segment.timestamp));quality|=segment.quality;
    }
    if(!values.some(Number.isFinite))throw Error('No valid pixels cover this storm.');
    const grid={width:size,height:size,bounds:frame.bounds,values,validAt:new Date(first).toISOString(),lastSegmentAt:new Date(last).toISOString(),quality};self.postMessage({grid},[values.buffer]);
  }catch(error){self.postMessage({error:error.message||'The native scan could not be decoded.'});}
};
