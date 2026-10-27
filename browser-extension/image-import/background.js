chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'send-image',title:'Send image to Tornado Database',contexts:['image']}));
});
chrome.contextMenus.onClicked.addListener(async info=>{
  if(info.menuItemId !== 'send-image' || !info.srcUrl)return;
  const id = crypto.randomUUID(), key = 'capture:'+id;
  const stored = await chrome.storage.session.get(null);
  const expired = Object.entries(stored).filter(([name,value])=>name.startsWith('capture:') && Date.now()-value.createdAt > 30*60*1000).map(([name])=>name);
  if(expired.length)await chrome.storage.session.remove(expired);
  await chrome.storage.session.set({[key]:{imageUrl:info.srcUrl,pageUrl:info.pageUrl || '',createdAt:Date.now()}});
  await chrome.tabs.create({url:chrome.runtime.getURL('send.html')+'#'+id});
});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('send.html')}));
