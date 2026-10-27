import { WIND_FACTORS } from './wind-pressure-model.js';
import { validateCycloneEstimates, cycloneError, cycloneUrl } from './cyclones.js';
import { bindStormSearchEnter } from './storm-search.js';

const estimateColumns='id,name,year,status,owner_estimated_winds_mph,owner_estimated_pressure_mb';
class EstimateError extends Error {
  constructor(message,field){super(message);this.field=field;this.name='EstimateError';}
}

export async function cycloneEstimateOwner(client) {
  const {data,error}=await client.auth.getUser();
  if(error?.name==='AuthSessionMissingError')return null;
  if(error)throw error;
  if(!data?.user)return null;
  const permission=await client.rpc('utwx_is_owner',{check_user_id:data.user.id});
  if(permission.error)throw permission.error;
  return permission.data===true?data.user:null;
}

export async function loadEstimateCyclones(client) {
  const rows=[];
  for(let from=0;;from+=1000) {
    const {data,error}=await client.from('tropical_cyclones').select(estimateColumns)
      .neq('status','rejected').order('year',{ascending:false}).order('name').order('id').range(from,from+999);
    if(error)throw error;
    rows.push(...(data || []));
    if(!data || data.length<1000)return rows;
  }
}

export function calculatorEstimateValues(result) {
  const row=result?.solutions?.length===1?result.solutions[0]:null;
  if(!row)return null;
  const mph=row.windKnots==null?NaN:row.windKnots*WIND_FACTORS.mph;
  const pressure=row.pressureMb==null?NaN:Number(Number(row.pressureMb).toFixed(2));
  const owner_estimated_winds_mph=Number.isFinite(mph) && mph>=0 && mph<=500?Number(mph.toFixed(1)):null;
  const owner_estimated_pressure_mb=Number.isFinite(pressure) && pressure>0 && pressure<=2000?pressure:null;
  return owner_estimated_winds_mph==null && owner_estimated_pressure_mb==null?null:{owner_estimated_winds_mph,owner_estimated_pressure_mb};
}

export async function saveCalculatorCycloneEstimate(client,id,input) {
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || ''))throw new EstimateError('Choose a tropical cyclone.','estimateCyclone');
  for(const [key,label,field] of [['owner_estimated_winds_mph','a wind estimate','estimateWindMph'],['owner_estimated_pressure_mb','a pressure estimate','estimatePressureMb']]) {
    if(input[key]==null || typeof input[key]==='boolean' || String(input[key]).trim()==='')throw new EstimateError('Enter '+label+' before saving.',field);
  }
  let edits;
  try{edits=validateCycloneEstimates(input);}catch(error){throw new EstimateError(error.message);}
  // Recheck the account on every save. The existing database trigger also
  // enforces owner-only changes; only the two estimate fields are sent.
  if(!await cycloneEstimateOwner(client))throw new EstimateError('Only the owner can send cyclone estimates. Sign in as the owner and try again.');
  const {data,error}=await client.from('tropical_cyclones').update(edits).eq('id',id).select(estimateColumns).single();
  if(error)throw error;
  if(data?.id!==id || Object.entries(edits).some(([key,value])=>data[key]==null || Number(data[key])!==value))throw new EstimateError('The server did not confirm these estimates. Refresh and check the cyclone before trying again.');
  return data;
}

function estimateMessage(error,fallback) {
  if(error instanceof EstimateError)return error.message;
  if(error?.code==='42501')return 'Only the owner can save cyclone estimates. Check that you are signed in as the owner.';
  return cycloneError(error,fallback);
}

export function initCycloneEstimateTransfer({getResult,client:providedClient}={}) {
  const get=id=>document.getElementById(id),panel=get('cycloneEstimateTransfer');
  if(!panel)return {refreshResult(){}};
  const form=get('cycloneEstimateTransferForm'),toggle=get('openCycloneEstimateTransfer'),fields=get('cycloneTransferFields');
  const select=get('estimateCyclone'),search=get('estimateCycloneSearch'),status=get('cycloneTransferStatus');
  const wind=get('estimateWindMph'),pressure=get('estimatePressureMb'),save=get('saveCycloneEstimate'),useResult=get('useCalculatorEstimate'),link=get('savedCycloneLink');
  let client,owner=null,rows=[],loaded=false,busy=false,authRun=0,accountRun=0,listRun=0,draftStarted=false;
  const selected=()=>rows.find(row=>row.id===select.value);
  const setStatus=message=>{status.textContent=message;};
  const showExisting=()=>{
    const row=selected();
    const text=(value,unit,label)=>value==null?label+' not set':String(value)+' '+unit;
    get('cycloneExistingEstimates').textContent=row?'Current owner estimates: '+text(row.owner_estimated_winds_mph,'mph','wind')+' · '+text(row.owner_estimated_pressure_mb,'mb','pressure')+'. Saving replaces both estimates.':'';
  };
  function refreshResult() {
    useResult.disabled=busy || !calculatorEstimateValues(getResult?.());
    save.disabled=busy || !selected();
  }
  function setBusy(value) {
    busy=value;fields.disabled=value;toggle.disabled=value;
    save.textContent=value?'Saving…':'Save owner estimates';refreshResult();
  }
  function renderOptions() {
    const previous=select.value,term=search.value.trim().toLocaleLowerCase();
    const matches=rows.filter(row=>`${row.name} ${row.year}`.toLocaleLowerCase().includes(term));
    const option=document.createElement('option');option.value='';
    option.textContent=matches.length?'Choose a tropical cyclone…':rows.length?'No matching tropical cyclones':'No tropical cyclones available';
    select.replaceChildren(option);
    for(const row of matches) {
      const option=document.createElement('option');option.value=row.id;
      option.textContent=`${row.name} (${row.year})${row.status==='pending'?' · Pending':''}`;
      select.append(option);
    }
    if(matches.some(row=>row.id===previous))select.value=previous;
    get('cyclonePickerCount').textContent=matches.length+' of '+rows.length+' tropical cyclones';
    showExisting();refreshResult();
  }
  function useCalculation() {
    const values=calculatorEstimateValues(getResult?.());
    if(!values)return;
    wind.value=values.owner_estimated_winds_mph??'';pressure.value=values.owner_estimated_pressure_mb??'';
    draftStarted=true;link.hidden=true;
    setStatus('Calculator values filled in. You can edit both estimates before saving.');
  }
  async function loadChoices() {
    if(busy)return;
    const run=++listRun,account=owner?.id;
    busy=true;fields.disabled=true;toggle.disabled=true;setStatus('Loading tropical cyclones…');
    try {
      const result=await loadEstimateCyclones(client);
      if(run!==listRun || owner?.id!==account)return;
      rows=result;loaded=true;renderOptions();setStatus(rows.length?'':'There are no tropical cyclones available yet.');
    }catch(error) {
      if(run!==listRun)return;
      setStatus(estimateMessage(error,'Could not load tropical cyclones. Close and reopen this form to retry.'));
    }finally {
      if(run===listRun){busy=false;fields.disabled=false;toggle.disabled=false;refreshResult();}
    }
  }
  async function refreshAccess() {
    const run=++authRun;
    try {
      const user=await cycloneEstimateOwner(client);
      if(run!==authRun)return;
      if(owner?.id!==user?.id) {
        ++accountRun;++listRun;owner=user;rows=[];loaded=false;busy=false;draftStarted=false;
        form.reset();form.hidden=true;fields.disabled=false;toggle.disabled=false;
        toggle.setAttribute('aria-expanded','false');toggle.textContent='Send to tropical cyclone';
        link.hidden=true;setStatus('');renderOptions();
      }
      owner=user;panel.hidden=!owner;refreshResult();
    }catch(error) {
      if(run!==authRun)return;
      ++accountRun;++listRun;owner=null;busy=false;panel.hidden=true;console.warn('Could not check cyclone estimate access.',error);
    }
  }
  toggle.addEventListener('click',async()=>{
    if(!owner || busy)return;
    form.hidden=!form.hidden;toggle.setAttribute('aria-expanded',String(!form.hidden));
    toggle.textContent=form.hidden?'Send to tropical cyclone':'Hide form';
    if(form.hidden)return;
    if(!draftStarted)useCalculation();
    if(!loaded)await loadChoices();
    if(!form.hidden && owner)search.focus();
  });
  search.addEventListener('input',()=>{renderOptions();link.hidden=true;});
  bindStormSearchEnter(search,select);
  select.addEventListener('change',()=>{showExisting();refreshResult();setStatus('');link.hidden=true;});
  form.addEventListener('input',event=>{draftStarted=true;event.target.removeAttribute('aria-invalid');setStatus('');link.hidden=true;});
  useResult.addEventListener('click',useCalculation);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !owner)return;
    const row=selected();
    if(!row){setStatus('Choose a tropical cyclone.');select.focus();return;}
    const account=owner.id,run=accountRun;
    form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
    setBusy(true);link.hidden=true;setStatus('Saving owner estimates…');
    try {
      const saved=await saveCalculatorCycloneEstimate(client,row.id,{owner_estimated_winds_mph:wind.value,owner_estimated_pressure_mb:pressure.value});
      if(run!==accountRun || owner?.id!==account)return;
      rows=rows.map(item=>item.id===saved.id?{...item,...saved}:item);showExisting();
      setStatus(`Owner estimates saved to ${saved.name} (${saved.year}): ${saved.owner_estimated_winds_mph} mph · ${saved.owner_estimated_pressure_mb} mb.`);
      link.href=cycloneUrl(saved);link.textContent='View '+saved.name+' →';link.hidden=false;
    }catch(error) {
      if(run!==accountRun || owner?.id!==account)return;
      setStatus(estimateMessage(error,'Could not save the owner estimates. Your entries are still here; please try again.'));
      if(error.field){get(error.field)?.setAttribute('aria-invalid','true');}
    }finally {
      if(run===accountRun){setBusy(false);}
    }
  });
  async function start() {
    try {
      client=providedClient || (await import('./supabase.js')).supabase;
      // Run account lookups outside Supabase's auth callback lock.
      client.auth.onAuthStateChange(event=>{
        if(event==='INITIAL_SESSION')return;
        if(event==='SIGNED_OUT'){++accountRun;++listRun;owner=null;panel.hidden=true;}
        setTimeout(()=>{void refreshAccess();},0);
      });
      await refreshAccess();
    }catch(error){console.warn('Cyclone estimate transfer is unavailable.',error);}
  }
  void start();
  return {refreshResult};
}
