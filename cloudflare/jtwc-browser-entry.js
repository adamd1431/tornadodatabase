import {getDocument,GlobalWorkerOptions} from '../server-vendor/pdfjs-4.8.69/pdf.mjs';
import {pdfTextLines,extractJtwcPressure,jtwcReportUrl} from '../jtwc-report-model.js';
GlobalWorkerOptions.workerSrc='/server-vendor/pdfjs-4.8.69/pdf.worker.mjs';
self.onmessage=async event=>{
  try{
    const {storm,years}=event.data;
    for(const year of years){
      const response=await fetch('/api/jtwc-report?'+new URLSearchParams({sid:storm.id,year,mode:'report'}));
      if(response.status===404)continue;
      if(!response.ok)throw Error('The JTWC annual report is temporarily unavailable.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>80000000||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('JTWC did not return a readable report.');
      const doc=await getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,verbosity:0}).promise;
      let result;
      try{
        if(doc.numPages>1200)throw Error('The report exceeds the page limit.');
        const pages=[];
        for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();pages.push({text:content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join(''),lines:pdfTextLines(content.items)});page.cleanup();}
        result=extractJtwcPressure(pages,storm,year);
      }finally{await doc.destroy();}
      if(result){self.postMessage({result});return;}
    }
    self.postMessage({result:{sid:storm.id,status:'not-found',message:'No unambiguous JTWC annual-report pressure could be extracted. Enter a verified pressure manually.',sourceUrl:jtwcReportUrl(storm.season)}});
  }catch(error){self.postMessage({error:error.message||'The JTWC report could not be checked.'});}
};
