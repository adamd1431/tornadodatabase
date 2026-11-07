import {deliverImage} from './delivery.js';
import {siteUrl,webUrl,captureId,imageName,IMPORT_TYPES,MAX_IMAGE_BYTES} from './common.js';

function waitForTab(api,id,previousUrl) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      api.tabs.onUpdated.removeListener(updated);api.tabs.onRemoved.removeListener(removed);
      error?reject(error):resolve();
    };
    const updated=(tabId,change)=>{if(tabId===id&&change.status==='complete')finish();};
    const removed=tabId=>{if(tabId===id)finish(new Error('The database tab was closed.'));};
    const timer=setTimeout(()=>finish(new Error('The database page took too long to load. Go back and try again.')),30000);
    api.tabs.onUpdated.addListener(updated);api.tabs.onRemoved.addListener(removed);
    api.tabs.get(id).then(tab=>{if(tab.status==='complete'&&tab.url!==previousUrl)finish();},finish);
  });
}

// Prepare in the worker before acknowledging the sender. The worker, rather than
// the outgoing extension document, retains the image while the same tab navigates.
export async function prepareCurrentTabImport(api,message,sender) {
  const sendPage=api.runtime.getURL('send.html');
  const isSendPage=value=>{try{const url=new URL(value);url.hash='';return url.href===sendPage;}catch{return false;}};
  if(sender?.id!==api.runtime.id||!isSendPage(sender.url)||!Number.isInteger(message.tabId)||message.tabId<0
    ||sender.tab?.id!=null&&sender.tab.id!==message.tabId)throw new Error('Continue from the extension’s Send an image page.');
  const previous=await api.tabs.get(message.tabId);
  if(!isSendPage(previous.url))throw new Error('The image sender tab has changed. Right-click the image again.');
  const input=message.payload||{},mime=input.mime,image=webUrl(input.imageUrl).href;
  if(!IMPORT_TYPES[mime]||typeof input.base64!=='string'||!input.base64.length||input.base64.length>Math.ceil(MAX_IMAGE_BYTES/3)*4
    ||input.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw new Error('The image transfer is invalid. Send the image again.');
  const payload={id:captureId(input.id),name:imageName(image,mime),mime,base64:input.base64,imageUrl:image,pageUrl:input.pageUrl?webUrl(input.pageUrl).href:''};
  const url=new URL('image-import.html',siteUrl(message.site));url.hash='capture='+payload.id;
  const origins=[...new Set([url.origin+'/*',new URL(image).origin+'/*'])];
  if(!await api.permissions.contains({origins}))throw new Error('Allow access to the image’s website and your database to continue.');
  const matches=value=>{try{const current=new URL(value);return current.origin===url.origin&&current.pathname===url.pathname&&new URLSearchParams(current.hash.slice(1)).get('capture')===payload.id;}catch{return false;}};
  return async()=>{
    try {
      const outgoing=await api.tabs.get(message.tabId);
      if(outgoing.url!==previous.url)throw new Error('The image sender tab has changed. Right-click the image again.');
      await api.tabs.update(message.tabId,{url:url.href});
      await waitForTab(api,message.tabId,previous.url);
      const current=await api.tabs.get(message.tabId);
      if(!matches(current.url))throw new Error('The database redirected away from its image picker. Go back and check the website address.');
      const delivered=await api.scripting.executeScript({target:{tabId:message.tabId},func:deliverImage,args:[payload]});
      if(delivered[0]?.result!==true)throw new Error('The database did not confirm receiving the image.');
    } catch(error) {
      const current=await api.tabs.get(message.tabId).catch(()=>null);
      if(current&&matches(current.url))await api.scripting.executeScript({target:{tabId:message.tabId},func:message=>{
        const status=document.getElementById('imageImportStatus');
        if(status)status.textContent=message+' Go back to retry, or choose a saved file instead.';
      },args:[error.message]}).catch(()=>{});
      throw error;
    }
  };
}
