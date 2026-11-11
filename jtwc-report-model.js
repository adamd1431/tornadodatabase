import {keyText} from './ibtracs-model.js';
const normalize=text=>String(text||'').replace(/([a-z])-\s+([a-z])/gi,'$1$2').replace(/\s+/g,' ').trim().toUpperCase();
const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const jtwcReportUrl=year=>`https://www.metoc.navy.mil/jtwc/products/atcr/${year}atcr.pdf`;
export function jtwcReportYears(storm){return [...new Set([storm.season,+storm.start?.slice(0,4),+storm.end?.slice(0,4)])].filter(y=>Number.isInteger(y)&&y>=1959&&y<=new Date().getUTCFullYear());}
export function usesJtwcReports(storm){return storm.atcf?.some(id=>/^(?:WP|IO|SH|SI|SP)\d{6}$/.test(id));}
export function pdfTextLines(items){
  const lines=[];
  for(const item of items.filter(i=>i.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){
    const y=item.transform[5];let line=lines.find(l=>Math.abs(l.y-y)<2.5);
    if(!line){line={y,items:[]};lines.push(line);}line.items.push({text:item.str,x:item.transform[4]});
  }
  return lines.map(l=>l.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '));
}
export function extractJtwcPressure(pages,storm,year){
  const name=keyText(storm.name),word=escape(String(storm.name).toUpperCase()),found=[];
  if(!/^[A-Z][A-Z -]{1,35}$/.test(storm.name))return null;
  const own=new RegExp('\\b'+word+'\\b'),title=new RegExp('(?:SUPER\\s*)?(?:TYPHOON|TROPICAL\\s+(?:CYCLONE|STORM)|CYCLONE)\\s+'+word+'\\b');
  function candidate(pressure,page,evidence,method){if(pressure>=800&&pressure<=1100)found.push({sid:storm.id,status:'found',pressureMb:pressure,reportYear:year,pdfPage:page,sourceUrl:jtwcReportUrl(year)+'#page='+page,evidence:evidence.slice(0,900),method});}
  pages.forEach((page,index)=>{
    const text=normalize(page.text),lines=(page.lines||page.text.split('\n')).map(normalize);
    // A named best-track title and its explicitly labelled minimum, on the same chart.
    const header=title.exec(text);
    if(header&&/BEST\s*TRACK/.test(text)){
      const section=text.slice(header.index,header.index+1800),minimum=section.match(/MINIMUM\s*(?:SLP|MSLP|SEA\s*LEVEL\s*PRESSURE)\s*[:=]?\s*(\d{3,4})\s*M(?:B|BS|ILLIBARS)\b/);
      if(minimum&&!/(?:TYPHOON|CYCLONE|TROPICAL STORM)\s+[A-Z]{3,}\b/.test(section.slice(header[0].length,minimum.index)))candidate(+minimum[1],index+1,section.slice(0,minimum.index+minimum[0].length),'Best-track chart');
    }
    // Reconstruct table rows from PDF coordinates: the raw text often stores
    // every storm name first, followed by a separate pressure column.
    if(/(?:MSLP|MINIMUM\s+(?:SLP|PRESSURE))/.test(text)&&/(?:MB|HPA)/.test(text)&&text.includes(String(year))){
      const pressureHeader=lines.findIndex(l=>/MSLP|MINIMUM\s+(?:SLP|PRESSURE)/.test(l));
      for(const line of lines.slice(Math.max(0,pressureHeader+1))){
        if(!own.test(line)||!new RegExp('(?:^|\\s)(?:STY|ST|TY|TS|TD|TC)\\s+'+word+'(?:\\s|\\*|$)').test(line)||(line.match(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/g)||[]).length<2)continue;
        const after=line.slice(line.search(own)+storm.name.length),values=[...after.matchAll(/\b(8\d{2}|9\d{2}|10\d{2}|1100)\b/g)];
        // Use only an unambiguous pressure, never distances or a year column.
        if(values.length===1)candidate(+values[0][1],index+1,line,'Annual summary table');
      }
    }
    // Early reports describe shared dropsonde minima in a single sentence.
    for(const m of text.matchAll(/TYPHOONS?\s+([A-Z]+(?:\s*(?:,|AND)\s*[A-Z]+){0,2})\s+HAD\s+MINIMUM\s+SEA\s+LEVEL\s+PRESSURES?\s+OF\s+(\d{3,4})\s+MB\b/g)){
      if(m[1].split(/\s*(?:,|AND)\s*/).some(n=>keyText(n)===name))candidate(+m[2],index+1,m[0],'Reported reconnaissance minimum');
    }
  });
  if(!found.length)return null;
  // Contradictory OCR/source readings need review instead of an invented value.
  if(new Set(found.map(r=>r.pressureMb)).size!==1)return null;
  return found.find(r=>r.method==='Best-track chart')||found[0];
}
