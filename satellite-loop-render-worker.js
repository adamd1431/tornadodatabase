import {drawScientific} from './live-storms-scientific.js';
self.onmessage=async({data})=>{
  try{const canvas=new OffscreenCanvas(1800,1800);drawScientific(canvas,[data.grid],data.options);const blob=await canvas.convertToBlob({type:'image/png'});self.postMessage({id:data.id,blob});}
  catch(error){self.postMessage({id:data.id,error:error.message||'Could not render the native scan.'});}
};
