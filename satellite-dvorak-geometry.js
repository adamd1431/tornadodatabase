// Matches the geographic raster area in mcfetch-plot.js (not its labels/legend).
export const DVORAK_MAP={left:64,top:70,size:810,width:1000,height:920};
const wrap=value=>((value+540)%360)-180;
export function dvorakMapPoint(latitude,longitude,settings){
  const extent=Number(settings.plotExtent)||6.5,north=Math.min(90,settings.latitude+extent),south=Math.max(-90,settings.latitude-extent),delta=wrap(longitude-settings.longitude);
  return {x:DVORAK_MAP.left+(delta+extent)/(extent*2)*DVORAK_MAP.size,y:DVORAK_MAP.top+(north-latitude)/(north-south)*DVORAK_MAP.size};
}
export function dvorakPointLocation(x,y,settings){
  const m=DVORAK_MAP;if(!Number.isFinite(x)||!Number.isFinite(y)||x<m.left||x>m.left+m.size||y<m.top||y>m.top+m.size)return null;
  const extent=Number(settings.plotExtent)||6.5,north=Math.min(90,settings.latitude+extent),south=Math.max(-90,settings.latitude-extent);
  return {latitude:north-(y-m.top)/m.size*(north-south),longitude:wrap(settings.longitude-extent+(x-m.left)/m.size*extent*2)};
}
export function dvorakImagePoint(clientX,clientY,rect){
  if(!rect.width||!rect.height)return null;const m=DVORAK_MAP,scale=Math.min(rect.width/m.width,rect.height/m.height),left=rect.left+(rect.width-m.width*scale)/2,top=rect.top+(rect.height-m.height*scale)/2;
  return {x:(clientX-left)/scale,y:(clientY-top)/scale};
}
export function dvorakCirclePath(latitude,longitude,radiusKm,settings){
  const rad=Math.PI/180,a=latitude*rad,b=longitude*rad,d=radiusKm/6371,points=[];
  for(let i=0;i<=72;i++){const bearing=i/72*Math.PI*2,lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(bearing)),lon=b+Math.atan2(Math.sin(bearing)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat));points.push(dvorakMapPoint(lat/rad,lon/rad,settings));}
  return points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')+' Z';
}
