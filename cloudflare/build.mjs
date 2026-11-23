import {readFile,writeFile,mkdir,copyFile,stat,open} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {build} from 'esbuild';

const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'..'),output=join(directory,'dist');
const directories=new Set(['assets','design-symbols','forecast-study','ibtracs-data','intensity-data','media-archive','motis-data','public-data','satellite-tracks','server-vendor','browser-extension','.codex-fonts']);
const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const assets=tracked.filter(file=>file.includes('/')?directories.has(file.split('/')[0]):/\.(?:html|css|js|png|jpe?g|gif|webp|svg|ico|json|woff2?|ttf)$/i.test(file));
if(assets.length>19990)throw Error('The static site exceeds the free Pages file limit.');
await mkdir(output,{recursive:true});
let copied=0,bytes=0;const largeAssets={};
for(const file of assets){
  const source=join(root,file),target=join(output,file),info=await stat(source);
  if(info.size>25*1024*1024){
    if(!/^media-archive\/[a-f0-9]{64}\.(?:webp|gif|png|jpe?g)$/.test(file))throw Error(`Asset exceeds the free Pages per-file limit: ${file}`);
    const chunkSize=8*1024*1024,chunks=[],handle=await open(source,'r');
    try{for(let position=0;position<info.size;position+=chunkSize){const buffer=Buffer.alloc(Math.min(chunkSize,info.size-position));await handle.read(buffer,0,buffer.length,position);const chunk=`/__large_media__/${file.split('/').pop()}/${chunks.length}`;await mkdir(dirname(join(output,chunk)),{recursive:true});await writeFile(join(output,chunk),buffer);chunks.push(chunk);}}finally{await handle.close();}
    largeAssets['/'+file]={size:info.size,chunkSize,chunks,mime:file.endsWith('.webp')?'image/webp':file.endsWith('.gif')?'image/gif':file.endsWith('.png')?'image/png':'image/jpeg',etag:'"'+file.split('/').pop()+'"'};
  }else{
    await mkdir(dirname(target),{recursive:true});const existing=await stat(target).catch(()=>null);
    if(!existing||existing.size!==info.size||existing.mtimeMs<info.mtimeMs){
      for(let attempt=0;;attempt++){try{await copyFile(source,target);break;}catch(error){if(attempt>=3)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
    }
  }
  copied++;bytes+=info.size;
}
await writeFile(join(output,'_routes.json'),JSON.stringify({version:1,include:['/api/*','/media/*','/storage/v1/object/public/cyclone-uploads/*',...Object.keys(largeAssets)],exclude:[]},null,2));
// Proxy to the clean asset URL. A .html target triggers Pages' canonical
// redirect, replacing the requested named route and losing its storm key.
await writeFile(join(output,'_redirects'),'/tornado.html/* /tornado 200\n/outbreak.html/* /outbreak 200\n/tropical-cyclone.html/* /tropical-cyclone 200\n/tropical-cyclone/* /tropical-cyclone 200\n');
await writeFile(join(output,'_headers'),'/media-archive/*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: *\n/public-data/*\n  Cache-Control: public, max-age=60, must-revalidate\n/ibtracs-data/*\n  Cache-Control: public, max-age=3600, must-revalidate\n/motis-data/*\n  Cache-Control: public, max-age=3600, must-revalidate\n/server-vendor/*\n  Cache-Control: public, max-age=86400\n');
await build({entryPoints:[join(directory,'worker.js')],outfile:join(output,'_worker.js'),bundle:true,format:'esm',platform:'neutral',target:'es2022',minify:true,external:['node:*'],define:{'process.env.NODE_ENV':'"production"','__LARGE_ASSETS__':JSON.stringify(largeAssets)}});
for(const name of ['pressure','jtwc'])await build({entryPoints:[join(directory,`${name}-browser-entry.js`)],outfile:join(output,`${name}-browser-worker.js`),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'browser-pdf',setup(builder){builder.onResolve({filter:/server-vendor\/pdfjs-4\.8\.69\/pdf\.mjs$/},()=>({path:'/server-vendor/pdfjs-4.8.69/pdf.mjs',external:true}));}}]});
await writeFile(join(output,'hosting-capabilities.json'),JSON.stringify({host:'cloudflare-pages',browserPressureAnalysis:true,browserJtwcReports:true,reconBatches:true}));
console.log(`Prepared ${copied} public assets (${(bytes/1024/1024).toFixed(1)} MiB); R2 and paid bindings are not configured.`);
