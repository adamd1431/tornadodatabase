import { cycloneFields, validateCyclone, cycloneMediaCategoryLabel, cycloneError, cycloneUrl, escapeCycloneHtml as esc } from './cyclones.js';
const tables = ['tropical_cyclones','cyclone_uploads','cyclone_summaries'];
let loadVersion = 0;

export async function pendingCycloneCount(client) {
  const results = await Promise.all(tables.map(table=>client.from(table).select('id',{count:'exact',head:true}).eq('status','pending')));
  if(results.some(result=>result.error)) return null;
  return results.reduce((sum,result)=>sum+(result.count || 0),0);
}

export async function loadCycloneReview(client, panel, options) {
  const version = ++loadVersion;
  panel.innerHTML = '<div class="state-msg">Loading tropical cyclone submissions…</div>';
  try {
    const results = await Promise.all(tables.map(table=>client.from(table).select(table === 'tropical_cyclones' ? '*' : '*,tropical_cyclones(name,year)').eq('status','pending').order('created_at',{ascending:false})));
    if(version !== loadVersion || !options.active()) return;
    const failure = results.find(result=>result.error); if(failure) throw failure.error;
    const records = new Map();
    panel.innerHTML = results.map((result,index)=>{
      const table = tables[index];
      const heading = ['Cyclone submissions','Media uploads','Summary submissions'][index];
      return `<h2 class="cyclone-admin-heading">${heading} · ${result.data.length}</h2>` + (result.data.length ? result.data.map(row=>{
        records.set(row.id,{row,table});
        const name = index === 0 ? row.name : row.tropical_cyclones?.name || 'Tropical cyclone';
        const href = cycloneUrl(index === 0 ? row : {id:row.cyclone_id});
        const form = index === 0 ? `<form class="cyclone-review-fields"><fieldset class="cyclone-fields">${cycloneFields(row,'review-'+row.id)}</fieldset></form>` : index === 2 ? `<form class="cyclone-review-fields"><div class="cyclone-field"><label for="summary-${esc(row.id)}">Summary</label><textarea id="summary-${esc(row.id)}" name="summary_text" required maxlength="20000">${esc(row.summary_text)}</textarea></div></form>` : `<div style="padding:16px 20px"><a href="${esc(row.file_url)}" target="_blank" rel="noopener">${/^image\//.test(row.mime_type) ? `<img src="${esc(row.file_url)}" alt="${esc(row.filename)}" style="max-width:100%;max-height:240px;border-radius:10px" loading="lazy">` : esc(row.filename)}</a><p>${esc(cycloneMediaCategoryLabel(row.category))} · ${esc(row.uploaded_by)}</p></div>`;
        return `<article class="sub-card" data-cyclone-review="${esc(row.id)}"><div class="sub-card-head"><div><div class="sub-card-title">${esc(name)}</div><p class="sub-card-submitter">${esc(row.submitted_by || row.uploaded_by || 'Anonymous')}${row.year ? ' · '+esc(row.year) : ''}</p><a class="btn" href="${esc(href)}" target="_blank" rel="noopener">Review tropical cyclone</a></div><span class="status-chip status-pending">Pending</span></div><div style="padding:0 20px">${form}</div><div class="sub-card-actions"><span role="status" class="cyclone-review-status"></span><div class="action-btns"><button class="btn btn-reject" type="button" data-cyclone-decision="rejected">Reject</button><button class="btn btn-approve" type="button" data-cyclone-decision="approved">Approve</button></div></div></article>`;
      }).join('') : '<div class="state-msg">Nothing waiting for approval.</div>');
    }).join('');
    panel.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));
    panel.onclick = async event=>{
      const button = event.target.closest('[data-cyclone-decision]');
      if(!button || !options.active()) return;
      const card = button.closest('[data-cyclone-review]'), cached = records.get(card.dataset.cycloneReview);
      if(!cached || card.dataset.busy === '1') return;
      const decision = button.dataset.cycloneDecision, form = card.querySelector('form');
      let edits = {};
      if(decision === 'approved' && form) {
        if(!form.reportValidity()) return;
        try {
          const values = Object.fromEntries(new FormData(form));
          edits = cached.table === 'tropical_cyclones' ? validateCyclone(values) : {summary_text:values.summary_text.trim()};
          if(edits.summary_text === '') throw new Error('Enter a summary.');
        } catch(error) { card.querySelector('[role=status]').textContent=error.message; return; }
      }
      card.dataset.busy = '1'; card.querySelectorAll('button,input,textarea').forEach(input=>input.disabled=true);
      try {
        const {data,error} = await client.from(cached.table).update({...edits,status:decision}).eq('id',cached.row.id).eq('status','pending').select('*').single();
        if(error)throw error;
        await options.log?.(`${decision === 'approved' ? 'Approved' : 'Rejected'} tropical cyclone submission`,cached.table,cached.row.id,cached.row.name || cached.row.tropical_cyclones?.name || 'Tropical cyclone',cached.row,data);
        const chip=card.querySelector('.status-chip');chip.textContent=decision === 'approved' ? 'Approved' : 'Rejected';chip.classList.remove('status-pending');
        card.querySelector('[role=status]').textContent='Decision saved.';
        await options.onChanged();
      } catch(error) {
        card.querySelector('[role=status]').textContent=cycloneError(error,'Could not save this decision. Refresh and try again.');
        card.querySelectorAll('button,input,textarea').forEach(input=>input.disabled=false);card.dataset.busy='0';
      }
    };
  } catch(error) {
    if(version !== loadVersion || !options.active()) return;
    panel.innerHTML=`<div class="state-msg">${esc(cycloneError(error,'Could not load tropical cyclone submissions. Please try again.'))}</div>`;
  }
}
