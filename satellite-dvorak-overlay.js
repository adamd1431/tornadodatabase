import {dvorakMapPoint,dvorakPointLocation,dvorakImagePoint,dvorakCirclePath} from './satellite-dvorak-geometry.js';
export function setupDvorakOverlay({onPick}){
  const get=id=>document.getElementById(id),img=get('archiveImage'),stage=get('previewStage'),svg=get('dvorakOverlay');let settings=null,row=null,picking=false;
  function position(){const a=img.getBoundingClientRect(),b=stage.getBoundingClientRect();Object.assign(svg.style,{left:a.left-b.left+'px',top:a.top-b.top+'px',width:a.width+'px',height:a.height+'px'});}
  function stop(){picking=false;img.classList.remove('picking-eye');get('pickDvorakEye').setAttribute('aria-pressed','false');get('pickDvorakEye').textContent='Pick eye on image';}
  function draw(){
    svg.replaceChildren();const hidden=!row||!get('dvorakShowOverlay').checked;svg.toggleAttribute('hidden',hidden);if(hidden)return;
    const ns='http://www.w3.org/2000/svg',make=(name,attrs)=>{const el=document.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
    const defs=make('defs',{}),clip=make('clipPath',{id:'dvorakMapClip'});clip.append(make('rect',{x:64,y:70,width:810,height:810}));defs.append(clip);svg.append(defs);
    const group=make('g',{'clip-path':'url(#dvorakMapClip)','fill':'none','stroke-width':1.8});
    for(const [radius,color,dash]of [[24,'#5cddff',''],[row.inner,'#8cf5bd',''],[row.outer,'#8cf5bd',''],[136,'#ffe28b','5 5']])group.append(make('path',{d:dvorakCirclePath(row.latitude,row.longitude,radius,settings),stroke:color,'stroke-dasharray':dash}));
    const p=dvorakMapPoint(row.latitude,row.longitude,settings);group.append(make('path',{d:`M${p.x-10} ${p.y}h20M${p.x} ${p.y-10}v20`,stroke:'#fff','stroke-width':2.5}));svg.append(group);position();
  }
  get('dvorakShowOverlay').addEventListener('change',draw);
  get('pickDvorakEye').addEventListener('click',()=>{if(!settings)return;if(picking){stop();get('dvorakPickStatus').textContent='Eye selection cancelled.';return;}picking=true;img.classList.add('picking-eye');get('pickDvorakEye').setAttribute('aria-pressed','true');get('pickDvorakEye').textContent='Cancel eye selection';get('dvorakPickStatus').textContent='Click the eye inside the plotted image. You can also enter its coordinates below.';img.scrollIntoView({behavior:'auto',block:'center'});});
  img.addEventListener('click',event=>{if(!picking||!settings)return;const p=dvorakImagePoint(event.clientX,event.clientY,img.getBoundingClientRect()),location=p&&dvorakPointLocation(p.x,p.y,settings);if(!location){get('dvorakPickStatus').textContent='Choose a point inside the satellite map, away from the title and temperature scale.';return;}stop();get('dvorakPickStatus').textContent=`Eye selected at ${location.latitude.toFixed(3)}°, ${location.longitude.toFixed(3)}°.`;onPick(location);get('dvorakPanel').scrollIntoView({behavior:'auto',block:'start'});});
  window.addEventListener('keydown',event=>{if(picking&&event.key==='Escape'){stop();get('dvorakPickStatus').textContent='Eye selection cancelled.';}});
  if(window.ResizeObserver)new ResizeObserver(position).observe(img);else window.addEventListener('resize',position);
  return {setResult(result){settings=result?.settings||null;row=null;stop();draw();get('dvorakPickStatus').textContent='';},show(result){row=result;draw();},clear(){row=null;draw();}};
}
