import {GIFEncoder,quantize,applyPalette} from './assets/vendor/gifenc.js';
self.onmessage=async({data})=>{
  try{
    const {frames,fps}=data,size=data.size===1200?1200:1800;if(!Array.isArray(frames)||frames.length<2||frames.length>60||!Number.isFinite(fps)||fps<1||fps>30)throw Error('Invalid GIF settings.');
    const canvas=new OffscreenCanvas(size,size),ctx=canvas.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();
    for(let i=0;i<frames.length;i++){
      const bitmap=await createImageBitmap(frames[i].blob);ctx.drawImage(bitmap,0,0,size,size);bitmap.close();
      const rgba=ctx.getImageData(0,0,size,size).data,palette=quantize(rgba,256),index=applyPalette(rgba,palette);
      gif.writeFrame(index,size,size,{palette,delay:1000/fps,repeat:0});self.postMessage({progress:i+1,total:frames.length});
      if(gif.bytesView().byteLength>150*1048576)throw Error('GIF exceeds the browser export limit. Choose fewer frames or 1200 px.');
    }
    gif.finish();const bytes=gif.bytes();self.postMessage({bytes},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message||'GIF export failed.'});}
};
