// Coordinates only: NOAA IBTrACS v04r01. No pressure or wind values are inferred.
export const TRACK_SOURCE='https://www.ncei.noaa.gov/products/international-best-track-archive';
const word=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function stormLookupName(value){return String(value||'').replace(/\([^)]*\)/g,'').replace(/^(?:super\s+)?(?:typhoon|hurricane|tropical\s+(?:cyclone|storm|depression)|cyclone)\s+/i,'').trim();}
export function parseStormCommand(value){
  const m=String(value||'').trim().match(/^!mcfetch(?:_nc|_pro)?\s+(?:"([^"]+)"|([^\s]+))\s+(\d{4})\s+([0-2]\d[0-5]\d)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\S+)?\s*$/i);
  if(!m||+m[4].slice(0,2)>23)throw Error('Use !mcfetch_nc Jova 2023 0000 07/09/2023 (date: day/month/year).');
  const date=`${m[7]}-${m[6].padStart(2,'0')}-${m[5].padStart(2,'0')}`;
  if(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('The command contains an invalid date.');
  return {query:m[1]||m[2],year:+m[3],date,time:m[4].slice(0,2)+':'+m[4].slice(2)};
}
function identities(storm){
  const ids=[storm.name,storm.id,...storm.atcf];
  for(const id of storm.atcf){const m=id.match(/^(AL|EP|CP|WP|IO|SH)(\d{2})\d{4}$/);if(m){const letters={AL:['L'],EP:['E'],CP:['C'],WP:['W'],IO:['A','B'],SH:['S','P']}[m[1]];for(const letter of letters)ids.push(m[2]+letter);ids.push(m[1]+m[2]);}}
  return ids.map(word);
}
export function findStorms(rows,{query,year,date,sid=''}){
  const q=word(stormLookupName(query)),at=Date.parse(date+'T00:00:00Z');
  if(!q)throw Error('Enter a storm name or designation, such as Jova or 11E.');
  return rows.filter(storm=>!sid||storm.id===sid).filter(storm=>storm.season===+year||new Date(storm.start*60000).getUTCFullYear()===+year).filter(storm=>identities(storm).includes(q)).filter(storm=>{const p=storm.points;return p.length&&at<=(storm.start+p.at(-1)[0])*60000&&at+86400000>(storm.start+p[0][0])*60000;});
}
export function positionAt(storm,date,time){
  const stamp=Date.parse(`${date}T${time}:00Z`)/60000-storm.start;
  if(!Number.isFinite(stamp))throw Error('Choose a valid UTC date and time.');
  const points=storm.points,exact=points.find(p=>p[0]===stamp);
  if(exact)return {latitude:exact[1],longitude:exact[2],method:'record',source:exact[3]===0?'IBTrACS USA position':'IBTrACS merged position',times:[new Date((storm.start+exact[0])*60000).toISOString()]};
  const hi=points.findIndex(p=>p[0]>stamp);
  if(hi<1)throw Error('That time falls outside this cyclone’s available track. Choose another time or enter coordinates manually.');
  const a=points[hi-1],b=points[hi];if(b[0]-a[0]>360)throw Error('The track has a gap over six hours here. Enter coordinates manually.');
  if(a[3]!==b[3])throw Error('Position sources change at this time. Choose a recorded track time or enter coordinates manually.');
  const f=(stamp-a[0])/(b[0]-a[0]),delta=((b[2]-a[2]+540)%360)-180;
  return {latitude:+(a[1]+f*(b[1]-a[1])).toFixed(4),longitude:+(((a[2]+f*delta+540)%360)-180).toFixed(4),method:'interpolated',source:a[3]===0?'IBTrACS USA position':'IBTrACS merged position',times:[a,b].map(p=>new Date((storm.start+p[0])*60000).toISOString())};
}
// Operational-era suggestions, not a claim that a scan exists. SSEC inventory
// remains authoritative for outages, substitutions, scan time and coverage.
// JMA: https://www.data.jma.go.jp/mscweb/en/oper/status.html
// NOAA: https://www.ncei.noaa.gov/products/satellite/goes-r
export function suggestSatellite(date,longitude){
  const pick=eras=>eras.find(([start])=>date>=start)?.[1]||'';
  if(longitude>100)return pick([['2022-12-13','HIMAWARI9'],['2015-07-07','HIMAWARI8'],['2010-07-01','MTSAT2'],['2005-06-28','MTSAT1R'],['2003-05-22','GOES9'],['1995-06-21','GMS5'],['1989-12-14','GMS4'],['1984-09-27','GMS3'],['1981-12-21','GMS2'],['1978-04-06','GMS1']]);
  if(longitude<=-105)return pick([['2023-01-04','GOES18'],['2019-02-12','GOES17'],['2011-12-06','GOES15'],['2006-06-21','GOES11'],['1998-07-27','GOES10'],['1996-01-01','GOES9'],['1989-01-21','GOES7'],['1983-06-01','GOES6'],['1981-03-05','GOES4'],['1978-11-21','GOES3'],['1978-02-18','GOES2'],['1975-10-16','GOES1'],['1974-05-17','SMS1']]);
  if(longitude>=-105&&longitude<=30)return pick([['2025-04-07','GOES19'],['2017-12-18','GOES16'],['2010-04-14','GOES13'],['2003-04-01','GOES12'],['1994-09-02','GOES8'],['1987-03-25','GOES7'],['1981-08-05','GOES5'],['1979-04-20','SMS2'],['1978-02-18','GOES2'],['1975-10-16','GOES1'],['1974-05-17','SMS1']]);
  return pick([['2023-10-26','EWS-G2'],['2023-04-02','MET9'],['2020-12-16','EWS-G1'],['2016-11-01','MET8'],['2007-01-26','MET7'],['1998-07-01','MET5']]);
}
export function createTrackLoader(read=fetch){
  const cache=new Map();
  return async function(year){
    if(!Number.isInteger(+year)||+year<1974||+year>new Date().getUTCFullYear())throw Error('Storm lookup covers 1974 through the latest available IBTrACS year.');
    if(!cache.has(+year))cache.set(+year,(async()=>{const r=await read(`satellite-tracks/${year}.json`);if(!r.ok)throw Error('No track data is available for that year. Enter coordinates manually.');const data=await r.json();if(data.version!==1||!Array.isArray(data.rows))throw Error('The track data could not be read.');return data.rows;})().catch(error=>{cache.delete(+year);throw error;}));
    return cache.get(+year);
  };
}
