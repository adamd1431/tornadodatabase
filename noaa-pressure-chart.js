import {validateAnalysisTime} from './poci-roci-model.js';

export function noaaPressureChartUrl(date,time,options={}){
  const t=validateAnalysisTime(date,time),year=String(t.year),month=String(Number(date.slice(5,7))),day=String(Number(date.slice(8,10))),hour=time.slice(0,2)+' Z';
  const params=new URLSearchParams({doplot:'1',varID:'142214',fileID:'0',itype:'0',variable:'prmsl',levelType:'Mean Sea Level',level_units:'',level:'Mean Sea Level',timetype:'8x',fileTimetype:'8x',year1:year,month1:month,day1:day,hr1:hour,year2:year,month2:month,day2:day,hr2:hour,vectorPlot:'0',contourLevel:'auto',cint:'4',lowr:'0',highr:'200',colormap:'default',reverseColormap:'no',contourlines:'1',colorlines:'1',contourfill:'1',contourlabels:'0',removezonal:'0',plotUnits:'Pa',boundary:'Geophysical',projection:'CylindricalEquidistant',region:'All',area_north:'90',area_south:'-90',area_west:'0',area_east:'360',centerLat:'0.0',centerLon:'270.0',mapfill:'0'});
  if(options.interval!==undefined){
    const {interval,lowMb,highMb}=options;
    if(![2,5].includes(interval)||!Number.isFinite(lowMb)||!Number.isFinite(highMb)||lowMb<800||highMb>1150||highMb<=lowMb)throw Error('Invalid pressure-chart contour settings.');
    params.set('contourLevel','custom');params.set('cint',String(interval*100));params.set('lowr',String(lowMb*100));params.set('highr',String(highMb*100));
  }
  return 'https://psl.noaa.gov/cgi-bin/mddb2/plot.pl?'+params;
}
export function noaaPressureSubsetUrl(date,time){
  // This is the numeric-subset GET link built by NOAA's own makeplot.js.
  const url=new URL(noaaPressureChartUrl(date,time));url.searchParams.set('doplot','0');
  for(const key of ['vectorPlot','contourLevel','cint','lowr','highr','colormap','reverseColormap','contourlines','colorlines','contourfill','contourlabels','removezonal','boundary','projection','mapfill'])url.searchParams.delete(key);
  return url.href;
}
export function createNoaaPressureChartHandler(read=fetch){
  const images=new Map();let retryAt=0;
  async function chart(date,time,options){
    const url=noaaPressureChartUrl(date,time,options),key=url;if(images.has(key))return images.get(key);
    if(Date.now()<retryAt)throw Object.assign(Error('NOAA is temporarily limiting chart requests. Please try again shortly.'),{status:503});
    const pending=(async()=>{
      const response=await read(url,{signal:AbortSignal.timeout(45000)});
      if(response.status===429){retryAt=Date.now()+Math.max(60,Math.min(300,Number(response.headers.get('Retry-After'))||60))*1000;throw Object.assign(Error('NOAA is temporarily limiting chart requests. Please try again shortly.'),{status:503});}
      if(!response.ok)throw Error('NOAA could not generate this pressure chart. Please retry.');
      if(Number(response.headers.get('Content-Length'))>8000000)throw Error('NOAA returned an oversized chart.');
      const bytes=new Uint8Array(await response.arrayBuffer()),signature=[137,80,78,71,13,10,26,10];
      if(bytes.length>8000000||bytes.length<24||!signature.every((b,i)=>bytes[i]===b))throw Error('NOAA did not return a valid chart image.');
      return bytes;
    })();images.set(key,pending);if(images.size>8)images.delete(images.keys().next().value);
    try{return await pending;}catch(error){images.delete(key);throw error;}
  }
  return {async fetch(request){
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
    const p=new URL(request.url).searchParams,date=p.get('date'),time=p.get('time')||'0000',options=p.has('interval')?{interval:Number(p.get('interval')),lowMb:Number(p.get('low')),highMb:Number(p.get('high'))}:{};
    try{validateAnalysisTime(date,time);noaaPressureChartUrl(date,time,options);}catch(error){return Response.json({error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});}
    try{const bytes=await chart(date,time,options);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="noaa-pressure-${date}-${time}Z.png"`}});}
    catch(error){return Response.json({error:error.message||'The NOAA chart is temporarily unavailable.'},{status:error.status||502,headers:{'Cache-Control':'no-store',...(error.status===503?{'Retry-After':String(Math.max(1,Math.ceil((retryAt-Date.now())/1000)))}:{})}});}
  }};
}
