export const RECON_UNITS=Object.freeze({kt:{label:'kt',mps:1852/3600},mph:{label:'mph',mps:.44704},kmh:{label:'km/h',mps:1/3.6},mps:{label:'m/s',mps:1}});
export const RECON_FACTORS=Object.freeze({'700':{eyewall:.90,convection:.85,clear:.80},'850':{eyewall:.80,convection:.80,clear:.75},'925':{eyewall:.75,convection:.75,clear:.75}});
export const RECON_SOURCES={standard:'https://www.nhc.noaa.gov/outreach/presentations/5_Hurricane_Hunter_Aircraft_Data_for_Tropical_Cyclone_Analysis_and_Forecasting_Past_Present_and_Future.pdf',powell:'https://www.aoml.noaa.gov/hrd/ike/Files/PowellEstWinds_1.pdf'};
function numeric(value,min,max,label){if(value==null||typeof value==='boolean'||String(value).trim()==='')throw Error(`Enter ${label}.`);const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label} must be between ${min} and ${max}.`);return n;}
export function calculateReconReduction(input={}){
  const method=input.method||'standard',unit=RECON_UNITS[input.windUnit||'kt'];if(!unit)throw Error('Choose a supported wind unit.');
  const wind=numeric(input.wind,.01,1500,'Flight-level wind'),flightMps=wind*unit.mps;if(flightMps>300)throw Error('Flight-level wind must be 300 m/s or less.');
  let factor,rmwKm=null,level=null,altitudeKm=null,formula,sourceUrl='',label;
  if(method==='standard'){
    level=String(input.level||'700');const environment=input.environment||'eyewall';if(!Object.hasOwn(RECON_FACTORS,level)||!Object.hasOwn(RECON_FACTORS[level],environment))throw Error('Choose a flight level and sampling region.');
    factor=RECON_FACTORS[level][environment];label='Franklin et al. (2003) · operational factors';formula=`Surface wind = flight-level wind × ${factor.toFixed(2)}`;sourceUrl=RECON_SOURCES.standard;
  }else if(method==='powell'){
    altitudeKm=numeric(input.altitudeKm??3,2,4,'Flight altitude (km)');
    if(!['nmi','km'].includes(input.rmwUnit))throw Error('Choose nautical miles or kilometers for RMW.');
    rmwKm=numeric(input.rmw,.01,300,'Flight-level radius of maximum wind')*(input.rmwUnit==='nmi'?1.852:1);
    factor=.84123+.001516*flightMps-.0026*rmwKm;
    if(factor<=0)throw Error('This wind and radius combination gives a nonphysical reduction factor. Check the flight-level RMW.');
    label='Powell et al. (2009) · mission-maximum estimate';formula='F = 0.84123 + 0.001516 × Vflight (m/s) − 0.0026 × RMWflight (km)';sourceUrl=RECON_SOURCES.powell;
  }else if(method==='custom'){
    factor=numeric(input.factor,.01,1.5,'Reduction factor');label='User-specified factor';formula=`Surface wind = flight-level wind × ${factor}`;
  }else throw Error('Choose a supported reduction method.');
  const surfaceMps=flightMps*factor,convert=mps=>Object.fromEntries(Object.entries(RECON_UNITS).map(([key,u])=>[key,mps/u.mps]));
  return {method,label,factor,reductionPercent:(1-factor)*100,flightMps,surfaceMps,flight:convert(flightMps),surface:convert(surfaceMps),rmwKm,level,altitudeKm,formula,sourceUrl,aboveFlight:factor>1};
}
export function reconWindPreset(search){
  const query=new URLSearchParams(search);if(!query.has('reconWind'))return null;
  const wind=numeric(query.get('reconWind'),25,250,'Imported surface wind (knots)');
  return {method:'ckz',windKnots:String(wind),windUnit:'kt',latitude:'',environmentMb:'',radiusNmi:'',knackRociNmi:'',motionKnots:''};
}
