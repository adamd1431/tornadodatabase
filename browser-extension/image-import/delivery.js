// Serialized by chrome.scripting into the configured database import page.
// Keep this function self-contained: no extension APIs, credentials, or DOM reads.
export function deliverImage(payload,timeoutMs=20000) {
  return new Promise((resolve,reject)=>{
    let sent=false;
    const cleanup=()=>{clearInterval(interval);clearTimeout(timeout);window.removeEventListener('message',receive);};
    function receive(event) {
      if(event.source!==window || event.origin!==location.origin || event.data?.id!==payload.id)return;
      if(event.data.type==='utwx:image-ready' && !sent){sent=true;window.postMessage({type:'utwx:image-data',...payload},location.origin);}
      if(event.data.type==='utwx:image-accepted' && sent){cleanup();resolve(true);}
      if(event.data.type==='utwx:image-error'){cleanup();reject(new Error(event.data.message || 'The database could not receive the image.'));}
    }
    window.addEventListener('message',receive);
    const offer=()=>window.postMessage({type:'utwx:image-offer',id:payload.id},location.origin);
    const interval=setInterval(offer,300);
    const timeout=setTimeout(()=>{cleanup();reject(new Error('The image picker did not respond. Deploy the website’s image-import files, then try again.'));},timeoutMs);
    offer();
  });
}
