import {DEFAULT_SITE,IMPORT_TTL,siteUrl,webUrl,captureId,imageName,readImageResponse} from './common.js';
const get = id=>document.getElementById(id);
let sourcePage = '', running = false;
const say = message=>{get('status').textContent = message;};
const originsFor = (site,image)=>[...new Set([new URL(site).origin+'/*',new URL(image).origin+'/*'])];

async function sendImage(requestPermission) {
  if(running)return;
  let destination, image;
  try {destination=siteUrl(get('site').value);image=webUrl(get('image').value).href;}catch(error){say(error.message);return;}
  running=true;get('send').disabled=true;
  try {
    const origins=originsFor(destination,image);
    const granted=requestPermission ? await chrome.permissions.request({origins}) : await chrome.permissions.contains({origins});
    if(!granted)throw new Error('Allow access to the image’s website and your database to continue.');
    await chrome.storage.local.set({databaseSite:destination});
    say('Downloading the selected image…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    let blob;
    try {blob=await readImageResponse(await fetch(image,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'}));}
    finally {clearTimeout(timer);}
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not prepare this image.'));reader.readAsDataURL(blob);});
    const id=crypto.randomUUID();
    say('Opening the database image picker…');
    const tab=await chrome.tabs.getCurrent();
    if(!Number.isInteger(tab?.id))throw new Error('Open the extension’s Send an image page in a browser tab.');
    const response=await chrome.runtime.sendMessage({type:'utwx:continue-image-import',tabId:tab.id,site:destination,
      payload:{id,name:imageName(image,blob.type),mime:blob.type,base64,imageUrl:image,pageUrl:sourcePage}});
    if(response?.ok!==true)throw new Error(response?.error||'The extension could not open the image picker. Reload the extension and try again.');
  } catch(error) {say(error.name==='AbortError'?'The image download timed out. Try again.':error.message+' If the website blocks downloads, save the image and use the normal file upload.');}
  finally {running=false;get('send').disabled=false;}
}
get('sendForm').addEventListener('submit',event=>{event.preventDefault();sendImage(true);});
const saved=await chrome.storage.local.get('databaseSite');get('site').value=saved.databaseSite || DEFAULT_SITE;
if(location.hash.length>1) {
  try {
    const id=captureId(location.hash.slice(1)),key='capture:'+id;
    const record=(await chrome.storage.session.get(key))[key];
    if(!record || Date.now()-record.createdAt > IMPORT_TTL)throw new Error('This image selection expired. Right-click the image again.');
    get('image').value=webUrl(record.imageUrl).href;
    try {sourcePage=webUrl(record.pageUrl).href;}catch{}
    if(await chrome.permissions.contains({origins:originsFor(siteUrl(get('site').value),get('image').value)}))sendImage(false);
  } catch(error) {say(error.message);}
}
