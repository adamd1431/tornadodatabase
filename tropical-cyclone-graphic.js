export const DEFAULT_GRAPHIC = Object.freeze({ name:'POLO',identifier:'EP172026',wind:155,pressure:900,peak:3,total:3,showCounter:true,note:'→ third-lowest pressure for an EPac system!',heading:'PEAK INTENSITY:',aspect:'4:3',width:1024,font:'arial',color:'#ffffff',rounding:5,pressureUnit:'mbar',textScale:100,backdrop:25,shadow:true,style:'aura',accent:'#a7b7ff',auraStrength:68 });
export const GRAPHIC_FONTS = { arial:'Arial, Helvetica, sans-serif',roboto:'"Roboto Condensed", Arial, sans-serif',inter:'Inter, Arial, sans-serif' };
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const number = (value,min,max,fallback) => value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value),min,max) : fallback;
const text = (value,limit) => String(value ?? '').trim().slice(0,limit);
export function normalizeGraphic(input = {}) {
  const d=DEFAULT_GRAPHIC;
  return {name:text(input.name ?? d.name,80),identifier:text(input.identifier ?? d.identifier,30),wind:number(input.wind,0,500,d.wind),pressure:number(input.pressure,.1,2000,d.pressure),peak:Math.round(number(input.peak,1,99,d.peak)),total:Math.round(number(input.total,1,99,d.total)),showCounter:input.showCounter ?? d.showCounter,note:text(input.note ?? d.note,280),heading:text(input.heading ?? d.heading,60),aspect:['4:3','16:9','1:1'].includes(input.aspect)?input.aspect:d.aspect,width:[1024,2048,3072].includes(Number(input.width))?Number(input.width):d.width,font:Object.hasOwn(GRAPHIC_FONTS,input.font)?input.font:d.font,color:/^#[\da-f]{6}$/i.test(input.color)?input.color:d.color,rounding:[5,1,.01].includes(Number(input.rounding))?Number(input.rounding):d.rounding,pressureUnit:['mbar','mb','hPa'].includes(input.pressureUnit)?input.pressureUnit:d.pressureUnit,textScale:number(input.textScale,75,135,d.textScale),backdrop:number(input.backdrop,0,80,d.backdrop),shadow:input.shadow ?? d.shadow,style:['aura','classic'].includes(input.style)?input.style:d.style,accent:/^#[\da-f]{6}$/i.test(input.accent)?input.accent:d.accent,auraStrength:number(input.auraStrength,0,100,d.auraStrength)};
}
export function graphicDimensions(state) {
  const s=normalizeGraphic(state),[w,h]=s.aspect.split(':').map(Number);
  return {width:s.width,height:Math.round(s.width*h/w)};
}
function displayNumber(value,decimals=4) { return Number(Number(value).toFixed(decimals)).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:decimals}); }
export function graphicWind(wind,rounding=5) {
  const value=number(wind,0,500,0),step=[5,1,.01].includes(Number(rounding))?Number(rounding):5;
  const round=n=>Number((Math.round((n+Number.EPSILON)/step)*step).toFixed(2));
  const mph=round(value*1.1507794480235),kph=round(value*1.852);
  return {knots:value,mph,kph,line:`${displayNumber(value)} knots (${displayNumber(mph,2)} mph; ${displayNumber(kph,2)} kph)`};
}
export function graphicLabels(input) {
  const s=normalizeGraphic(input),name=s.name.toUpperCase()||'STORM';
  return {header:s.showCounter?`${name} PEAK ${s.peak} out of ${s.total}`:'',title:s.identifier?`(${s.identifier.toUpperCase()}) ${name}`:name,heading:s.heading,wind:graphicWind(s.wind,s.rounding).line,pressure:`${displayNumber(s.pressure)} ${s.pressureUnit}`,note:s.note};
}
export function imageFrame(imageWidth,imageHeight,width,height,{zoom=1,x=50,y=50,fit='cover'}={}) {
  if (![imageWidth,imageHeight,width,height].every(n=>Number.isFinite(n)&&n>0)) throw Error('Invalid image dimensions.');
  const scale=(fit==='contain'?Math.min:Math.max)(width/imageWidth,height/imageHeight)*number(zoom,1,4,1);
  const w=imageWidth*scale,h=imageHeight*scale;
  return {x:(width-w)*number(x,0,100,50)/100,y:(height-h)*number(y,0,100,50)/100,width:w,height:h};
}
export function graphicFilename(input) {
  const s=normalizeGraphic(input),stem=(s.name||'tropical-cyclone').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
  return `${stem||'tropical-cyclone'}${s.identifier?'-'+s.identifier.toLowerCase().replace(/[^a-z0-9-]/g,''):''}-peak-${s.peak}.png`;
}
export function shortStormName(value) { return String(value||'').replace(/^(?:(?:super\s+)?typhoon|hurricane|(?:severe\s+)?tropical\s+(?:cyclone|storm|depression)|cyclone)\s+/i,'').replace(/\s*\([^)]*\)/g,'').trim(); }

function fittedFont(ctx,line,size,maxWidth,family,minSize=10,face='700') {
  ctx.font=`${face} ${size}px ${family}`;
  const measured=ctx.measureText(line).width;
  const fitted=measured>maxWidth?Math.max(minSize,size*maxWidth/measured):size;
  ctx.font=`${face} ${fitted}px ${family}`;
  return fitted;
}
function wrapText(ctx,value,maxWidth) {
  const lines=[];
  for(const paragraph of value.split('\n')) {
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)) {
      if(ctx.measureText(word).width>maxWidth){
        if(line){lines.push(line);line='';}
        for(const character of word){if(line&&ctx.measureText(line+character).width>maxWidth){lines.push(line);line='';}line+=character;}
        continue;
      }
      const combined=line?line+' '+word:word;
      if(line&&ctx.measureText(combined).width>maxWidth){lines.push(line);line=word;}else line=combined;
    }
    if(line)lines.push(line);
  }
  return lines;
}

const channels=hex=>[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16));
const alpha=(hex,value)=>`rgba(${channels(hex).join(',')},${value})`;
const blend=(a,b,weight)=>'#'+channels(a).map((value,index)=>Math.round(value*(1-weight)+channels(b)[index]*weight).toString(16).padStart(2,'0')).join('');

function auraLighting(ctx,state,width,height) {
  const strength=state.auraStrength/100;
  ctx.save();ctx.globalCompositeOperation='screen';
  const bloom=(x,y,radius,color,opacity)=>{const g=ctx.createRadialGradient(x,y,0,x,y,radius);g.addColorStop(0,alpha(color,opacity*strength));g.addColorStop(1,alpha(color,0));ctx.fillStyle=g;ctx.fillRect(0,0,width,height);};
  bloom(width*.04,height*.12,width*.68,'#4c88ff',.24);
  bloom(width*.98,height*.68,width*.64,state.accent,.28);
  ctx.restore();
  const vignette=ctx.createRadialGradient(width*.52,height*.43,width*.12,width*.52,height*.43,Math.max(width,height)*.79);
  vignette.addColorStop(0,'rgba(2,7,20,0)');vignette.addColorStop(.42,'rgba(2,7,20,0)');vignette.addColorStop(1,`rgba(1,4,14,${.3+.5*strength})`);
  ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
  const bottom=ctx.createLinearGradient(0,height*.39,0,height);
  bottom.addColorStop(0,'rgba(3,7,20,0)');bottom.addColorStop(.44,`rgba(3,7,20,${.16+.13*strength})`);bottom.addColorStop(1,`rgba(2,5,15,${.7+.18*strength})`);
  ctx.fillStyle=bottom;ctx.fillRect(0,0,width,height);
}

function drawAuraLabels(ctx,state,width,height,labels) {
  const scale=width/1024,ts=state.textScale/100,family=GRAPHIC_FONTS[state.font],margin=44*scale,maxWidth=width-2*margin,strength=state.auraStrength/100;
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.lineJoin='round';
  const plain=(value,x,y,size,{color=state.color,face='700',max=maxWidth,glow=0}={})=>{
    ctx.save();ctx.fillStyle=color;fittedFont(ctx,value,size*scale*ts,max,family,10*scale,face);
    if(glow){ctx.shadowColor=state.accent;ctx.shadowBlur=glow*scale*strength;ctx.fillText(value,x,y);ctx.shadowBlur=0;}
    if(state.shadow){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=7*scale;ctx.shadowOffsetY=2*scale;}
    ctx.fillText(value,x,y);const measured=ctx.measureText(value).width;ctx.restore();return measured;
  };
  const tracked=(value,x,y,size,spacing,color=state.accent,max=maxWidth)=>{
    ctx.save();ctx.fillStyle=color;ctx.font=`700 ${size*scale*ts}px ${family}`;
    const glyphs=[...value],gap=spacing*scale,full=ctx.measureText(value).width+Math.max(0,glyphs.length-1)*gap;
    const ratio=Math.min(1,max/Math.max(1,full));ctx.font=`700 ${size*scale*ts*ratio}px ${family}`;
    for(const glyph of glyphs){ctx.fillText(glyph,x,y);x+=ctx.measureText(glyph).width+gap*ratio;}ctx.restore();
  };
  if(state.showCounter){
    const counter=`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`;
    ctx.save();ctx.font=`700 ${13*scale}px ${family}`;
    const boxWidth=ctx.measureText(counter).width+36*scale,x=width-margin-boxWidth,y=32*scale,h=36*scale;
    ctx.fillStyle='rgba(5,10,26,.62)';ctx.strokeStyle=alpha(state.accent,.38);ctx.lineWidth=scale;
    ctx.beginPath();ctx.roundRect(x,y,boxWidth,h,5*scale);ctx.fill();ctx.stroke();
    ctx.fillStyle=state.color;ctx.fillText(counter,x+18*scale,y+23*scale);ctx.restore();
  }
  const detailY=height-34*scale,statY=detailY-35*scale*ts,titleY=statY-105*scale*ts,idY=titleY-95*scale*ts;
  if(labels.note){
    let fontSize=17*scale*ts;ctx.font=`600 ${fontSize}px ${family}`;let lines=wrapText(ctx,labels.note,maxWidth*.87);
    while(lines.length>3&&fontSize>11*scale){fontSize-=scale;ctx.font=`600 ${fontSize}px ${family}`;lines=wrapText(ctx,labels.note,maxWidth*.87);}
    lines.forEach((line,index)=>plain(line,margin,idY-33*scale*ts-(lines.length-index-1)*fontSize*1.35,fontSize/(scale*ts),{color:blend(state.color,state.accent,.18),face:'600'}));
  }
  if(state.identifier)tracked(state.identifier.toUpperCase(),margin,idY,14,3.2,state.accent);
  ctx.save();const titleGradient=ctx.createLinearGradient(0,titleY-100*scale*ts,0,titleY+8*scale);
  titleGradient.addColorStop(0,state.color);titleGradient.addColorStop(.55,state.color);titleGradient.addColorStop(1,blend(state.color,state.accent,.48));
  const titleWidth=plain(state.name.toUpperCase()||'STORM',margin-3*scale,titleY,96,{color:titleGradient,face:'italic 900',glow:30});
  ctx.restore();
  const rule=ctx.createLinearGradient(margin,0,margin+Math.min(maxWidth*.64,Math.max(220*scale,titleWidth)),0);
  rule.addColorStop(0,alpha(state.accent,.9));rule.addColorStop(1,alpha(state.accent,0));ctx.fillStyle=rule;ctx.fillRect(margin,titleY+18*scale,Math.min(maxWidth*.64,Math.max(220*scale,titleWidth)),scale);
  if(labels.heading)tracked(labels.heading.replace(/:\s*$/,'').toUpperCase(),margin,statY-58*scale*ts,11,2.4,alpha(state.color,.65));
  const blockWidth=maxWidth*.47,rightX=margin+maxWidth*.54,wind=graphicWind(state.wind,state.rounding);
  const stat=(value,unit,detail,x)=>{
    const unitSize=13*scale*ts;ctx.font=`700 ${unitSize}px ${family}`;
    const unitWidth=ctx.measureText(unit).width,numberWidth=plain(value,x,statY,50,{face:'800',max:blockWidth-unitWidth-14*scale});
    plain(unit,x+numberWidth+12*scale,statY-3*scale,13,{color:state.accent,max:unitWidth+3*scale});
    plain(detail,x,detailY,15,{color:alpha(state.color,.72),face:'500',max:blockWidth});
  };
  stat(displayNumber(state.wind),'KNOTS',`${displayNumber(wind.mph,2)} mph · ${displayNumber(wind.kph,2)} kph`,margin);
  stat(displayNumber(state.pressure),state.pressureUnit,'Central pressure',rightX);
}

export function drawCycloneGraphic(ctx,image,input,frame={}) {
  const state=normalizeGraphic(input),{width,height}=graphicDimensions(state),labels=graphicLabels(state);
  ctx.save();ctx.clearRect(0,0,width,height);ctx.fillStyle='#07111f';ctx.fillRect(0,0,width,height);
  if(image){const r=imageFrame(image.width,image.height,width,height,frame);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.save();if(state.style==='aura'){const a=state.auraStrength/100;ctx.filter=`contrast(${1+.3*a}) saturate(${1+.18*a}) brightness(${1-.13*a})`;}ctx.drawImage(image,r.x,r.y,r.width,r.height);ctx.restore();}
  else{ctx.fillStyle='#879ab6';ctx.font=`500 ${width/42}px Arial`;ctx.textAlign='center';ctx.fillText('Add a satellite image',width/2,height*.44);}
  if(state.backdrop){const shade=ctx.createLinearGradient(0,height*.5,0,height);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,`rgba(0,0,0,${state.backdrop/100})`);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);}
  if(state.style==='aura'){auraLighting(ctx,state,width,height);drawAuraLabels(ctx,state,width,height,labels);ctx.restore();return {width,height,labels};}
  const scale=width/1024,ts=state.textScale/100,family=GRAPHIC_FONTS[state.font],margin=32*scale,maxWidth=width-2*margin;
  ctx.fillStyle=state.color;ctx.strokeStyle='rgba(0,0,0,.42)';ctx.lineJoin='round';ctx.textBaseline='alphabetic';ctx.lineWidth=1.1*scale;
  if(state.shadow){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=4*scale;ctx.shadowOffsetY=1.5*scale;}
  const draw=(line,x,y,size,align='left')=>{ctx.textAlign=align;fittedFont(ctx,line,size*scale*ts,maxWidth,family,10*scale);if(state.shadow)ctx.strokeText(line,x,y);ctx.fillText(line,x,y);};
  if(labels.header)draw(labels.header,width-margin,57*scale,26,'right');
  const bottom=height-36*scale,line=32*scale*ts;
  draw(labels.pressure,margin,bottom,30);
  draw(labels.wind,margin,bottom-line,30);
  draw(labels.heading,margin,bottom-2*line,30);
  const titleY=bottom-2*line-49*scale*ts;
  draw(labels.title,margin,titleY,36);
  if(labels.note){
    let noteSize=19*scale*ts;ctx.font=`700 ${noteSize}px ${family}`;let lines=wrapText(ctx,labels.note,maxWidth);
    while(lines.length>3&&noteSize>12*scale){noteSize-=scale;ctx.font=`700 ${noteSize}px ${family}`;lines=wrapText(ctx,labels.note,maxWidth);}
    const gap=noteSize*1.2,baseline=titleY-46*scale*ts;
    lines.forEach((text,index)=>draw(text,margin,baseline-(lines.length-1-index)*gap,noteSize/(scale*ts)));
  }
  ctx.restore();return {width,height,labels};
}
