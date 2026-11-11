import {availableAgencies,peakRecords,recordTime} from './ibtracs-model.js';

export function estimatorUrl({sid,at,agency='USA',source='agency'}={}){
  const query=new URLSearchParams();
  if(sid)query.set('sid',sid);
  if(at&&Number.isFinite(Date.parse(at)))query.set('at',at);
  if(agency)query.set('agency',agency);
  if(source==='motis')query.set('source','motis');
  return 'tropical-cyclone-estimator.html'+(query.size?'?'+query:'');
}

export function estimatorSelection(records,col,{agency='USA',at,source='agency'}={}){
  const agencies=availableAgencies(records,col);
  const chosen=agencies.find(a=>a.id===agency)||agencies.find(a=>a.id==='USA')||agencies[0];
  agency=chosen?.id||'WMO';
  const peak=peakRecords(records,col,agency),fallback=peak.wind?.index??peak.pressure?.index??0;
  if(!at)return {agency,index:fallback,source,scanAt:null,notice:''};
  const time=Date.parse(at);
  const exact=records.findIndex(row=>Date.parse(recordTime(row,col))===time);
  if(exact>=0)return {agency,index:exact,source,scanAt:source==='motis'?at:null,notice:''};
  if(source==='motis'&&Number.isFinite(time)){
    const index=records.reduce((best,row,i)=>Math.abs(Date.parse(recordTime(row,col))-time)<Math.abs(Date.parse(recordTime(records[best],col))-time)?i:best,0);
    return {agency,index,source,scanAt:at,notice:''};
  }
  return {agency,index:fallback,source:'agency',scanAt:null,notice:'That observation time is unavailable. The agency peak is selected instead.'};
}
