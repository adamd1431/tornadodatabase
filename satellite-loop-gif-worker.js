import {GIFEncoder,quantize,applyPalette} from './assets/vendor/gifenc.js';
import {gifDimensions} from './satellite-loop-model.js';
self.onmessage=async({data})=>{
  try{
    const {frames,fps}=data;if(!Array.isArray(frames)||frames.length<2||frames.length>60||!Number.isFinite(fps)||fps<1||fps>30)throw Error('Invalid GIF settings.');
    const first=await createImageBitmap(frames[0].blob),{width,height}=gifDimensions(first.width,first.height,data.size===1200?1200:0);
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();
    for(let i=0;i<frames.length;i++){
      const bitmap=i===0?first:await createImageBitmap(frames[i].blob);ctx.clearRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      const rgba=ctx.getImageData(0,0,width,height).data,palette=quantize(rgba,256),index=applyPalette(rgba,palette);
      gif.writeFrame(index,width,height,{palette,delay:1000/fps,repeat:0});self.postMessage({progress:i+1,total:frames.length});
      if(gif.bytesView().byteLength>150*1048576)throw Error('GIF exceeds the browser export limit. Choose fewer frames or 1200 px.');
    }
    gif.finish();const bytes=gif.bytes();self.postMessage({bytes},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message||'GIF export failed.'});}
};
