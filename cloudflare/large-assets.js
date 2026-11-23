// Reassemble exact bytes for the one archive image larger than Pages' 25-MiB
// per-file limit. Static chunks remain free assets; no R2 bucket is involved.
export function largeAssetRange(value,size){
  if(!value)return {start:0,end:size-1,partial:false};
  const match=value.match(/^bytes=(\d*)-(\d*)$/);if(!match||(!match[1]&&!match[2]))return null;
  let start,end;
  if(!match[1]){const tail=Number(match[2]);if(!Number.isSafeInteger(tail)||tail<=0)return null;start=Math.max(0,size-tail);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
  return {start,end,partial:true};
}
export async function serveLargeAsset(request,env,asset){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const headers=new Headers({'Content-Type':asset.mime,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','ETag':asset.etag,'X-Content-Type-Options':'nosniff'});
  if(request.headers.get('if-none-match')===asset.etag)return new Response(null,{status:304,headers});
  const range=largeAssetRange(request.headers.get('range'),asset.size);
  if(!range){headers.set('Content-Range','bytes */'+asset.size);return new Response(null,{status:416,headers});}
  headers.set('Content-Length',String(range.end-range.start+1));
  if(range.partial)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${asset.size}`);
  if(request.method==='HEAD')return new Response(null,{status:range.partial?206:200,headers});
  let activeReader,canceled=false,index=Math.floor(range.start/asset.chunkSize),position=index*asset.chunkSize;
  const finalIndex=Math.floor(range.end/asset.chunkSize);
  const body=new ReadableStream({
    async pull(controller){
      try{
        while(index<=finalIndex&&!canceled){
          if(!activeReader){
            const response=await env.ASSETS.fetch(new Request(new URL(asset.chunks[index],request.url)));
            if(!response.ok||!response.body)throw Error('Archive chunk is unavailable.');
            activeReader=response.body.getReader();position=index*asset.chunkSize;
          }
          const {value,done}=await activeReader.read();
          if(done){activeReader.releaseLock();activeReader=null;index++;continue;}
          const low=Math.max(0,range.start-position),high=Math.min(value.length,range.end-position+1);position+=value.length;
          if(high>low){controller.enqueue(value.subarray(low,high));if(position>range.end){await activeReader.cancel();activeReader.releaseLock();activeReader=null;index=finalIndex+1;controller.close();}return;}
        }
        if(!canceled)controller.close();
      }catch(error){if(!canceled)controller.error(error);}
    },
    async cancel(){canceled=true;await activeReader?.cancel();}
  });
  return new Response(body,{status:range.partial?206:200,headers});
}
