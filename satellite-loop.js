import {PRIMARY_PRODUCTS} from './live-storms-primary.js';
import {decodePackedGrid} from './live-storms-grid.js';
import {createHsdClient} from './live-storms-hsd-client.js';
import {drawScientific} from './live-storms-scientific.js';
import {imageUrl} from './live-storms-model.js';
import {createLoopDiskCache,renderedLoopKey,runLoopJobs} from './satellite-loop-cache.js';
import {LOOP_DEFAULTS,loopSettings} from './satellite-loop-model.js';
import {createLoopPlayback} from './satellite-loop-playback.js?v=buffered-1';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),nativeClients=[createHsdClient(),createHsdClient()],renderWorkers=[null,null],diskCache=createLoopDiskCache();
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(new Date(value)).replace(',','')+' UTC';
let catalog=[],storm=null,product=['spectrum','wv','vis'].includes(params.get('product'))?params.get('product'):'spectrum',settings={...LOOP_DEFAULTS},coastlines=null;
let controller=null,version=0,playback=null,gifWorker=null,currentFrame=null,loading=false,storedBytes=0,paintVersion=0,resumeOnVisible=false,loadMetrics=null;
const rendered=new Map(),bitmaps=new Map();let cacheBytes=0;
const pngCache={get(key){const row=rendered.get(key);if(row){rendered.delete(key);rendered.set(key,row);}return row;},set(key,row){const old=rendered.get(key);if(old)cacheBytes-=old.blob.size;rendered.delete(key);rendered.set(key,row);cacheBytes+=row.blob.size;while(cacheBytes>100*1048576||rendered.size>60){const first=rendered.keys().next().value;cacheBytes-=rendered.get(first).blob.size;rendered.delete(first);}}};
async function api(query={},signal){const r=await fetch('api/live-storms?'+new URLSearchParams(query),{signal});const body=await r.json();if(!r.ok)throw Error(body.message||'Product unavailable.');return body;}
function status(text){$('loopStatus').textContent=text;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function fileName(ext){return `${storm.name.toLowerCase().replace(/[^a-z0-9-]/g,'-')}-${product}-${ext==='gif'?'loop':currentFrame.validAt.replace(/[-:T]/g,'').slice(0,12)}.${ext}`;}
function zoom(){const mode=$('viewerZoom').value;const canvas=$('loopCanvas');$('loopViewport').dataset.zoom=mode;canvas.style.width=mode==='100'?'1800px':mode==='fit'?'auto':'100%';canvas.style.height=mode==='fit'?'100%':'auto';}
function cancelGif(){gifWorker?.terminate();gifWorker=null;$('cancelGif').hidden=true;$('gifStatus').textContent='';$('makeGif').disabled=loading||(playback?.getFrames().length||0)<2;}
function cleanBitmaps(){for(const b of bitmaps.values())b.close();bitmaps.clear();}
async function bitmap(frame,token){
  if(bitmaps.has(frame.key)){const b=bitmaps.get(frame.key);bitmaps.delete(frame.key);bitmaps.set(frame.key,b);return b;}
  const b=await createImageBitmap(frame.blob);if(token!==version){b.close();return null;}bitmaps.set(frame.key,b);while(bitmaps.size>4){const key=bitmaps.keys().next().value;bitmaps.get(key).close();bitmaps.delete(key);}return b;
}
async function showFrame(frame,token){
  if(token!==version)return;const paint=++paintVersion,b=await bitmap(frame,token);if(!b||token!==version||paint!==paintVersion)return;
  const canvas=$('loopCanvas');canvas.width=1800;canvas.height=1800;canvas.getContext('2d').drawImage(b,0,0);canvas.hidden=false;$('loopPreview').hidden=true;$('viewerPlaceholder').hidden=true;
  currentFrame=frame;$('scanTime').textContent='Observation '+date(frame.validAt);$('saveFrame').disabled=false;canvas.dataset.validAt=frame.validAt;zoom();
}
function playbackState(state){
  $('togglePlayback').disabled=!state.ready||state.count<2;
  $('togglePlayback').textContent=state.playing?'Ⅱ':'▶';$('togglePlayback').setAttribute('aria-label',state.playing?'Pause loop':'Play loop');
  $('frameTimeline').disabled=!state.ready||state.count<2;$('frameTimeline').max=Math.max(0,state.count-1);$('frameTimeline').value=Math.max(0,state.index);
  $('previousFrame').disabled=!state.ready||state.count<2;$('nextFrame').disabled=!state.ready||state.count<2;
  $('frameCounter').textContent=state.ready?`${Math.max(0,state.index+1)} / ${state.count}`:`${state.count} / ${settings.frames}`;
  $('playbackStatus').textContent=state.ready?`${state.fps} frames per second · ${settings.skip?`skip ${settings.skip} between scans`:'no skipped scans'}`:`Loading ${state.count} / ${settings.frames} frames · playback starts when ready`;
}
function workerRender(grid,options,signal,lane=0){
  if(typeof OffscreenCanvas==='undefined'){const canvas=document.createElement('canvas');drawScientific(canvas,[grid],options);return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob),'image/png'));}
  if(!renderWorkers[lane])renderWorkers[lane]=new Worker(new URL('./satellite-loop-render-worker.js',import.meta.url),{type:'module'});
  const worker=renderWorkers[lane],id=version;
  return new Promise((resolve,reject)=>{
    const abort=()=>{worker.terminate();if(renderWorkers[lane]===worker)renderWorkers[lane]=null;reject(new DOMException('Aborted','AbortError'));};
    const done=()=>{signal.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;};signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.id!==id)return;done();if(data.error)reject(Error(data.error));else resolve(data.blob);};
    worker.onerror=()=>{done();worker.terminate();if(renderWorkers[lane]===worker)renderWorkers[lane]=null;reject(Error('Satellite plot rendering failed.'));};
    worker.postMessage({id,grid,options},[grid.values.buffer]);
  });
}
async function prepare(frame,descriptor,token,signal,lane=0){
  const key=renderedLoopKey(storm,product,frame),cached=pngCache.get(key);if(cached){loadMetrics.cacheKeys.add(key);return cached;}
  const saved=await diskCache.get(key);if(token!==version||signal.aborted)throw new DOMException('Aborted','AbortError');
  if(saved){pngCache.set(key,saved);loadMetrics.cacheKeys.add(key);return saved;}
  const grid=descriptor.kind==='goes'?decodePackedGrid(await api({view:'grid',storm:storm.id,product,quality:'high',frames:settings.frames,skip:settings.skip,scan:frame.scan},signal)):
    await nativeClients[lane].load(frame,{signal,onProgress:message=>{if(token===version)status(message);}});
  if(token!==version||signal.aborted)throw new DOMException('Aborted','AbortError');
  const validAt=grid.validAt,blob=await workerRender(grid,{kind:product,storm,coastlines,source:descriptor.source,satellite:descriptor.satellite,band:descriptor.band,validAt,method:descriptor.method},signal,lane);
  if(token!==version||signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!blob)throw Error('Could not prepare PNG frame.');const row={key,blob,validAt};pngCache.set(key,row);diskCache.set(key,row);loadMetrics.prepared++;return row;
}
function updateProducts(){for(const button of document.querySelectorAll('[data-product]'))button.setAttribute('aria-pressed',String(button.dataset.product===product));}
async function load(){
  if(!storm)return;controller?.abort();playback?.dispose();cancelGif();cleanBitmaps();
  const token=++version;controller=new AbortController();const {signal}=controller;loading=true;currentFrame=null;storedBytes=0;
  loadMetrics={started:performance.now(),cacheKeys:new Set(),prepared:0};delete $('loopCanvas').dataset.loadMs;delete $('loopCanvas').dataset.cacheHits;
  playback=createLoopPlayback({fps:settings.fps,onFrame:frame=>{if(!loading)return showFrame(frame,token);},onState:state=>{if(token===version)playbackState(state);}});
  playbackState(playback.getState());
  $('loopCanvas').hidden=true;$('loopPreview').hidden=true;$('viewerPlaceholder').hidden=false;$('makeGif').disabled=true;$('saveFrame').disabled=true;$('frameCounter').textContent=`0 / ${settings.frames}`;$('loopProgress').max=settings.frames;$('loopProgress').value=0;
  $('viewerTitle').textContent=`${storm.name} · ${storm.designation}`;document.title=`${storm.name} Satellite Loop · Tornado Database`;$('scanTime').textContent='Finding the newest scan…';status(`Preparing ${settings.frames} frames at ${settings.fps} fps…`);updateProducts();
  history.replaceState(null,'','satellite-loop.html?'+new URLSearchParams({storm:storm.id,product}));
  const fallback=imageUrl(storm,product==='spectrum'?'ir':product,true);$('originalLoop').hidden=!fallback;if(fallback)$('originalLoop').href=fallback;
  const preview=imageUrl(storm,product==='spectrum'?'ir':product,false);if(preview){const img=$('loopPreview');img.onload=()=>{if(token===version&&$('loopCanvas').hidden){img.hidden=false;$('viewerPlaceholder').hidden=true;$('scanTime').textContent='Original NOAA preview · loading calibrated loop…';}};img.src=preview;}
  try{
    // Show a recent scan before discovering and rendering the full history.
    const first=(await api({view:'charts',storm:storm.id,product,quality:'high',animated:'0'},signal)).satellite;
    const newest=await prepare(first.frames.at(-1),first,token,signal);await showFrame(newest,token);
    status('Newest scan ready · finding loop history…');
    const descriptor=(await api({view:'charts',storm:storm.id,product,quality:'high',animated:'1',frames:settings.frames,skip:settings.skip},signal)).satellite;
    if(token!==version)return;$('loopCredit').textContent=`Plot: Tornado Database · Data: ${descriptor.source}`;$('loopSource').hidden=false;$('loopSource').href=descriptor.sourceUrl;$('loopMethod').textContent=descriptor.method;
    let failures=0;const jobs=descriptor.frames.map((frame,slot)=>({frame,slot})).reverse();
    await runLoopJobs(jobs,{concurrency:2,signal,work:async({frame:source,slot},lane)=>{
      if(token!==version||signal.aborted)return;
      try{const frame=await prepare(source,descriptor,token,signal,lane);if(token!==version||signal.aborted)return;storedBytes+=frame.blob.size;if(storedBytes>160*1048576){controller.abort();throw Error('Loop exceeds this browser’s memory budget. Choose fewer frames.');}await playback.add({...frame,slot});}
      catch(error){if(error.name==='AbortError'||token!==version)return;if(error.message.includes('memory budget'))throw error;failures++;}
      const count=playback.getFrames().length;$('loopProgress').value=count;status(`${count} / ${settings.frames} frames ready · ${descriptor.frames.length} scans found${failures?` · ${failures} unavailable`:''}`);
    }});
    await diskCache.flush();if(token!==version)return;loading=false;playback.finishLoading();const count=playback.getFrames().length,cacheHits=Math.min(count,loadMetrics.cacheKeys.size);$('makeGif').disabled=count<2;
    $('loopCanvas').dataset.loadMs=String(Math.round(performance.now()-loadMetrics.started));$('loopCanvas').dataset.cacheHits=String(cacheHits);$('loopCanvas').dataset.preparedFrames=String(loadMetrics.prepared);
    status(`${count} / ${settings.frames} requested frames loaded${count<settings.frames?' · missing scans are not duplicated':''}. ${settings.fps} fps, skip ${settings.skip}.${cacheHits>1?` ${cacheHits} saved frames reused.`:''}`);
    if(count<2)$('playbackStatus').textContent='Only one scan is available; a loop needs at least two.';
  }catch(error){if(error.name==='AbortError'||token!==version)return;loading=false;status(error.message+(fallback?' The original NOAA loop is linked below.':''));$('makeGif').disabled=(playback?.getFrames().length||0)<2;}
}
$('loopSettings').addEventListener('submit',event=>{event.preventDefault();try{const next=loopSettings({frames:$('loopFrames').value,fps:$('loopFps').value,skip:$('loopSkip').value}),reload=next.frames!==settings.frames||next.skip!==settings.skip;settings=next;if(reload)load();else{playback?.setSpeed(settings.fps);status(`Playback speed set to ${settings.fps} fps.`);}}catch(error){status(error.message);}});
$('togglePlayback').addEventListener('click',()=>playback?.setPlaying(!playback.getState().playing));$('previousFrame').addEventListener('click',()=>playback?.step(-1));$('nextFrame').addEventListener('click',()=>playback?.step(1));$('frameTimeline').addEventListener('input',()=>playback?.seek(+$('frameTimeline').value));$('viewerZoom').addEventListener('change',zoom);
for(const button of document.querySelectorAll('[data-product]'))button.addEventListener('click',()=>{if(product===button.dataset.product)return;product=button.dataset.product;load();});
$('loopStorm').addEventListener('change',()=>{storm=catalog.find(s=>s.id===$('loopStorm').value);load();});$('reloadLoop').addEventListener('click',load);
$('saveFrame').addEventListener('click',()=>{if(currentFrame)download(currentFrame.blob,fileName('png'));});
$('makeGif').addEventListener('click',()=>{
  const frames=playback?.getFrames()||[];if(loading||frames.length<2)return;const exportSettings={...settings},exportName=fileName('gif');playback.setPlaying(false);cancelGif();$('makeGif').disabled=true;$('cancelGif').hidden=false;$('gifStatus').textContent=`Encoding ${frames.length} frames at ${exportSettings.fps} fps…`;
  const worker=new Worker(new URL('./satellite-loop-gif-worker.js',import.meta.url),{type:'module'});gifWorker=worker;
  const finish=message=>{worker.terminate();if(gifWorker===worker)gifWorker=null;$('cancelGif').hidden=true;$('makeGif').disabled=false;$('gifStatus').textContent=message;};
  worker.onmessage=({data})=>{if(gifWorker!==worker)return;if(data.error){finish(data.error);return;}if(data.progress){$('gifStatus').textContent=`Encoding GIF · ${data.progress} / ${data.total} frames`;return;}download(new Blob([data.bytes],{type:'image/gif'}),exportName);finish(`Saved ${frames.length} frames · ${exportSettings.fps} fps · skip ${exportSettings.skip}.`);};
  worker.onerror=()=>{if(gifWorker===worker)finish('GIF export failed. Try fewer frames or a smaller GIF size.');};worker.postMessage({frames:frames.map(f=>({blob:f.blob})),fps:exportSettings.fps,size:+$('gifSize').value});
});
$('cancelGif').addEventListener('click',cancelGif);
document.addEventListener('visibilitychange',()=>{if(document.hidden){resumeOnVisible=!!playback?.getState().wantsPlayback;playback?.setPlaying(false);}else if(resumeOnVisible)playback?.setPlaying(true);});
window.addEventListener('pagehide',()=>{version++;controller?.abort();playback?.dispose();nativeClients.forEach(client=>client.close());renderWorkers.forEach(worker=>worker?.terminate());gifWorker?.terminate();cleanBitmaps();rendered.clear();});
async function initialize(){
  try{const [data,coast]=await Promise.all([api(),fetch('assets/mcfetch-coastlines.json').then(r=>r.ok?r.json():null).catch(()=>null)]);catalog=data.storms;coastlines=coast;storm=catalog.find(s=>s.id===params.get('storm'))||catalog[0];
    if(!storm)throw Error('No current storms are available. Return to Live storms.');
    $('loopStorm').replaceChildren(...catalog.map(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=`${s.name} · ${s.designation}`;return option;}));$('loopStorm').value=storm.id;$('loopStorm').disabled=false;
    if(storm.pressureMb===null){try{const structure=await api({view:'structure',storm:storm.id});if(structure.pressureMatchesAdvisory&&structure.validAt===storm.validAt)storm={...storm,pressureMb:structure.pressureMb};}catch{}}
    await load();
  }catch(error){status(error.message);$('scanTime').textContent='Satellite loop unavailable';$('viewerPlaceholder').textContent=error.message;}
}
initialize();
