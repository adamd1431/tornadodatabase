import { cycloneActor, escapeCycloneHtml as esc } from './cyclones.js';

function number(value,min,max,fallback) {
  if(value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max,Math.max(min,parsed)) : fallback;
}

export function cycloneCropSettings(row = {}, mode = 'thumbnail') {
  const prefix = mode === 'cover' ? 'cover' : 'thumbnail';
  const position = String(row[prefix+'_position'] || row.cover_position || '50% 50%').match(/^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
  return {fit:row[prefix+'_fit'] === 'contain' ? 'contain' : 'cover',zoom:number(row[prefix+'_zoom'],.25,2.5,1),
    x:number(position?.[1],0,100,50),y:number(position?.[2],0,100,50)};
}

export function cycloneCropUpdates(settings, mode = 'thumbnail', url) {
  const prefix = mode === 'cover' ? 'cover' : 'thumbnail';
  const result = {[prefix+'_fit']:settings.fit === 'contain' ? 'contain' : 'cover',
    [prefix+'_zoom']:Number(number(settings.zoom,.25,2.5,1).toFixed(2)),
    [prefix+'_position']:`${Number(number(settings.x,0,100,50).toFixed(1))}% ${Number(number(settings.y,0,100,50).toFixed(1))}%`};
  if(mode === 'cover' && url) result.cover_image = url;
  return result;
}

export function cycloneCropStyle(row, mode = 'thumbnail') {
  const s = cycloneCropSettings(row,mode);
  return `object-fit:${s.fit};object-position:${s.x}% ${s.y}%;transform:scale(${s.zoom});transform-origin:${s.x}% ${s.y}%;`;
}

export async function saveCycloneCrop(client, row, settings, mode, url) {
  const actor = await cycloneActor(client);
  if(!actor.isAdmin) throw new Error('Only admins can adjust cyclone thumbnails.');
  const updates = cycloneCropUpdates(settings,mode,url);
  const {data,error} = await client.from('tropical_cyclones').update(updates).eq('id',row.id).select('*').single();
  if(error) throw error;
  if(!data?.id || data.id !== row.id) throw new Error('The server did not confirm this thumbnail change.');
  return data;
}

let active = null;
export function openCycloneCropper(client,row,{mode='thumbnail',source=null,url=row.cover_image} = {}) {
  if(!url) return Promise.resolve(null);
  if(active) return active;
  const dialog = document.createElement('dialog');
  dialog.className = 'cyclone-dialog cyclone-crop-dialog'; dialog.setAttribute('aria-labelledby','cycloneCropTitle');
  const shape = source?.getBoundingClientRect?.();
  const width = shape?.width > 0 ? shape.width : mode === 'cover' ? 1180 : 252;
  const height = shape?.height > 0 ? shape.height : mode === 'cover' ? 380 : 126;
  const initial = url === row.cover_image ? cycloneCropSettings(row,mode) : {fit:'cover',zoom:1,x:50,y:50};
  dialog.innerHTML = `<form class="cyclone-modal"><h2 id="cycloneCropTitle">${mode==='cover'?'Choose cover crop':'Adjust thumbnail'}</h2><p class="cyclone-estimate-help">${esc(row.name)} · Drag the image or use the controls.</p><div class="cyclone-crop-preview ${mode==='thumbnail'?'is-thumbnail':''}" style="aspect-ratio:${width}/${height}"><img src="${esc(url)}" alt="${esc(row.name)} crop preview" draggable="false"></div><fieldset class="cyclone-crop-controls"><label for="cycloneCropFit">Fit</label><select id="cycloneCropFit" name="fit"><option value="cover">Snug cover</option><option value="contain">Full image</option></select>${[['zoom','Zoom','.25','2.5','.01'],['x','Horizontal','0','100','.5'],['y','Vertical','0','100','.5']].map(([name,label,min,max,step])=>`<label for="cycloneCrop-${name}">${label}</label><div class="cyclone-crop-slider"><input id="cycloneCrop-${name}" name="${name}" type="range" min="${min}" max="${max}" step="${step}"><output for="cycloneCrop-${name}" data-output="${name}"></output></div>`).join('')}</fieldset><p class="cyclone-status" role="status" aria-live="polite"></p><div class="cyclone-actions"><button class="btn" type="button" data-reset>Reset</button><button class="btn" type="button" data-cancel>Cancel</button><button class="btn btn-primary" type="submit">${mode==='cover'?'Save cover':'Save thumbnail'}</button></div></form>`;
  const form = dialog.querySelector('form'), preview = dialog.querySelector('.cyclone-crop-preview'), image = preview.querySelector('img');
  const status = dialog.querySelector('[role=status]');
  let busy = false, drag = null, result = null;
  const input = name => form.elements.namedItem(name);
  const read = () => ({fit:input('fit').value,zoom:Number(input('zoom').value),x:Number(input('x').value),y:Number(input('y').value)});
  function sync() {
    const s = read();
    image.style.cssText = cycloneCropStyle(cycloneCropUpdates(s,mode),mode);
    for(const name of ['zoom','x','y']) dialog.querySelector(`[data-output="${name}"]`).textContent = name === 'zoom' ? s[name].toFixed(2)+'x' : Math.round(s[name])+'%';
  }
  function set(settings) {for(const key of ['fit','zoom','x','y']) input(key).value = settings[key];sync();}
  set(initial);
  form.addEventListener('input',sync);
  dialog.querySelector('[data-reset]').addEventListener('click',()=>set({fit:'cover',zoom:1,x:50,y:50}));
  dialog.querySelector('[data-cancel]').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('click',event=>{if(event.target===dialog && !busy)dialog.close();});
  preview.addEventListener('pointerdown',event=>{
    if(busy || (event.button != null && event.button !== 0)) return;
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,settings:read()};
    preview.setPointerCapture(event.pointerId); preview.classList.add('is-dragging');event.preventDefault();
  });
  preview.addEventListener('pointermove',event=>{
    if(!drag || drag.id!==event.pointerId || busy) return;
    const rect=preview.getBoundingClientRect(),ease=Math.max(1,drag.settings.zoom);
    input('x').value=number(drag.settings.x-(event.clientX-drag.x)/Math.max(1,rect.width)*100/ease,0,100,50);
    input('y').value=number(drag.settings.y-(event.clientY-drag.y)/Math.max(1,rect.height)*100/ease,0,100,50);sync();
  });
  const finish=()=>{drag=null;preview.classList.remove('is-dragging');};
  ['pointerup','pointercancel','lostpointercapture'].forEach(name=>preview.addEventListener(name,finish));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    busy=true;const settings=read();status.textContent='Saving…';
    dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    try {result=await saveCycloneCrop(client,row,settings,mode,url);dialog.close();}
    catch(error){status.textContent=['42703','PGRST204'].includes(String(error?.code))?'Run supabase-cyclone-media-tools.sql in Supabase to enable crop settings, then try again.':error.message || 'Could not save this crop. Please try again.';}
    finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
  });
  const focusBefore = document.activeElement;
  active = new Promise(resolve=>dialog.addEventListener('close',()=>{
    active=null;dialog.remove();if(focusBefore?.isConnected)focusBefore.focus({preventScroll:true});resolve(result);
  },{once:true}));
  document.body.append(dialog);dialog.showModal();
  return active;
}
