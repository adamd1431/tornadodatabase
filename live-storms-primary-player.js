import {decodePackedGrid} from './live-storms-grid.js';
import {drawScientific} from './live-storms-scientific.js';
import {createFrameCache,observationContext,observationKey} from './live-storms-frame-cache.js';
import {createHsdClient} from './live-storms-hsd-client.js';
export function createPrimaryPlayer(canvas,{api,getCoastlines,getStormDetails,render=drawScientific,nativeClient=createHsdClient(),now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout,isHidden=()=>document.hidden}={}){
  const cache=createFrameCache(),metadata=new Map(),history=new Map();let timer=null,version=0,active=null,session=null;
  const boundedSet=(map,key,value)=>{map.delete(key);map.set(key,value);while(map.size>24)map.delete(map.keys().next().value);};
  const getMetadata=key=>{const row=metadata.get(key);return row&&now()-row.at<60000?row.value:null;};
  function stop(){version++;session?.controller.abort();session?.detach();session=null;cancel(timer);timer=null;active=null;}
  function dispose(){stop();nativeClient.close();cache.clear();metadata.clear();history.clear();}
  function redraw(){if(active){const current=getStormDetails?.();render(canvas,[active.grid],{...active.options,...(current?.id===active.options.storm.id?{storm:current}:{}),coastlines:getCoastlines?.()});}}
  function previous(storm,product){const row=history.get(observationContext(storm,product));if(!row)return null;const grid=cache.get(row.key),age=grid?now()-Date.parse(grid.validAt):Infinity;return grid&&age>=-15*60000&&age<3*3600000?{...row,grid}:null;}
  async function load(storm,product,animated,{signal,onProgress,onFrame}={}){
    stop();const current=version,controller=new AbortController(),relay=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',relay,{once:true});
    session={controller,detach:()=>signal?.removeEventListener('abort',relay)};const requestSignal=controller.signal,context=observationContext(storm,product),valid=()=>current===version&&!requestSignal.aborted;
    let descriptor=null,painted=false,lastKey=null;
    function paint(grid,d,key,status={}){
      if(!valid())return;const same=active?.grid===grid;painted=true;lastKey=key;active={grid,options:{kind:product,storm,source:d.source,satellite:d.satellite,band:d.band,validAt:grid.validAt,method:d.method}};if(!same)redraw();onFrame?.(grid,{...d,...status});
    }
    async function inventory(loop){const key=context+':'+loop,found=getMetadata(key);if(found)return found;const result=await api({view:'charts',storm:storm.id,product,quality:'high',animated:loop?'1':'0'},requestSignal);if(!valid())throw new DOMException('Aborted','AbortError');boundedSet(metadata,key,{at:now(),value:result.satellite});return result.satellite;}
    async function getGrid(frame,d){
      const key=observationKey(context,frame),saved=cache.get(key);if(saved)return {grid:saved,key,cached:true};if(!valid())throw new DOMException('Aborted','AbortError');
      const grid=d.kind==='goes'?decodePackedGrid(await api({view:'grid',storm:storm.id,product,quality:'high',scan:frame.scan},requestSignal)):await nativeClient.load(frame,{signal:requestSignal,onProgress:message=>{if(valid())onProgress?.(message);}});
      if(!valid())throw new DOMException('Aborted','AbortError');cache.set(key,grid);return {grid,key,cached:false};
    }
    const saved=previous(storm,product);
    if(saved&&valid())paint(saved.grid,saved.descriptor,saved.key,{fromCache:true,checking:!getMetadata(context+':false'),buffering:animated});
    try{
      // A loop inventory may need several upstream requests. Fetch the newest
      // still first; discover history only after something is already visible.
      descriptor=(animated&&getMetadata(context+':true'))||await inventory(false);const latest=await getGrid(descriptor.frames.at(-1),descriptor);
      if(!valid())return;boundedSet(history,context,{key:latest.key,descriptor});paint(latest.grid,descriptor,latest.key,{fromCache:latest.cached,buffering:animated});
    }catch(error){if(error.name==='AbortError'||!valid())return;if(painted){paint(saved.grid,saved.descriptor,saved.key,{fromCache:true,loopNote:'Update check unavailable; showing the loaded scan.'});return saved.descriptor;}throw error;}
    if(animated){
      (async()=>{
        let full;try{full=await inventory(true);}catch(error){if(valid())onFrame?.(active.grid,{...descriptor,loopNote:'Loop inventory unavailable; showing the newest loaded scan.'});return;}
        if(!valid())return;const ready=new Map();
        const sorted=()=>full.frames.map(f=>ready.get(observationKey(context,f))).filter(Boolean);
        for(const frame of full.frames){const key=observationKey(context,frame),grid=cache.get(key);if(grid)ready.set(key,{key,grid});}
        function tick(){timer=null;if(!valid()||isHidden())return;const frames=sorted();if(frames.length<2)return;const position=frames.findIndex(f=>f.key===lastKey),next=frames[(position+1)%frames.length];paint(next.grid,full,next.key,{fromCache:true,loopFrames:frames.length});timer=schedule(tick,next.key===frames.at(-1).key?900:350);}
        function start(){const frames=sorted();if(frames.length>=2&&timer===null){if(active)onFrame?.(active.grid,{...full,loopFrames:frames.length});timer=schedule(tick,350);}}
        start();
        // The first additional frame starts playback; later frames join as
        // they arrive. Reuse decoded latest frames instead of downloading twice.
        for(const frame of [...full.frames].reverse()){
          if(!valid())return;const key=observationKey(context,frame);if(ready.has(key))continue;
          try{const result=await getGrid(frame,full);if(!valid())return;ready.set(key,result);start();}catch(error){if(error.name==='AbortError'||!valid())return;}
        }
        if(valid()&&ready.size<2)onFrame?.(active.grid,{...full,loopNote:full.loopNote||'One scan loaded; additional loop frames are unavailable.'});
      })();
    }
    return descriptor;
  }
  return {load,stop,dispose,redraw,hasFrame:(storm,product)=>!!previous(storm,product)};
}
