import * as HDF5Module from './server-vendor/jsfive-0.4.2.cjs';
// Native Node ESM wraps CommonJS in default; Vercel's transpiler preserves
// this package's __esModule exports directly. Support both module loaders.
const HDF5=HDF5Module.default||HDF5Module;

export function parseNoaaPressureSubset(input,expectedAt){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),signature=[137,72,68,70,13,10,26,10];
  if(bytes.length<128||bytes.length>4000000||!signature.every((b,i)=>bytes[i]===b))throw Error('NOAA did not return a valid NetCDF pressure subset.');
  const file=new HDF5.File(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),latData=file.get('lat'),lonData=file.get('lon'),timeData=file.get('time'),pressure=file.get('prmsl');
  if(!latData||!lonData||!timeData||!pressure||pressure.shape.join(',')!=='1,181,360'||latData.shape.join(',')!=='181'||lonData.shape.join(',')!=='360'||timeData.shape.join(',')!=='1')throw Error('NOAA pressure subset dimensions do not match the requested grid.');
  const lat=Array.from(latData.value),lon=Array.from(lonData.value),time=timeData.value[0],raw=Array.from(pressure.value);
  if(lat.some((v,i)=>v!==i-90)||lon.some((v,i)=>v!==i)||Date.UTC(1800,0,1)+time*3600000!==Date.parse(expectedAt))throw Error('NOAA pressure subset coordinates or valid time do not match the request.');
  if(raw.length!==181*360||raw.some(v=>!Number.isFinite(v)||v<80000||v>115000))throw Error('NOAA pressure subset contains missing or invalid pressures.');
  return {lat,lon,values:lat.map((_,j)=>raw.slice(j*360,(j+1)*360).map(v=>v/100)),at:expectedAt};
}
