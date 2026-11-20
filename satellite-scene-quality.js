import {measureEirEye,EIR_SOURCE} from './satellite-dvorak-eir.js';

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=v=>finite(v)?v.toFixed(1):'Unavailable';
const signed=v=>(v>=0?'+':'')+fmt(v);

// Shared evidence for the archive, calibrated-data estimator and picture mode.
// No intensity labels, identities, CDO-area bonus or guessed eye temperatures.
export function assessSatelliteScene(grid,eye,{pattern,patternError='',thermalHistory=null,sourcePixelKm=null}={}){
  let ring=pattern;
  if(ring===undefined)try{ring=measureEirEye(grid,eye);}catch(error){ring=null;patternError=error.message;}
  const picture=!!grid?.calibration?.startsWith('Approximate'),sampledPixelKm=ring?.resolutionKm??null;
  const supplied=finite(sourcePixelKm)&&sourcePixelKm>0?sourcePixelKm:finite(grid?.sourcePixelKm)&&grid.sourcePixelKm>0?grid.sourcePixelKm:null;
  const nativePixelKm=picture?supplied:supplied??sampledPixelKm;
  const effectivePixelKm=finite(nativePixelKm)&&finite(sampledPixelKm)?Math.max(nativePixelKm,sampledPixelKm):nativePixelKm;
  const eyeMinorKm=ring?.eyeMinorKm??null,pixelsAcrossEye=finite(eyeMinorKm)&&finite(effectivePixelKm)?eyeMinorKm/effectivePixelKm:null;
  // Three pixels across the minor axis is a conservative sampling flag, not a
  // fitted confidence level or an operational pinhole-intensity correction.
  const resolutionLimited=finite(pixelsAcrossEye)?pixelsAcrossEye<3:!!ring?.eyeUndersampled;
  const resolutionUnknown=picture&&!finite(nativePixelKm);
  const accepted=!!ring;
  const flags=[];
  if(!accepted)flags.push(patternError||'A complete, sufficiently thick cold ring could not be measured.');
  if(resolutionLimited)flags.push('The eye spans fewer than three effective image pixels on its narrow axis. Its measured temperature may be too cold; no warmer temperature or intensity boost is invented.');
  if(resolutionUnknown)flags.push('The original sensor resolution is unknown. Enlarging this picture cannot establish that its eye is resolved.');
  if(eye?.pinhole)flags.push('Pinhole scene selected. This experimental measured-temperature variant retains the observed eye temperature instead of applying an operational pinhole substitution.');
  let evolution=null;
  const elapsed=(Date.parse(eye?.timestamp)-Date.parse(thermalHistory?.timestamp))/3600000;
  if(elapsed>=6&&elapsed<=7.5&&[thermalHistory?.eye,thermalHistory?.cloud,eye?.eye,eye?.cloud].every(finite)){
    evolution={timestamp:thermalHistory.timestamp,hours:elapsed,eyeChangeC:eye.eye-thermalHistory.eye,cloudChangeC:eye.cloud-thermalHistory.cloud,contrastChangeC:(eye.eye-eye.cloud)-(thermalHistory.eye-thermalHistory.cloud),samplingComparable:thermalHistory.samplingVersion===eye.version};
  }
  return {version:'scene-1',accepted,status:!accepted?'ring-unresolved':resolutionLimited?'resolution-limited':resolutionUnknown?'source-resolution-unknown':'supported-eye',
    picture,eyeContrastC:finite(eye?.eye)&&finite(eye?.cloud)?eye.eye-eye.cloud:null,asymmetryC:eye?.symmetry??null,
    measuredEyeC:eye?.eye??null,eyeTemperatureAdjusted:false,ring,sampledPixelKm,nativePixelKm,effectivePixelKm,eyeMinorKm,pixelsAcrossEye,resolutionLimited,resolutionUnknown,evolution,flags,
    explanation:accepted?'Eye–cloud contrast, opposite-sector asymmetry and a complete cold ring are measured together. Overall CDO spread does not add an intensity bonus.':'The eye-pattern structural check is unresolved. Raw temperature diagnostics remain available; a final wind/pressure point estimate is withheld.',source:EIR_SOURCE};
}

export function satelliteSceneFacts(scene){
  if(!scene)return [];
  const ring=scene.ring,trend=scene.evolution;
  return [
    ['Eye–cloud temperature contrast',fmt(scene.eyeContrastC)+' °C'],
    ['Opposite-sector asymmetry',fmt(scene.asymmetryC)+' °C · lower is more symmetric'],
    ['Complete cold ring',ring?`${ring.ringShade} · ${fmt(ring.narrowestWidthKm)} km minimum width`:'Not resolved'],
    ['Required ring width',ring?fmt(ring.requiredWidthKm)+' km':'Unavailable'],
    ['Eye on its narrow axis',finite(scene.eyeMinorKm)?fmt(scene.eyeMinorKm)+' km':'Unavailable'],
    [scene.picture?'Original source pixel spacing':'Sampled infrared grid spacing',finite(scene.nativePixelKm)?fmt(scene.nativePixelKm)+' km':scene.picture?'Unknown · picture pixels are not sensor resolution':'Unavailable'],
    ['Pixels across the eye',finite(scene.pixelsAcrossEye)?fmt(scene.pixelsAcrossEye)+(scene.resolutionLimited?' · resolution-limited':' · three-pixel check passed'):'Unknown'],
    ['Earlier thermal observations',trend?`${fmt(trend.hours)} h earlier · ${trend.timestamp.replace('T',' ').replace(/(?:\.000)?Z$/,' UTC')}`:'No suitable earlier thermal observation'],
    ['Eye / cloud temperature change',trend?`${signed(trend.eyeChangeC)} / ${signed(trend.cloudChangeC)} °C`:'Unavailable'],
    ['Eye–cloud contrast change',trend?signed(trend.contrastChangeC)+' °C':'Unavailable'],
    ['History interpretation',trend?(trend.samplingComparable?'Same sampling version':'Context only · archived and local sampling regions can differ'):'A single scan cannot establish a trend']
  ];
}
