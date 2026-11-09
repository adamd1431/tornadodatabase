import {readClassicNetcdf} from './mcfetch-netcdf.js';
import {wrapLon} from './live-storms-primary.js';
export function decodeCrw(input){
  const nc=readClassicNetcdf(input),lat=nc.read('latitude'),lon=nc.read('longitude'),t=nc.read('time'),v=nc.read('analysed_sst'),width=lon.data.length,height=lat.data.length;
  if(v.attributes.units!=='degree_C'||!String(t.attributes.units).startsWith('seconds since 1970-01-01')||width*height!==v.data.length||width*height>400000)throw Error('Unsupported NOAA CRW grid.');
  const values=new Float32Array(v.data.length),scale=Number(v.attributes.scale_factor?.[0]??1),offset=Number(v.attributes.add_offset?.[0]??0),fill=v.attributes._FillValue?.[0];
  const ascending=lat.data[0]<lat.data.at(-1);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const raw=v.data[(ascending?height-1-y:y)*width+x],value=raw*scale+offset;values[y*width+x]=raw===fill||!Number.isFinite(value)||value< -2||value>50?NaN:value;}
  const dx=Math.abs(lon.data[1]-lon.data[0]),dy=Math.abs(lat.data[1]-lat.data[0]),west=wrapLon(lon.data[0])-dx/2;
  return {width,height,values,bounds:{west,east:west+width*dx,south:Math.min(...lat.data)-dy/2,north:Math.max(...lat.data)+dy/2},validAt:new Date(t.data[0]*1000).toISOString()};
}
export function pointSample(grids,latitude,longitude){
  for(const g of grids){const b=g.bounds,lon=b.west+((longitude-b.west+720)%360),x=Math.floor((lon-b.west)/(b.east-b.west)*g.width),y=Math.floor((b.north-latitude)/(b.north-b.south)*g.height);if(x>=0&&x<g.width&&y>=0&&y<g.height){const t=g.values[y*g.width+x];return Number.isFinite(t)?t:null;}}
  return null;
}
export function decodePackedGrid(result){
  if(result.encoding!=='int16-le-centi'||result.width*result.height>1000000)throw Error('Invalid calibrated grid.');
  const raw=Uint8Array.from(atob(result.packed),c=>c.charCodeAt(0)),v=new DataView(raw.buffer);if(raw.length!==result.width*result.height*2)throw Error('Truncated calibrated grid.');
  const values=Float32Array.from({length:raw.length/2},(_,i)=>{const n=v.getInt16(i*2,true);return n===-32768?NaN:n/100;});return {...result,values};
}
