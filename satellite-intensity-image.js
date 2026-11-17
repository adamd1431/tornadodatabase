import {calculateEyeDvorak,eyeRegression} from './satellite-dvorak-model.js';
import {ciToWind} from './wind-pressure-model.js';
import {tablePressure} from './satellite-intensity-model.js';
import {spectrumColor} from './live-storms-palette.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);

export function imagePalette(kind,{start=30,end=-90,legend=[]}={}){
  if(kind==='spectrum')return Array.from({length:601},(_,i)=>{const t=-100+i*.25;return {t,rgb:spectrumColor(t)};});
  if(![start,end].every(finite)||start===end||Math.min(start,end)<-110||Math.max(start,end)>50)throw Error('Set valid temperature-scale endpoints between −110 and +50 °C.');
  if(kind==='linear-gray')return Array.from({length:256},(_,v)=>({t:start+(end-start)*v/255,rgb:[v,v,v]}));
  if(kind!=='legend'||legend.length<32||legend.length>2048||legend.some(rgb=>rgb.length!==3||!rgb.every(v=>finite(v)&&v>=0&&v<=255)))throw Error('Draw a line through the temperature color bar, from its first temperature to its last.');
  return legend.map((rgb,i)=>({t:start+(end-start)*i/(legend.length-1),rgb}));
}

export function imageTemperatureGrid(image,{palette,eyeX,eyeY,widthKm,heightKm,confirmedInfrared=false}={}){
  const {data,width,height}=image||{};
  if(!confirmedInfrared)throw Error('Confirm that this is thermal infrared imagery with the selected temperature scale. Visible-light photographs do not contain cloud temperatures.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<80||height<80||width*height>600000||data?.length!==width*height*4)throw Error('Choose a storm area at least 80 × 80 pixels, with no more than 600,000 sampled pixels.');
  if(![eyeX,eyeY,widthKm,heightKm].every(finite)||eyeX<0||eyeX>=width||eyeY<0||eyeY>=height||widthKm<280||heightKm<280||widthKm>5000||heightKm>5000)throw Error('Mark the eye and enter the cropped area’s width and height in km (280–5,000 km).');
  if(!Array.isArray(palette)||palette.length<32||palette.length>2048||palette.some(p=>!finite(p.t)||p.rgb?.length!==3||!p.rgb.every(finite)))throw Error('A valid infrared temperature palette is required.');
  const temperature=new Float32Array(width*height).fill(NaN),latitude=new Float32Array(temperature.length),longitude=new Float32Array(temperature.length),cache=new Map();let matched=0,ambiguous=0,unmatched=0;
  function decode(r,g,b){const key=r*65536+g*256+b;if(cache.has(key))return cache.get(key);let best=Infinity;const distances=palette.map(p=>{const d=Math.hypot(p.rgb[0]-r,p.rgb[1]-g,p.rgb[2]-b);best=Math.min(best,d);return d;});let result;
    if(best>24)result={kind:'unmatched'};
    else {const candidates=palette.filter((p,i)=>distances[i]<=best+2).map(p=>p.t),lo=Math.min(...candidates),hi=Math.max(...candidates);result=hi-lo>6?{kind:'ambiguous'}:{kind:'matched',temperature:(lo+hi)/2};}
    cache.set(key,result);return result;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,j=i*4;latitude[i]=(eyeY-y-.5)*heightKm/height/111.195;longitude[i]=(x+.5-eyeX)*widthKm/width/111.195;
    const p=data[j+3]<240?{kind:'unmatched'}:decode(data[j],data[j+1],data[j+2]);if(p.kind==='matched'){matched++;temperature[i]=p.temperature;}else if(p.kind==='ambiguous')ambiguous++;else unmatched++;
  }
  const total=temperature.length,quality={matchedFraction:matched/total,ambiguousFraction:ambiguous/total,unmatchedFraction:unmatched/total};
  if(quality.matchedFraction<.7)throw Error(ambiguous>unmatched?'This color scale repeats colors for widely different temperatures. It cannot support an unambiguous intensity scan. Use continuous infrared colors, a linear grayscale image, or a calibrated scan in Satellite Archive.':'Most pixels do not match the temperature scale. Check the crop, palette and legend endpoints; a normal or visible-light photograph cannot be scanned as infrared.');
  return {grid:{width,height,temperature,latitude,longitude,timestamp:null,calibration:'Approximate temperatures recovered from user-confirmed image colors',navigation:'Local distance coordinates from the user-supplied image scale; not geographic positions'},quality};
}

export function estimatePictureIntensity(decoded,{basin,scene='eye'}={}){
  if(!['WP','AL','EP','CP','IO','SH'].includes(basin))throw Error('Choose the cyclone’s basin.');
  const domain=['AL','EP','CP'].includes(basin)?'atlantic':'pacific',eye=calculateEyeDvorak(decoded.grid,{latitude:0,longitude:0,domain,largeEye:scene==='large',pinhole:scene==='pinhole'});
  const windKt=ciToWind(eye.rawT),pressureMb=tablePressure(eye.rawT,basin+'000000');
  return {method:'Approximate picture-derived eye-scene baseline',sourceKind:'uploaded-infrared-picture',eye,windKt,pressureMb,quality:decoded.quality,basin,
    sensitivity:temperatureSensitivity(eye,basin),notes:['Picture colors and a manually supplied distance scale are less reliable than calibrated satellite pixels.','Native-image trained trees and MOTIS/owner/official intensities are not used.','This is a single-image eye-scene diagnostic, not operational ADT or a validated image model.','Visible-light imagery and ambiguous or mismatched temperature scales cannot produce an accepted scan.']};
}
function temperatureSensitivity(eye,basin){
  const ts=[];for(const e of [-2,2])for(const c of [-2,2])for(const s of [-2,2])try{ts.push(eyeRegression({...eye,eye:eye.eye+e,cloud:eye.cloud+c,symmetry:Math.max(0,eye.symmetry+s)}));}catch{}
  const winds=ts.map(ciToWind).filter(finite),pressures=ts.map(t=>tablePressure(t,basin+'000000')).filter(finite);
  return {kind:'sensitivity-not-confidence',temperatureStepC:2,windMin:winds.length?Math.min(...winds):null,windMax:winds.length?Math.max(...winds):null,pressureMin:pressures.length?Math.min(...pressures):null,pressureMax:pressures.length?Math.max(...pressures):null};
}

export function normalizedRectangle(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
