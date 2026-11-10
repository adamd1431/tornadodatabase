import {cycloneActor} from './cyclones.js';
import {IMPORT_KINDS,normalizeSource,safeSourceImage,importedSourcePath,importedSourceUrl,sourceFromImportUrl,sourceCredit} from './ibtracs-media-model.js';
export function mountImportChoices(form,items,actor){
  const host=document.createElement('div');host.className='cyclone-source-media full';
  const heading=document.createElement('h3');heading.textContent='Images to include';host.append(heading);
  const note=document.createElement('p');note.textContent=items.length?(actor.user?'Selected images are added with the cyclone. The Wikipedia picture becomes its thumbnail.'+(actor.isAdmin?'':' Images and thumbnail wait for approval.'):'Sign in to include images. You can still submit the cyclone values as a guest.'):'No matched source images were found. You can still add the cyclone and upload images later.';host.append(note);
  const grid=document.createElement('div');grid.className='source-choice-grid';host.append(grid);
  for(const item of items){const source=normalizeSource(item),label=document.createElement('label'),input=document.createElement('input'),image=document.createElement('img'),caption=document.createElement('span'),credit=document.createElement('a');
    input.type='checkbox';input.name='importSources';input.value=source.kind;input.dataset.importMedia='1';input.checked=!!actor.user;input.disabled=!actor.user;
    image.src=safeSourceImage(item.preview)||source.url;image.alt=IMPORT_KINDS[source.kind].label;image.loading='lazy';image.referrerPolicy='no-referrer';
    caption.textContent=IMPORT_KINDS[source.kind].label;credit.href=source.sourcePage;credit.target='_blank';credit.rel='noopener noreferrer';credit.textContent=sourceCredit(source);
    label.append(input,image,caption);const card=document.createElement('div');card.className='source-choice';card.append(label,credit);grid.append(card);
  }
  if(!actor.user&&items.length){const signIn=document.createElement('a');signIn.href='login.html?redirect='+encodeURIComponent(location.pathname+location.search);signIn.textContent='Sign in to include images →';host.append(signIn);}
  form.querySelector('fieldset').append(host);
}
export const selectedImportSources=(form,items)=>{const selected=new Set([...form.querySelectorAll('[data-import-media]:checked')].map(el=>el.value));return items.filter(item=>selected.has(item.kind));};
async function mediaId(path){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path)));bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;const s=[...bytes.slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export async function setImportedCycloneCover(client,row){
  const source=sourceFromImportUrl(row?.file_url);if(row?.status!=='approved'||row.category!=='photos'||source?.kind!=='photo'||source.cycloneId!==row.cyclone_id)return false;
  const {data,error}=await client.from('tropical_cyclones').update({cover_image:row.file_url}).eq('id',row.cyclone_id).is('cover_image',null).select('id,cover_image');if(error)throw error;return Array.isArray(data)&&data.some(r=>r.cover_image===row.file_url);
}
export async function importCycloneSources(client,cycloneId,items,{read=fetch,getActor=cycloneActor}={}){
  if(!items.length)return {count:0};const actor=await getActor(client);if(!actor.user)throw Object.assign(Error('Sign in again, then retry importing the images. The cyclone is already saved.'),{code:'CYCLONE_MEDIA_IMPORT'});
  const sources=items.map(normalizeSource),results=await Promise.allSettled(sources.map(async source=>{
    const path=importedSourcePath(actor.user.id,cycloneId,source),id=await mediaId(path),file_url=importedSourceUrl(path);
    const existing=await client.from('cyclone_uploads').select('*').eq('id',id).maybeSingle();if(existing.error)throw existing.error;
    let row=existing.data;if(row&&(row.cyclone_id!==cycloneId||row.file_url!==file_url||row.status==='rejected'))throw Error('An earlier image import needs review.');
    if(!row){
      const available=await read(file_url,{method:'HEAD'});if(!available.ok||!/^image\//i.test(available.headers.get('content-type')||''))throw Error('Source image is temporarily unavailable.');
      row={id,cyclone_id:cycloneId,user_id:actor.user.id,uploaded_by:actor.name,file_url,storage_path:path,filename:source.title,mime_type:available.headers.get('content-type').split(';')[0],category:IMPORT_KINDS[source.kind].category,status:actor.isAdmin?'approved':'pending'};
      const saved=await client.from('cyclone_uploads').insert(row).select('*').single();if(saved.error){if(saved.error.code!=='23505')throw saved.error;const retry=await client.from('cyclone_uploads').select('*').eq('id',id).maybeSingle();if(retry.error||retry.data?.file_url!==file_url)throw saved.error;row=retry.data;}else{if(!saved.data?.id)throw Error('The image import was not confirmed.');row=saved.data;}
    }
    if(actor.isAdmin)await setImportedCycloneCover(client,row);return row;
  }));
  const failed=results.flatMap((r,i)=>r.status==='rejected'?[IMPORT_KINDS[sources[i].kind].label]:[]);if(failed.length)throw Object.assign(Error('Cyclone saved. Could not finish: '+failed.join(', ')+'. Retry images to finish; completed images will not be duplicated.'),{code:'CYCLONE_MEDIA_IMPORT'});
  return {count:results.length,pending:!actor.isAdmin};
}
