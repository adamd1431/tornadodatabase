import {parseHdob,cleanObservations} from './recon-view-model.js';
import {parseReconMessages} from './recon-import-model.js';

export async function readReconArchive(url,{signal,read=fetch,onProgress=()=>{}}={}){
  async function json(target){const response=await read(target,{signal}),body=await response.json();if(!response.ok)throw Error(body.message||'The aircraft archive is temporarily unavailable.');return body;}
  const initial=await json(url);if(initial.browserRecon!==true)return initial;
  if(!['hdob','vortex'].includes(initial.kind)||!Number.isSafeInteger(initial.total)||initial.total<0||initial.total>1500||initial.batchSize!==12)throw Error('The archive returned an invalid batch plan.');
  const batches=Math.ceil(initial.total/initial.batchSize),responses=new Array(batches);let next=0,failed=0,done=0;
  await Promise.all(Array.from({length:Math.min(3,batches)},async()=>{
    while(next<batches){
      const batch=next++;
      try{
        const body=await json(url+(url.includes('?')?'&':'?')+'batch='+batch);
        if(body.sid!==initial.sid||body.date!==initial.date||body.kind!==initial.kind||body.batch!==batch||!Array.isArray(body.messages))throw Error('The archive returned an unexpected cyclone/date.');
        responses[batch]=body;
      }catch(error){if(signal?.aborted)throw error;failed++;}
      onProgress({done:++done,total:batches});
    }
  }));
  const messages=responses.flatMap(body=>body?.messages||[]),partial=initial.partial||failed>0||responses.some(body=>body?.partial);
  if(failed===batches&&batches)throw Error('The aircraft messages could not be loaded. Please retry.');
  if(initial.kind==='hdob'){
    const observations=cleanObservations(messages.flatMap(message=>parseHdob(message.text,{atcf:message.atcf,date:initial.date,sourceUrl:message.sourceUrl})));
    return {...initial,browserRecon:undefined,status:observations.length?'found':partial?'unavailable':'not-found',observations,partial,loaded:messages.length,message:observations.length?`${observations.length.toLocaleString('en-US')} observations · ${messages.length}/${initial.total} archive messages read${partial?' · the archive is incomplete; refresh to retry':''}.`:partial?'The aircraft archive could not be read completely. Retry this date.':'No matching modern HDOB messages were found on this UTC date.'};
  }
  const parsed=messages.map(message=>({message,records:parseReconMessages(message.text,{atcf:message.atcf,date:initial.date,start:initial.start,end:initial.end,sourceUrl:message.sourceUrl}),passes:parseReconMessages(message.text,{atcf:message.atcf,date:initial.date,start:initial.start,end:initial.end,sourceUrl:message.sourceUrl,allCandidates:true})}));
  const ncar=new Set(parsed.filter(item=>item.message.archive==='ncar'&&item.records.length).map(item=>item.message.atcf));
  const selected=parsed.filter(item=>item.message.archive==='ncar'||!ncar.has(item.message.atcf));
  const records=new Map(),passes=new Map();
  for(const item of selected){
    for(const row of item.records)records.set(row.atcf+'|'+row.fixAt+'|'+row.mission.replace(/\s+CC[A-Z]?\b/g,''),row);
    for(const row of item.passes)passes.set(row.atcf+'|'+row.fixAt+'|'+row.windAt+'|'+row.flightWindKt+'|'+row.rmwNmi+'|'+row.mission.replace(/\s+CC[A-Z]?\b/g,''),row);
  }
  const rows=[...records.values()].sort((a,b)=>a.windAt.localeCompare(b.windAt)),allPasses=[...passes.values()].sort((a,b)=>a.windAt.localeCompare(b.windAt));
  rows.forEach((row,index)=>row.id=row.atcf+'-'+row.fixAt+'-'+index);
  const found=rows.length||(url.includes('view=passes')&&allPasses.length);
  return {...initial,browserRecon:undefined,records:rows,passes:allPasses,partial,status:found?'found':partial?'unavailable':'not-found',message:found?`${rows.length} paired aircraft observations found.${partial?' Some archive requests failed; this list may be incomplete.':''}`:partial?'The aircraft archive could not be read completely. Retry this date.':'No paired flight-level wind / RMW messages were found on this date. Choose another date or enter verified recon values manually.'};
}
