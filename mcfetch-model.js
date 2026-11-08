// Independent McFETCH client. Parameter reference: https://mcfetch.ssec.wisc.edu/#help
// Coordinates in this UI use east-positive longitude; McFETCH uses west-positive.
export const MCFETCH_ENDPOINT = 'https://mcfetch.ssec.wisc.edu/cgi-bin/mcfetch';
// Leave room below the hosting platform's 4.5 MB response limit.
export const MCFETCH_MAX_BYTES = 4 * 1024 * 1024;
export const SATELLITES = Object.freeze([
  ...[9,8].map(n=>({id:`HIMAWARI${n}`,label:`Himawari-${n}`,visible:3,infrared:13,modern:true})),
  ...[19,18,17,16].map(n=>({id:`GOES${n}`,label:`GOES-${n}`,visible:2,infrared:13,modern:true})),
  ...[2,1].map(n=>({id:n===1?'MTSAT1R':'MTSAT2',label:n===1?'MTSAT-1R':'MTSAT-2',visible:1,infrared:2})),
  {id:'GMS5',label:'GMS-5',visible:1,infrared:2},
  ...[4,3,2,1].map(n=>({id:`GMS${n}`,label:`GMS-${n}`,visible:1,infrared:8})),
  ...[15,14,13,12,11,10,9,8].map(n=>({id:`GOES${n}`,label:`GOES-${n}`,visible:1,infrared:4})),
  ...[7,6,5,4,3,2,1].map(n=>({id:`GOES${n}`,label:`GOES-${n}`,visible:1,infrared:8})),
  ...[11,10,9,8].map(n=>({id:`MET${n}`,label:`Meteosat-${n}`,visible:1,infrared:9,modern:true})),
  ...[7,6,5].map(n=>({id:`MET${n}`,label:`Meteosat-${n}`,visible:1,infrared:8})),
  ...[2,1].map(n=>({id:`SMS${n}`,label:`SMS-${n}`,visible:1,infrared:8})),
  ...[2,1].map(n=>({id:`EWS-G${n}`,label:`EWS-G${n}`,visible:1,infrared:4}))
]);
export function mcfetchKey(value) {
  const key=String(value||'').trim();
  if(!/^[a-z0-9_-]{8,160}$/i.test(key))throw Error('Enter the access key issued to you by McFETCH.');
  return key;
}
function number(value,min,max,label,integer=false) {
  if(value===null||value===undefined||String(value).trim()==='')throw Error(`Enter ${label.toLowerCase()}.`);
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error(`${label} must be ${integer?'a whole number ':''}between ${min} and ${max}.`);
  return n;
}
export function utcClock(value){
  const s=String(value||'').trim();if(!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(s))throw Error('Enter a four-digit UTC time from 0000 to 2359.');return s.slice(0,2)+':'+s.slice(2);
}
export function normalizeMcfetch(input,now=new Date()) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose satellite image settings.');
  const satellite=String(input.satellite||'').toUpperCase();
  if(!SATELLITES.some(row=>row.id===satellite))throw Error('Choose a satellite from the list.');
  const date=String(input.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<'1974-01-01'||date>now.toISOString().slice(0,10))throw Error('Choose a valid archive date from 1974 through today.');
  const time=String(input.time||'');
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time))throw Error('Enter a valid UTC time, such as 06:00.');
  const enhancement=String(input.enhancement||'').toUpperCase();
  if(!['','BD','MB'].includes(enhancement))throw Error('Choose a supported enhancement.');
  const renderMode=String(input.renderMode||'image');if(!['image','plot'].includes(renderMode))throw Error('Choose a supported image style.');
  if(renderMode==='plot'&&enhancement==='MB')throw Error('MB is available in Original image mode. Choose BD or grayscale for a temperature plot.');
  const coverage=String(input.coverage||'').toUpperCase();
  if(!['','FD','NH','SH','CONUS','MESO1','MESO2'].includes(coverage))throw Error('Choose a supported satellite coverage.');
  const magLine=number(input.magLine??(renderMode==='plot'?1:-1),-32,1,'Vertical image scale',true),magElement=number(input.magElement??(renderMode==='plot'?1:-2),-32,1,'Horizontal image scale',true);
  if(magLine===0||magElement===0)throw Error('Image scale cannot be zero.');
  return {satellite,date,time,latitude:number(input.latitude,-90,90,'Latitude'),longitude:number(input.longitude,-180,180,'Longitude'),band:number(input.band,1,16,'Band',true),enhancement,coverage,renderMode,plotExtent:number(input.plotExtent??6.5,1,20,'Map half-width'),width:number(input.width??(renderMode==='plot'?350:800),64,renderMode==='plot'?500:1600,'Image width',true),height:number(input.height??(renderMode==='plot'?350:800),64,renderMode==='plot'?500:1600,'Image height',true),magLine,magElement,map:input.map!==false};
}
export function mcfetchUrl(settings,key) {
  const s=normalizeMcfetch(settings),url=new URL(MCFETCH_ENDPOINT);
  const params={dkey:mcfetchKey(key),satellite:s.satellite,band:String(s.band),output:s.renderMode==='plot'?'NETCDF':'GIF',date:s.date,time:s.time,lat:`${s.latitude} ${-s.longitude}`,size:`${s.height} ${s.width}`,mag:`${s.magLine} ${s.magElement}`};
  if(s.renderMode==='plot')params.unit='TEMP';else {params.map=s.map?'YES':'NO';if(s.enhancement)params.eu=s.enhancement;}
  if(s.coverage)params.coverage=s.coverage;
  // The legacy McFETCH CGI does not decode %3A in time values. Preserve the
  // literal separators or it can silently choose a scan near midnight.
  url.search=new URLSearchParams(params).toString().replace(/%3A/gi,':');
  return url;
}
export function mcfetchFilename(settings,name='cyclone') {
  const s=normalizeMcfetch(settings),slug=String(name||'cyclone').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,65)||'cyclone';
  return `${slug.toLowerCase()}-${s.satellite.toLowerCase()}-${s.date}-${s.time.replaceAll(':','')}z-band${s.band}.${s.renderMode==='plot'?'png':'gif'}`;
}
