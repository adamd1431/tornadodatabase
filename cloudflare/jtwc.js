import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {jtwcReportYears,jtwcReportUrl,usesJtwcReports} from '../jtwc-report-model.js';
export function createCloudflareJtwcHandler({read=fetch,storms=manifest.storms}={}){return {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const p=new URL(request.url).searchParams,storm=storms.find(s=>s.id===p.get('sid'));
  if(!storm)return Response.json({error:'Cyclone not found.'},{status:404});
  if(!usesJtwcReports(storm))return Response.json({sid:storm.id,status:'not-applicable',message:'This storm uses NHC records rather than JTWC annual reports.'});
  if(p.get('mode')!=='report')return Response.json({sid:storm.id,browserReport:true,years:jtwcReportYears(storm)},{headers:{'Cache-Control':'public, max-age=86400'}});
  const year=Number(p.get('year'));
  if(!jtwcReportYears(storm).includes(year))return Response.json({error:'Invalid report year.'},{status:400});
  try{
    const upstream=await read(jtwcReportUrl(year),{redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!upstream.ok)return new Response('Report unavailable.',{status:upstream.status===404?404:502});
    if(Number(upstream.headers.get('content-length'))>80000000){await upstream.body?.cancel();return new Response('Report exceeds the size limit.',{status:502});}
    return new Response(request.method==='HEAD'?null:upstream.body,{headers:{'Content-Type':'application/pdf','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Report temporarily unavailable.',{status:502,headers:{'Cache-Control':'no-store'}});}
}};}
