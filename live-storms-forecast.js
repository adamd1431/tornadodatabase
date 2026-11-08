import {wrapLongitude} from './storm-forecast-model.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const palette=['#809edb','#c3a5df','#e8a8a1','#7fbeb5','#c3bc89','#93c3e2'];
const coordinate=(v,lat)=>Math.abs(v).toFixed(1)+'°'+(lat?(v<0?'S':'N'):(v<0?'W':'E'));
const decimal=v=>v===null||v===undefined?'—':v.toFixed(1);
export function createForecastView({api,getStorm,wind,unitName,time,getCoastlines}){
  let forecast=null,environment=null,controller=null,environmentController=null,active='',hour=24;
  const point=()=>forecast?.points.find(p=>p.hours===hour)||forecast?.points.at(-1),modelsVisible=()=>$('showForecastMembers').checked;
  function reset(){controller?.abort();environmentController?.abort();forecast=null;environment=null;active='';$('labContent').hidden=true;$('downloadForecast').disabled=true;$('labStatus').hidden=false;$('labStatus').textContent='Collecting recent model guidance…';$('environmentStatus').textContent='Loading GFS and ocean data…';$('environmentRows').replaceChildren();}
  async function load(){
    reset();const storm=getStorm();if(!storm)return;active=storm.id+':'+storm.validAt;const token=active;controller=new AbortController();
    try{const result=await api({view:'forecast',storm:storm.id},controller.signal);if(token!==active)return;
      forecast=result;hour=Math.min(24,forecast.points.at(-1).hours);$('forecastHour').max=forecast.points.at(-1).hours;$('forecastHour').value=hour;$('labContent').hidden=false;$('downloadForecast').disabled=false;
      $('labStatus').textContent=`Initialized ${time(result.initializedAt)} · ${result.members.length} model ${result.members.length===1?'family (single-model baseline)':'families'} · Guidance retrieved ${time(result.retrievedAt)}`;
      render();loadEnvironment(storm,token);
    }catch(error){if(error.name!=='AbortError'&&token===active)$('labStatus').textContent=error.message;}
  }
  async function loadEnvironment(storm,token){
    environmentController=new AbortController();try{const result=await api({view:'environment',storm:storm.id,run:forecast.runId},environmentController.signal);if(token!==active)return;environment=result;renderEnvironment();}
    catch(error){if(error.name!=='AbortError'&&token===active){$('environmentStatus').textContent='Environmental data unavailable';$('environmentNote').textContent=error.message;}}
  }
  function summary(){
    const winds=forecast.points.filter(p=>p.windKt!==null),pressures=forecast.points.filter(p=>p.pressureMb!==null),peak=winds.reduce((a,b)=>b.windKt>a.windKt?b:a,winds[0]),low=pressures.reduce((a,b)=>b.pressureMb<a.pressureMb?b:a,pressures[0]),last=forecast.points.at(-1);
    const cards=[['FORECAST PEAK WIND',peak?`${wind(peak.windKt)} ${unitName()}`:'Not available',peak?`At +${peak.hours}h · ${peak.windCount} contributing models`:'No wind guidance'],['FORECAST LOWEST PRESSURE',low?`${decimal(low.pressureMb)} mb`:'Not available',low?`At +${low.hours}h · ${low.pressureCount} contributing models`:'No matching pressure anchor'],['FORECAST COVERAGE',`${last.hours} hours`,`${forecast.members.length} model families · 6-hour steps`]];
    $('labSummary').replaceChildren(...cards.map(([label,value,note])=>{const box=el('article');box.append(el('p',label),el('strong',value),el('small',note));return box;}));
  }
  function render(){
    if(!forecast)return;summary();$('labWindUnit').textContent=unitName();$('trackHorizon').textContent=`Through +${forecast.points.at(-1).hours}h`;$('guidanceLink').href=forecast.sourceUrl;
    $('forecastModels').replaceChildren(...forecast.members.map((m,i)=>{const chip=el('div',undefined,'model-chip');chip.style.setProperty('--model-color',palette[i%palette.length]);chip.append(el('strong',`${m.name} · ${m.code}`),el('span',time(m.cycle)));return chip;}));
    if(forecast.official){const chip=el('div',undefined,'model-chip official-chip');chip.append(el('strong',forecast.official.agency+' official forecast'),el('span',time(forecast.official.cycle)));$('forecastModels').append(chip);}
    $('forecastMethod').replaceChildren(...forecast.notes.map(note=>el('p',note)));
    $('labForecastRows').replaceChildren(...forecast.points.map(p=>{const r=el('tr');for(const v of [`+${p.hours}h`,time(p.validAt),coordinate(p.latitude,true),coordinate(p.longitude,false),p.windKt===null?'—':`${wind(p.windKt)} ${unitName()}`,p.pressureMb===null?'—':decimal(p.pressureMb)+' mb',`${p.modelCount} / ${p.windCount} / ${p.pressureCount}`])r.append(el('td',v));return r;}));
    renderFocus();renderEnvironment();
  }
  function renderFocus(){
    if(!forecast)return;const p=point();$('forecastHourLabel').textContent=hour?`+${hour} hours`:'Advisory';
    $('labMemberLegend').hidden=!modelsVisible();$('labMemberLegend').replaceChildren(...forecast.members.map((m,i)=>{const label=el('span',m.name+' · '+m.code);label.style.setProperty('--model-color',palette[i%palette.length]);label.title='Cycle '+time(m.cycle);return label;}));
    const row=el('div');row.append(el('strong',time(p.validAt)),el('span',`${coordinate(p.latitude,true)} · ${coordinate(p.longitude,false)}`));const values=el('div');values.append(el('strong',`${wind(p.windKt)} ${unitName()}  /  ${decimal(p.pressureMb)} mb`),el('span',`${p.modelCount} track · ${p.windCount} wind · ${p.pressureCount} pressure contributors`));$('trackReadout').replaceChildren(row,values);
    drawTrack();drawLine('labWindChart','windKt','windMinKt','windMaxKt',wind);drawLine('labPressureChart','pressureMb','pressureMinMb','pressureMaxMb',decimal);
  }
  function drawLine(id,key,minKey,maxKey,format){
    const w=700,h=255,left=56,right=20,top=24,bottom=39,end=forecast.points.at(-1).hours,show=modelsVisible(),official=forecast.official?.points||[];
    const values=[...forecast.points.flatMap(p=>[p[key],p[minKey],p[maxKey]]),...official.map(p=>p[key])].filter(v=>v!==null&&v!==undefined);
    if(!values.length){$(id).replaceChildren(el('p','No matching pressure guidance is available. Pressure is left blank.','lab-empty'));return;}
    let min=Math.min(...values),max=Math.max(...values),pad=Math.max(key==='windKt'?5:3,(max-min)*.15);min=Math.floor((min-pad)/5)*5;max=Math.ceil((max+pad)/5)*5;if(key==='windKt')min=Math.max(0,min);
    const x=v=>left+v/end*(w-left-right),y=v=>top+(max-v)/(max-min)*(h-top-bottom),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',key==='windKt'?'Experimental wind forecast with model range and official comparison':'Experimental central pressure forecast with model range');
    const add=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
    for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;add('line',{x1:left,x2:w-right,y1:y(v),y2:y(v),stroke:'#24384a','stroke-width':1});add('text',{x:left-9,y:y(v)+4,'text-anchor':'end',fill:'#8ea8bf','font-size':12},format(v));}
    for(let t=0;t<=end;t+=24)add('text',{x:x(t),y:h-12,'text-anchor':'middle',fill:'#8ea8bf','font-size':12},t?`+${t}h`:'Now');
    // Break both lines and bands at missing values; never bridge unavailable data.
    const chunks=(points,field)=>{const result=[];let current=[];for(const p of points){if(p[field]===null||p[field]===undefined){if(current.length)result.push(current);current=[];}else current.push(p);}if(current.length)result.push(current);return result;};
    for(const part of chunks(forecast.points,minKey)){const path=[...part.map(p=>[x(p.hours),y(p[minKey])]),...part.toReversed().map(p=>[x(p.hours),y(p[maxKey])])];add('path',{d:path.map(([a,b],i)=>`${i?'L':'M'}${a},${b}`).join(' ')+'Z',fill:'#9eb9c51c',stroke:'none'});}
    const line=(points,color,width=2,dash='')=>{for(const part of chunks(points.filter(p=>p.hours>=0&&p.hours<=end),key))add('path',{d:part.map((p,i)=>`${i?'L':'M'}${x(p.hours)},${y(p[key])}`).join(' '),fill:'none',stroke:color,'stroke-width':width,'stroke-dasharray':dash,'stroke-linejoin':'round'});};
    if(show)forecast.members.forEach((m,i)=>line(m.points,palette[i%palette.length],1.3));line(official,'#deb777',2,'6 5');line(forecast.points,'#8aead6',3);
    add('line',{x1:x(hour),x2:x(hour),y1:top,y2:h-bottom,stroke:'#e7f6f1','stroke-width':1,'stroke-dasharray':'3 5'});const p=point();if(p[key]!==null)add('circle',{cx:x(p.hours),cy:y(p[key]),r:5,fill:'#b4f9e7',stroke:'#112d31','stroke-width':2});$(id).replaceChildren(svg);
  }
  function drawTrack(){
    const s=getStorm();if(!s||!forecast)return;const canvas=$('forecastTrack'),ctx=canvas.getContext('2d'),show=modelsVisible(),official=forecast.official?.points||[],all=[...forecast.points,...official,...(show?forecast.members.flatMap(m=>m.points):[])],ref=s.longitude,rel=lon=>ref+wrapLongitude(lon-ref);
    let south=Math.min(...all.map(p=>p.latitude))-2,north=Math.max(...all.map(p=>p.latitude))+2,west=Math.min(...all.map(p=>rel(p.longitude)))-2,east=Math.max(...all.map(p=>rel(p.longitude)))+2;
    const left=65,top=45,width=970,height=670,cos=Math.max(.25,Math.cos((north+south)/2*Math.PI/180)),ratio=width/height;
    if((east-west)*cos/(north-south)<ratio){const pad=((north-south)*ratio/cos-(east-west))/2;west-=pad;east+=pad;}else{const pad=((east-west)*cos/ratio-(north-south))/2;south-=pad;north+=pad;}
    const x=lon=>left+(rel(lon)-west)/(east-west)*width,y=lat=>top+(north-lat)/(north-south)*height;
    ctx.fillStyle='#091522';ctx.fillRect(0,0,1100,800);ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();
    const gradient=ctx.createRadialGradient(x(s.longitude),y(s.latitude),0,x(s.longitude),y(s.latitude),800);gradient.addColorStop(0,'#16333d');gradient.addColorStop(1,'#0a1727');ctx.fillStyle=gradient;ctx.fillRect(left,top,width,height);
    const grid=(east-west)>40?10:(east-west)>18?5:2;ctx.strokeStyle='#839caf20';ctx.lineWidth=1;
    for(let lon=Math.ceil(west/grid)*grid;lon<east;lon+=grid){const px=left+(lon-west)/(east-west)*width;ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,top+height);ctx.stroke();}
    for(let lat=Math.ceil(south/grid)*grid;lat<north;lat+=grid){ctx.beginPath();ctx.moveTo(left,y(lat));ctx.lineTo(left+width,y(lat));ctx.stroke();}
    const coast=getCoastlines();if(coast){ctx.strokeStyle='#b8cbd077';ctx.lineWidth=1.5;ctx.beginPath();for(const line of coast.lines){let prev=null;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(prev&&Math.abs(px-prev[0])<width)ctx.lineTo(px,py);else ctx.moveTo(px,py);prev=[px,py];}}ctx.stroke();}
    const draw=(points,color,width,dash=[])=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i)ctx.lineTo(x(p.longitude),y(p.latitude));else ctx.moveTo(x(p.longitude),y(p.latitude));}ctx.stroke();ctx.setLineDash([]);};
    if(show)forecast.members.forEach((m,i)=>draw(m.points,palette[i%palette.length]+'aa',2));draw(official,'#deb777',3,[9,7]);draw(forecast.points,'#8aead6',4);
    ctx.font='600 19px Arial';for(const p of forecast.points.filter(p=>p.hours%24===0)){const px=x(p.longitude),py=y(p.latitude);ctx.fillStyle='#0b2130';ctx.strokeStyle='#8aead6';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#e3f9f2';ctx.shadowColor='#05111b';ctx.shadowBlur=5;ctx.fillText(p.hours?`+${p.hours}h`:'Now',px+10,py-10);ctx.shadowBlur=0;}
    const focus=point();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x(focus.longitude),y(focus.latitude),13,0,Math.PI*2);ctx.stroke();ctx.restore();
    ctx.strokeStyle='#526f7d';ctx.lineWidth=1;ctx.strokeRect(left,top,width,height);ctx.font='16px Arial';ctx.fillStyle='#9fb8c9';
    for(let lat=Math.ceil(south/grid)*grid;lat<north;lat+=grid){ctx.textAlign='right';ctx.fillText(coordinate(lat,true),left-10,y(lat)+5);}
    for(let lon=Math.ceil(west/grid)*grid;lon<east;lon+=grid){ctx.textAlign='center';ctx.fillText(coordinate(wrapLongitude(lon),false),left+(lon-west)/(east-west)*width,top+height+28);}
    ctx.textAlign='left';ctx.font='15px Arial';ctx.fillText('Anchored to the advisory position · no probability cone',left,775);
  }
  function renderEnvironment(){
    if(!environment)return;$('environmentStatus').textContent=environment.airAvailable?(environment.oceanAvailable?'Air & ocean fields loaded':'GFS loaded · ocean data unavailable'):'GFS unavailable · available ocean data shown';
    $('environmentRows').replaceChildren(...environment.rows.map(p=>{const r=el('tr');const lead=el('td');lead.append(el('strong',p.hours?`+${p.hours} hours`:'Advisory'),el('small',time(p.validAt)));r.append(lead);
      const shear=el('td');shear.append(el('strong',p.shearKt===null?'Unavailable':`${decimal(p.shearKt)} kt`));if(p.shearKt!==null){const bar=el('span',undefined,'env-bar');bar.style.setProperty('--level',Math.min(100,p.shearKt/60*100)+'%');shear.append(bar);}r.append(shear);
      const humidity=el('td');humidity.append(el('strong',p.humidityPct===null?'Unavailable':`${decimal(p.humidityPct)}%`));if(p.humidityPct!==null){const bar=el('span',undefined,'env-bar humidity');bar.style.setProperty('--level',p.humidityPct+'%');humidity.append(bar);}r.append(humidity);
      const sst=el('td');sst.append(el('strong',p.temperatureC===null?(p.oceanStatus==='unavailable'?'Unavailable':'Missing / land'):`${decimal(p.temperatureC)} °C`),el('small',p.temperatureC===null?(p.oceanStatus==='unavailable'?'Ocean service unavailable':'No ocean grid value'):'Ocean-model forecast'));r.append(sst);
      const flow=el('td');flow.append(el('strong',p.flow500Kt===null?'Unavailable':`${decimal(p.flow500Kt)} kt`),el('small',p.flow500Towards===null?'':`Toward ${Math.round(p.flow500Towards)}°`));r.append(flow);return r;}));
    $('environmentNote').textContent=`Retrieved ${time(environment.retrievedAt)}. Latest GFS fields; the distributor does not supply a cycle timestamp and may interpolate time and grid samples. Humidity averages 700 and 500 hPa. Missing air fields require at least 6 of 8 valid ring samples. The 500-hPa flow is a diagnostic, not a track prediction.`;
  }
  function download(){
    if(!forecast)return;const fields=['lead_hours','valid_utc','latitude','longitude','wind_knots','pressure_mb','wind_min_knots','wind_max_knots','pressure_min_mb','pressure_max_mb','track_models','wind_models','pressure_models','interpolated','method','initialized_utc','guidance_retrieved_utc','model_cycles'];
    const csv=[fields.join(','),...forecast.points.map(p=>[p.hours,p.validAt,p.latitude,p.longitude,p.windKt,p.pressureMb,p.windMinKt,p.windMaxKt,p.pressureMinMb,p.pressureMaxMb,p.modelCount,p.windCount,p.pressureCount,p.interpolated,forecast.version,forecast.initializedAt,forecast.retrievedAt,forecast.members.map(m=>m.code+':'+m.cycle).join(' | ')].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download=forecast.stormId.toLowerCase()+'-experimental-forecast.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  $('forecastHour').addEventListener('input',()=>{hour=+$('forecastHour').value;renderFocus();});$('showForecastMembers').addEventListener('change',renderFocus);$('reloadForecast').addEventListener('click',load);$('downloadForecast').addEventListener('click',download);
  return {load,reset,render,redraw:drawTrack,abort:()=>{controller?.abort();environmentController?.abort();active='';}};
}
