import {paintSpectrum} from './live-storms-palette.js';
export function createSpectrumPlayer(canvas){
  let generation=0,decoder=null,timer=null,bitmap=null;
  function stop(){generation++;clearTimeout(timer);timer=null;try{decoder?.close();}catch{}decoder=null;bitmap?.close();bitmap=null;}
  async function load(blob,options){
    stop();const token=generation,data=await blob.arrayBuffer();if(token!==generation)return;
    if(options.animated){
      if(typeof ImageDecoder==='undefined')throw Error('Color-enhanced loops are not supported by this browser. Uncheck Animate or choose a NOAA satellite product.');
      const current=new ImageDecoder({data,type:'image/gif'});decoder=current;await current.tracks.ready;if(token!==generation){current.close();return;}
      const frames=Math.min(current.tracks.selectedTrack.frameCount,64);if(!frames)throw Error('The infrared loop has no readable frames.');
      async function render(index){const result=await current.decode({frameIndex:index});if(token!==generation){result.image.close();return;}const duration=result.image.duration;try{paintSpectrum(canvas,result.image,options);options.onFrame?.();}finally{result.image.close();}return duration;}
      await render(0);let index=1;
      async function advance(){if(token!==generation)return;try{const duration=await render(index);if(token!==generation)return;index=(index+1)%frames;timer=setTimeout(advance,index===0?900:Math.max(200,Math.min(800,(duration||250000)/1000)));}catch{if(token===generation)stop();}}
      timer=setTimeout(advance,350);
    }else{
      bitmap=await createImageBitmap(new Blob([data],{type:'image/gif'}));if(token!==generation){bitmap.close();return;}paintSpectrum(canvas,bitmap,options);options.onFrame?.();bitmap.close();bitmap=null;
    }
  }
  return {load,stop};
}
