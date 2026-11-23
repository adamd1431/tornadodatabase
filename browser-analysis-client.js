function workerRequest(filename,payload,timeout){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(filename,import.meta.url),{type:'module'});
    const timer=setTimeout(()=>finish(Error('The analysis took too long. Please try again.')),timeout);
    function finish(error,result){clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);}
    worker.onmessage=event=>event.data.error?finish(Error(event.data.error)):finish(null,event.data.result);
    worker.onerror=()=>finish(Error('The analysis worker could not start. Refresh the page and retry.'));
    worker.postMessage(payload);
  });
}
export const browserPressureAnalysis=parameters=>workerRequest('./pressure-browser-worker.js',parameters,90000);
export const browserJtwcReport=(storm,years)=>workerRequest('./jtwc-browser-worker.js',{storm,years},180000);
