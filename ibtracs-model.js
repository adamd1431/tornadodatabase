export const BASINS={NA:'North Atlantic',EP:'Eastern Pacific',WP:'Western Pacific',NI:'North Indian Ocean',SI:'South Indian Ocean',SP:'South Pacific',SA:'South Atlantic',MM:'Unspecified'};
export const FIELD_DOC='https://www.ncei.noaa.gov/sites/default/files/2025-09/IBTrACS_v04r01_column_documentation.pdf';
export const AGENCIES=[
  ['USA','USA / NHC · JTWC','1-minute sustained winds'],['WMO','WMO reporting agency','Native agency averaging period; not converted'],['TOKYO','JMA / Tokyo','10-minute sustained winds'],['CMA','China Meteorological Administration','Native agency averaging period'],['HKO','Hong Kong Observatory','10-minute sustained winds'],['KMA','Korea Meteorological Administration','Native agency averaging period'],['NEWDELHI','IMD / New Delhi','3-minute sustained winds'],['REUNION','Météo-France / La Réunion','10-minute sustained winds'],['BOM','Bureau of Meteorology','10-minute sustained winds'],['NADI','Fiji / Nadi','10-minute sustained winds'],['WELLINGTON','New Zealand / Wellington','10-minute sustained winds'],['DS824','Historical DS824','Native source values'],['TD9636','Historical TD9636','Native source values'],['TD9635','Historical TD9635','Native source values'],['NEUMANN','Neumann historical data','Native source values'],['MLC','Chenoweth historical data','Native source values']
].map(([id,label,note])=>({id,label,note}));
export const keyText=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const bareName=value=>String(value||'').replace(/\([^)]*\)/g,'').replace(/^(?:(?:super\s+)?(?:typhoon|hurricane|tropical\s+(?:cyclone|storm|depression)|cyclone)\s+(?:\/\s*)?)+/i,'').trim();
export function designation(atcf,storm={}){const m=String(atcf||'').match(/^(AL|EP|CP|WP|IO|SH|SI|SP)(\d{2})\d{4}$/);if(!m)return atcf;const letter={AL:'L',EP:'E',CP:'C',WP:'W',SI:'S',SP:'P'}[m[1]]||(m[1]==='SH'?(storm.basins?.length===1&&storm.basins[0]==='SP'?'P':storm.basins?.length===1&&storm.basins[0]==='SI'?'S':null):(storm.subbasins?.includes('AS')?'A':storm.subbasins?.includes('BB')?'B':null));return letter?m[2]+letter:atcf;}
export function searchStorms(storms,{query='',year='',basin=''}={}){
  const tokens=String(query).trim().split(/\s+/).map(keyText).filter(Boolean);
  return storms.filter(s=>(!year||s.season===+year)&&(!basin||s.basins.includes(basin))&&tokens.every(q=>keyText([s.name,s.season,s.id,...s.atcf,...s.atcf.map(a=>designation(a,s)),...s.basins.map(b=>BASINS[b])].join(' ')).includes(q))).sort((a,b)=>b.season-a.season||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export const columnMap=columns=>Object.fromEntries(columns.map((name,i)=>[name,i]));
export const rawValue=(row,col,key)=>row?.[col[key]]??'';
export function numberValue(row,col,key){const s=rawValue(row,col,key);return s!==''&&Number.isFinite(+s)&&+s> -9000?+s:null;}
export const recordTime=(row,col)=>{const s=rawValue(row,col,'ISO_TIME');return s?s.replace(' ','T')+'Z':null;};
export function availableAgencies(records,col){return AGENCIES.filter(a=>records.some(r=>['WIND','PRES','LAT'].some(k=>rawValue(r,col,a.id+'_'+k)!=='')));}
export function peakRecords(records,col,agency){
  let wind=null,pressure=null;
  records.forEach((r,i)=>{const w=numberValue(r,col,agency+'_WIND'),p=numberValue(r,col,agency+'_PRES');if(w!==null&&(wind===null||w>wind.value))wind={value:w,index:i,time:recordTime(r,col)};if(p!==null&&p>0&&(pressure===null||p<pressure.value))pressure={value:p,index:i,time:recordTime(r,col)};});
  return {wind,pressure};
}
export function position(row,col,agency='USA'){
  let lat=numberValue(row,col,agency+'_LAT'),lon=numberValue(row,col,agency+'_LON'),source=agency;
  if(lat===null||lon===null){lat=numberValue(row,col,'LAT');lon=numberValue(row,col,'LON');source='IBTrACS merged';}
  return lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=360?{lat,lon:((lon+540)%360)-180,source}:null;
}
export function sixHourMotion(records,col,index,agency='USA'){
  const time=Date.parse(recordTime(records[index],col)),points=records.map(r=>({...position(r,col,agency),at:Date.parse(recordTime(r,col))})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).sort((a,b)=>a.at-b.at);
  function at(t){const exact=points.find(p=>p.at===t);if(exact)return exact;const i=points.findIndex(p=>p.at>t);if(i<1)return null;const a=points[i-1],b=points[i];if(b.at-a.at>21600000||a.source!==b.source)return null;const f=(t-a.at)/(b.at-a.at);return {lat:a.lat+f*(b.lat-a.lat),lon:a.lon+f*(((b.lon-a.lon+540)%360)-180),source:a.source};}
  const a=at(time-10800000),b=at(time+10800000);if(!a||!b||a.source!==b.source)return null;
  const rad=Math.PI/180,h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return Math.round(6371.0088*2*Math.asin(Math.min(1,Math.sqrt(h)))/1.852/6*100)/100;
}
export function archiveLink(storm,row,col,agency='USA'){
  const date=rawValue(row,col,'ISO_TIME'),p=position(row,col,agency);if(!date||!p||date<'1974-01-01'||storm.season<1974)return null;
  return 'satellite-archive.html?'+new URLSearchParams({ibtracs:storm.id,at:date,agency});
}
export function stormCsv(columns,units,records){const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';return [columns,units,...records].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';}
export async function unpackSnapshot(response){
  if(!response.ok)throw Error('The IBTrACS snapshot is unavailable. Please try again.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===31&&bytes[1]===139){if(typeof DecompressionStream==='undefined')throw Error('This browser needs gzip support. Open this page in a current browser.');return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function fieldGroup(key){const agency=AGENCIES.find(a=>key.startsWith(a.id+'_'));return agency?.id||'GENERAL';}
