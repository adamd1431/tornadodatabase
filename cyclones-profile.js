import { cycloneUrl, escapeCycloneHtml as esc } from './cyclones.js';
import { cleanupCycloneFiles } from './owner-deletion.js';
let version = 0;
export async function loadCycloneContributions(client, target, userId, publicView = false) {
  const run=++version;
  target.hidden=!userId;
  if(!userId)return;
  try {
    let records=client.from('tropical_cyclones').select('id,name,year,status,created_at').eq('created_by',userId).order('created_at',{ascending:false}).limit(24);
    let media=client.from('cyclone_uploads').select('*,tropical_cyclones(id,name,status)').eq('user_id',userId).order('created_at',{ascending:false}).limit(24);
    if(publicView){records=records.eq('status','approved');media=media.eq('status','approved');}
    const [r,u]=await Promise.all([records,media]);
    if(run!==version)return;
    if(r.error||u.error){target.hidden=true;return;}
    const uploads=(u.data||[]).filter(row=>!publicView||row.tropical_cyclones?.status==='approved');
    target.innerHTML=`<div class="card-title">Tropical cyclone contributions</div><div class="activity-list">${(r.data||[]).map(row=>`<a class="activity-item" href="${esc(cycloneUrl(row))}"><span>${esc(row.name)} · ${esc(row.year)}</span><span>${esc(row.status)}</span></a>`).join('') || '<div class="empty-note">No tropical cyclone submissions yet.</div>'}${uploads.map(row=>`<div class="activity-item"><a class="cyclone-detail-link" href="${esc(cycloneUrl({id:row.cyclone_id}))}">${esc(row.tropical_cyclones?.name || 'Tropical cyclone')} · ${esc(row.filename)}</a><span>${esc(row.status)}</span>${!publicView&&row.status==='pending' ? `<button class="btn btn-danger" type="button" data-cancel-cyclone-upload="${esc(row.id)}">Cancel</button>` : ''}</div>`).join('')}</div><p class="cyclone-status" role="status"></p>`;
    target.onclick=async event=>{
      const button=event.target.closest('[data-cancel-cyclone-upload]');
      if(!button||publicView||!confirm('Cancel this pending cyclone upload?'))return;
      const row=uploads.find(item=>item.id===button.dataset.cancelCycloneUpload);if(!row)return;
      button.disabled=true;
      try {
        const result=await client.from('cyclone_uploads').delete().eq('id',row.id).eq('user_id',userId).eq('status','pending').select('id');
        if(result.error)throw result.error;
        if(!result.data?.length)throw new Error('The upload was already reviewed. Refresh to see its status.');
        await cleanupCycloneFiles(client,[row.storage_path]);
        await loadCycloneContributions(client,target,userId,publicView);
      }catch(error){target.querySelector('[role=status]').textContent=error.message || 'Could not cancel this upload.';button.disabled=false;}
    };
  }catch{if(run===version)target.hidden=true;}
}
