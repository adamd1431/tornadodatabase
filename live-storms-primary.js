// Original data discovery; never consumes another weather website's plots.
// HSD layout/calibration: JMA Himawari Standard Data User's Guide v1.3.
import {bilinearSampler} from './live-storms-resample.js';
export const PRIMARY_PRODUCTS=Object.freeze([
  {id:'spectrum',name:'Infrared · calibrated temperature',ahi:13,abi:13},
  {id:'wv',name:'Water vapor · calibrated temperature',ahi:9,abi:9},
  {id:'vis',name:'Visible · reflectance',ahi:3,abi:2}
]);
export const HSD_ROOT='https://noaa-himawari9.s3.amazonaws.com/';
export const CRW_ROOT='https://oceanwatch.pifsc.noaa.gov/erddap/griddap/CRW_sst_v3_1';
const rad=Math.PI/180;
export const wrapLon=x=>((x+540)%360)-180;
export function plotBounds(storm,extent=6){
  if(!Number.isFinite(storm.latitude)||!Number.isFinite(storm.longitude)||Math.abs(storm.latitude)>70)throw Error('Invalid tropical storm position.');
  return {west:storm.longitude-extent,east:storm.longitude+extent,south:Math.max(-75,storm.latitude-extent),north:Math.min(75,storm.latitude+extent)};
}
// Earth point -> viewing angles, from WGS84 ECEF geometry. HSD uses sweep-y
// with a south-positive line axis; GOES CF uses sweep-x and north-positive y.
export function scanAngles(latitude,longitude,p){
  const a=p.req,b=p.rpol,lat=latitude*rad,dl=wrapLon(longitude-p.subLon)*rad,e2=1-b*b/(a*a),n=a/Math.sqrt(1-e2*Math.sin(lat)**2);
  const X=n*Math.cos(lat)*Math.cos(dl),Y=n*Math.cos(lat)*Math.sin(dl),Z=n*(1-e2)*Math.sin(lat),sx=p.rs-X;
  if(X*sx-Y*Y-a*a/(b*b)*Z*Z<=0)return null;
  return p.sweep==='x'?[Math.asin(Y/Math.hypot(sx,Y,Z)),Math.atan2(Z,sx)]:[Math.atan2(Y,sx),Math.atan2(-Z,Math.hypot(sx,Y))];
}
export function hsdPixel(latitude,longitude,p){const xy=scanAngles(latitude,longitude,p);return xy?[p.coff+xy[0]/rad*p.cfac/65536-1,p.loff+xy[1]/rad*p.lfac/65536-1]:null;}
export function hsdSegments(bounds,resolution=20){
  const factor=20/resolution,p={subLon:140.7,req:6378.137,rpol:6356.7523,rs:42164,sweep:'y',coff:2750*factor+.5,loff:2750*factor+.5,cfac:20466275*factor,lfac:20466275*factor},rows=[];
  for(let y=0;y<=12;y++)for(let x=0;x<=12;x++){const q=hsdPixel(bounds.south+(bounds.north-bounds.south)*y/12,bounds.west+(bounds.east-bounds.west)*x/12,p);if(q)rows.push(q[1]);}
  if(!rows.length)throw Error('This storm is outside Himawari coverage.');
  const first=Math.max(1,Math.floor(Math.min(...rows)/(550*factor))+1),last=Math.min(10,Math.floor(Math.max(...rows)/(550*factor))+1);
  return Array.from({length:last-first+1},(_,i)=>first+i);
}
export function hsdPlan(storm,product,stamp){
  const p=PRIMARY_PRODUCTS.find(p=>p.id===product);if(!p||!/^\d{12}$/.test(stamp))throw Error('Invalid satellite request.');
  const bounds=plotBounds(storm),band=String(p.ahi).padStart(2,'0'),resolution=p.ahi===3?5:20,res=String(resolution).padStart(2,'0'),day=stamp.slice(0,8),clock=stamp.slice(8),prefix=`AHI-L1b-FLDK/${day.slice(0,4)}/${day.slice(4,6)}/${day.slice(6,8)}/${clock}/HS_H09_${day}_${clock}_B${band}_FLDK_R${res}_S`;
  return {bounds,band:p.ahi,resolution,prefix,files:hsdSegments(bounds,resolution).map(segment=>HSD_ROOT+prefix+String(segment).padStart(2,'0')+'10.DAT.bz2')};
}
export function hsdAvailable(xml,plan){
  const keys=new Set([...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m=>m[1]));
  return plan.files.every(url=>keys.has(url.slice(HSD_ROOT.length)));
}
export function crwUrl(storm){
  const b=plotBounds(storm,10),west=(b.west+360)%360,east=west+(b.east-b.west);
  const spans=east<=360?[[west,east]]:[[west,359.975],[0,east-360]];
  return {bounds:b,urls:spans.map(([w,e])=>`${CRW_ROOT}.nc?analysed_sst[(last)][(${b.south.toFixed(3)}):1:(${b.north.toFixed(3)})][(${w.toFixed(3)}):1:(${e.toFixed(3)})]`)};
}
export function readHsd(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length<282||bytes[0]!==1||![0,1].includes(bytes[5]))throw Error('Invalid HSD header.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),le=bytes[5]===0,u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le),f32=o=>v.getFloat32(o,le),f64=o=>v.getFloat64(o,le),blocks={};let off=0;
  for(let i=1;i<=11;i++){if(off+3>bytes.length||bytes[off]!==i)throw Error('Missing HSD block.');const size=u16(off+1);if(size<3||off+size>bytes.length)throw Error('Truncated HSD block.');blocks[i]=off;off+=size;}
  const d=blocks[2],q=blocks[3],c=blocks[5],s=blocks[7],width=u16(d+5),height=u16(d+7),start=u32(70),band=u16(c+3);
  if(u16(d+3)!==16||bytes[d+9]!==0||width*height>50000000||!width||!height||start!==off||start+width*height*2>bytes.length||band<1||band>16)throw Error('Unsupported or truncated HSD pixels.');
  const projection={subLon:f64(q+3),cfac:u32(q+11),lfac:u32(q+15),coff:f32(q+19),loff:f32(q+23),rs:f64(q+27),req:f64(q+35),rpol:f64(q+43),sweep:'y'};
  const calibration={band,wavelength:f64(c+5),bits:u16(c+13),error:u16(c+15),outside:u16(c+17),gain:f64(c+19),offset:f64(c+27),c0:f64(c+35),c1:f64(c+43),c2:f64(c+51),light:f64(c+83),planck:f64(c+91),boltzmann:f64(c+99)};
  if(band<=6&&f64(c+51)>0){calibration.gain=f64(c+51);calibration.offset=f64(c+59);}
  const firstLine=u16(s+5)-1,timestamp=new Date((f64(46)-40587)*86400000).toISOString();
  return {width,height,firstLine,projection,calibration,timestamp,quality:bytes[78],count:(x,y)=>v.getUint16(start+((y-firstLine)*width+x)*2,le)};
}
export function calibrateHsd(count,c){
  if(count===c.error||count===c.outside||count>=2**c.bits)return NaN;
  const radiance=c.gain*count+c.offset;if(!(radiance>0))return c.band<=6&&radiance===0?0:NaN;
  if(c.band<=6)return radiance*c.c0*100;
  const wavelength=c.wavelength*1e-6,t=c.planck*c.light/(c.boltzmann*wavelength)/Math.log1p(2*c.planck*c.light**2/(wavelength**5*radiance*1e6));
  return c.c0+c.c1*t+c.c2*t*t-273.15;
}
export function sampleHsd(segment,bounds,size=1152,values=new Float32Array(size*size).fill(NaN)){
  if(!Number.isInteger(size)||size<2||size>2048)throw Error('Invalid output grid.');
  const lut=Float32Array.from({length:2**segment.calibration.bits},(_,i)=>calibrateHsd(i,segment.calibration));
  const sample=bilinearSampler(segment.width,segment.height,(x,y)=>lut[segment.count(x,y+segment.firstLine)]??NaN);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const lat=bounds.north-(row+.5)/size*(bounds.north-bounds.south),lon=bounds.west+(col+.5)/size*(bounds.east-bounds.west),p=hsdPixel(lat,lon,segment.projection);if(!p)continue;
    const x=p[0],y=p[1]-segment.firstLine;if(x<-.5||x>segment.width-.5||y<-.5||y>segment.height-.5)continue;
    values[row*size+col]=sample(x,y);
  }return values;
}
