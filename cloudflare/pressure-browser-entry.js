import {analyzePressureTime} from '../pressure-analysis-model.js';
import {parseNoaaPressureSubset} from '../noaa-pressure-subset.js';
import {unpackSnapshot} from '../ibtracs-model.js';
self.onmessage=async event=>{
  try{
    const p=event.data,response=await fetch('/ibtracs-data/index.json');
    if(!response.ok)throw Error('The cyclone catalog could not be loaded.');
    const manifest=await response.json();
    const result=await analyzePressureTime(manifest,p.date,p.time,{sid:p.sid,agency:p.agency||'USA',interval:Number(p.interval??5),
      readYear:async year=>unpackSnapshot(await fetch(`/ibtracs-data/${year}.json.gz`)),
      readField:async t=>{
        const response=await fetch('/api/poci-roci?'+new URLSearchParams({...p,mode:'field'}));
        if(!response.ok){let message='NOAA pressure data is temporarily unavailable.';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
        return parseNoaaPressureSubset(new Uint8Array(await response.arrayBuffer()),t.at);
      }
    });
    self.postMessage({result});
  }catch(error){self.postMessage({error:error.message||'Pressure extraction failed.'});}
};
