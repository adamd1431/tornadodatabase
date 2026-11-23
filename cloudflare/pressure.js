import {validateAnalysisTime} from '../poci-roci-model.js';
import {noaaPressureSubsetUrl} from '../noaa-pressure-chart.js';
import {AGENCIES} from '../ibtracs-model.js';

export function createCloudflarePressureHandler({read=fetch}={}){return {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const p=new URL(request.url).searchParams,date=p.get('date'),time=p.get('time')||'0000';
  try{
    validateAnalysisTime(date,time);
    if(p.has('sid')&&!/^\d{7}[NS]\d{5}$/.test(p.get('sid')))throw Error('Invalid cyclone identifier.');
    if(!AGENCIES.some(a=>a.id===(p.get('agency')||'USA')))throw Error('Invalid reporting agency.');
    if(![2,5].includes(Number(p.get('interval')||5)))throw Error('Choose a 5-mb or 2-mb contour interval.');
  }catch(error){return Response.json({error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});}
  if(p.get('mode')!=='field')return Response.json({browserAnalysis:true},{headers:{'Cache-Control':'public, max-age=86400'}});
  try{
    const upstream=await read(noaaPressureSubsetUrl(date,time),{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(upstream.status===429)return Response.json({error:'NOAA is temporarily limiting pressure-data requests. Please try again in a minute.'},{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
    if(!upstream.ok)return Response.json({error:'NOAA pressure data is temporarily unavailable. Please retry.'},{status:502});
    if(Number(upstream.headers.get('content-length'))>4000000){await upstream.body?.cancel();return new Response('Pressure subset is too large.',{status:502});}
    return new Response(request.method==='HEAD'?null:upstream.body,{headers:{'Content-Type':'application/x-netcdf','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({error:'NOAA pressure data is temporarily unavailable. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}});}
}};}
