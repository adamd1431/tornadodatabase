import {compass,fixAge,environmentLevel} from './storm-forecast-summary.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const dec=v=>Number.isFinite(v)?v.toFixed(1):'—';
const coord=(v,lat)=>Number.isFinite(v)?`${Math.abs(v).toFixed(1)}°${lat?(v<0?'S':'N'):(v<0?'W':'E')}`:'—';
export function createStormContext({getStorm,getOcean,getOceanNote,getStructure,time}){
  let environment=null,state='loading';
  function direction(bearing){
    const label=el('span',undefined,'context-direction');
    if(!Number.isFinite(bearing))return label;
    const arrow=el('span','↑');arrow.setAttribute('aria-hidden','true');arrow.style.transform=`rotate(${bearing}deg)`;
    label.append(arrow,document.createTextNode(`${compass(bearing)} · ${Math.round(bearing)}°`));label.title='Direction toward which the vector points';return label;
  }
  function render(){
    const s=getStorm();if(!s)return;
    const e=environment?.stormId===s.id&&environment.initializedAt===s.validAt?environment:null,row=e?.rows.find(p=>p.hours===0),water=getOcean(),structure=getStructure();
    const pressure=s.pressureMb??(structure?.pressureMatchesAdvisory&&structure.validAt===s.validAt?structure.pressureMb:null);
    const facts=[['Basin',s.basin],['Position',`${coord(s.latitude,true)}  ${coord(s.longitude,false)}`],
      ['Motion',Number.isFinite(s.motionKt)?`${Number.isFinite(s.motionDegrees)?`${Math.round(s.motionDegrees)}° ${compass(s.motionDegrees)} at `:''}${dec(s.motionKt)} kt`:'Not published'],
      ['MSLP',Number.isFinite(pressure)?`${dec(pressure)} hPa`:'Not published'],['Vmax · 1-minute',Number.isFinite(s.windKt)?`${dec(s.windKt)} kt`:'Not published'],
      ['Last fix',`${time(s.validAt)} · ${fixAge(s.validAt)}`]];
    $('contextFacts').replaceChildren(...facts.map(([label,value])=>{const r=el('div');r.append(el('dt',label),el('dd',value));return r;}));
    $('contextAgency').textContent=s.agency;
    $('contextStatus').textContent=state==='loading'?'Loading environment…':state==='unavailable'?'Environmental feed unavailable':e?.airAvailable?'GFS environment':'Air data unavailable';
    const sst=Number.isFinite(water?.temperatureC)?water.temperatureC:null;
    const gauges=[
      {key:'shear',label:'Deep-layer shear',value:row?.shearKt,unit:'kt',help:'Mean 200 minus 850 hPa wind vector on an eight-point, 500-km ring. The arrow points toward the shear vector, not from it.',note:row?`${time(row.validAt)} · ${row.samples}/8 ring samples`:'Awaiting GFS fields',bearing:row?.shearTowards},
      {key:'sst',label:'Sea-surface temperature',value:sst,unit:'°C',help:'Daily ocean analysis sampled at the advisory center. This is not an instantaneous observation or a climate anomaly.',note:water?`${water.grids?'NOAA CRW':'JPL MUR'} · ${time(water.sampledAt)}`:getOceanNote()},
      {key:'humidity',label:'Mid-level humidity',value:row?.humidityPct,unit:'%',help:'Mean relative humidity at 700 and 500 hPa on the same 500-km ring.',note:row?`${time(row.validAt)} · NOAA GFS`:'Awaiting GFS fields'}
    ];
    $('contextGauges').replaceChildren(...gauges.map(g=>{
      const box=el('div',undefined,'context-gauge'),heading=el('div',undefined,'gauge-heading'),name=el('span',g.label),help=el('button','i','context-help');help.type='button';help.title=g.help;help.setAttribute('aria-label',`${g.label}: ${g.help}`);name.append(help);
      const loading=g.key==='sst'?g.note.startsWith('Loading'):state==='loading';
      const value=el('strong',Number.isFinite(g.value)?`${dec(g.value)} ${g.unit}`:loading?'Loading…':'Unavailable');heading.append(name,value);box.append(heading);
      const level=environmentLevel(g.key,g.value),bar=el('div',undefined,'context-meter');bar.setAttribute('aria-hidden','true');if(level!==null){bar.style.setProperty('--level',level+'%');bar.append(el('span'));}else bar.classList.add('missing');box.append(bar);
      const note=el('div',undefined,'gauge-note');note.append(el('span',g.note));if(Number.isFinite(g.bearing)&&g.value>.1)note.append(direction(g.bearing));box.append(note);return box;
    }));
  }
  return {render,setEnvironment(value,status='ready'){environment=value;state=status;render();}};
}
