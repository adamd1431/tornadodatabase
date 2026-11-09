// Great-circle destinations in nautical miles, for published quadrant radii.
export function radiusDestination(latitude,longitude,bearing,nmi){
  const rad=Math.PI/180,lat=latitude*rad,lon=longitude*rad,b=bearing*rad,d=nmi/3440.065;
  const a=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
  const o=lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(a));return [a/rad,((o/rad+540)%360)-180];
}
export function windFootprint(storm,structure){
  const published=storm.radii||{},useAdvisory=Object.keys(published).length>0||!!storm.radii34;
  const radii=useAdvisory?(Object.keys(published).length?published:{34:storm.radii34}):structure?.radii||{};
  const position=useAdvisory?storm:structure||storm;
  return {radii,latitude:position.latitude,longitude:position.longitude,validAt:position.validAt,source:useAdvisory?storm.agency:structure?.source||storm.agency,rmwNmi:structure?.validAt===position.validAt?structure.rmwNmi:null};
}
export function drawWindRadii(canvas,storm,structure,coastlines,formatTime){
  const f=windFootprint(storm,structure),entries=Object.entries(f.radii).filter(([,r])=>r&&Object.values(r).some(v=>v>0));if(!entries.length)return null;
  const ctx=canvas.getContext('2d'),left=80,top=95,width=1020,height=1020,largest=Math.max(60,...entries.flatMap(([,r])=>Object.values(r))),extent=Math.max(2,Math.ceil(largest*1.55/60)),lonExtent=extent/Math.max(.25,Math.cos(f.latitude*Math.PI/180)),west=f.longitude-lonExtent,north=f.latitude+extent,south=f.latitude-extent;
  const relative=lon=>f.longitude+((lon-f.longitude+540)%360)-180,x=lon=>left+(relative(lon)-west)/(lonExtent*2)*width,y=lat=>top+(north-lat)/(north-south)*height;
  canvas.width=1200;canvas.height=1200;ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,1200);ctx.fillStyle='#244451';ctx.font='bold 23px Arial';ctx.fillText('Wind radii · '+storm.name,left,32);ctx.textAlign='right';ctx.font='17px Arial';ctx.fillText('Valid '+formatTime(f.validAt),left+width,32);ctx.textAlign='left';
  ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();ctx.fillStyle='#d7e9ed';ctx.fillRect(left,top,width,height);
  ctx.strokeStyle='#8dafbb66';ctx.lineWidth=1;const step=extent>4?2:1;for(let lat=Math.ceil(south/step)*step;lat<north;lat+=step){ctx.beginPath();ctx.moveTo(left,y(lat));ctx.lineTo(left+width,y(lat));ctx.stroke();}for(let lon=Math.ceil(west/step)*step;lon<f.longitude+lonExtent;lon+=step){ctx.beginPath();ctx.moveTo(x(lon),top);ctx.lineTo(x(lon),top+height);ctx.stroke();}
  if(coastlines){ctx.strokeStyle='#5c7883';ctx.lineWidth=1.2;ctx.beginPath();for(const line of coastlines.lines){let previous;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(previous&&Math.abs(px-previous)<width)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=px;}}ctx.stroke();}
  const colors={34:['#63a96b','#6bbb6b33'],50:['#dd993e','#f3bb5c55'],64:['#bb5b6c','#df6b754a']},cx=x(f.longitude),cy=y(f.latitude),quadrants=['NE','SE','SW','NW'];
  for(const [threshold,radii]of entries.sort((a,b)=>+a[0]-+b[0])){ctx.fillStyle=colors[threshold]?.[1]||'#4c85b833';ctx.strokeStyle=colors[threshold]?.[0]||'#4c85b8';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);for(let q=0;q<4;q++){const radius=radii[quadrants[q]]||0;for(let angle=q*90;angle<=(q+1)*90;angle+=2){const [lat,lon]=radiusDestination(f.latitude,f.longitude,angle,radius);ctx.lineTo(x(lon),y(lat));}}ctx.closePath();ctx.fill();ctx.stroke();}
  if(f.rmwNmi){ctx.beginPath();for(let b=0;b<=360;b+=3){const [lat,lon]=radiusDestination(f.latitude,f.longitude,b,f.rmwNmi);if(b)ctx.lineTo(x(lon),y(lat));else ctx.moveTo(x(lon),y(lat));}ctx.setLineDash([7,5]);ctx.strokeStyle='#514861';ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);}
  ctx.fillStyle='#1b3441';ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fill();ctx.restore();ctx.strokeStyle='#7899a5';ctx.lineWidth=1;ctx.strokeRect(left,top,width,height);ctx.fillStyle='#385764';ctx.font='17px Arial';
  for(let lat=Math.ceil(south/step)*step;lat<north;lat+=step){ctx.textAlign='right';ctx.fillText(`${Math.abs(lat)}°${lat<0?'S':'N'}`,left-13,y(lat)+6);}for(let lon=Math.ceil(west/step)*step;lon<f.longitude+lonExtent;lon+=step){ctx.textAlign='center';const n=((lon+540)%360)-180;ctx.fillText(`${Math.abs(n)}°${n<0?'W':'E'}`,x(lon),top+height+29);}
  let legendX=left;ctx.textAlign='left';ctx.font='19px Arial';for(const [threshold]of entries){ctx.fillStyle=colors[threshold]?.[0]||'#4c85b8';ctx.fillRect(legendX,top+height+64,25,5);ctx.fillStyle='#385764';ctx.fillText(`${threshold} kt`,legendX+34,top+height+72);legendX+=150;}if(f.rmwNmi){ctx.fillStyle='#514861';ctx.fillText(`RMW ${f.rmwNmi} nmi`,legendX,top+height+72);}
  ctx.font='16px Arial';ctx.textAlign='right';ctx.fillStyle='#244451';ctx.fillText('Plot: Tornado Database · Data: '+f.source,left+width,1187);
  return f;
}
