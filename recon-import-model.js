const DAY=86400000;
const utc=value=>{const s=String(value||'').replace(' ','T');return Date.parse(s.endsWith('Z')?s:s+'Z');};
const real=(value,min,max)=>{const n=Number(value);return String(value??'').trim()!==''&&Number.isFinite(n)&&n>=min&&n<=max?n:null;};
export function reconDateValid(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
export function reconSupported(storm){return storm?.atcf?.some(id=>/^(AL|EP|CP)\d{6}$/.test(id)&&+id.slice(-4)>=1989);}
export function reconDates(storm){const start=utc(storm.start),end=utc(storm.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>90*DAY)return [];const days=[];for(let t=Math.floor(start/DAY)*DAY;t<=Math.floor(end/DAY)*DAY;t+=DAY)days.push(new Date(t).toISOString().slice(0,10));return days;}
function messageClock(value){const token=String(value||'').replaceAll(':','');if(!/^\d{4}(?:\d{2})?$/.test(token))return null;const h=+token.slice(0,2),m=+token.slice(2,4),s=token.length===6?+token.slice(4,6):0;return h<24&&m<60&&s<60?`${token.slice(0,2)}:${token.slice(2,4)}:${String(s).padStart(2,'0')}`:null;}
function clockNear(text,fixAt){const token=String(text).match(/\b(\d{2}:\d{2}:\d{2}|\d{4}(?:\d{2})?)Z\b/i)?.[1],clock=messageClock(token);if(!clock)return null;const base=Date.parse(fixAt),day=Math.floor(base/DAY)*DAY,time=day+Date.parse('1970-01-01T'+clock+'Z');return new Date([time-DAY,time,time+DAY].sort((a,b)=>Math.abs(a-base)-Math.abs(b-base))[0]).toISOString();}
function fixDate(day,clock,{date,start,end}){
  const reference=Date.parse(date+'T00:00:00Z'),lo=utc(start)-DAY,hi=utc(end)+DAY,candidates=[];
  for(let month=-1;month<=1;month++){const d=new Date(reference);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+month);const expectedMonth=d.getUTCMonth();d.setUTCDate(+day);if(d.getUTCMonth()!==expectedMonth)continue;const stamp=d.toISOString().slice(0,10)+'T'+clock+'Z',t=Date.parse(stamp);if(Number.isFinite(t)&&t>=lo&&t<=hi&&new Date(t).toISOString().slice(11,19)===clock)candidates.push(stamp);}
  return candidates.length===1?candidates[0]:null;
}
// Only paired FL wind/location fields or explicit FL remarks are decoded.
// Surface/SFMR winds and eye diameter never become FL wind or RMW inputs.
export function parseReconMessages(text,{atcf,date,start,end,sourceUrl,allCandidates=false}={}){
  if(typeof text!=='string'||text.length>4000000||!reconDateValid(date))return [];
  const blocks=text.split(/(?=^\s*VORTEX DATA MESSAGE\b)/m),rows=[];
  for(let i=1;i<blocks.length;i++){
    const block=blocks[i],heading=block.match(/^[\t ]*VORTEX DATA MESSAGE([^\r\n]*)/m)?.[1]?.trim()||'',id=heading.match(/^([A-Z]{2}\d{6})\b/)?.[1];
    const field=letter=>block.match(new RegExp('^'+letter+'\\.\\s*([^\\n]+)','im'))?.[1]?.trim()||'';
    // Older VDM headings omit ATCF. Verify their P-line mission code instead:
    // AF966 2009A = mission 20, Atlantic cyclone 09 (not aircraft AF966).
    if(id){if(id!==atcf)continue;}else{
      const missionCode=field('P').match(/\b\d{2}(\d{2})([AEC])\b/i),basin={A:'AL',E:'EP',C:'CP'}[missionCode?.[2]?.toUpperCase()];
      if(heading||!missionCode||basin+missionCode[1]!==atcf?.slice(0,4))continue;
    }
    const a=field('A').match(/^(\d{1,2})\/(\d{2}:\d{2}:\d{2}|\d{4}(?:\d{2})?)Z\b/i),clock=messageClock(a?.[2]);if(!a||!clock)continue;
    const fixAt=fixDate(a[1],clock,{date,start,end});if(!fixAt)continue;
    const level=field('C').match(/^(\d{1,4}(?:\.\d+)?)\s*MB\b/i),altitude=field('C').match(/\bMB\s+(\d+)\s*M\b/i),flightLevelMb=real(level?.[1],1,1100),flightAltitudeM=real(altitude?.[1],0,10000),modern=!!field('U')||/^\d+(?:\.\d+)?\s*MB\b/i.test(field('D'));
    const pressure=field(modern?'D':'H').match(/^(\d+(?:\.\d+)?)\s*MB\b/i),pressureMb=real(pressure?.[1],800,1100),mission=field(modern?'U':'P'),candidates=[];
    function add(wind,location,kind,time){const flightWindKt=real(wind,.01,350),loc=String(location).match(/(\d+(?:\.\d+)?)\s*NM\b/i),rmwNmi=real(loc?.[1],.01,300),windAt=clockNear(time||location,fixAt)||fixAt;if(flightWindKt===null||rmwNmi===null||Math.abs(Date.parse(windAt)-Date.parse(fixAt))>1800000)return;candidates.push({flightWindKt,rmwNmi,windAt,kind,timeIsFix:!clockNear(time||location,fixAt)});}
    // A legacy mission-maximum remark can supply the time only when its wind
    // matches F and is near this fix. It never replaces F or borrows G's radius
    // for a different or hours-old mission maximum.
    function pairedRemarkTime(wind){for(const line of block.split('\n')){const m=line.match(/MAX\s+FL\s+WIND\s+(\d+(?:\.\d+)?)\s*KTS?\b.*?\b(\d{2}:\d{2}:\d{2}|\d{4}(?:\d{2})?)Z\b/i);if(m&&+m[1]===+wind){const at=clockNear(m[2]+'Z',fixAt);if(at&&Math.abs(Date.parse(at)-Date.parse(fixAt))<=1800000)return m[2]+'Z';}}return null;}
    for(const [windField,locationField,kind]of modern?[['J','K','Inbound'],['N','O','Outbound']]:[['F','G','Inbound']]){const w=field(windField).match(/(\d+(?:\.\d+)?)\s*KT(?:S)?\b/i);if(w)add(w[1],field(locationField),kind,modern?null:pairedRemarkTime(w[1]));}
    for(const line of block.split('\n')){const m=line.match(/MAX\s+(?:OUTBOUND\s+(?:AND\s+MAX\s+)?)?FL\s+WIND\s+(\d+(?:\.\d+)?)\s*KTS?\s+\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)\s*NM\s+(\d{2}:\d{2}:\d{2}Z)/i);if(m)add(m[1],m[2]+' NM','Reported maximum',m[3]);}
    candidates.sort((a,b)=>b.flightWindKt-a.flightWindKt||Number(a.timeIsFix)-Number(b.timeIsFix));
    const distinct=new Map();for(const c of candidates){const key=c.windAt+'|'+c.flightWindKt+'|'+c.rmwNmi;if(!distinct.has(key))distinct.set(key,c);}
    const samples=allCandidates?[...distinct.values()]:candidates.slice(0,1);
    for(const sample of samples){if(sample.windAt.slice(0,10)!==date)continue;
      rows.push({...sample,id:atcf+'-'+fixAt+'-'+rows.length,atcf,fixAt,flightLevelMb,flightAltitudeM,pressureMb,mission,sourceUrl,raw:block.split(/\n\s*000\s*\n/)[0].trim()});
    }
  }
  return rows;
}
export function reconImportEligibility(row){
  if(!row||!Number.isFinite(row.flightWindKt)||row.flightWindKt<=0||!Number.isFinite(row.rmwNmi)||row.rmwNmi<=0)return {ok:false,message:'This message has no paired flight-level wind and radius.'};
  if(!Number.isFinite(row.flightLevelMb)||row.flightLevelMb<1||row.flightLevelMb>1100)return {ok:false,message:'The flight pressure is missing. Use a matched HDOB observation in the viewer or enter verified flight pressure manually.'};
  return {ok:true,method:'jwt',message:row.flightLevelMb===700?'Imports the paired wind and RMW into the original 700-mb JWT curve.':`Imports the paired wind, RMW and ${row.flightLevelMb}-mb pressure into the pressure-adjusted JWT extension.`};
}
export function preferredReconRecord(rows){const eligible=rows.filter(r=>reconImportEligibility(r).ok);return [...(eligible.length?eligible:rows)].sort((a,b)=>b.flightWindKt-a.flightWindKt||a.windAt.localeCompare(b.windAt))[0]||null;}
