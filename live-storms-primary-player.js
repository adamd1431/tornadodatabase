import {decodePackedGrid} from './live-storms-grid.js';
import {drawScientific} from './live-storms-scientific.js';
export function createPrimaryPlayer(canvas,{api,getCoastlines,getStormDetails}){
  let worker=null,timer=null,version=0,active=null;
  function stop(){version++;worker?.terminate();worker=null;clearTimeout(timer);active=null;}
  function redraw(){if(active){const current=getStormDetails?.();drawScientific(canvas,[active.grid],{...active.options,...(current?.id===active.options.storm.id?{storm:current}:{}),coastlines:getCoastlines()});}}
  async function load(storm,product,animated,{signal,onProgress,onFrame}){
    stop();const current=version,result=await api({view:'charts',storm:storm.id,product,quality:'high',animated:animated?'1':'0'},signal),descriptor=result.satellite;
    const valid=()=>current===version&&!signal.aborted;
    async function getGrid(frame){
      if(!valid())throw new DOMException('Aborted','AbortError');
      if(descriptor.kind==='goes')return decodePackedGrid(await api({view:'grid',storm:storm.id,product,quality:'high',scan:frame.scan},signal));
      return new Promise((resolve,reject)=>{
        const job=new Worker(new URL('./live-storms-hsd-worker.js',import.meta.url),{type:'module'});worker=job;
        const cleanup=()=>{signal.removeEventListener('abort',abort);job.terminate();if(worker===job)worker=null;};
        const abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});
        job.onmessage=({data})=>{if(data.progress){onProgress?.(data.progress);return;}cleanup();data.error?reject(Error(data.error)):resolve(data.grid);};
        job.onerror=()=>{cleanup();reject(Error('The native scan worker failed.'));};job.postMessage({frame});
      });
    }
    function paint(grid){if(!valid())return;active={grid,options:{kind:product,storm,source:descriptor.source,satellite:descriptor.satellite,band:descriptor.band,validAt:grid.validAt,method:descriptor.method}};redraw();onFrame?.(grid,descriptor);}
    const frames=descriptor.frames,latest=await getGrid(frames.at(-1));if(!valid())return;paint(latest);
    if(animated&&frames.length>1){
      (async()=>{const grids=[];for(const frame of frames.slice(0,-1)){if(!valid())return;try{grids.push(await getGrid(frame));}catch(error){if(error.name==='AbortError')return;}}grids.push(latest);if(!valid()||grids.length<2)return;let i=grids.length-1;
        const next=()=>{if(!valid()||document.hidden)return;i=(i+1)%grids.length;paint(grids[i]);timer=setTimeout(next,i===grids.length-1?1600:650);};timer=setTimeout(next,1600);
      })();
    }
    return descriptor;
  }
  return {load,stop,redraw};
}
