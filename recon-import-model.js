const DAY=86400000;
const utc=value=>{const s=String(value||'').replace(' ','T');return Date.parse(s.endsWith('Z')?s:s+'Z');};
const real=(value,min,max)=>{const n=Number(value);return String(value??'').trim()!==''&&Number.isFinite(n)&&n>=min&&n<=max?n:null;};
export function reconDateValid(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
export function reconSupported(storm){return storm?.atcf?.some(id=>/^(AL|EP|CP)\d{6}$/.test(id)&&+id.slice(-4)>=1989);}
export function reconDates(storm){const start=utc(storm.start),end=utc(storm.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>90*DAY)return [];const days=[];for(let t=Math.floor(start/DAY)*DAY;t<=Math.floor(end/DAY)*DAY;t+=DAY)days.push(new Date(t).toISOString().slice(0,10));return days;}
function clockNear(text,fixAt){const m=String(text).match(/\b(\d{2}):(\d{2}):(\d{2})Z\b/);if(!m||+m[1]>23||+m[2]>59||+m[3]>59)return null;const base=Date.parse(fixAt),day=Math.floor(base/DAY)*DAY,time=day+(+m[1]*3600 + +m[2]*60 + +m[3])*1000;return new Date([time-DAY,time,time+DAY].sort((a,b)=>Math.abs(a-base)-Math.abs(b-base))[0]).toISOString();}
function fixDate(day,clock,{date,start,end}){
  const reference=Date.parse(date+'T00:00:00Z'),lo=utc(start)-DAY,hi=utc(end)+DAY,candidates=[];
  for(let month=-1;month<=1;month++){const d=new Date(reference);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+month);const expectedMonth=d.getUTCMonth();d.setUTCDate(+day);if(d.getUTCMonth()!==expectedMonth)continue;const stamp=d.toISOString().slice(0,10)+'T'+clock+'Z',t=Date.parse(stamp);if(Number.isFinite(t)&&t>=lo&&t<=hi&&new Date(t).toISOString().slice(11,19)===clock)candidates.push(stamp);}
  return candidates.length===1?candidates[0]:null;
}
// Only paired FL wind/location fields or explicit FL remarks are decoded.
// Surface/SFMR winds and eye diameter never become FL wind or RMW inputs.
export function parseReconMessages(text,{atcf,date,start,end,sourceUrl}={}){
  if(typeof text!=='string'||text.length>4000000||!reconDateValid(date))return [];
  const blocks=text.split(/(?=^\s*VORTEX DATA MESSAGE\b)/m),rows=[];
  for(let i=1;i<blocks.length;i++){
    const block=blocks[i],id=block.match(/^\s*VORTEX DATA MESSAGE\s+([A-Z]{2}\d{6})\b/m)?.[1];if(id!==atcf)continue;
    const field=letter=>block.match(new RegExp('^'+letter+'\\.\\s*([^\\n]+)','im'))?.[1]?.trim()||'';
    const a=field('A').match(/^(\d{1,2})\/(\d{2}:\d{2}:\d{2})Z/);if(!a)continue;
    const fixAt=fixDate(a[1],a[2],{date,start,end});if(!fixAt)continue;
    const level=field('C').match(/^(\d{3,4})\s*MB\b/i),altitude=field('C').match(/\bMB\s+(\d+)\s*M\b/i),flightLevelMb=real(level?.[1],300,1000),flightAltitudeM=real(altitude?.[1],0,10000),modern=!!field('U')||/^\d+(?:\.\d+)?\s*MB\b/i.test(field('D'));
    const pressure=field(modern?'D':'H').match(/^(\d+(?:\.\d+)?)\s*MB\b/i),pressureMb=real(pressure?.[1],800,1100),mission=field(modern?'U':'P'),candidates=[];
    function add(wind,location,kind,time){const flightWindKt=real(wind,.01,350),loc=String(location).match(/(\d+(?:\.\d+)?)\s*NM\b/i),rmwNmi=real(loc?.[1],.01,300),windAt=clockNear(time||location,fixAt)||fixAt;if(flightWindKt===null||rmwNmi===null||Math.abs(Date.parse(windAt)-Date.parse(fixAt))>1800000)return;candidates.push({flightWindKt,rmwNmi,windAt,kind,timeIsFix:!clockNear(time||location,fixAt)});}
    for(const [windField,locationField,kind]of modern?[['J','K','Inbound'],['N','O','Outbound']]:[['F','G','Inbound']]){const w=field(windField).match(/(\d+(?:\.\d+)?)\s*KT(?:S)?\b/i);if(w)add(w[1],field(locationField),kind);}
    for(const line of block.split('\n')){const m=line.match(/MAX\s+(?:OUTBOUND\s+(?:AND\s+MAX\s+)?)?FL\s+WIND\s+(\d+(?:\.\d+)?)\s*KTS?\s+\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)\s*NM\s+(\d{2}:\d{2}:\d{2}Z)/i);if(m)add(m[1],m[2]+' NM','Reported maximum',m[3]);}
    candidates.sort((a,b)=>b.flightWindKt-a.flightWindKt||Number(a.timeIsFix)-Number(b.timeIsFix));const sample=candidates[0];if(!sample||sample.windAt.slice(0,10)!==date)continue;
    rows.push({...sample,id:atcf+'-'+fixAt+'-'+rows.length,atcf,fixAt,flightLevelMb,flightAltitudeM,pressureMb,mission,sourceUrl,raw:block.split(/\n\s*000\s*\n/)[0].trim()});
  }
  return rows;
}
export function reconImportEligibility(row){
  if(!row||!Number.isFinite(row.flightWindKt)||row.flightWindKt<=0||!Number.isFinite(row.rmwNmi)||row.rmwNmi<=0)return {ok:false,message:'This message has no paired flight-level wind and radius.'};
  if(![700,850,925].includes(row.flightLevelMb))return {ok:false,message:'The flight level is missing or unsupported. Verify it in the source before entering this observation manually.'};
  return {ok:true,method:row.flightLevelMb===700?'jwt':'standard',message:row.flightLevelMb===700?'Imports wind and RMW into the JWT 700-mb curve.':`Imports wind into the ${row.flightLevelMb}-mb operational factor; JWT is a 700-mb curve.`};
}
export function preferredReconRecord(rows){const eligible=rows.filter(r=>reconImportEligibility(r).ok);return [...(eligible.length?eligible:rows)].sort((a,b)=>Number(b.flightLevelMb===700)-Number(a.flightLevelMb===700)||b.flightWindKt-a.flightWindKt||a.windAt.localeCompare(b.windAt))[0]||null;}
