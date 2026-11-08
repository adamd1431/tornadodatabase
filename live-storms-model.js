// Public NHC/CPHC and JTWC operational products. Supplemental ATCF structure
// retains its own timestamp; matching pressure comes from a published fix.
export const LIVE_SOURCES=Object.freeze({
  nhc:'https://www.nhc.noaa.gov/CurrentStorms.json',
  jtwc:'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss',
  imagery:'https://ospo.noaa.gov/products/ocean/tropical/floaters.html',
  ocean:'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41'
});
export const IMAGE_PRODUCTS=Object.freeze([
  {id:'bd',name:'Dvorak IR'},{id:'avn',name:'Enhanced IR'},
  {id:'rgb',name:'RGB'},{id:'vis',name:'Visible'},{id:'wv',name:'Water vapor'}
]);
const number=(value,min,max)=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(+value)&&+value>=min&&+value<=max?+value:null;
const clean=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,160);
export const basinName=id=>({AL:'North Atlantic',EP:'Eastern Pacific',CP:'Central Pacific',WP:'Western Pacific',IO:'North Indian Ocean',SH:'Southern Hemisphere'}[id.slice(0,2)]||'Tropical cyclone');
export const designation=id=>id.slice(2,4)+({AL:'L',EP:'E',CP:'C',WP:'W',IO:'B',SH:'S'}[id.slice(0,2)]||'');
export function nearbyUtc(value,reference){
  const m=String(value).match(/^(\d{2})(\d{2})(\d{2})$/),ref=new Date(reference);if(!m||!Number.isFinite(+ref)||+m[2]>23||+m[3]>59)return null;
  const choices=[-1,0,1].map(offset=>{const month=new Date(Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth()+offset,1)),d=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),+m[1],+m[2],+m[3]));return d.getUTCMonth()===month.getUTCMonth()&&+m[1]>0?d:null;}).filter(Boolean).sort((a,b)=>Math.abs(a-ref)-Math.abs(b-ref));return choices[0]?.toISOString()||null;
}
export function parseNhc(data){
  if(!Array.isArray(data?.activeStorms))throw Error('The NHC feed could not be read.');
  return data.activeStorms.map(row=>{
    const id=String(row.id||'').toUpperCase(),latitude=number(row.latitudeNumeric,-90,90),longitude=number(row.longitudeNumeric,-180,180),validAt=Number.isFinite(Date.parse(row.lastUpdate))?new Date(row.lastUpdate).toISOString():null;
    if(!/^(AL|EP|CP)\d{6}$/.test(id)||latitude===null||longitude===null||!validAt)return null;
    const advisory=String(row.publicAdvisory?.url||''),sourceUrl=/^https:\/\/www\.nhc\.noaa\.gov\//.test(advisory)?advisory:LIVE_SOURCES.nhc;
    return {id,name:clean(row.name)||designation(id),designation:designation(id),basin:basinName(id),classification:clean(row.classification),latitude,longitude,windKt:number(row.intensity,0,250),pressureMb:number(row.pressure,800,1100),gustKt:null,motionKt:number(row.movementSpeed,0,100),motionDegrees:number(row.movementDir,0,360),validAt,issuedAt:row.publicAdvisory?.issuance||validAt,agency:id.startsWith('CP')?'CPHC / NHC':'NHC',sourceUrl,forecastUrl:/^https:\/\/www\.nhc\.noaa\.gov\//.test(row.forecastGraphics?.url||'')?row.forecastGraphics.url:sourceUrl,forecast:[],radii34:null};
  }).filter(Boolean);
}
export function parseJtwcFeed(text){
  if(!/<rss\b/i.test(text))throw Error('The JTWC feed could not be read.');
  const stamp=text.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/i)?.[1]||text.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1],issuedAt=Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():null,products=[];
  for(const m of text.matchAll(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/((?:wp|io|sh|ep|cp|al)\d{4})web\.txt/gi)){
    const key=m[1].toLowerCase();if(products.some(p=>p.key===key))continue;
    const end=text.indexOf('</ul>',m.index),section=text.slice(m.index,end<0?m.index+2500:end),image=section.match(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/\d{2}[WABSPCLE]_\d{6}sair\.jpg/i)?.[0]||null;
    products.push({key,id:key.slice(0,4).toUpperCase()+'20'+key.slice(4),url:`https://www.metoc.navy.mil/jtwc/products/${key}web.txt`,image,issuedAt});
  }
  return {issuedAt,products:products.slice(0,20)};
}
const coordinate=(value,hemisphere)=>+value*(/[SW]/i.test(hemisphere)?-1:1);
export function parseJtwcWarning(text,product){
  const header=text.match(/SUBJ\/([^/]+?)\s+(\d{2}[WABSPCLE])\s+\(([^)]+)\)\s+WARNING\s+NR\s+(\d+)/i),position=text.match(/WARNING POSITION:\s*(\d{6})Z\s*---\s*NEAR\s+([\d.]+)([NS])\s+([\d.]+)([EW])/i),present=text.split(/FORECASTS:/i)[0],wind=present.match(/MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT(?:,\s*GUSTS\s*(\d+)\s*KT)?/i),motion=present.match(/MOVEMENT PAST SIX HOURS\s*-\s*(\d+)\s*DEGREES AT\s*(\d+)\s*KTS/i),pressure=present.match(/(?:MINIMUM CENTRAL PRESSURE|MSLP)\s*(?:-|:|OF)?\s*(\d{3,4})\s*(?:MB|HPA)/i);
  if(!header||!position||!wind||!product.issuedAt||header[2].slice(0,2)!==product.id.slice(2,4))throw Error('This JTWC warning does not contain a matching current position and intensity.');
  const validAt=nearbyUtc(position[1],product.issuedAt),latitude=coordinate(position[2],position[3]),longitude=coordinate(position[4],position[5]);if(!validAt||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('The JTWC position is invalid.');
  const forecast=[];for(const m of text.matchAll(/(\d{1,3})\s+HRS, VALID AT:\s*(\d{6})Z\s*---\s*(?:NEAR\s+)?([\d.]+)([NS])\s+([\d.]+)([EW])[\s\S]*?MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT/gi)){const at=nearbyUtc(m[2],validAt);if(+m[1]<=120&&at)forecast.push({hours:+m[1],validAt:at,latitude:coordinate(m[3],m[4]),longitude:coordinate(m[5],m[6]),windKt:+m[7]});}
  const radii={};for(const threshold of [34,50,64]){const r=present.match(new RegExp(`RADIUS OF ${String(threshold).padStart(3,'0')} KT WINDS\\s*-\\s*(\\d+)\\s*NM NORTHEAST QUADRANT\\s*(\\d+)\\s*NM SOUTHEAST QUADRANT\\s*(\\d+)\\s*NM SOUTHWEST QUADRANT\\s*(\\d+)\\s*NM NORTHWEST QUADRANT`,'i'));if(r)radii[threshold]={NE:+r[1],SE:+r[2],SW:+r[3],NW:+r[4]};}
  return {id:product.id,name:clean(header[3]),designation:header[2].toUpperCase(),basin:basinName(product.id),classification:clean(header[1]),latitude,longitude,windKt:number(wind[1],0,250),gustKt:number(wind[2],0,300),pressureMb:number(pressure?.[1],800,1100),motionDegrees:number(motion?.[1],0,360),motionKt:number(motion?.[2],0,100),validAt,issuedAt:nearbyUtc(text.match(/^\w+ PGTW (\d{6})/m)?.[1],product.issuedAt)||product.issuedAt,agency:'JTWC',sourceUrl:product.url,forecastUrl:product.url.replace(/web\.txt$/,'.gif'),forecast,radii34:radii[34]||null,radii,jtwcImage:product.image,warningNumber:+header[4]};
}
export function structureUrl(storm){
  const id=storm.id.toLowerCase();if(!/^(al|ep|cp|wp|io|sh)\d{6}$/.test(id))throw Error('Invalid storm ID.');
  return /^(al|ep|cp)/.test(id)?`https://ftp.nhc.noaa.gov/atcf/btk/b${id}.dat`:`https://hurricanes.ral.ucar.edu/repository/data/bdecks_open/${id.slice(4)}/b${id}.dat`;
}
export function parseStructure(text,storm){
  const records=[];for(const line of text.split(/\r?\n/)){const c=line.split(',').map(v=>v.trim());if(c.length<20||c[0]+c[1]!==storm.id.slice(0,4)||c[4]!=='BEST'||+c[5]!==0||!/^\d{10}$/.test(c[2]))continue;
    const stamp=`${c[2].slice(0,4)}-${c[2].slice(4,6)}-${c[2].slice(6,8)}T${c[2].slice(8,10)}:00:00Z`,age=(Date.parse(storm.validAt)-Date.parse(stamp))/3600000,lat=c[6].match(/^(\d+)([NS])$/),lon=c[7].match(/^(\d+)([EW])$/);if(!Number.isFinite(age)||age<0||age>6||!lat||!lon)continue;
    const latitude=coordinate(+lat[1]/10,lat[2]),longitude=coordinate(+lon[1]/10,lon[2]);if(Math.abs(latitude)>90||Math.abs(longitude)>180)continue;
    const row={validAt:new Date(stamp).toISOString(),latitude,longitude,windKt:number(c[8],1,250),pressureMb:number(c[9],800,1100),pociMb:number(c[17],850,1100),rociNmi:number(c[18],1,3000),rmwNmi:number(c[19],1,300),radii:{}};
    if([34,50,64].includes(+c[11])){const values=c.slice(13,17).map(v=>number(v,0,1000)),order={NEQ:['NE','SE','SW','NW'],SEQ:['SE','SW','NW','NE'],SWQ:['SW','NW','NE','SE'],NWQ:['NW','NE','SE','SW']}[c[12]];if(values.every(v=>v!==null)&&values.some(v=>v>0)){if(order)row.radii[c[11]]=Object.fromEntries(order.map((q,i)=>[q,values[i]]));else if(c[12]==='AAA')row.radii[c[11]]={NE:values[0],SE:values[0],SW:values[0],NW:values[0]};}}
    records.push(row);
  }
  records.sort((a,b)=>Date.parse(b.validAt)-Date.parse(a.validAt));if(!records.length)throw Error('No matching recent ATCF structure record.');const row=records[0];for(const other of records.filter(r=>r.validAt===row.validAt))Object.assign(row.radii,other.radii);
  return {...row,source:/^(AL|EP|CP)/.test(storm.id)?'NHC / CPHC operational ATCF':'JTWC / NCEP operational ATCF · NCAR mirror',sourceUrl:structureUrl(storm),pressureMatchesAdvisory:row.validAt===storm.validAt&&row.windKt===storm.windKt&&Math.abs(row.latitude-storm.latitude)<=.15&&Math.abs(row.longitude-storm.longitude)<=.15};
}
export function parseFloaters(text){
  if(!/floater/i.test(text))throw Error('The NOAA imagery index could not be read.');
  const codes=[...new Set([...text.matchAll(/\/tropical-floaters\/(\d{2}[WABSPCLE])\/imagery\//gi)].map(m=>m[1].toUpperCase()))];return codes;
}
export function mergeStorms(nhc,jtwc,floaters,now=new Date()){
  const rows=new Map();for(const storm of [...nhc,...jtwc]){
    const age=(+now-Date.parse(storm.validAt))/3600000;if(age< -3||age>36)continue;
    if(rows.has(storm.id))continue; // NHC/CPHC takes precedence in its own basins.
    rows.set(storm.id,{...storm,stale:age>12,hasImagery:floaters.includes(storm.designation),windAveraging:'1 minute'});
  }
  return [...rows.values()].sort((a,b)=>(b.windKt??-1)-(a.windKt??-1)||a.id.localeCompare(b.id));
}
export function imageUrl(storm,product='bd',animated=false){
  if(!IMAGE_PRODUCTS.some(p=>p.id===product))throw Error('Choose an available satellite product.');
  if(storm.hasImagery)return `https://ospo.noaa.gov/tropical-floaters/${storm.designation}/imagery/${product}${animated?'_lalo-animated':'0-lalo'}.gif`;
  if(product==='bd'&&!animated&&/^https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/\d{2}[WABSPCLE]_\d{6}sair\.jpg$/.test(storm.jtwcImage||''))return storm.jtwcImage;
  return null;
}
export function oceanQueries(storm){
  const south=Math.max(-89.99,+(storm.latitude-6).toFixed(2)),north=Math.min(89.99,+(storm.latitude+6).toFixed(2)),west=+(storm.longitude-6).toFixed(2),east=+(storm.longitude+6).toFixed(2);
  const segments=west< -179.99?[[west+360,180],[-179.99,east]]:east>180?[[west,180],[-179.99,east-360]]:[[west,east]];
  return {bounds:{south,north,west,east},urls:segments.map(([w,e])=>new URL(LIVE_SOURCES.ocean+'.json?'+encodeURIComponent(`analysed_sst[(last)][(${south}):50:(${north})][(${w.toFixed(2)}):50:(${e.toFixed(2)})]`)))};
}
export function parseOcean(grids,storm){
  const cells=[];let timestamp=null,center=null,distance=Infinity;
  for(const data of grids){const t=data?.table;if(!Array.isArray(t?.rows)||!t.columnNames?.includes('analysed_sst'))throw Error('The ocean analysis could not be read.');const at=name=>t.columnNames.indexOf(name);if(t.columnUnits?.[at('analysed_sst')]!=='degree_C')throw Error('The ocean analysis units could not be read.');
    for(const row of t.rows){const lat=number(row[at('latitude')],-90,90),lon=number(row[at('longitude')],-180,180),value=number(row[at('analysed_sst')],-3,45),time=row[at('time')];if(lat===null||lon===null||!Number.isFinite(Date.parse(time)))continue;if(timestamp&&timestamp!==time)throw Error('The ocean tiles have different analysis times.');timestamp=time;cells.push([lat,lon,value]);const d=Math.hypot(lat-storm.latitude,((lon-storm.longitude+540)%360)-180);if(d<distance){distance=d;center=value;}}
  }
  if(!timestamp||!cells.length)throw Error('The ocean analysis returned no grid.');
  return {sampledAt:timestamp,temperatureC:distance<=.03?center:null,cells,source:'NASA JPL MUR v4.1 · NOAA CoastWatch',sourceUrl:LIVE_SOURCES.ocean+'.html',spacingDegrees:.5};
}
