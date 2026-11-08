// Bounded NetCDF classic reader, independently implemented from the Unidata
// CDF-1/CDF-2 specification. McFETCH exports fixed-size latitude/longitude grids.
// https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html
export function readClassicNetcdf(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=4;
  const need=n=>{if(!Number.isSafeInteger(n)||n<0||offset+n>bytes.length)throw Error('The NetCDF file is truncated or invalid.');};
  const u32=()=>{need(4);const n=view.getUint32(offset);offset+=4;return n;};
  const name=()=>{const n=u32();if(n>4096)throw Error('Invalid NetCDF name.');need(Math.ceil(n/4)*4);const s=new TextDecoder().decode(bytes.subarray(offset,offset+n)).replace(/\0+$/,'');offset+=Math.ceil(n/4)*4;return s;};
  const sizes={1:1,2:1,3:2,4:4,5:4,6:8},getters={1:'getInt8',3:'getInt16',4:'getInt32',5:'getFloat32',6:'getFloat64'};
  const values=(type,count)=>{const size=sizes[type];if(!size||count>2000000)throw Error('Unsupported NetCDF values.');need(Math.ceil(count*size/4)*4);let result;if(type===2)result=new TextDecoder().decode(bytes.subarray(offset,offset+count)).replace(/\0+$/,'');else{result=new Float64Array(count);for(let i=0;i<count;i++)result[i]=view[getters[type]](offset+i*size);}offset+=Math.ceil(count*size/4)*4;return result;};
  const list=(tag,read,max=256)=>{const kind=u32(),n=u32();if(!kind&&!n)return [];if(kind!==tag||n>max)throw Error('Invalid NetCDF header.');return Array.from({length:n},read);};
  const attrs=()=>Object.fromEntries(list(12,()=>{const key=name(),type=u32(),n=u32();return [key,values(type,n)];}));
  if(bytes.length<8||bytes[0]!==67||bytes[1]!==68||bytes[2]!==70||![1,2].includes(bytes[3]))throw Error('This plot needs a NetCDF classic file from McFETCH.');
  const version=bytes[3],records=u32(),dimensions=list(10,()=>({name:name(),length:u32()}),32),attributes=attrs();
  const variables=list(11,()=>{const key=name(),rank=u32();if(rank>8)throw Error('Invalid NetCDF dimensions.');const ids=Array.from({length:rank},u32),attributes=attrs(),type=u32(),size=u32();let start=u32();if(version===2)start=start*4294967296+u32();const shape=ids.map(i=>{if(!dimensions[i])throw Error('Invalid NetCDF dimension.');if(dimensions[i].length===0)throw Error('Record-based NetCDF files are not supported by this plot.');return dimensions[i].length;});return {name:key,shape,attributes,type,size,start};});
  const read=key=>{const variable=variables.find(row=>row.name===key);if(!variable)throw Error(`McFETCH did not provide the ${key} variable.`);const saved=offset;offset=variable.start;const count=variable.shape.reduce((a,b)=>a*b,1),data=values(variable.type,count);offset=saved;return {...variable,data};};
  return {dimensions,variables,attributes,records,read};
}
const scalar=variable=>Number(variable.data[0]);
export function decodeTemperatureGrid(input){
  const nc=readClassicNetcdf(input),data=nc.read('data'),lat=nc.read('lat'),lon=nc.read('lon'),height=lat.shape.at(-2),width=lat.shape.at(-1),length=height*width;
  if(!height||!width||length!==lat.data.length||length!==lon.data.length||data.data.length!==length)throw Error('The NetCDF temperature and coordinate grids do not match.');
  const units=String(data.attributes.units||'').replace(/[^a-z]/gi,'').toLowerCase(),kelvin=['k','kelvin','degreesk','degreeskelvin'].includes(units),celsius=['c','celsius','degreesc','degreescelsius'].includes(units);
  if(!kelvin&&!celsius)throw Error('This band does not contain calibrated temperatures. Choose an infrared band or Original image mode.');
  const factor=Number(data.attributes.scale_factor?.[0]??1),add=Number(data.attributes.add_offset?.[0]??0),fill=data.attributes._FillValue?.[0]??data.attributes.missing_value?.[0],temperatures=new Float32Array(length);
  const sensor=String(nc.attributes['Satellite Sensor']||'').trim(),tenths=/GOES.?7/i.test(sensor)&&kelvin&&data.data.some(v=>v>1000&&v<4000);
  for(let i=0;i<length;i++){const raw=data.data[i],v=(raw*factor+add)*(tenths?0.1:1)-(kelvin?273.15:0);temperatures[i]=raw===fill||!Number.isFinite(v)||v< -200||v>100?NaN:v;}
  const day=scalar(nc.read('imageDate')),clock=String(scalar(nc.read('imageTime'))).padStart(6,'0'),year=Math.floor(day/1000),doy=day%1000;
  if(year<1970||year>2100||doy<1||doy>366||!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(clock))throw Error('The NetCDF scan timestamp is invalid.');
  const timestamp=new Date(Date.UTC(year,0,doy,+clock.slice(0,2),+clock.slice(2,4),+clock.slice(4))).toISOString();
  return {width,height,latitude:lat.data,longitude:lon.data,temperature:temperatures,timestamp,sensor,calibration:tenths?'GOES-7 tenths-K correction':'file temperature units',band:scalar(nc.read('bands'))};
}
export function centerMaximum(grid,latitude,longitude){
  let max=-Infinity;for(let i=0;i<grid.temperature.length;i++){const dy=Math.abs(grid.latitude[i]-latitude),dx=Math.abs(((grid.longitude[i]-longitude+540)%360)-180),t=grid.temperature[i];if(dy<=1&&dx<=1&&Number.isFinite(t))max=Math.max(max,t);}return Number.isFinite(max)?max:null;
}
