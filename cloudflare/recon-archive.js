import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {reconDates,reconDateValid,reconSupported} from '../recon-import-model.js';
const links=text=>[...text.matchAll(/href=["']([^"']+)["']/gi)].map(match=>match[1]);
export const ARCHIVE_BATCH_SIZE=12;
export function createCloudflareArchiveHandler(kind,{read=fetch,storms=manifest.storms}={}){
  const plans=new Map();
  async function text(url,max=8000000){
    const response=await read(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'TornadoDatabase/1.0 (NOAA reconnaissance archive)'}});
    if(response.status===404)return null;
    if(!response.ok)throw Error('The aircraft archive is temporarily unavailable.');
    if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('The archive exceeds its size limit.');}
    const value=await response.text();if(value.length>max)throw Error('The archive exceeds its size limit.');return value;
  }
  async function plan(storm,date){
    const files=[],sources=[],failures=[],year=Number(date.slice(0,4)),begin=Date.parse(date+'T00:00:00Z');
    for(const atcf of storm.atcf.filter(id=>/^(AL|EP|CP)\d{6}$/.test(id))){
      if(kind==='vortex'&&Number(atcf.slice(-4))<=2021){
        const base=`https://hurricanes.ral.ucar.edu/structure/vortex/vdm_data/${atcf.slice(-4)}/`;
        try{
          const listing=await text(base),name=links(listing||'').filter(name=>new RegExp('^vortex_'+atcf+'_[A-Z0-9_-]+\\.txt$').test(name)&&!name.includes('_INVEST.')).sort()[0];
          if(name){files.push({atcf,sourceUrl:base+name,archive:'ncar'});sources.push(base);}
        }catch(error){console.warn('Recon archive listing unavailable:',base,error.message);failures.push(base);}
      }
      const code=atcf.startsWith('AL')?'NT':'PN',product=kind==='hdob'?`AHO${code}1`:(code==='NT'?'REPNT2':'REPPN2');
      const bases=kind==='hdob'&&year<2012?['NOAA','USAF'].map(agency=>`https://www.nhc.noaa.gov/archive/recon/${year}/HDOB/${agency}/UR${code}15/`):[`https://www.nhc.noaa.gov/archive/recon/${year}/${product}/`];
      for(const base of bases){
        try{
          const listing=await text(base);if(listing===null)continue;sources.push(base);
          const selected=links(listing).filter(name=>/^[A-Za-z0-9_.-]+\.\d{12}\.txt$/.test(name)).filter(name=>{
            const m=name.match(/\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.txt$/),stamp=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
            return stamp>=begin-(kind==='vortex'?3600000:0)&&stamp<begin+90000000;
          }).sort();
          if(selected.length>(kind==='hdob'?650:120))throw Error('The archive has too many messages.');
          files.push(...selected.map(name=>({atcf,sourceUrl:base+name,archive:'nhc'})));
        }catch(error){console.warn('Recon archive listing unavailable:',base,error.message);failures.push(base);}
      }
    }
    return {files,sources,partial:failures.length>0};
  }
  return {async fetch(request){
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405,headers:{Allow:'GET, HEAD'}});
    const q=new URL(request.url).searchParams,storm=storms.find(s=>s.id===q.get('sid')),date=q.get('date');
    if(!storm||!reconDateValid(date)||!reconDates(storm).includes(date))return Response.json({message:'Choose a cyclone and a date within its lifetime.'},{status:400});
    if((kind==='hdob'&&Number(date.slice(0,4))<2008)||!reconSupported(storm))return Response.json({sid:storm.id,date,status:'unsupported',observations:[],records:[],message:kind==='hdob'?'Automatic HDOB tracks cover Atlantic and Eastern/Central Pacific storms from 2008 onward. The Recon calculator retains older vortex-message imports.':'Automatic aircraft imports cover Atlantic and Eastern/Central Pacific archives from 1989 onward.'});
    const key=storm.id+'|'+date,hasBatch=q.has('batch');
    let entry=plans.get(key);
    if(!entry||entry.until<Date.now()||(!hasBatch&&q.get('refresh')==='1')){
      entry={until:Date.now()+300000,promise:plan(storm,date).catch(()=>({files:[],sources:[],partial:true}))};plans.set(key,entry);
      if(plans.size>24)plans.delete(plans.keys().next().value);
    }
    const archive=await entry.promise,base={sid:storm.id,date,start:storm.start,end:storm.end,kind,browserRecon:true,batchSize:ARCHIVE_BATCH_SIZE,total:archive.files.length,sources:archive.sources,partial:archive.partial};
    if(!hasBatch)return Response.json(base,{headers:{'Cache-Control':archive.partial?'no-store':'public, max-age=300'}});
    const batch=Number(q.get('batch'));
    if(!/^\d+$/.test(q.get('batch'))||!Number.isSafeInteger(batch)||batch<0||batch>=Math.ceil(archive.files.length/ARCHIVE_BATCH_SIZE))return Response.json({message:'Invalid archive batch.'},{status:400});
    const messages=[],selected=archive.files.slice(batch*ARCHIVE_BATCH_SIZE,(batch+1)*ARCHIVE_BATCH_SIZE);let next=0,failed=0;
    await Promise.all(Array.from({length:Math.min(6,selected.length)},async()=>{
      while(next<selected.length){const item=selected[next++];try{const raw=await text(item.sourceUrl,kind==='vortex'?4000000:8000000);if(raw!==null)messages.push({...item,text:raw});else failed++;}catch{failed++;}}
    }));
    const body={...base,batch,messages,failed,partial:base.partial||failed>0};
    return new Response(request.method==='HEAD'?null:JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':body.partial?'no-store':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
  }};
}
