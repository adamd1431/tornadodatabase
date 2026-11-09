import {IMAGE_PRODUCTS} from './live-storms-model.js';
import {drawWindRadii} from './live-storms-radii.js';
import {createForecastView} from './live-storms-forecast.js';
import {createSpectrumPlayer} from './live-storms-spectrum.js';
import {PUBLISHED_PRODUCTS} from './live-storms-published.js';
const get=id=>document.getElementById(id),node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
let imageSequence=0,previewKind='';
let data=null,selected='',ocean=null,structure=null,structurePending=false,pendingPreview='',imageController=null,oceanController=null,structureController=null,feedController=null,refreshing=false,coastlines=null;
let publishedRadiiActive=false,publishedOceanActive=false,publishedTimer=null;
const publishedMode=()=>get('chartProvider').value==='published';
const storm=()=>data?.storms.find(s=>s.id===selected),windUnit=()=>get('windUnit').value;
const unitName=()=>({mph:'mph',kt:'knots',kmh:'km/h'}[windUnit()]),wind=value=>value===null||value===undefined?'—':(value*({mph:1.150779448,kt:1,kmh:1.852}[windUnit()])).toFixed(1);
const time=value=>{const d=new Date(value);return Number.isFinite(+d)?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(d).replace(',','')+' UTC':'Time unavailable';};
const title=value=>String(value||'').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
const coord=(v,axis)=>`${Math.abs(v).toFixed(1)}°${axis==='lat'?(v<0?'S':'N'):(v<0?'W':'E')}`;
function classification(s){if(s.windKt===null)return 'Tropical cyclone';if(s.windKt<34)return 'Tropical depression';if(s.windKt<64)return 'Tropical storm';return s.id.startsWith('WP')?(s.windKt>=130?'Super typhoon':'Typhoon'):s.id.startsWith('SH')||s.id.startsWith('IO')?'Tropical cyclone':'Hurricane';}
function notice(message){get('pageNotice').textContent=message||'';get('pageNotice').hidden=!message;}
function renderList(){
  const list=get('stormList');list.replaceChildren();
  for(const s of data.storms){const b=node('button',undefined,'storm-card');b.type='button';b.setAttribute('aria-pressed',String(s.id===selected));const top=node('div',undefined,'card-top');top.append(node('span',s.designation,'card-designation'),node('span',`${wind(s.windKt)} ${unitName()}`,'card-wind'));const bottom=node('div',undefined,'card-bottom');bottom.append(node('span',s.basin),node('span',s.stale?'Older advisory':s.agency));b.append(top,node('h3',title(s.name)),bottom);b.addEventListener('click',()=>selectStorm(s.id));list.append(b);}
  const picker=get('stormSelect');picker.replaceChildren(...data.storms.map(s=>{const option=node('option',`${title(s.name)} · ${s.designation} · ${s.basin}`);option.value=s.id;return option;}));picker.value=selected;picker.disabled=!data.storms.length;
  if(!data.storms.length){list.append(node('p','No current warnings in the available feeds.','muted'));picker.append(node('option','No current warnings'));}
}
function fact(label,value){const box=node('div');box.append(node('dt',label),node('dd',value));return box;}
function renderInfo(){
  const s=storm();if(!s)return;get('imageProduct').querySelector('[value="spectrum"]').disabled=!publishedMode()&&!s.hasImagery;if(!publishedMode()&&!s.hasImagery&&get('imageProduct').value==='spectrum')get('imageProduct').value='bd';get('stormDesignation').textContent=s.designation;get('stormClass').textContent=classification(s);get('stormName').textContent=title(s.name);get('stormBasin').textContent=s.basin;get('stormAgency').textContent=s.agency+' ADVISORY';get('advisoryTime').textContent=time(s.validAt)+(s.stale?' · Older than 12 hours':'');get('advisoryLink').href=s.sourceUrl;get('summaryForecast').href=s.forecastUrl;get('summaryPosition').textContent=`${coord(s.latitude,'lat')} · ${coord(s.longitude,'lon')}`;
  get('windValue').textContent=wind(s.windKt);get('windUnitLabel').textContent=unitName();get('windSecondary').textContent=s.windKt===null?'Not published':`${windUnit()==='kt'?(s.windKt*1.150779448).toFixed(1)+' mph':s.windKt.toFixed(1)+' knots'} · ${windUnit()==='kmh'?(s.windKt*1.150779448).toFixed(1)+' mph':(s.windKt*1.852).toFixed(1)+' km/h'} · 1-min`;
  const pressure=s.pressureMb??(structure?.pressureMatchesAdvisory&&structure.validAt===s.validAt?structure.pressureMb:null);get('pressureValue').textContent=pressure===null?'—':pressure.toFixed(1);get('pressureNote').textContent=pressure===null?'Not published in available feeds':s.pressureMb===null?'Matching operational ATCF fix':s.agency+' operational estimate';get('intensitySource').textContent=`${s.agency} · Valid ${time(s.validAt)} · One-minute sustained winds`;
  const facts=[['Wind',`${wind(s.windKt)} ${unitName()}`],['Pressure',pressure===null?'Not published':`${pressure.toFixed(1)} mb`],['Gusts',s.gustKt===null?'Not published':`${wind(s.gustKt)} ${unitName()}`],['Position',`${coord(s.latitude,'lat')} · ${coord(s.longitude,'lon')}`],['Motion',s.motionKt===null?'Not published':`${s.motionKt.toFixed(1)} knots${s.motionDegrees===null?'':` · ${s.motionDegrees}°`}`],['Observation time',time(s.validAt)]];get('intensityFacts').replaceChildren(...facts.map(([label,value])=>fact(label,value)));
  get('forecastLink').href=s.forecastUrl;get('forecastBlock').hidden=!s.forecast.length;get('radiiBlock').hidden=!s.radii34;
  if(s.radii34)get('radiiValues').replaceChildren(...Object.entries(s.radii34).map(([direction,value])=>{const box=node('div');box.append(node('span',direction),node('strong',`${value} nmi`));return box;}));
  if(s.forecast.length)renderForecast(s);
  get('rmwValue').textContent=structure?.rmwNmi?.toFixed(1)||'—';get('pociValue').textContent=structure?.pociMb?.toFixed(1)||'—';get('rociValue').textContent=structure?.rociNmi?.toFixed(1)||'—';
}
function renderForecast(s){
  const points=[{hours:0,windKt:s.windKt},...s.forecast],max=Math.max(...points.map(p=>p.windKt),40)+15,end=Math.max(...points.map(p=>p.hours)),x=h=>45+h/end*700,y=w=>180-w/max*145;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 780 215');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${s.agency} forecast wind intensity. Future values are forecasts.`);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
  for(let w=0;w<=max;w+=25){add('line',{x1:45,x2:745,y1:y(w),y2:y(w),stroke:'#253a4d'});add('text',{x:37,y:y(w)+4,'text-anchor':'end',fill:'#829bb5','font-size':11},wind(w));}
  add('path',{d:points.map((p,i)=>`${i?'L':'M'}${x(p.hours)},${y(p.windKt)}`).join(' '),fill:'none',stroke:'#8adbd0','stroke-width':2.5,'stroke-dasharray':'5 4'});
  for(const p of points){add('circle',{cx:x(p.hours),cy:y(p.windKt),r:4,fill:p.hours?'#101b2b':'#8adbd0',stroke:'#8adbd0','stroke-width':2});add('text',{x:x(p.hours),y:204,'text-anchor':'middle',fill:'#829bb5','font-size':11},p.hours?`+${p.hours}h`:'Now');}
  get('forecastChart').replaceChildren(svg);get('forecastTable').replaceChildren(...points.map(p=>{const box=node('div');box.append(node('span',p.hours?`+${p.hours} hours`:'Advisory'),node('strong',`${wind(p.windKt)} ${unitName()}`));return box;}));
}
async function api(params,signal){const r=await fetch('api/live-storms?'+new URLSearchParams(params),{signal});const body=await r.json();if(!r.ok)throw Error(body.message||'This product is unavailable.');return body;}
function configureChartProducts(){
  const picker=get('imageProduct'),previous=picker.value,products=publishedMode()?PUBLISHED_PRODUCTS:IMAGE_PRODUCTS;picker.replaceChildren(...products.map(p=>{const option=node('option',p.name);option.value=p.id;return option;}));picker.value=products.some(p=>p.id===previous)?previous:'spectrum';
  document.body.classList.toggle('scientific-chart-mode',publishedMode());
  get('chartSourceNote').textContent=publishedMode()?'Original CyclonicWx plots retain scan times, axes, legends and credits. Each panel identifies its source; unavailable plots use the local fallback.':'NOAA satellite displays with locally drawn wind radii and JPL MUR sea temperatures.';
}
function resetPublishedPlots(){
  publishedRadiiActive=false;publishedOceanActive=false;clearTimeout(publishedTimer);
  for(const id of ['radiiImage','oceanImage']){const img=get(id);img.onload=null;img.onerror=null;img.hidden=true;img.removeAttribute('src');delete img.dataset.plotKey;}
}
function oceanPresentation(remote=false){
  get('oceanType').textContent=remote?'NOAA Coral Reef Watch · °C':'JPL MUR · Daily analysis · °C';
  get('oceanSource').href=remote?'https://cyclonicwx.com/storms/#'+selected.slice(0,4).toLowerCase():'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html';get('oceanSource').textContent=remote?'Original chart · CyclonicWx ↗':'NOAA CoastWatch / JPL ↗';
  get('oceanProductNote').textContent=remote?'NOAA Coral Reef Watch analysis plotted by CyclonicWx. The analysis date is printed on the chart. The point value above is a separate JPL MUR sample, identified with its own source and time.':'JPL MUR daily analysis; land and missing pixels stay blank. The local regional display samples the 0.01° analysis every 0.5°.';
}
function applyPublishedPlots(result,s){
  for(const [kind,url]of [['radii',result.radii],['ocean',result.ocean]]){
    if(!url)continue;const img=get(kind+'Image'),key=s.id+':'+url+':'+Math.floor(Date.parse(result.checkedAt)/300000);if(img.dataset.plotKey===key)continue;img.dataset.plotKey=key;
    const current=()=>storm()?.id===s.id&&publishedMode()&&img.dataset.plotKey===key;
    img.onload=()=>{if(!current())return;img.hidden=false;get(kind==='radii'?'radiiMap':'oceanMap').hidden=true;get(kind==='radii'?'radiiStatus':'oceanStatus').hidden=true;
      if(kind==='radii'){publishedRadiiActive=true;get('radiiTime').textContent='Published chart · valid time printed on image';get('radiiCaption').textContent='Wind extents · CyclonicWx';get('radiiSource').href=result.sourceUrl;get('radiiSource').textContent='Original chart ↗';get('radiiSource').hidden=false;}
      else{publishedOceanActive=true;oceanPresentation(true);get('oceanCaption').textContent='Analysis date printed on the original chart';}
      if(get('chartDialog').open&&previewKind===kind)openPreview(kind);
    };
    img.onerror=()=>{if(!current())return;delete img.dataset.plotKey;img.hidden=true;if(kind==='radii'){publishedRadiiActive=false;renderRadii();}else{publishedOceanActive=false;oceanPresentation();drawOcean();}get('chartSourceNote').textContent='A CyclonicWx plot could not load. Its panel shows the identified local fallback; other available charts remain unchanged.';};
    img.alt=`${title(s.name)}: ${kind==='radii'?'published quadrant wind radii':'NOAA Coral Reef Watch sea-surface temperatures'}, chart by CyclonicWx. Valid time and credits are printed on the original.`;img.src=url+'?v='+Math.floor(Date.parse(result.checkedAt)/300000);
  }
}
function copySpectrumPreview(){
  if(!get('chartDialog').open||previewKind!=='satellite'||get('spectrumImage').hidden)return;const c=get('dialogCanvas'),source=get('spectrumImage');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);
}
async function loadImage({forceNoaa=false,warning=''}={}){
  const s=storm();if(!s)return;imageController?.abort();const controller=new AbortController();imageController=controller;const sequence=++imageSequence,id=s.id,remote=publishedMode()&&!forceNoaa,animated=get('animate').checked;let product=get('imageProduct').value;if(!remote&&!s.hasImagery&&product==='spectrum')product='bd';
  spectrumPlayer.stop();clearTimeout(publishedTimer);const img=get('liveImage'),canvas=get('spectrumImage'),current=()=>sequence===imageSequence&&selected===id,useCanvas=!remote&&product==='spectrum';
  img.onload=null;img.onerror=null;img.hidden=true;canvas.hidden=true;get('imageLoading').hidden=false;get('imageError').hidden=true;get('imageTime').textContent='Checking latest image…';get('paletteNote').hidden=!useCanvas;
  function ready(){if(!current())return;get('imageLoading').hidden=true;if(useCanvas)canvas.hidden=false;else img.hidden=false;if(pendingPreview==='satellite'){pendingPreview='';get('satelliteLoop').disabled=false;openPreview('satellite');}}
  try{
    if(remote){
      const result=await api({view:'charts',storm:id,product,animated:animated?'1':'0'},controller.signal);if(!current())return;applyPublishedPlots(result,s);const image=result.satellite;if(!image)throw Error('No matching recent satellite plot.');
      const frames=animated?image.frames:[image],loop=animated&&frames.length>1;let index=frames.length-1;get('imageSource').href=image.sourceUrl;get('imageSource').hidden=false;get('imageCaption').textContent=`CyclonicWx · ${PUBLISHED_PRODUCTS.find(p=>p.id===product).name}${loop?' · '+frames.length+'-scan loop':animated?' · latest still (loop unavailable)':''}`;
      img.alt=`${title(s.name)}: original CyclonicWx ${PUBLISHED_PRODUCTS.find(p=>p.id===product).name}. Scan time, axes, temperature scale and source credits are retained.`;
      img.onload=()=>{if(!current())return;ready();get('imageTime').textContent='Scan '+time(frames[index].validAt)+(loop?' · loop':'');if(get('chartDialog').open&&previewKind==='satellite'){get('dialogCanvas').hidden=true;get('dialogImage').hidden=false;get('dialogImage').src=img.src;get('dialogCaption').textContent=get('imageTime').textContent;}
        if(loop)publishedTimer=setTimeout(()=>{if(!current()||document.hidden)return;index=(index+1)%frames.length;img.src=frames[index].imageUrl;},index===frames.length-1?1000:450);
      };
      img.onerror=()=>{if(current())loadImage({forceNoaa:true,warning:'CyclonicWx plot unavailable · NOAA fallback'});};img.src=frames[index].imageUrl;return;
    }
    const image=await api({view:'imagery',storm:id,product,animated:animated?'1':'0'},controller.signal);if(!current())return;
    get('imageTime').textContent=image.updatedAt?'File updated '+time(image.updatedAt):'Acquisition time is printed on the image';get('imageSource').href=image.sourceUrl;get('imageSource').hidden=false;get('imageCaption').textContent=`${warning?warning+' · ':''}${image.source} · ${IMAGE_PRODUCTS.find(p=>p.id===product).name}${animated?' · animation':''}`;
    if(product==='spectrum'){
      const response=await fetch('api/live-storms?'+new URLSearchParams({view:'infrared',storm:id,animated:animated?'1':'0'}),{signal:controller.signal});if(!response.ok){const error=await response.json();throw Error(error.message||'Infrared imagery is unavailable.');}
      const blob=await response.blob();if(!current())return;await spectrumPlayer.load(blob,{name:s.name,designation:s.designation,animated,onFrame:copySpectrumPreview});if(!current())return;ready();
    }else{
      img.onload=ready;img.onerror=()=>{if(!current())return;get('imageLoading').hidden=true;get('imageError').textContent='The image could not load. Try another product or open the original source.';get('imageError').hidden=false;pendingPreview='';get('satelliteLoop').disabled=false;};img.alt=`${title(s.name)}: ${IMAGE_PRODUCTS.find(p=>p.id===product).name}${animated?' animation':''}, from ${image.source}. Acquisition times are printed on the image.`;img.src=image.imageUrl+'?v='+encodeURIComponent(image.updatedAt||image.checkedAt.slice(0,16));
    }
  }catch(error){if(error.name==='AbortError'||!current())return;if(remote)return loadImage({forceNoaa:true,warning:'CyclonicWx unavailable · NOAA fallback'});get('imageLoading').hidden=true;get('imageError').textContent=error.message;get('imageError').hidden=false;get('imageTime').textContent='Product unavailable';get('imageSource').hidden=true;pendingPreview='';get('satelliteLoop').disabled=false;}
}
async function loadOcean(){
  const s=storm();if(!s)return;oceanController?.abort();oceanController=new AbortController();const id=s.id;ocean=null;get('sstValue').textContent='—';get('sstNote').textContent='Loading JPL MUR point sample…';get('oceanMap').hidden=true;get('oceanStatus').hidden=publishedOceanActive;get('oceanStatus').textContent='Loading daily sea-surface temperatures…';if(!publishedOceanActive){get('oceanCaption').textContent='';oceanPresentation();}
  try{const result=await api({view:'ocean',storm:id},oceanController.signal);if(selected!==id)return;ocean=result;get('sstValue').textContent=ocean.temperatureC===null?'—':ocean.temperatureC.toFixed(1);const old=Date.now()-Date.parse(ocean.sampledAt)>72*3600000;get('sstNote').textContent=ocean.temperatureC===null?'JPL MUR · land or missing sea pixel':`JPL MUR point · ${time(ocean.sampledAt)}${old?' · Delayed':''}`;if(!publishedOceanActive)get('oceanCaption').textContent=`Analysis: ${time(ocean.sampledAt)}${old?' · More than 72 hours old':''}`;get('oceanStatus').hidden=true;drawOcean();
  }catch(error){if(error.name==='AbortError'||selected!==id)return;get('sstNote').textContent='JPL MUR point sample unavailable';get('oceanStatus').textContent=error.message;}
}
let coastPromise;
function loadCoastlines(){if(!coastPromise)coastPromise=fetch('assets/mcfetch-coastlines.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(result=>{coastlines=result;drawOcean();renderRadii();forecastView.redraw();}).catch(()=>{coastPromise=null;});}

function temperatureColor(value){const stops=[[15,[41,77,139]],[20,[38,132,168]],[24,[61,185,169]],[26,[167,206,111]],[28,[239,211,100]],[30,[235,142,78]],[32,[192,70,65]]];for(let i=1;i<stops.length;i++){if(value<=stops[i][0]){const a=stops[i-1],b=stops[i],f=Math.max(0,Math.min(1,(value-a[0])/(b[0]-a[0])));return 'rgb('+a[1].map((v,j)=>Math.round(v+(b[1][j]-v)*f)).join(',')+')';}}return 'rgb(192,70,65)';}
function drawOcean(){
  if(publishedOceanActive&&publishedMode())return;
  const s=storm();if(!ocean||!s)return;const canvas=get('oceanMap'),ctx=canvas.getContext('2d'),{west,east,south,north}=ocean.bounds,left=62,top=60,width=975,height=565,rel=lon=>s.longitude+((lon-s.longitude+540)%360)-180,x=lon=>left+(rel(lon)-west)/(east-west)*width,y=lat=>top+(north-lat)/(north-south)*height;
  canvas.hidden=false;ctx.fillStyle='#0a1422';ctx.fillRect(0,0,1100,760);ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();ctx.fillStyle='#122337';ctx.fillRect(left,top,width,height);
  for(const [lat,lon,t]of ocean.cells){if(t===null)continue;ctx.fillStyle=temperatureColor(t);ctx.fillRect(x(lon)-.25/(east-west)*width,y(lat)-.25/(north-south)*height,.5/(east-west)*width+1,.5/(north-south)*height+1);}
  ctx.strokeStyle='#0d263c33';ctx.lineWidth=1;for(let lat=Math.ceil(south/2)*2;lat<north;lat+=2){ctx.beginPath();ctx.moveTo(left,y(lat));ctx.lineTo(left+width,y(lat));ctx.stroke();}for(let lon=Math.ceil(west/2)*2;lon<east;lon+=2){ctx.beginPath();ctx.moveTo(left+(lon-west)/(east-west)*width,top);ctx.lineTo(left+(lon-west)/(east-west)*width,top+height);ctx.stroke();}
  if(coastlines){ctx.strokeStyle='#eef5f3bb';ctx.lineWidth=1.3;ctx.beginPath();for(const line of coastlines.lines){let previous=null;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(previous&&Math.abs(px-previous[0])<width)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=[px,py];}}ctx.stroke();}
  const cx=x(s.longitude),cy=y(s.latitude);ctx.fillStyle='#0c1c2dee';ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(cx,cy,10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(cx-17,cy);ctx.lineTo(cx+17,cy);ctx.moveTo(cx,cy-17);ctx.lineTo(cx,cy+17);ctx.stroke();ctx.font='bold 19px Arial';const label=title(s.name),measure=ctx.measureText(label).width;ctx.fillStyle='#0a1628df';ctx.fillRect(cx+21,cy-15,measure+20,33);ctx.fillStyle='#fff';ctx.fillText(label,cx+31,cy+8);ctx.restore();
  ctx.strokeStyle='#4e667c';ctx.lineWidth=1;ctx.strokeRect(left,top,width,height);ctx.fillStyle='#bed0df';ctx.font='16px Arial';ctx.textAlign='left';ctx.fillText('Sea-surface temperature  /  °C',left,30);ctx.textAlign='right';ctx.font='14px Arial';ctx.fillText(time(ocean.sampledAt),left+width,30);
  for(let lat=Math.ceil(south/2)*2;lat<north;lat+=2){ctx.textAlign='right';ctx.fillText(coord(lat,'lat'),left-10,y(lat)+5);}for(let lon=Math.ceil(west/2)*2;lon<east;lon+=2){ctx.textAlign='center';ctx.fillText(coord(((lon+540)%360)-180,'lon'),left+(lon-west)/(east-west)*width,top+height+25);}
  for(let i=0;i<800;i++){ctx.fillStyle=temperatureColor(15+i/799*17);ctx.fillRect(left+90+i,top+height+61,1,14);}ctx.font='14px Arial';ctx.fillStyle='#9db4c9';for(const t of [15,20,24,26,28,30,32]){ctx.textAlign='center';ctx.fillText(t+'°',left+90+(t-15)/17*800,top+height+99);}
  loadCoastlines();
}
function renderRadii(){
  if(publishedRadiiActive&&publishedMode())return;
  const s=storm();if(!s)return;const f=drawWindRadii(get('radiiMap'),s,structure,coastlines,time);get('radiiMap').hidden=!f;get('radiiStatus').hidden=!!f;
  get('radiiCaption').textContent='Local chart · published quadrant radii';get('radiiSource').textContent='Source ↗';
  if(f){get('radiiTime').textContent='Valid '+time(f.validAt);get('radiiSource').href=f.source===s.agency?s.sourceUrl:structure.sourceUrl;get('radiiSource').hidden=false;}
  else{get('radiiStatus').textContent=structurePending?'Loading published wind radii…':'Wind radii are not available in the current sources.';get('radiiTime').textContent='Published quadrant wind radii';get('radiiSource').hidden=true;}
}
async function loadStructure(){
  const s=storm();if(!s)return;structureController?.abort();structureController=new AbortController();const id=s.id,at=s.validAt;structurePending=true;get('structureNote').textContent='Loading operational storm structure…';renderRadii();
  try{const result=await api({view:'structure',storm:id},structureController.signal);if(selected!==id||storm()?.validAt!==at)return;structure=result;const link=node('a','Raw ATCF data ↗');link.href=result.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';get('structureNote').replaceChildren(document.createTextNode(`Structure: ${result.source} · ${time(result.validAt)}. POCI is shown directly. `),link);renderInfo();}
  catch(error){if(error.name==='AbortError'||selected!==id)return;get('structureNote').textContent=error.message;}
  finally{if(selected===id&&storm()?.validAt===at){structurePending=false;renderRadii();}}
}
function openPreview(kind){
  const isImage=kind==='satellite',isSpectrum=isImage&&!get('spectrumImage').hidden,remotePlot=!isImage&&(kind==='ocean'?publishedOceanActive:publishedRadiiActive),element=get(isSpectrum?'spectrumImage':isImage?'liveImage':remotePlot?kind+'Image':kind==='ocean'?'oceanMap':'radiiMap');if(element.hidden){notice('This chart is still loading or unavailable. Try another product.');return;}
  previewKind=kind;const label={satellite:'Satellite imagery',radii:'Wind radii',ocean:'Sea-surface temperatures'}[kind];get('dialogTitle').textContent=title(storm().name)+' · '+label;get('dialogCaption').textContent=get(isImage?'imageTime':kind==='ocean'?'oceanCaption':'radiiTime').textContent;get('dialogCanvas').hidden=!isSpectrum;get('dialogImage').hidden=isSpectrum;
  if(!isSpectrum){get('dialogImage').src=isImage||remotePlot?element.src:element.toDataURL('image/png');get('dialogImage').alt=title(storm().name)+' — '+label;}
  get('dialogSource').href=isImage?get('imageSource').href:kind==='ocean'?get('oceanSource').href:get('radiiSource').href;if(!get('chartDialog').open)get('chartDialog').showModal();if(isSpectrum)copySpectrumPreview();
}
for(const button of document.querySelectorAll('[data-expand]'))button.addEventListener('click',()=>openPreview(button.dataset.expand));
get('closeDialog').addEventListener('click',()=>get('chartDialog').close());get('chartDialog').addEventListener('click',event=>{if(event.target===get('chartDialog'))get('chartDialog').close();});
get('satelliteLoop').addEventListener('click',()=>{get('animate').checked=true;pendingPreview='satellite';get('satelliteLoop').disabled=true;loadImage();});
function selectStorm(id){selected=id;ocean=null;structure=null;resetPublishedPlots();pendingPreview='';get('satelliteLoop').disabled=false;renderList();renderInfo();loadImage();loadOcean();loadStructure();loadCoastlines();forecastView.load();}
async function refresh(){
  if(refreshing)return;refreshing=true;get('refresh').disabled=true;feedController=new AbortController();
  try{const result=await api({},feedController.signal);data=result;if(!data.storms.some(s=>s.id===selected))selected=data.storms[0]?.id||'';get('checkedAt').textContent='Feeds checked '+time(data.checkedAt);get('stormCount').textContent=`${data.storms.length} current warned ${data.storms.length===1?'system':'systems'}`;get('feedStatus').replaceChildren(...data.sources.map(s=>{const a=node('a',s.name,'feed'+(!s.available||s.partial?' unavailable':''));a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.title=s.available?(s.partial?'Some warnings could not be read':'Feed available'):'Feed temporarily unavailable';return a;}));const unavailable=data.sources.filter(s=>!s.available||s.partial);notice(unavailable.length?`${unavailable.map(s=>s.name).join(', ')}: some products are unavailable. Available feeds are still shown; coverage may be incomplete.`:'');get('stormDetail').hidden=!selected;get('emptyState').hidden=!!selected;renderList();if(selected){resetPublishedPlots();structure=null;renderInfo();loadImage();loadOcean();loadStructure();loadCoastlines();forecastView.load();}}
  catch(error){if(error.name==='AbortError')return;notice(error.message+(data?' Keeping the last loaded data; check its observation times.':''));get('checkedAt').textContent='Refresh failed · '+time(new Date());if(!data)get('stormList').replaceChildren(node('p','Current storm feeds are unavailable. Use Refresh data to try again.','muted'));}
  finally{refreshing=false;get('refresh').disabled=false;}
}
get('stormSelect').addEventListener('change',()=>selectStorm(get('stormSelect').value));
function updateSectionNav(){const target=location.hash||'#conditions';for(const link of document.querySelectorAll('.section-nav a')){if(link.hash===target)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}}
window.addEventListener('hashchange',updateSectionNav);updateSectionNav();
get('refresh').addEventListener('click',refresh);get('imageProduct').addEventListener('change',loadImage);get('animate').addEventListener('change',loadImage);get('retryOcean').addEventListener('click',()=>{loadOcean();if(publishedMode())loadImage();});get('windUnit').addEventListener('change',()=>{if(data){renderList();renderInfo();forecastView.render();}});
setInterval(()=>{if(get('autoRefresh').checked&&!document.hidden)refresh();},300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&get('autoRefresh').checked&&(!data||Date.now()-Date.parse(data.checkedAt)>300000))refresh();});window.addEventListener('pagehide',()=>{clearTimeout(publishedTimer);feedController?.abort();imageController?.abort();oceanController?.abort();structureController?.abort();imageSequence++;spectrumPlayer.stop();forecastView.abort();});
get('chartProvider').addEventListener('change',()=>{resetPublishedPlots();configureChartProducts();if(storm()){renderInfo();renderRadii();oceanPresentation();if(ocean)drawOcean();else loadOcean();loadImage();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&publishedMode()&&get('animate').checked)loadImage();});
configureChartProducts();
const spectrumPlayer=createSpectrumPlayer(get('spectrumImage'));
const forecastView=createForecastView({api,getStorm:storm,wind,unitName,time,getCoastlines:()=>coastlines});
refresh();
