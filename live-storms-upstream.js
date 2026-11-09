import {PRIMARY_PRODUCTS,HSD_ROOT,hsdPlan,hsdAvailable,scanAngles,crwUrl} from './live-storms-primary.js';
import {THREDDS,goesMetadata,goesWindow,decodeGoesDods} from './live-storms-goes.js';
const stamp=d=>d.toISOString().replace(/[-:T]/g,'').slice(0,12);
function scanDate(key){const m=key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_/);return m?new Date(Date.UTC(+m[1],0,+m[2],+m[3],+m[4],+m[5])).toISOString():null;}
export function createPrimaryService({text,binary,cached,now}){
  async function himawari(storm,product,animated){
    const frames=[];let probes=0;
    for(let t=Math.floor((+now()-10*60000)/600000)*600000;t>+now()-90*60000&&probes<7;t-=600000){
      const validAt=new Date(t).toISOString(),plan=hsdPlan(storm,product,stamp(new Date(t)));probes++;
      const xml=await cached('hsd-list:'+plan.prefix,120000,()=>text(HSD_ROOT+'?'+new URLSearchParams({'list-type':'2',prefix:plan.prefix,'max-keys':'20'}),30000));
      if(hsdAvailable(xml,plan))frames.push({...plan,validAt});if(frames.length>=(animated&&product!=='vis'?3:1))break;
    }
    if(!frames.length)throw Error('Recent Himawari files are not yet available.');
    return {kind:'hsd',satellite:'Himawari-9',band:frames[0].band,units:product==='vis'?'%':'°C',frames:frames.reverse(),source:'JMA / NOAA Open Data',nativeResolutionKm:frames[0].resolution/10,sourceUrl:'https://registry.opendata.aws/noaa-himawari/',method:'Native HSD calibration; bilinear resampling of calibrated values. Nominal geostationary navigation; no parallax correction.',loopNote:product==='vis'&&animated?'Visible imagery uses one scan to limit large native file transfers.':null};
  }
  async function goes(storm,product,animated){
    const p=PRIMARY_PRODUCTS.find(p=>p.id===product),side=storm.longitude< -100?'west':'east',folder=`satellite/goes/${side}/products/CloudAndMoistureImagery/FullDisk/Channel${String(p.abi).padStart(2,'0')}/current/`;
    const xml=await cached('goes-list:'+folder,120000,()=>text(THREDDS+'catalog/'+folder+'catalog.xml',200000));
    const files=[...new Set([...xml.matchAll(/urlPath="([^"]+)"/g)].map(m=>m[1]))].filter(p=>p.startsWith(folder)&&/^OR_ABI-L2-CMIPF-[A-Za-z0-9_]+\.nc$/.test(p.slice(folder.length))).map(path=>({path,validAt:scanDate(path)})).filter(f=>f.validAt&&+now()-Date.parse(f.validAt)>=0&&+now()-Date.parse(f.validAt)<3*3600000).sort((a,b)=>Date.parse(b.validAt)-Date.parse(a.validAt)).slice(0,animated?3:1);
    if(!files.length)throw Error('No recent GOES observations.');
    const base=THREDDS+'dodsC/'+files[0].path,[das,dds]=await Promise.all([cached('das:'+base,300000,()=>text(base+'.das',50000)),cached('dds:'+base,300000,()=>text(base+'.dds',15000))]),metadata=goesMetadata(das,dds),window=goesWindow(storm,metadata);
    return {kind:'goes',satellite:metadata.satellite,band:p.abi,units:metadata.units==='kelvin'?'°C':'%',frames:files.reverse().map(f=>({validAt:f.validAt,scan:f.path.match(/_s(\d+)_/)[1]})),source:'NOAA / Unidata',sourceUrl:'https://www.unidata.ucar.edu/data/satellite/goes',method:`CF-calibrated ABI CMI; ${window.stride>1?window.stride+'-pixel sampling; ':''}bilinear resampling of calibrated values. Nominal geostationary navigation; no parallax correction.`,metadata,window,files};
  }
  async function charts(storm,product,animated){
    const productInfo=PRIMARY_PRODUCTS.find(p=>p.id===product);if(!productInfo)throw Error('Unsupported calibrated product.');
    const him=scanAngles(storm.latitude,storm.longitude,{subLon:140.7,req:6378.137,rpol:6356.7523,rs:42164,sweep:'y'});
    const useHim=!!him&&(storm.longitude>70||storm.longitude< -165);
    const satellite=await cached(`primary:${storm.id}:${storm.validAt}:${product}:${animated}`,120000,()=>useHim?himawari(storm,product,animated):goes(storm,product,animated));
    // Internal paths and parsing metadata stay on the server for GOES subsets.
    const {files,metadata,window,...publicSatellite}=satellite;
    return {stormId:storm.id,provider:'Tornado Database',checkedAt:now().toISOString(),satellite:publicSatellite};
  }
  async function grid(storm,product,scan){
    await charts(storm,product,true);const full=await cached(`primary:${storm.id}:${storm.validAt}:${product}:true`,120000,()=>goes(storm,product,true));
    if(full.kind!=='goes')throw Error('Himawari files are fetched directly from NOAA.');const f=full.files.find(f=>f.path.match(/_s(\d+)_/)[1]===scan);if(!f)throw Error('This scan is no longer in the recent inventory.');
    return cached('goes-grid:'+storm.id+':'+product+':'+scan,600000,async()=>{let metadata=full.metadata;if(f.path!==full.files.at(-1).path){const base=THREDDS+'dodsC/'+f.path;const [das,dds]=await Promise.all([text(base+'.das',50000),text(base+'.dds',15000)]);metadata=goesMetadata(das,dds);}const w=goesWindow(storm,metadata),slice=`Sectorized_CMI[${w.top}:${w.stride}:${w.bottom}][${w.left}:${w.stride}:${w.right}]`,bytes=await binary(THREDDS+'dodsC/'+f.path+'.dods?'+slice,3500000,35000),grid=decodeGoesDods(bytes,metadata,w),packed=new Int16Array(grid.values.length);
      for(let i=0;i<packed.length;i++)packed[i]=Number.isFinite(grid.values[i])?Math.round(grid.values[i]*100):-32768;
      return {width:grid.width,height:grid.height,bounds:grid.bounds,packed:Buffer.from(packed.buffer).toString('base64'),encoding:'int16-le-centi',validAt:f.validAt};
    });
  }
  async function ocean(storm,part){const plan=crwUrl(storm);if(part<0||part>=plan.urls.length)throw Error('Invalid ocean tile.');return cached('crw:'+plan.urls[part],1800000,()=>binary(plan.urls[part],2500000,35000));}
  return {charts,grid,ocean};
}
