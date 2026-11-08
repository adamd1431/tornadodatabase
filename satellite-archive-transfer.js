import {getImageImport} from './image-import-bridge.js';
import {captureId,validateImageBytes} from './browser-extension/image-import/common.js';

export async function loadArchiveGraphic({loadImage,applyStorm,say,search=location.search,read=getImageImport}) {
  const value=new URLSearchParams(search).get('archiveImage');
  if(!value)return false;
  try {
    const record=await read(captureId(value));
    if(!record?.archive||!(record.blob instanceof Blob))throw Error('This satellite preview has expired. Return to Satellite Archive and fetch it again.');
    validateImageBytes(new Uint8Array(await record.blob.arrayBuffer()),record.blob.type);
    const loaded=await loadImage(record.blob,record.name,{onLoaded:()=>{if(record.archive.storm)applyStorm(record.archive.storm);}});
    if(!loaded)return false;
    say('Satellite image opened. Check the storm details, then download your graphic.');return true;
  }catch(error){say(error.message||'The satellite image could not be opened. Download it from Satellite Archive and choose the file here.',true);return false;}
}
