// Only approved, already-public records are included in these saved copies.
// Authentication, private data and every write always use the real backend.
let recoveryUntil = 0;
let recoveryDate = '';
const PRIVATE_FIELDS = new Set(['user_id','created_by','submitted_by','pending_description','repeat_scan','repeat_reason','upload_fingerprint','image_hash','original_file_url','original_file_name','original_file_size']);
const TABLES = { tornadoes:'tornadoes', tropical_cyclones:'cyclones', outbreaks:'outbreaks', site_settings:'site-settings', uploads:'uploads', cyclone_uploads:'cyclone_uploads' };

export function isProjectRestricted(error) {
  return Number(error?.status) === 402 || /exceed_egress_quota|project is restricted|services? (?:are |is )?restricted/i.test(String(error?.message || ''));
}

export function notePublicRecovery(generatedAt) {
  if (Number.isFinite(Date.parse(generatedAt))) recoveryDate = generatedAt;
  if (!globalThis.document?.body || document.getElementById('publicRecoveryNotice')) return;
  const notice=document.createElement('div');notice.id='publicRecoveryNotice';notice.setAttribute('role','status');
  notice.style.cssText='padding:12px 20px;background:#252013;color:#f3dfad;border-bottom:1px solid #69572e;font:500 13px/1.6 Inter,Arial,sans-serif;text-align:center;';
  const date=recoveryDate?` · Saved ${new Date(recoveryDate).toLocaleDateString()}`:'';
  notice.textContent=`Saved public copy${date}. Refresh to check for live updates.`;
  document.body.prepend(notice);
}

function predicate(value, condition) {
  if(condition.startsWith('not.'))return !predicate(value,condition.slice(4));
  const point=condition.indexOf('.'),op=condition.slice(0,point),wanted=condition.slice(point+1);
  if(point<0)throw Error('Unsupported filter');
  if(op==='is')return wanted==='null'?value==null:wanted==='true'?value===true:wanted==='false'?value===false:false;
  if(op==='in'){
    if(!/^\(.*\)$/.test(wanted))throw Error('Unsupported filter');
    return wanted.slice(1,-1).split(',').map(item=>item.replace(/^"|"$/g,'')).includes(String(value));
  }
  if(op==='eq')return value!=null&&String(value)===wanted;
  if(op==='neq')return value!=null&&String(value)!==wanted;
  if(['gt','gte','lt','lte'].includes(op)){
    if(value==null)return false;
    const compared=typeof value==='number'?Number(wanted):wanted;
    return op==='gt'?value>compared:op==='gte'?value>=compared:op==='lt'?value<compared:value<=compared;
  }
  if(op==='like'||op==='ilike'){
    const escaped=wanted.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');
    return new RegExp('^'+escaped+'$',op==='ilike'?'i':'').test(String(value??''));
  }
  throw Error('Unsupported filter');
}

export function queryPublicRecovery(rows, params, headers=new Headers()) {
  const filters=[...params].filter(([key])=>!['select','order','limit','offset'].includes(key));
  if(filters.some(([key])=>PRIVATE_FIELDS.has(key)||!/^\w+$/.test(key)))return null;
  // Never substitute a saved public list for a private review queue.
  const selection=(params.get('select')||'*').split(',');
  if(selection.some(field=>field!=='*'&&field!=='cyclone_uploads(count)'&&(!/^\w+$/.test(field)||PRIVATE_FIELDS.has(field))))return null;
  try {
    if(filters.some(([key,value])=>key==='status'&&!predicate('approved',value)))return null;
    let result=rows.filter(row=>filters.every(([key,condition])=>predicate(row[key],condition)));
    const total=result.length;
    const order=(params.get('order')||'').split(',').filter(Boolean).map(value=>value.split('.'));
    result=[...result].sort((a,b)=>{
      for(const [field,direction='asc',nulls] of order){
        if(!/^\w+$/.test(field)||PRIVATE_FIELDS.has(field))throw Error('Unsupported order');
        const av=a[field],bv=b[field];if(av===bv)continue;
        if(av==null||bv==null){const first=nulls==='nullsfirst'||(!nulls&&direction==='desc');return av==null?(first?-1:1):(first?1:-1);}
        const compared=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv));
        if(compared)return direction==='desc'?-compared:compared;
      }return 0;
    });
    const range=headers.get('range')?.match(/^(\d+)-(\d+)$/);
    const offset=Number(params.get('offset')??range?.[1]??0),limit=Number(params.get('limit')??(range?Number(range[2])-Number(range[1])+1:1000));
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<0||limit>100000)return null;
    result=result.slice(offset,offset+limit).map(row=>{
      const value=selection.includes('*')?Object.fromEntries(Object.entries(row).filter(([key])=>!PRIVATE_FIELDS.has(key))):{};
      for(const field of selection){
        if(field==='cyclone_uploads(count)')value.cyclone_uploads=[{count:Number(row.upload_count||0)}];
        else if(field!=='*')value[field]=row[field]??null;
      }return value;
    });
    return {rows:result,total,offset};
  }catch{return null;}
}

export function createPublicRecoveryFetch(network, projectUrl, {read=globalThis.fetch?.bind(globalThis),base=globalThis.location?.href,onRecovery=notePublicRecovery}={}) {
  const origin=new URL(projectUrl).origin, cached=new Map();
  const load=async path=>{
    if(!cached.has(path))cached.set(path,(async()=>{const response=await read(path,{credentials:'omit'});if(!response.ok)throw Error('Saved copy unavailable');return response.json();})().catch(error=>{cached.delete(path);throw error;}));
    return cached.get(path);
  };
  return async (input,init={})=>{
    const request=typeof Request!=='undefined'&&input instanceof Request?input:null;
    const method=String(init?.method||request?.method||'GET').toUpperCase();
    let url;try{url=new URL(request?request.url:String(input));}catch{return network(input,init);}
    const table=url.origin===origin?url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]:null;
    const supported=base&&['GET','HEAD'].includes(method)&&Object.hasOwn(TABLES,table);
    let response;
    if(!supported||recoveryUntil<=Date.now()){
      response=await network(input,init);
      if(url.origin===origin&&response.status===402)recoveryUntil=Date.now()+5*60*1000;
      if(!supported||response.status!==402)return response;
    }
    if(!supported)return response;
    try {
      let body,rows;
      if(table==='uploads'||table==='cyclone_uploads'){
        const parentField=table==='uploads'?'tornado_id':'cyclone_id',parent=url.searchParams.get(parentField)?.match(/^eq\.([a-zA-Z0-9_-]{1,80})$/)?.[1];
        if(!parent)return response||network(input,init);
        body=await load('/public-data/galleries/'+(table==='uploads'?'tornado':'cyclone')+'/'+parent+'.json');
        if(body.resource!==table||body.parentId!==parent||!Array.isArray(body.rows))throw Error('Invalid saved gallery');
        rows=body.rows;
      }else{
        body=await load('/public-data/catalogs.json');rows=body.resources?.[TABLES[table]]?.rows;
      }
      if(!Array.isArray(rows)||rows.some(row=>table==='site_settings'?!['top100_public_visible','top100_wind_estimates','site_design'].includes(row.key):row.status!=='approved'))throw Error('Invalid public copy');
      const headers=new Headers(request?.headers);new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));
      const result=queryPublicRecovery(rows,url.searchParams,headers);
      if(!result)return response||network(input,init);
      const single=headers.get('accept')?.includes('application/vnd.pgrst.object+json');
      if(single&&result.rows.length!==1)return new Response(JSON.stringify({code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:`The result contains ${result.rows.length} rows`}),{status:406,headers:{'Content-Type':'application/json'}});
      onRecovery(body.generatedAt);
      const range=result.rows.length?`${result.offset}-${result.offset+result.rows.length-1}/${result.total}`:'*/'+result.total;
      return new Response(method==='HEAD'?null:JSON.stringify(single?result.rows[0]:result.rows),{headers:{'Content-Type':'application/json','Content-Range':range,'X-Public-Recovery':'1','Cache-Control':'no-store'}});
    }catch{return response||network(input,init);}
  };
}
