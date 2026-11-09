// Reuse an idle decoder/WASM instance. Interrupt an active job immediately
// when the user switches products; obsolete work can never paint a new view.
export function createHsdClient({makeWorker=()=>new Worker(new URL('./live-storms-hsd-worker.js?v=pooled-1',import.meta.url),{type:'module'})}={}){
  let worker=null,active=null,serial=0;
  function close(){if(active)active.abort();else{worker?.terminate();worker=null;}}
  function load(frame,{signal,onProgress}={}){
    if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    if(active)close();if(!worker)worker=makeWorker();const job=worker,id=++serial;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{signal?.removeEventListener('abort',abort);if(active?.id===id)active=null;job.onmessage=null;job.onerror=null;};
      const abort=()=>{cleanup();job.terminate();if(worker===job)worker=null;reject(new DOMException('Aborted','AbortError'));};active={id,abort};signal?.addEventListener('abort',abort,{once:true});
      job.onmessage=({data})=>{if(data.id!==id)return;if(data.progress){onProgress?.(data.progress);return;}cleanup();if(data.error){job.terminate();if(worker===job)worker=null;reject(Error(data.error));}else resolve(data.grid);};
      job.onerror=()=>{cleanup();job.terminate();if(worker===job)worker=null;reject(Error('The native scan worker failed.'));};job.postMessage({id,frame});
    });
  }
  return {load,close};
}
