import manifest from '../ibtracs-data/index.json' with {type:'json'};
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {jtwcReportUrl,jtwcReportYears,usesJtwcReports,pdfTextLines,extractJtwcPressure} from '../jtwc-report-model.js';
const reports=new Map(),results=new Map();
export async function readJtwcReport(year,read=fetch){
  const response=await read(jtwcReportUrl(year),{headers:{'User-Agent':'TornadoDatabase/1.0 (https://tornadodatabase.vercel.app; JTWC historical pressure lookup)'},signal:AbortSignal.timeout(30000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error('JTWC report temporarily unavailable.');
  if(+response.headers.get('Content-Length')>80000000)throw Error('JTWC report is too large for this lookup.');
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>80000000||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('JTWC did not return a readable report.');
  const {getDocument,GlobalWorkerOptions}=await import('../server-vendor/pdfjs-4.8.69/pdf.mjs');
  GlobalWorkerOptions.workerSrc=pathToFileURL(join(process.cwd(),'server-vendor/pdfjs-4.8.69/pdf.worker.mjs')).href;
  const doc=await getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,verbosity:0}).promise;
  try{
    if(doc.numPages>1200)throw Error('JTWC report is too large for this lookup.');
    const pages=[];for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();pages.push({text:content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join(''),lines:pdfTextLines(content.items)});page.cleanup();}return pages;
  }finally{await doc.destroy();}
}
async function reportPages(year){
  let entry=reports.get(year);if(!entry||entry.until<Date.now()){
    entry={until:Date.now()+86400000,data:readJtwcReport(year).catch(e=>{reports.delete(year);throw e;})};reports.set(year,entry);if(reports.size>3)reports.delete(reports.keys().next().value);
  }return entry.data;
}
export async function lookupJtwcPressure(storm,{readReport=reportPages}={}){
  if(!usesJtwcReports(storm))return {sid:storm.id,status:'not-applicable',message:'This storm uses NHC records rather than JTWC annual reports.'};
  for(const year of jtwcReportYears(storm)){
    const pages=await readReport(year);if(!pages)continue;const result=extractJtwcPressure(pages,storm,year);if(result)return result;
  }
  return {sid:storm.id,status:'not-found',message:'No unambiguous JTWC annual-report pressure could be extracted. Enter a verified pressure manually.',sourceUrl:jtwcReportUrl(storm.season)};
}
export default {async fetch(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed.',{status:405});
  const sid=new URL(request.url).searchParams.get('sid'),storm=manifest.storms.find(s=>s.id===sid);
  if(!storm)return Response.json({error:'Cyclone not found.'},{status:404,headers:{'Cache-Control':'no-store'}});
  try{
    let entry=results.get(sid);if(!entry||entry.until<Date.now()){entry={until:Date.now()+86400000,data:lookupJtwcPressure(storm).catch(e=>{results.delete(sid);throw e;})};results.set(sid,entry);if(results.size>200)results.delete(results.keys().next().value);}
    const result=await entry.data;return new Response(request.method==='HEAD'?null:JSON.stringify(result),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=86400, s-maxage=604800','X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({sid,status:'unavailable',message:'JTWC annual reports are temporarily unavailable. You can still enter a verified pressure manually.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}};
