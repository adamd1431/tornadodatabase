import {scanAngles,plotBounds,wrapLon} from './live-storms-primary.js';
export const THREDDS='https://thredds.ucar.edu/thredds/';
const block=(s,k)=>s.match(new RegExp('(?:^|\\n)\\s*'+k+' \\{([\\s\\S]*?)\\n\\s*\\}'))?.[1]||'';
const number=(s,k)=>Number(s.match(new RegExp('\\b'+k+'\\s+([-+0-9.eE]+)\\s*;'))?.[1]);
export function goesMetadata(das,dds){
  const x=block(das,'x'),y=block(das,'y'),p=block(das,'fixedgrid_projection'),c=block(das,'Sectorized_CMI'),g=block(das,'NC_GLOBAL');
  const width=Number(dds.match(/Sectorized_CMI\[y = \d+\]\[x = (\d+)\]/)?.[1]),height=Number(dds.match(/Sectorized_CMI\[y = (\d+)\]/)?.[1]);
  const projection={subLon:number(p,'longitude_of_projection_origin'),req:number(p,'semi_major_axis'),rpol:number(p,'semi_minor_axis'),rs:number(p,'perspective_point_height')+number(p,'semi_major_axis'),sweep:'x'};
  const meta={projection,width,height,x0:number(x,'add_offset')*1e-6,dx:number(x,'scale_factor')*1e-6,y0:number(y,'add_offset')*1e-6,dy:number(y,'scale_factor')*1e-6,gain:number(c,'scale_factor'),offset:number(c,'add_offset'),fill:number(c,'_FillValue'),units:c.match(/units "([^"]+)"/)?.[1],satellite:g.match(/satellite_id "([^"]+)"/)?.[1]||'GOES',band:number(g,'channel_id')};
  if(!width||!height||width*height>600000000||!['kelvin','1'].includes(meta.units)||![...Object.values(projection).filter(v=>typeof v==='number'),meta.x0,meta.dx,meta.y0,meta.dy,meta.gain,meta.offset].every(Number.isFinite))throw Error('Unsupported GOES calibration or projection.');
  return meta;
}
export function goesWindow(storm,m){
  const bounds=plotBounds(storm),points=[];
  for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){const q=scanAngles(bounds.south+(bounds.north-bounds.south)*y/16,bounds.west+(bounds.east-bounds.west)*x/16,m.projection);if(q)points.push([(q[0]-m.x0)/m.dx,(q[1]-m.y0)/m.dy]);}
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-1),right=Math.min(m.width-1,Math.ceil(Math.max(...points.map(p=>p[0])))+1),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-1),bottom=Math.min(m.height-1,Math.ceil(Math.max(...points.map(p=>p[1])))+1);
  if(!points.length||right<=left||bottom<=top)throw Error('The regional GOES feed does not cover this position.');
  const stride=Math.max(1,Math.ceil(Math.sqrt((right-left+1)*(bottom-top+1)/500000)));
  return {bounds,left,right,top,bottom,stride,width:Math.floor((right-left)/stride)+1,height:Math.floor((bottom-top)/stride)+1};
}
export function decodeGoesDods(input,m,w,size=700){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),text=new TextDecoder().decode(bytes.subarray(0,3000)),marker=text.indexOf('Data:\n');if(marker<0)throw Error('Invalid GOES subset.');
  let at=marker+6;const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u32=()=>{if(at+4>bytes.length)throw Error('Truncated GOES subset.');const n=v.getUint32(at);at+=4;return n;};
  const n=w.width*w.height;if(u32()!==n||u32()!==n||at+n*4>bytes.length)throw Error('GOES subset dimensions do not match.');const start=at;at+=n*4;
  // Validate coordinate maps rather than assuming the server honored the slice.
  for(const [count,first]of [[w.height,w.top],[w.width,w.left]]){if(u32()!==count||u32()!==count)throw Error('Invalid GOES coordinate map.');for(let i=0;i<count;i++)if(u32()!==first+i*w.stride)throw Error('Unexpected GOES coordinate map.');}
  const values=new Float32Array(size*size).fill(NaN),b=w.bounds;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const q=scanAngles(b.north-(y+.5)/size*(b.north-b.south),wrapLon(b.west+(x+.5)/size*(b.east-b.west)),m.projection);if(!q)continue;
    const col=Math.round(((q[0]-m.x0)/m.dx-w.left)/w.stride),row=Math.round(((q[1]-m.y0)/m.dy-w.top)/w.stride);if(col<0||row<0||col>=w.width||row>=w.height)continue;
    const count=v.getInt32(start+(row*w.width+col)*4);if(count===m.fill||count<0||count>4095)continue;values[y*size+x]=(count*m.gain+m.offset)*(m.units==='1'?100:1)-(m.units==='kelvin'?273.15:0);
  }return {width:size,height:size,bounds:b,values};
}
