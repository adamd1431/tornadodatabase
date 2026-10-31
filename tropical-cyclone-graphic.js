export const DEFAULT_GRAPHIC = Object.freeze({ name:'POLO',identifier:'EP172026',wind:155,pressure:900,peak:3,total:3,showCounter:true,note:'→ third-lowest pressure for an EPac system!',heading:'PEAK INTENSITY:',aspect:'4:3',width:1024,font:'arial',color:'#ffffff',rounding:5,pressureUnit:'mbar',textScale:100,backdrop:25,shadow:true,style:'aura',accent:'#a7b7ff',auraStrength:68,estimateSource:'official',texture:40,year:'2026',officialWind:155,officialPressure:900,ownerWind:null,ownerPressure:null });
export const GRAPHIC_FONTS = { arial:'Arial, Helvetica, sans-serif',roboto:'"Roboto Condensed", Arial, sans-serif',inter:'Inter, Arial, sans-serif' };
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const number = (value,min,max,fallback) => value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value),min,max) : fallback;
const text = (value,limit) => String(value ?? '').trim().slice(0,limit);
const optionalNumber=(value,fallback,min,max)=>{const resolved=value===undefined?fallback:value;return resolved===null||resolved===''?null:number(resolved,min,max,null);};
export function normalizeGraphic(input = {}) {
  const d=DEFAULT_GRAPHIC;
  return {name:text(input.name ?? d.name,80),identifier:text(input.identifier ?? d.identifier,30),wind:number(input.wind,0,500,d.wind),pressure:number(input.pressure,.1,2000,d.pressure),peak:Math.round(number(input.peak,1,99,d.peak)),total:Math.round(number(input.total,1,99,d.total)),showCounter:input.showCounter ?? d.showCounter,note:text(input.note ?? d.note,280),heading:text(input.heading ?? d.heading,60),aspect:['4:3','16:9','1:1'].includes(input.aspect)?input.aspect:d.aspect,width:[1024,2048,3072].includes(Number(input.width))?Number(input.width):d.width,font:Object.hasOwn(GRAPHIC_FONTS,input.font)?input.font:d.font,color:/^#[\da-f]{6}$/i.test(input.color)?input.color:d.color,rounding:[5,1,.01].includes(Number(input.rounding))?Number(input.rounding):d.rounding,pressureUnit:['mbar','mb','hPa'].includes(input.pressureUnit)?input.pressureUnit:d.pressureUnit,textScale:number(input.textScale,75,135,d.textScale),backdrop:number(input.backdrop,0,80,d.backdrop),shadow:input.shadow ?? d.shadow,style:['aura','old-aura','classic'].includes(input.style)?input.style:d.style,accent:/^#[\da-f]{6}$/i.test(input.accent)?input.accent:d.accent,auraStrength:number(input.auraStrength,0,100,d.auraStrength),estimateSource:input.estimateSource==='owner'?'owner':'official',windMissing:input.windMissing??input.wind==='',pressureMissing:input.pressureMissing??input.pressure==='',texture:number(input.texture,0,100,d.texture),year:/^\d{4}$/.test(String(input.year??d.year))?String(input.year??d.year):'',officialWind:optionalNumber(input.officialWind,d.officialWind,0,500),officialPressure:optionalNumber(input.officialPressure,d.officialPressure,.1,2000),ownerWind:optionalNumber(input.ownerWind,d.ownerWind,0,500),ownerPressure:optionalNumber(input.ownerPressure,d.ownerPressure,.1,2000)};
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
  return {knots:value,mph,kph,line:`${displayNumber(mph,2)} mph (${displayNumber(value)} knots; ${displayNumber(kph,2)} km/h)`};
}
export function graphicEstimateValues(row,source='official') {
  const owner=source==='owner',mph=row[owner?'owner_estimated_winds_mph':'peak_winds_mph'],pressure=row[owner?'owner_estimated_pressure_mb':'lowest_pressure_mb'];
  const valid=value=>value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>0;
  const knots=Number(mph)/1.1507794480235;
  return {wind:valid(mph)?Number(knots.toFixed(4)):'',pressure:valid(pressure)?Number(pressure):''};
}
export function graphicEstimateSections(input) {
  const s=normalizeGraphic(input);
  return ['official','owner'].map(source=>({source,label:source==='official'?'OFFICIAL ESTIMATES':'OWNER ESTIMATES',wind:s[`${source}Wind`]===null?null:graphicWind(s[`${source}Wind`],s.rounding),pressure:s[`${source}Pressure`]}));
}
export function graphicLabels(input) {
  const s=normalizeGraphic(input),name=s.name.toUpperCase()||'STORM',titleName=name+(s.style==='aura'&&s.year?` ${s.year}`:'');
  let wind=s.windMissing?'Wind not provided':graphicWind(s.wind,s.rounding).line,pressure=s.pressureMissing?'Pressure not provided':`${displayNumber(s.pressure)} ${s.pressureUnit}`;
  if(s.style==='aura'){
    const sections=graphicEstimateSections(s);
    wind=sections.map(section=>`${section.label}: ${section.wind?.line||'Wind not provided'}`).join('. ');
    pressure=sections.map(section=>`${section.label}: ${section.pressure===null?'Pressure not provided':displayNumber(section.pressure)+' '+s.pressureUnit}`).join('. ');
  }
  return {header:s.showCounter?`${name} PEAK ${s.peak} out of ${s.total}`:'',title:s.identifier?`(${s.identifier.toUpperCase()}) ${titleName}`:titleName,heading:s.heading,wind,pressure,note:s.note,estimate:s.style==='aura'?'OFFICIAL + OWNER ESTIMATES':s.estimateSource==='owner'?'OWNER ESTIMATES':'OFFICIAL FIGURES'};
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

function drawEstimateBadge(ctx,state,value,x,y,maxWidth) {
  const scale=state.width/1024;
  ctx.save();ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.letterSpacing='0px';
  fittedFont(ctx,value,13*scale,maxWidth-28*scale,GRAPHIC_FONTS[state.font],10*scale,'700');
  const width=ctx.measureText(value).width+28*scale;
  ctx.fillStyle='rgba(4,9,18,.78)';ctx.strokeStyle=alpha(state.accent,.35);ctx.lineWidth=scale;
  ctx.beginPath();ctx.roundRect(x,y,width,36*scale,4*scale);ctx.fill();ctx.stroke();
  ctx.fillStyle=state.color;ctx.fillText(value,x+14*scale,y+23*scale);ctx.restore();
}

function oldAuraLighting(ctx,state,width,height) {
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

function drawOldAuraLabels(ctx,state,width,height,labels) {
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
  drawEstimateBadge(ctx,state,labels.estimate,44*scale,32*scale,maxWidth*.58);
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
  stat(state.windMissing?'—':displayNumber(wind.mph,2),'MPH',state.windMissing?'Wind estimate needed':`${displayNumber(wind.knots)} knots · ${displayNumber(wind.kph,2)} km/h`,margin);
  stat(state.pressureMissing?'—':displayNumber(state.pressure),state.pressureUnit,'Central pressure',rightX);
}

let auraGrainTile;
function drawAuraTexture(ctx,state,width,height) {
  if(!state.texture)return;
  if(!auraGrainTile){
    const tile=typeof OffscreenCanvas==='function'?new OffscreenCanvas(192,192):document.createElement('canvas');
    tile.width=192;tile.height=192;
    const texture=tile.getContext('2d'),pixels=texture.createImageData(192,192);
    let seed=0x41a7c3;
    for(let i=0;i<pixels.data.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const value=seed>>>24;pixels.data[i]=value;pixels.data[i+1]=value;pixels.data[i+2]=value;pixels.data[i+3]=255;
    }
    texture.putImageData(pixels,0,0);auraGrainTile=tile;
  }
  const pattern=ctx.createPattern(auraGrainTile,'repeat');if(!pattern)return;
  const scale=width/1024;
  ctx.save();ctx.scale(scale,scale);ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=state.texture/100*.32;
  ctx.fillStyle=pattern;ctx.fillRect(0,0,width/scale,height/scale);ctx.restore();
}

function auraLayout(ctx,state,width,height,labels) {
  const scale=width/1024,margin=56*scale,maxWidth=width-2*margin,family=GRAPHIC_FONTS[state.font];
  let ts=state.textScale/100,layout;
  for(let pass=0;pass<4;pass++){
    const unit=scale*ts,detailY=height-38*scale,statY=detailY-35*unit,panelY=statY-56*unit;
    const headingY=panelY-18*unit,titleY=headingY-36*unit,idY=titleY-91*unit;
    ctx.letterSpacing='0px';ctx.font=`600 ${17*unit}px ${family}`;
    const noteLines=labels.note?wrapText(ctx,labels.note,maxWidth*.9):[];
    const noteY=idY-31*unit-(noteLines.length-1)*23*unit;
    const top=noteLines.length?noteY-17*unit:state.identifier?idY-14*unit:titleY-76*unit;
    layout={scale,unit,margin,maxWidth,family,detailY,statY,panelY,headingY,titleY,idY,noteLines,noteY};
    const available=height*.55;
    if(height-22*scale-top<=available)break;
    ts*=available/(height-22*scale-top);
  }
  return layout;
}

function auraLighting(ctx,state,width,height) {
  oldAuraLighting(ctx,state,width,height);
  drawAuraTexture(ctx,state,width,height);
}

function drawAuraLabels(ctx,state,width,height,labels,layout) {
  const {scale,unit,margin,maxWidth,family,detailY,statY,panelY,headingY,titleY,idY,noteLines,noteY}=layout;
  const accent=blend(state.accent,'#ffffff',.12);
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.lineJoin='round';ctx.letterSpacing='0px';
  const plain=(value,x,y,size,{color=state.color,face='700',max=maxWidth,spacing=0,glow=0}={})=>{
    ctx.save();ctx.fillStyle=color;ctx.letterSpacing=`${spacing}px`;
    const fitted=fittedFont(ctx,value,size,max,family,10*scale,face);
    if(glow){ctx.shadowColor=alpha(state.accent,.7);ctx.shadowBlur=glow*state.auraStrength/100;ctx.fillText(value,x,y);ctx.shadowBlur=0;}
    if(state.shadow){ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=5*scale;ctx.shadowOffsetY=scale;}
    ctx.fillText(value,x,y);const measured=ctx.measureText(value).width;ctx.restore();return {width:measured,size:fitted};
  };
  const glass=(x,y,w,h,radius)=>{
    ctx.save();ctx.shadowColor='rgba(0,0,0,.24)';ctx.shadowBlur=20*scale;ctx.shadowOffsetY=5*scale;
    const fill=ctx.createLinearGradient(x,y,x+w,y+h);
    fill.addColorStop(0,'rgba(35,44,72,.58)');fill.addColorStop(.45,'rgba(14,22,42,.48)');fill.addColorStop(1,'rgba(6,12,27,.69)');
    ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    const edge=ctx.createLinearGradient(x,y,x+w,y+h);
    edge.addColorStop(0,alpha(state.color,.3));edge.addColorStop(.45,alpha(state.accent,.18));edge.addColorStop(1,alpha(state.color,.08));
    ctx.strokeStyle=edge;ctx.lineWidth=scale;ctx.stroke();
    ctx.save();ctx.clip();drawAuraTexture(ctx,state,width,height);
    ctx.strokeStyle=alpha(state.color,.025*state.texture/100);ctx.lineWidth=.6*scale;
    for(let line=y+3*scale;line<y+h;line+=4*scale){ctx.beginPath();ctx.moveTo(x,line);ctx.lineTo(x+w,line);ctx.stroke();}
    ctx.restore();ctx.restore();
  };
  const chip=(value,x,max,align='left')=>{
    ctx.save();ctx.font=`700 ${12*scale}px ${family}`;ctx.letterSpacing=`${.65*scale}px`;
    const fontSize=fittedFont(ctx,value,12*scale,max-32*scale,family,10*scale,'700');
    const w=ctx.measureText(value).width+32*scale,left=align==='right'?x-w:x,y=32*scale,h=38*scale;
    glass(left,y,w,h,h/2);
    plain(value,left+16*scale,y+24*scale,fontSize,{color:blend(state.color,state.accent,.12),spacing:.65*scale,max:max-32*scale});ctx.restore();
  };
  chip(labels.estimate,36*scale,maxWidth*.57);
  if(state.showCounter)chip(`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`,width-36*scale,maxWidth*.35,'right');

  noteLines.forEach((line,index)=>plain(line,margin,noteY+index*23*unit,17*unit,{color:blend(state.color,state.accent,.13),face:'600'}));
  if(state.identifier)plain(state.identifier.toUpperCase(),margin,idY,13*unit,{color:accent,spacing:2.8*unit});
  const titleGradient=ctx.createLinearGradient(0,titleY-96*unit,0,titleY+8*scale);
  titleGradient.addColorStop(0,state.color);titleGradient.addColorStop(.55,state.color);titleGradient.addColorStop(1,blend(state.color,state.accent,.45));
  ctx.save();ctx.font=`700 ${22*unit}px ${family}`;const yearWidth=state.year?ctx.measureText(state.year).width:0;ctx.restore();
  const title=plain(state.name.toUpperCase()||'STORM',margin-4*scale,titleY,96*unit,{color:titleGradient,face:'italic 900',glow:26*scale,max:maxWidth-(state.year?yearWidth+24*unit:0)});
  if(state.year)plain(state.year,margin+title.width+16*unit,titleY-7*unit,22*unit,{color:accent,max:yearWidth+4*unit});
  const ruleWidth=Math.min(maxWidth*.68,Math.max(220*scale,title.width));
  const rule=ctx.createLinearGradient(margin,0,margin+ruleWidth,0);
  rule.addColorStop(0,alpha(state.accent,.8));rule.addColorStop(1,alpha(state.accent,0));ctx.fillStyle=rule;ctx.fillRect(margin,titleY+15*unit,ruleWidth,scale);
  if(labels.heading)plain(labels.heading.replace(/:\s*$/,'').toUpperCase(),margin,headingY,11*unit,{color:alpha(state.color,.75),spacing:2.1*unit});

  const column=maxWidth*.46,rightX=margin+maxWidth*.54;
  const source=(section,x)=>{
    plain(section.label,x,statY-49*unit,11*unit,{color:accent,spacing:1.3*unit,max:column});
    const windWidth=column*.58,pressureX=x+column*.64,pressureWidth=column*.36;
    const numberWithUnit=(value,label,left,size,max)=>{
      ctx.save();ctx.font=`700 ${12*unit}px ${family}`;const unitWidth=ctx.measureText(label).width;ctx.restore();
      const valueWidth=plain(value,left,statY,size*unit,{face:'800',max:max-unitWidth-10*unit}).width;
      plain(label,left+valueWidth+8*unit,statY-3*unit,12*unit,{color:accent,max:unitWidth+3*unit});
    };
    numberWithUnit(section.wind?displayNumber(section.wind.mph,2):'—','MPH',x,52,windWidth);
    plain(section.wind?`${displayNumber(section.wind.knots)} knots · ${displayNumber(section.wind.kph,2)} km/h`:'Not provided',x,detailY,15*unit,{color:blend(state.color,'#b7c4da',.3),face:'500',max:windWidth});
    numberWithUnit(section.pressure===null?'—':displayNumber(section.pressure),state.pressureUnit,pressureX,42,pressureWidth);
    plain(section.pressure===null?'Not provided':'Pressure',pressureX,detailY,12*unit,{color:blend(state.color,'#b7c4da',.3),face:'500',max:pressureWidth});
  };
  const sections=graphicEstimateSections(state);source(sections[0],margin);source(sections[1],rightX);
  ctx.save();const frame=ctx.createLinearGradient(0,0,width,height);
  frame.addColorStop(0,alpha(state.color,.22));frame.addColorStop(.4,alpha(state.color,.04));frame.addColorStop(1,alpha(state.accent,.14));
  ctx.strokeStyle=frame;ctx.lineWidth=scale;ctx.beginPath();ctx.roundRect(10.5*scale,10.5*scale,width-21*scale,height-21*scale,24*scale);ctx.stroke();ctx.restore();
}

export function drawCycloneGraphic(ctx,image,input,frame={}) {
  const state=normalizeGraphic(input),{width,height}=graphicDimensions(state),labels=graphicLabels(state);
  ctx.save();ctx.clearRect(0,0,width,height);
  if(state.style==='aura'){ctx.beginPath();ctx.roundRect(0,0,width,height,32*width/1024);ctx.clip();}
  ctx.fillStyle='#07111f';ctx.fillRect(0,0,width,height);
  if(image){const r=imageFrame(image.width,image.height,width,height,frame);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.save();const a=state.auraStrength/100;if(state.style==='aura'||state.style==='old-aura')ctx.filter=`contrast(${1+.3*a}) saturate(${1+.18*a}) brightness(${1-.13*a})`;ctx.drawImage(image,r.x,r.y,r.width,r.height);ctx.restore();}
  else{ctx.fillStyle='#879ab6';ctx.font=`500 ${width/42}px Arial`;ctx.textAlign='center';ctx.fillText('Add a satellite image',width/2,height*.44);}
  if(state.backdrop){const shade=ctx.createLinearGradient(0,height*.5,0,height);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,`rgba(0,0,0,${state.backdrop/100})`);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);}
  if(state.style==='aura'){const layout=auraLayout(ctx,state,width,height,labels);auraLighting(ctx,state,width,height,layout);drawAuraLabels(ctx,state,width,height,labels,layout);ctx.restore();return {width,height,labels};}
  if(state.style==='old-aura'){oldAuraLighting(ctx,state,width,height);drawOldAuraLabels(ctx,state,width,height,labels);ctx.restore();return {width,height,labels};}
  const scale=width/1024,ts=state.textScale/100,family=GRAPHIC_FONTS[state.font],margin=32*scale,maxWidth=width-2*margin;
  ctx.fillStyle=state.color;ctx.strokeStyle='rgba(0,0,0,.42)';ctx.lineJoin='round';ctx.textBaseline='alphabetic';ctx.lineWidth=1.1*scale;
  if(state.shadow){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=4*scale;ctx.shadowOffsetY=1.5*scale;}
  const draw=(line,x,y,size,align='left')=>{ctx.textAlign=align;fittedFont(ctx,line,size*scale*ts,maxWidth,family,10*scale);if(state.shadow)ctx.strokeText(line,x,y);ctx.fillText(line,x,y);};
  if(labels.header)draw(labels.header,width-margin,57*scale,26,'right');
  drawEstimateBadge(ctx,state,labels.estimate,margin,80*scale,maxWidth);
  const bottom=height-36*scale;
  draw(labels.pressure,margin,bottom,30);
  const wind=graphicWind(state.wind,state.rounding),detailY=bottom-36*scale*ts,windY=detailY-36*scale*ts,headingY=windY-60*scale*ts;
  draw(state.windMissing?'Wind estimate needed':`${displayNumber(wind.knots)} knots · ${displayNumber(wind.kph,2)} km/h`,margin,detailY,22);
  draw(state.windMissing?'— mph':`${displayNumber(wind.mph,2)} mph`,margin,windY,48);
  draw(labels.heading,margin,headingY,30);
  const titleY=headingY-49*scale*ts;
  draw(labels.title,margin,titleY,36);
  if(labels.note){
    let noteSize=19*scale*ts;ctx.font=`700 ${noteSize}px ${family}`;let lines=wrapText(ctx,labels.note,maxWidth);
    while(lines.length>3&&noteSize>12*scale){noteSize-=scale;ctx.font=`700 ${noteSize}px ${family}`;lines=wrapText(ctx,labels.note,maxWidth);}
    const gap=noteSize*1.2,baseline=titleY-46*scale*ts;
    lines.forEach((text,index)=>draw(text,margin,baseline-(lines.length-1-index)*gap,noteSize/(scale*ts)));
  }
  ctx.restore();return {width,height,labels};
}
