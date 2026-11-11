export const EARTH_KM=6371.0088;
const rad=Math.PI/180,mod=(n,m)=>(n%m+m)%m;
export function greatCircleKm(a,b){const dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad,h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 2*EARTH_KM*Math.asin(Math.sqrt(Math.min(1,h)));}
export function validateAnalysisTime(date,time='0000'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||! /^(00|03|06|09|12|15|18|21)00$/.test(time||''))throw Error('Choose a valid date and a 3-hour UTC time.');
  const at=`${date}T${time.slice(0,2)}:00:00Z`,stamp=Date.parse(at),year=Number(date.slice(0,4));
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)throw Error('Choose a valid calendar date.');
  if(year<1806||year>2015)throw Error('This NOAA reanalysis covers 1806–2015.');
  return {at,stamp,year,index:(stamp-Date.UTC(year,0,1))/10800000};
}
export function pressureDataUrl(date,time){const t=validateAnalysisTime(date,time),file=`https://psl.noaa.gov/thredds/dodsC/Datasets/20thC_ReanV3/${t.year<=1980?'miscSI':'miscMO'}/prmsl.${t.year}.nc.ascii`;return file+'?'+encodeURIComponent(`prmsl[${t.index}:1:${t.index}][0:1:180][0:1:359]`);}
export function parsePressureAscii(text,expectedAt){
  const rows=Array.from({length:181},()=>null);for(const m of text.matchAll(/^\[0\]\[(\d+)\],\s*([^\r\n]+)$/gm)){const i=+m[1],values=m[2].split(',').map(Number);if(i>180||rows[i]||values.length!==360||values.some(v=>!Number.isFinite(v)||v<80000||v>115000))throw Error('NOAA returned an incomplete or invalid pressure grid.');rows[i]=values.map(v=>v/100);}
  const coordinates=name=>{const m=text.match(new RegExp('prmsl\\.'+name+'\\[\\d+\\]\\s*\\r?\\n([^\\r\\n]+)'));return m?m[1].split(',').map(Number):[];},lat=coordinates('lat'),lon=coordinates('lon'),time=coordinates('time')[0];
  if(rows.some(r=>!r)||lat.length!==181||lon.length!==360||lat.some((v,i)=>v!==i-90)||lon.some((v,i)=>v!==i)||Date.UTC(1800,0,1)+time*3600000!==Date.parse(expectedAt))throw Error('NOAA grid coordinates or valid time do not match the request.');
  return {lat,lon,values:rows,at:expectedAt};
}
export function regionalGrid(grid,position,span=24){
  const west=Math.floor(position.lon-span/Math.max(.5,Math.cos(position.lat*rad))),east=Math.ceil(position.lon+span/Math.max(.5,Math.cos(position.lat*rad))),south=Math.max(-89,Math.floor(position.lat-span)),north=Math.min(89,Math.ceil(position.lat+span));
  const lon=Array.from({length:east-west+1},(_,i)=>west+i),lat=Array.from({length:north-south+1},(_,i)=>south+i);
  return {lon,lat,values:lat.map(y=>lon.map(x=>grid.values[y+90][mod(x,360)]))};
}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
export function containsPoint(points,p){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function pressureContours(grid,level){
  const height=grid.lat.length,width=grid.lon.length,nodes=new Map(),segments=[],threshold=level+1e-9;
  const node=(x,y,edge,v)=>{let key,a,b;if(edge===0){key=`h${x},${y}`;a=[x,y];b=[x+1,y];}else if(edge===1){key=`v${x+1},${y}`;a=[x+1,y];b=[x+1,y+1];}else if(edge===2){key=`h${x},${y+1}`;a=[x,y+1];b=[x+1,y+1];}else{key=`v${x},${y}`;a=[x,y];b=[x,y+1];}
    if(!nodes.has(key)){const va=grid.values[a[1]][a[0]],vb=grid.values[b[1]][b[0]],t=(threshold-va)/(vb-va);nodes.set(key,{point:[grid.lon[a[0]]+(grid.lon[b[0]]-grid.lon[a[0]])*t,grid.lat[a[1]]+(grid.lat[b[1]]-grid.lat[a[1]])*t],edges:[]});}return key;};
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const v=[grid.values[y][x],grid.values[y][x+1],grid.values[y+1][x+1],grid.values[y+1][x]],edges=[];for(let e=0;e<4;e++)if((v[e]<threshold)!==(v[(e+1)%4]<threshold))edges.push(e);
    const pairs=edges.length===2?[edges]:edges.length===4?((v[0]-threshold)*(v[2]-threshold)-(v[1]-threshold)*(v[3]-threshold)>0?[[0,1],[2,3]]:[[0,3],[1,2]]):[];
    for(const pair of pairs){const keys=pair.map(e=>node(x,y,e,v)),id=segments.length;segments.push(keys);keys.forEach(k=>nodes.get(k).edges.push(id));}
  }
  const used=new Set(),lines=[];
  const order=[...nodes.values()].filter(node=>node.edges.length===1).map(node=>node.edges[0]).concat(segments.map((_,i)=>i));
  for(const i of order){if(used.has(i))continue;let start=segments[i].find(k=>nodes.get(k).edges.length===1)||segments[i][0],key=start,points=[],closed=false;
    for(let count=0;count<=segments.length;count++){points.push(nodes.get(key).point);const next=nodes.get(key).edges.find(id=>!used.has(id));if(next===undefined)break;used.add(next);key=segments[next].find(k=>k!==key);if(key===start){closed=true;break;}}
    if(points.length>2)lines.push({points,closed});
  }return lines;
}
function minima(grid){const result=[],seen=new Set(),w=grid.lon.length,h=grid.lat.length;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const v=grid.values[y][x];if(seen.has(y*w+x))continue;let low=true,lower=false;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const q=grid.values[y+j][x+i];if(q<v)low=false;if(q>v)lower=true;}
    if(!low||!lower)continue;result.push({x,y,lat:grid.lat[y],lon:grid.lon[x],pressureMb:v});
    const todo=[[x,y]];while(todo.length){const [a,b]=todo.pop(),id=b*w+a;if(seen.has(id))continue;seen.add(id);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(a+i>0&&a+i<w-1&&b+j>0&&b+j<h-1&&grid.values[b+j][a+i]===v&&!seen.has((b+j)*w+a+i))todo.push([a+i,b+j]);}
  }return result;
}
class Heap{data=[];push(v){const a=this.data;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.data,top=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=v[0])break;a[i]=a[j];i=j;}a[i]=v;}return top;}}
// Pressure-basin prominence suppresses sub-interval grid ripples. A second
// low with at least 2 hPa depth is treated as a separate pressure system.
function prominence(grid,low){const w=grid.lon.length,h=grid.lat.length,heap=new Heap(),seen=new Uint8Array(w*h);heap.push([low.pressureMb,low.x,low.y]);
  while(heap.data.length){const [level,x,y]=heap.pop(),id=y*w+x;if(seen[id])continue;seen[id]=1;if(x===0||y===0||x===w-1||y===h-1||grid.values[y][x]<low.pressureMb-1e-7)return level-low.pressureMb;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if((i||j)&&!seen[(y+j)*w+x+i]){
      const a=grid.values[y][x],b=grid.values[y+j][x+i];let barrier=Math.max(a,b);
      if(i&&j){const c=grid.values[y][x+i],d=grid.values[y+j][x],q=a-c-d+b;barrier=Math.min(Math.max(a,b,c),Math.max(a,b,d));if(Math.abs(q)>1e-12){const sx=(a-d)/q,sy=(a-c)/q,saddle=a-(c-a)*(d-a)/q;if(sx>0&&sx<1&&sy>0&&sy<1&&a<=saddle&&b<=saddle)barrier=Math.min(barrier,saddle);}}
      heap.push([Math.max(level,barrier),x+i,y+j]);
    }
  }return 0;
}
function projected(point,center){const p={lon:point[0],lat:point[1]},d=greatCircleKm(center,p),dlon=(p.lon-center.lon)*rad,y=Math.sin(dlon)*Math.cos(p.lat*rad),x=Math.cos(center.lat*rad)*Math.sin(p.lat*rad)-Math.sin(center.lat*rad)*Math.cos(p.lat*rad)*Math.cos(dlon),bearing=Math.atan2(y,x);return [d*Math.sin(bearing),d*Math.cos(bearing)];}
export function contourRadius(points,center){const polygon=points.map(p=>projected(p,center)),radii=[];
  for(let bearing=0;bearing<360;bearing++){const direction=[Math.sin(bearing*rad),Math.cos(bearing*rad)];let best=Infinity;
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],segment=[b[0]-a[0],b[1]-a[1]],denominator=cross(direction,segment);if(Math.abs(denominator)<1e-9)continue;const t=cross(a,segment)/denominator,u=cross(a,direction)/denominator;if(t>=0&&u>=-1e-9&&u<=1+1e-9)best=Math.min(best,t);}
    if(!Number.isFinite(best))throw Error('The closed contour does not enclose its center.');radii.push(best/1.852);
  }return {meanNmi:radii.reduce((a,b)=>a+b,0)/radii.length,minNmi:Math.min(...radii),maxNmi:Math.max(...radii)};
}
function contourEstimate(last,center,region,next,termination,interval){
  const radius=contourRadius(last.line.points,center);
  return {status:'estimated',pociMb:last.level,rociNmi:Number(radius.meanNmi.toFixed(4)),radiusMinNmi:Math.round(radius.minNmi),radiusMaxNmi:Math.round(radius.maxNmi),nextContourMb:next,contourIntervalMb:interval,termination,center:{lat:center.lat,lon:mod(center.lon+180,360)-180,pressureMb:Math.round(center.pressureMb*100)/100,offsetKm:center.offsetKm},contour:last.line.points,region,message:termination==='open'?`Highest isolated closed ${interval}-mb contour. The next contour is open on the full global pressure grid. ROCI is the mean radius over 360 bearings.`:`Highest closed ${interval}-mb contour enclosing this low before it joins another distinct pressure system. ROCI is the mean radius over 360 bearings.`};
}
function extractRegion(grid,reported,span,interval){
  const region=regionalGrid(grid,reported,span),lows=minima(region).map(low=>({...low,prominence:prominence(region,low)})).filter(low=>low.prominence>=2-1e-7),candidates=lows.filter(low=>greatCircleKm(reported,low)<=300).sort((a,b)=>greatCircleKm(reported,a)-greatCircleKm(reported,b));
  if(!candidates.length)return {status:'unresolved',message:'No distinct pressure minimum is resolved within 300 km of this cyclone’s track position.',region};
  const center=candidates[0],others=lows.filter(low=>low!==center);let last=null,reason='limit',next=null;
  for(let level=Math.ceil((center.pressureMb+1e-6)/interval)*interval;level<=1100;level+=interval){
    const enclosing=pressureContours(region,level).filter(line=>line.closed&&containsPoint(line.points,[center.lon,center.lat]));
    if(!enclosing.length){reason='boundary';next=level;break;}
    const area=line=>Math.abs(line.points.reduce((sum,p,i)=>{const q=line.points[(i+1)%line.points.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
    const line=enclosing.sort((a,b)=>area(a)-area(b))[0];
    if(others.some(low=>containsPoint(line.points,[low.lon,low.lat]))){reason='merged';next=level;break;}
    last={level,line};
  }
  if(!last)return {status:reason==='boundary'?'boundary-limited':'unresolved',message:'No isolated closed contour is resolved at the selected contour interval.',center,region};
  center.offsetKm=Math.round(greatCircleKm(reported,center));
  if(reason!=='merged')return {status:'boundary-limited',message:'A closed outer contour was found, but its outer boundary still requires verification on the global grid.',center,region,pendingContour:last,nextContourMb:next};
  return contourEstimate(last,center,region,next,'merged',interval);
}
export function extractPociRoci(grid,position,{interval=2}={}){
  if(!position||!Number.isFinite(position.lat)||!Number.isFinite(position.lon)||Math.abs(position.lat)>65)throw Error('A valid tropical cyclone position is required.');
  if(![2,5].includes(interval))throw Error('Choose a 5-mb or 2-mb contour interval.');
  const reported={lat:position.lat,lon:mod(position.lon+180,360)-180};let result=extractRegion(grid,reported,24,interval);if(result.status==='boundary-limited')result=extractRegion(grid,reported,40,interval);
  if(result.status==='boundary-limited'&&result.pendingContour&&result.nextContourMb){
    const {center,region}=result,west=Math.floor(center.lon)-180,lon=Array.from({length:361},(_,i)=>west+i),lat=grid.lat.slice(1,-1);
    const world={lon,lat,values:lat.map(y=>lon.map(x=>grid.values[y+90][mod(x,360)]))};
    const others=minima(world).filter(low=>low.lat!==center.lat||mod(low.lon-center.lon,360)!==0),depths=new Map();
    const distinct=low=>{if(!depths.has(low))depths.set(low,prominence(world,low));return depths.get(low)>=2-1e-7;};
    let last=null;
    const finish=(next,termination)=>{
      if(!last)return {...result,status:'unresolved',message:'No separate closed isobar could be assigned to this cyclone on the global pressure grid.'};
      // Follow the complete contour, rather than stopping at a regional chart
      // edge. Do not turn a planetary pressure basin into a CKZ-sized cyclone.
      const radius=contourRadius(last.line.points,center);
      if(radius.meanNmi>1500)return {...result,message:'The global pressure basin exceeds the estimator’s 1,500 nmi ROCI range. Choose reported values or enter a measurement.'};
      let area=region;
      if(last.line.points.some(([x,y])=>x<region.lon[0]||x>region.lon.at(-1)||y<region.lat[0]||y>region.lat.at(-1))){
        const xs=last.line.points.map(p=>p[0]),ys=last.line.points.map(p=>p[1]),w=Math.floor(Math.min(...xs))-2,e=Math.ceil(Math.max(...xs))+2,s=Math.max(-89,Math.floor(Math.min(...ys))-2),n=Math.min(89,Math.ceil(Math.max(...ys))+2);
        const lon=Array.from({length:e-w+1},(_,i)=>w+i),lat=Array.from({length:n-s+1},(_,i)=>s+i);area={lon,lat,values:lat.map(y=>lon.map(x=>grid.values[y+90][mod(x,360)]))};
      }
      return contourEstimate(last,center,area,next,termination,interval);
    };
    for(let level=Math.ceil((center.pressureMb+1e-6)/interval)*interval;level<=1100;level+=interval){
      const enclosing=pressureContours(world,level).filter(line=>line.closed&&containsPoint(line.points,[center.lon,center.lat]));
      if(!enclosing.length){result=finish(level,'open');break;}
      const area=line=>Math.abs(line.points.reduce((sum,p,i)=>{const q=line.points[(i+1)%line.points.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
      const line=enclosing.sort((a,b)=>area(a)-area(b))[0];
      if(others.some(low=>containsPoint(line.points,[low.lon,low.lat])&&distinct(low))){result=finish(level,'merged');break;}
      last={level,line};
    }
  }
  const {pendingContour,...output}=result;if(output.status==='boundary-limited'&&output.message.includes('still requires verification'))output.message='The global reanalysis does not separate an outer isobar for this cyclone. Choose reported values or enter a measurement.';return output;
}
