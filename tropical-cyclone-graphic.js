import { GRAPHIC_FONTS, canonicalGraphicFont, graphicCanvasFont } from './graphic-fonts.js';
export { GRAPHIC_FONTS } from './graphic-fonts.js';
export const DEFAULT_GRAPHIC = Object.freeze({ name:'POLO',identifier:'EP172026',wind:155,pressure:900,peak:3,total:3,showCounter:false,note:'→ third-lowest pressure for an EPac system!',heading:'PEAK INTENSITY:',aspect:'4:3',ratioWidth:4,ratioHeight:3,width:1024,font:'inter',color:'#ffffff',rounding:.1,pressureUnit:'mb',textScale:100,subtitleScale:100,noteScale:100,insetSize:32,backdrop:25,topShadow:34,bottomShadow:34,shadow:true,style:'aura',accent:'#b13c97',auraStrength:17,estimateSource:'official',texture:51,year:'2026',officialWind:155,officialPressure:900,ownerWind:null,ownerPressure:null,topLeftBadge:'rank',rank:20,subtitle:'',monochrome:false,headingAlign:'center',outline:'none',outlineColor:'#ffffff',cornerRadius:null,headingGlow:false });
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export const dualGraphicStyle = style => ['aura','new-aura','aesthetic','aesthetic2'].includes(style);
const number = (value,min,max,fallback) => value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value),min,max) : fallback;
const text = (value,limit) => String(value ?? '').trim().slice(0,limit);
const optionalNumber=(value,fallback,min,max)=>{const resolved=value===undefined?fallback:value;return resolved===null||resolved===''?null:number(resolved,min,max,null);};
const positiveNumber=(value,fallback)=>value!==''&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
function normalizedAspect(value,fallback) {
  if(value==='custom')return value;
  const parts=String(value??'').split(':');
  return parts.length===2&&parts.every(part=>positiveNumber(part,null)!==null)?parts.map(Number).join(':'):fallback;
}
export function normalizeGraphic(input = {}) {
  const d=DEFAULT_GRAPHIC;
  return {name:text(input.name ?? d.name,80),identifier:text(input.identifier ?? d.identifier,30),wind:number(input.wind,0,500,d.wind),pressure:number(input.pressure,.1,2000,d.pressure),peak:Math.round(number(input.peak,1,99,d.peak)),total:Math.round(number(input.total,1,99,d.total)),showCounter:input.showCounter ?? d.showCounter,note:text(input.note ?? d.note,280),heading:text(input.heading ?? d.heading,60),aspect:normalizedAspect(input.aspect,d.aspect),ratioWidth:positiveNumber(input.ratioWidth,d.ratioWidth),ratioHeight:positiveNumber(input.ratioHeight,d.ratioHeight),width:[1024,2048,3072].includes(Number(input.width))?Number(input.width):d.width,font:Object.hasOwn(GRAPHIC_FONTS,canonicalGraphicFont(input.font))?canonicalGraphicFont(input.font):d.font,color:/^#[\da-f]{6}$/i.test(input.color)?input.color:d.color,rounding:d.rounding,pressureUnit:input.pressureUnit==='hPa'?'hPa':'mb',textScale:number(input.textScale,75,135,d.textScale),subtitleScale:number(input.subtitleScale,50,250,d.subtitleScale),noteScale:number(input.noteScale,50,250,d.noteScale),insetSize:number(input.insetSize,15,45,d.insetSize),backdrop:number(input.backdrop,0,80,d.backdrop),topShadow:number(input.topShadow,0,100,d.topShadow),bottomShadow:number(input.bottomShadow,0,100,d.bottomShadow),shadow:input.shadow ?? d.shadow,style:['aura','new-aura','aesthetic','aesthetic2','old-aura','classic'].includes(input.style)?input.style:d.style,accent:/^#[\da-f]{6}$/i.test(input.accent)?input.accent:d.accent,auraStrength:number(input.auraStrength,0,100,d.auraStrength),estimateSource:input.estimateSource==='owner'?'owner':'official',windMissing:input.windMissing??input.wind==='',pressureMissing:input.pressureMissing??input.pressure==='',texture:number(input.texture,0,100,d.texture),year:/^\d{4}$/.test(String(input.year??d.year))?String(input.year??d.year):'',officialWind:optionalNumber(input.officialWind,d.officialWind,0,500),officialPressure:optionalNumber(input.officialPressure,d.officialPressure,.1,2000),ownerWind:optionalNumber(input.ownerWind,d.ownerWind,0,500),ownerPressure:optionalNumber(input.ownerPressure,d.ownerPressure,.1,2000),topLeftBadge:['estimates','rank','hidden'].includes(input.topLeftBadge)?input.topLeftBadge:d.topLeftBadge,rank:Math.round(number(input.rank,1,99999,d.rank)),subtitle:text(input.subtitle??d.subtitle,160),monochrome:input.monochrome??d.monochrome,headingAlign:['left','center','right'].includes(input.headingAlign)?input.headingAlign:d.headingAlign,outline:['none','aura','silver','custom'].includes(input.outline)?input.outline:d.outline,outlineColor:/^#[\da-f]{6}$/i.test(input.outlineColor)?input.outlineColor:d.outlineColor,cornerRadius:optionalNumber(input.cornerRadius,d.cornerRadius,0,100),headingGlow:input.headingGlow??d.headingGlow};
}
export function graphicCornerRadius(input) {
  const state=normalizeGraphic(input);
  return dualGraphicStyle(state.style)?state.cornerRadius??(state.style==='aura'?32:28):0;
}
export function graphicDimensions(state) {
  const s=normalizeGraphic(state),[w,h]=s.aspect==='custom'?[s.ratioWidth,s.ratioHeight]:s.aspect.split(':').map(Number);
  const height=Math.max(1,Math.round(s.width*(h/w)));
  if(!Number.isFinite(height)||height>16384||s.width*height>32*1024*1024)throw new RangeError('This ratio is too tall for the selected export width. Choose a smaller export width or reduce the ratio height.');
  return {width:s.width,height};
}
function displayNumber(value) { return Number(value).toFixed(1); }
export function graphicWind(wind) {
  const value=number(wind,0,500,0),round=n=>Math.round((n+Number.EPSILON)*10)/10;
  const mph=round(value*1.1507794480235),kph=round(value*1.852);
  return {knots:value,mph,kph,line:`${displayNumber(mph)} mph (${displayNumber(value)} knots; ${displayNumber(kph)} km/h)`};
}
export function graphicEstimateValues(row,source='official') {
  const owner=source==='owner',mph=row[owner?'owner_estimated_winds_mph':'peak_winds_mph'],savedKnots=row[owner?'owner_estimated_winds_kts':'peak_winds_kts'],pressure=row[owner?'owner_estimated_pressure_mb':'lowest_pressure_mb'];
  const valid=value=>value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>0;
  const knots=valid(savedKnots)?Number(savedKnots):valid(mph)?Number(mph)/1.1507794480235:null;
  return {wind:knots===null?'':Number(knots.toFixed(4)),pressure:valid(pressure)?Number(pressure):''};
}
export function graphicEstimateSections(input) {
  const s=normalizeGraphic(input);
  return ['official','owner'].map(source=>({source,label:source==='official'?'OFFICIAL ESTIMATES (JTWC)':'MY ESTIMATE',wind:s[`${source}Wind`]===null?null:graphicWind(s[`${source}Wind`]),pressure:s[`${source}Pressure`]}));
}
export function graphicTopLeftBadge(input) {
  const s=normalizeGraphic(input);
  if(!dualGraphicStyle(s.style)||s.topLeftBadge==='hidden')return '';
  return s.topLeftBadge==='rank'?`[#${s.rank}]`:'OFFICIAL + MY ESTIMATE';
}
export function graphicLabels(input) {
  const s=normalizeGraphic(input),name=s.name.toUpperCase()||'STORM',titleName=name+(dualGraphicStyle(s.style)&&s.year?` ${s.year}`:'');
  let wind=s.windMissing?'Wind not provided':graphicWind(s.wind).line,pressure=s.pressureMissing?'Pressure not provided':`${displayNumber(s.pressure)} ${s.pressureUnit}`;
  if(dualGraphicStyle(s.style)){
    const sections=graphicEstimateSections(s);
    wind=sections.map(section=>`${section.label}: ${section.wind?.line||'Wind not provided'}`).join('. ');
    pressure=sections.map(section=>`${section.label}: ${section.pressure===null?'Pressure not provided':displayNumber(section.pressure)+' '+s.pressureUnit}`).join('. ');
  }
  return {header:s.showCounter?`${name} PEAK ${s.peak} out of ${s.total}`:'',title:s.identifier?`(${s.identifier.toUpperCase()}) ${titleName}`:titleName,heading:s.heading,wind,pressure,note:s.note,estimate:dualGraphicStyle(s.style)?'OFFICIAL + MY ESTIMATE':s.estimateSource==='owner'?'MY ESTIMATE':'OFFICIAL FIGURES'};
}
export function imageFrame(imageWidth,imageHeight,width,height,{zoom=1,x=50,y=50,fit='cover'}={}) {
  if (![imageWidth,imageHeight,width,height].every(n=>Number.isFinite(n)&&n>0)) throw Error('Invalid image dimensions.');
  const scale=(fit==='contain'?Math.min:Math.max)(width/imageWidth,height/imageHeight)*number(zoom,1,4,1);
  const w=imageWidth*scale,h=imageHeight*scale;
  return {x:(width-w)*number(x,0,100,50)/100,y:(height-h)*number(y,0,100,50)/100,width:w,height:h};
}
export function graphicPhotoArea(style,width,height,input={},ctx) {
  if(style!=='aesthetic2')return {x:0,y:0,width,height};
  const state=normalizeGraphic({...input,style}),scale=width/1024,unit=scale*Math.min(1,height/(width*.75));
  const subtitleExtra=15*unit*Math.min(state.textScale/100,1)*Math.max(0,state.subtitleScale/100-1);
  const noteExtra=ctx?footerNoteLayout(ctx,state,width,height).extra:0,y=172*unit+subtitleExtra;
  return {x:48*scale,y,width:width-96*scale,height:Math.max(1,height-y-208*unit-28*scale-noteExtra)};
}
export function graphicInsetFrame(image,inset,input,frame={},ctx) {
  if(!image||!inset)return null;
  const state=normalizeGraphic(input),{width,height}=graphicDimensions(state),scale=width/1024;
  const area=graphicPhotoArea(state.style,width,height,state,ctx),crop=imageFrame(image.width,image.height,area.width,area.height,frame);
  const left=Math.max(area.x,area.x+crop.x),top=Math.max(area.y,area.y+crop.y);
  const right=Math.min(area.x+area.width,area.x+crop.x+crop.width),imageBottom=Math.min(area.y+area.height,area.y+crop.y+crop.height);
  const photoWidth=right-left,photoHeight=imageBottom-top,padding=Math.min(16*scale,photoWidth*.025,photoHeight*.04);
  let bottom=imageBottom;
  if(state.style!=='aesthetic2'){
    const unit=scale*Math.min(state.textScale/100,height<width*9/16?1:1.35)*Math.min(1,height/(width*.75));
    const extra=ctx?footerNoteLayout(ctx,state,width,height).extra:0;
    const estimateTop=state.style==='aura'?height-245*unit+4*scale-extra:state.style==='new-aura'?height-258*unit-40*scale-extra:state.style==='aesthetic'?height-233*unit-34*scale-extra:height*.65;
    bottom=Math.min(imageBottom,Math.max(top+photoHeight*.6,estimateTop-18*scale));
  }
  const availableHeight=bottom-(top+photoHeight/2)-2*padding;
  if(photoWidth<=0||availableHeight<=0)return null;
  const fit=Math.min(photoWidth*.45/inset.width,availableHeight/inset.height)*state.insetSize/45;
  const insetWidth=inset.width*fit,insetHeight=inset.height*fit;
  return {x:right-padding-insetWidth,y:bottom-padding-insetHeight,width:insetWidth,height:insetHeight,radius:Math.min(10*scale,insetWidth/8,insetHeight/8)};
}
function drawInsetImage(ctx,image,inset,state,frame,width,height) {
  const box=graphicInsetFrame(image,inset,state,frame,ctx);if(!box)return;
  const scale=width/1024,border=Math.min(3*scale,box.width*.025,box.height*.025);
  const area=graphicPhotoArea(state.style,width,height,state,ctx);
  ctx.save();ctx.filter='none';
  if(state.style==='aesthetic2')traceAesthetic2Window(ctx,area,scale);
  else{ctx.beginPath();ctx.roundRect(area.x,area.y,area.width,area.height,0);}
  ctx.clip();
  ctx.fillStyle=state.style==='aesthetic2'?'#fffdf7':'#ffffff';ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=12*scale;ctx.shadowOffsetY=3*scale;
  ctx.beginPath();ctx.roundRect(box.x-border,box.y-border,box.width+2*border,box.height+2*border,box.radius+border);ctx.fill();
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.beginPath();ctx.roundRect(box.x,box.y,box.width,box.height,box.radius);ctx.clip();
  ctx.drawImage(inset,box.x,box.y,box.width,box.height);ctx.restore();
}

export function graphicFilename(input) {
  const s=normalizeGraphic(input),stem=(s.name||'tropical-cyclone').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
  return `${stem||'tropical-cyclone'}${s.identifier?'-'+s.identifier.toLowerCase().replace(/[^a-z0-9-]/g,''):''}-peak-${s.peak}.png`;
}
export function shortStormName(value) { return String(value||'').replace(/^(?:(?:super\s+)?typhoon|hurricane|(?:severe\s+)?tropical\s+(?:cyclone|storm|depression)|cyclone)\s+/i,'').replace(/\s*\([^)]*\)/g,'').trim(); }

function fittedFont(ctx,line,size,maxWidth,family,minSize=10,face='700') {
  ctx.font=graphicCanvasFont(family,size,face);
  const measured=ctx.measureText(line).width;
  const fitted=measured>maxWidth?Math.max(minSize,size*maxWidth/measured):size;
  ctx.font=graphicCanvasFont(family,fitted,face);
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

function footerNoteLayout(ctx,state,width,height) {
  const scale=width/1024,ratio=state.noteScale/100,fall=state.style==='aesthetic2',aura=state.style==='aura',modern=state.style==='new-aura';
  const family=fall?'Arial, Helvetica, sans-serif':GRAPHIC_FONTS[state.font],face=modern?'600':'500';
  const baseSize=fall?10:aura?12:11,lineHeight=(fall?14:aura?16:15)*scale*ratio;
  const size=baseSize*scale*ratio,margin=(aura?36:fall?40:48)*scale;
  ctx.save();ctx.font=graphicCanvasFont(family,size,face);ctx.letterSpacing='0px';
  const lines=wrapText(ctx,state.note,width-2*margin);ctx.restore();
  const bottom=(fall?15:modern?20:18)*scale,baseline=height-bottom;
  const firstBaseline=baseline-Math.max(0,lines.length-1)*lineHeight;
  // The original footer already has room for two default-size lines.
  const extra=lines.length?Math.max(0,size+Math.max(0,lines.length-1)*lineHeight-(baseSize+(fall?14:aura?16:15))*scale):0;
  return {lines,size,lineHeight,firstBaseline,extra,family,face,margin,align:modern?'left':'center'};
}
function drawFooterNote(ctx,state,width,height) {
  if(!state.note)return;
  const note=footerNoteLayout(ctx,state,width,height),opacity=state.style==='aura'?.58:state.style==='aesthetic2'?.65:.66;
  ctx.save();ctx.font=graphicCanvasFont(note.family,note.size,note.face);ctx.textAlign=note.align;ctx.letterSpacing='0px';ctx.fillStyle=alpha(state.color,opacity);
  if(state.style!=='aesthetic2'&&state.shadow){ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=5*width/1024;ctx.shadowOffsetY=width/1024;}
  note.lines.forEach((line,index)=>ctx.fillText(line,note.align==='left'?note.margin:width/2,note.firstBaseline+index*note.lineHeight));ctx.restore();
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
    ctx.save();ctx.fillStyle=color;ctx.font=graphicCanvasFont(family,size*scale*ts,"700");
    const glyphs=[...value],gap=spacing*scale,full=ctx.measureText(value).width+Math.max(0,glyphs.length-1)*gap;
    const ratio=Math.min(1,max/Math.max(1,full));ctx.font=graphicCanvasFont(family,size*scale*ts*ratio,"700");
    for(const glyph of glyphs){ctx.fillText(glyph,x,y);x+=ctx.measureText(glyph).width+gap*ratio;}ctx.restore();
  };
  drawEstimateBadge(ctx,state,labels.estimate,44*scale,32*scale,maxWidth*.58);
  if(state.showCounter){
    const counter=`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`;
    ctx.save();ctx.font=graphicCanvasFont(family,13*scale,"700");
    const boxWidth=ctx.measureText(counter).width+36*scale,x=width-margin-boxWidth,y=32*scale,h=36*scale;
    ctx.fillStyle='rgba(5,10,26,.62)';ctx.strokeStyle=alpha(state.accent,.38);ctx.lineWidth=scale;
    ctx.beginPath();ctx.roundRect(x,y,boxWidth,h,5*scale);ctx.fill();ctx.stroke();
    ctx.fillStyle=state.color;ctx.fillText(counter,x+18*scale,y+23*scale);ctx.restore();
  }
  const detailY=height-34*scale,statY=detailY-35*scale*ts,titleY=statY-105*scale*ts,idY=titleY-95*scale*ts;
  if(labels.note){
    let fontSize=17*scale*ts*state.noteScale/100;ctx.font=graphicCanvasFont(family,fontSize,"600");let lines=wrapText(ctx,labels.note,maxWidth*.87);
    while(state.noteScale===100&&lines.length>3&&fontSize>11*scale){fontSize-=scale;ctx.font=graphicCanvasFont(family,fontSize,"600");lines=wrapText(ctx,labels.note,maxWidth*.87);}
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
  const blockWidth=maxWidth*.47,rightX=margin+maxWidth*.54,wind=graphicWind(state.wind);
  const stat=(value,unit,detail,x)=>{
    const unitSize=13*scale*ts;ctx.font=graphicCanvasFont(family,unitSize,"700");
    const unitWidth=ctx.measureText(unit).width,numberWidth=plain(value,x,statY,50,{face:'800',max:blockWidth-unitWidth-14*scale});
    plain(unit,x+numberWidth+12*scale,statY-3*scale,13,{color:state.accent,max:unitWidth+3*scale});
    plain(detail,x,detailY,15,{color:alpha(state.color,.72),face:'500',max:blockWidth});
  };
  stat(state.windMissing?'—':displayNumber(wind.mph),'MPH',state.windMissing?'Wind estimate needed':`${displayNumber(wind.knots)} knots · ${displayNumber(wind.kph)} km/h`,margin);
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
  const scale=width/1024,unit=scale*Math.min(state.textScale/100,height<width*9/16?1:1.35)*Math.min(1,height/(width*.75));
  return {scale,unit,margin:36*scale,maxWidth:width-72*scale,family:GRAPHIC_FONTS[state.font],footerY:height-245*unit+4*scale-footerNoteLayout(ctx,state,width,height).extra};
}

function auraShadows(ctx,state,width,height) {
  if(state.backdrop){const shade=ctx.createLinearGradient(0,height*.5,0,height);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,`rgba(0,0,0,${state.backdrop/100})`);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);}
  const vignette=ctx.createRadialGradient(width*.5,height*.44,width*.09,width*.5,height*.44,Math.max(width,height)*.73);
  vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(.42,'rgba(0,0,0,.18)');vignette.addColorStop(.76,'rgba(0,0,0,.88)');vignette.addColorStop(1,'rgba(0,0,0,1)');
  ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
  const top=ctx.createLinearGradient(0,0,0,height*.33);
  top.addColorStop(0,'rgba(0,0,0,.95)');top.addColorStop(.5,'rgba(0,0,0,.72)');top.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=top;ctx.fillRect(0,0,width,height);
  const bottom=ctx.createLinearGradient(0,height*.46,0,height);
  bottom.addColorStop(0,'rgba(0,0,0,0)');bottom.addColorStop(.48,'rgba(0,0,0,.86)');bottom.addColorStop(1,'rgba(0,0,0,.99)');ctx.fillStyle=bottom;ctx.fillRect(0,0,width,height);
}

let auraShadowLayer;
function auraLighting(ctx,state,width,height) {
  const top=state.topShadow,bottom=state.bottomShadow;
  // Keep the original draw order and exact pixels at the original 50% midpoint.
  if(top===50&&bottom===50)auraShadows(ctx,state,width,height);
  else if(top||bottom){
    if(!auraShadowLayer)auraShadowLayer=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');
    if(auraShadowLayer.width!==width)auraShadowLayer.width=width;
    if(auraShadowLayer.height!==height)auraShadowLayer.height=height;
    const shade=auraShadowLayer.getContext('2d');shade.clearRect(0,0,width,height);
    auraShadows(shade,state,width,height);
    // Fade every shading layer, including the vignette, out of each region.
    shade.save();shade.globalCompositeOperation='destination-in';
    const mask=shade.createLinearGradient(0,0,0,height),topAlpha=Math.min(1,top/50),bottomAlpha=Math.min(1,bottom/50);
    for(const [stop,opacity]of [[0,topAlpha],[.33,topAlpha],[.46,bottomAlpha],[1,bottomAlpha]])mask.addColorStop(stop,`rgba(0,0,0,${opacity})`);
    shade.fillStyle=mask;shade.fillRect(0,0,width,height);shade.restore();
    const start=top?0:height*.33,end=bottom?height:height*.46;
    ctx.drawImage(auraShadowLayer,0,start,width,end-start,0,start,width,end-start);
    // Above the default, deepen each fade until its outer region is solid black.
    if(top>50){const fade=ctx.createLinearGradient(0,0,0,height*.33),opacity=(top-50)/50;fade.addColorStop(0,`rgba(0,0,0,${opacity})`);fade.addColorStop(.5,`rgba(0,0,0,${opacity})`);fade.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=fade;ctx.fillRect(0,0,width,height*.33);}
    if(bottom>50){const fade=ctx.createLinearGradient(0,height*.46,0,height),opacity=(bottom-50)/50;fade.addColorStop(0,'rgba(0,0,0,0)');fade.addColorStop(.48,`rgba(0,0,0,${opacity})`);fade.addColorStop(1,`rgba(0,0,0,${opacity})`);ctx.fillStyle=fade;ctx.fillRect(0,height*.46,width,height*.54);}
  }
  drawAuraTexture(ctx,state,width,height);
}

function drawAuraOutline(ctx,state,width,height) {
  if(state.outline==='none')return;
  const scale=width/1024,radius=graphicCornerRadius(state)*scale;
  ctx.save();ctx.lineWidth=Math.min(2*scale,width,height);ctx.lineJoin='miter';
  const inset=ctx.lineWidth/2;
  ctx.strokeStyle=state.outline==='custom'?state.outlineColor:state.outline==='aura'?blend(state.accent,state.color,.3):alpha(state.color,.72);
  if(state.outline==='aura'){ctx.shadowColor=state.accent;ctx.shadowBlur=10*scale;}
  ctx.beginPath();ctx.roundRect(inset,inset,width-2*inset,height-2*inset,Math.max(0,radius-inset));ctx.stroke();ctx.restore();
}

function drawAuraLabels(ctx,state,width,height,labels,layout) {
  const {scale,unit,margin,maxWidth,family,footerY}=layout;
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.letterSpacing='0px';ctx.lineJoin='round';
  const text=(value,x,y,size,{color=state.color,face='700',max=maxWidth,spacing=0,align='left',glow=false}={})=>{
    ctx.save();ctx.fillStyle=color;ctx.letterSpacing=`${spacing}px`;ctx.textAlign=align;
    const fitted=fittedFont(ctx,value,size,max,family,9*scale,face);
    if(glow){ctx.shadowColor=state.accent;ctx.shadowBlur=30*scale*state.auraStrength/100;ctx.shadowOffsetY=0;ctx.fillText(value,x,y);ctx.shadowBlur=0;}
    if(state.shadow){ctx.shadowColor='rgba(0,0,0,.92)';ctx.shadowBlur=5*scale;ctx.shadowOffsetY=2*scale;}
    ctx.fillText(value,x,y);const metrics=ctx.measureText(value);ctx.restore();return {width:metrics.width,size:fitted,ascent:metrics.actualBoundingBoxAscent||fitted*.75};
  };
  const silver=(top,bottom)=>{
    const g=ctx.createLinearGradient(0,top,0,bottom);
    g.addColorStop(0,state.color);g.addColorStop(.45,blend(state.color,'#dedde0',.6));g.addColorStop(1,blend(state.color,'#88818c',.62));return g;
  };
  const rankShown=state.topLeftBadge==='rank',title=state.name.toUpperCase()||'STORM',rank=String(state.rank),baseSize=144*unit;
  const subtitle=[state.subtitle||state.identifier||'TROPICAL CYCLONE',state.year&&!(state.subtitle||'').includes(state.year)?state.year:''].filter(Boolean).join(' · ').toUpperCase();
  // Fit the heading as one group so the rank and name always use the same font size.
  ctx.save();ctx.letterSpacing='0px';ctx.font=graphicCanvasFont(family,baseSize,"900");
  const naturalRankWidth=rankShown?Math.max(ctx.measureText(rank).width+52*unit,(ctx.measureText(rank).width+16*unit)/.7):0;
  const naturalWidth=ctx.measureText(title).width+naturalRankWidth+(rankShown?30*unit:0);
  ctx.restore();
  const widthFit=Math.min(1,maxWidth/Math.max(1,naturalWidth));
  const measureHeading=headingScale=>{
    const fit=widthFit*headingScale,titleSize=baseSize*fit;
    ctx.save();ctx.letterSpacing='0px';ctx.font=graphicCanvasFont(family,titleSize,"900");
    const titleMetrics=ctx.measureText(title),rankMetrics=ctx.measureText(rank);
    const titleAscent=Math.max(titleMetrics.actualBoundingBoxAscent||titleSize*.75,rankShown?(rankMetrics.actualBoundingBoxAscent||titleSize*.75):0);
    const titleDescent=Math.max(titleMetrics.actualBoundingBoxDescent||0,rankShown?(rankMetrics.actualBoundingBoxDescent||0):0);
    const symbolHeight=(titleAscent*.5+12*unit*fit)/.72;
    const titleTop=rankShown?Math.max(42*scale,symbolHeight-titleAscent*.51+24*scale):(state.topLeftBadge==='estimates'?58:42)*scale,titleY=titleTop+titleAscent;
    const headingBottom=Math.max(titleY+titleDescent+6*scale,rankShown?titleY-titleAscent*.49+symbolHeight*1.02+scale:0);
    const subtitleSpacing=.6*unit*headingScale;ctx.letterSpacing=`${subtitleSpacing}px`;
    const subtitleSize=fittedFont(ctx,subtitle,23*unit*headingScale*state.subtitleScale/100,maxWidth,family,Math.min(9*scale,23*unit*headingScale*state.subtitleScale/100),'700');
    const subtitleMetrics=ctx.measureText(subtitle),subtitleAscent=subtitleMetrics.actualBoundingBoxAscent||subtitleSize*.75;
    const subtitleY=headingBottom+10*scale+subtitleAscent;
    const bottom=subtitleY+Math.max(7*scale,(subtitleMetrics.actualBoundingBoxDescent||0)+3*scale);
    ctx.restore();
    return {fit,titleSize,titleWidth:titleMetrics.width,rankMetrics,rankWidth:naturalRankWidth*fit,gap:rankShown?30*unit*fit:0,titleAscent,symbolHeight,titleTop,titleY,subtitleSize,subtitleSpacing,subtitleY,bottom};
  };
  // Keep a clear image band between the complete heading and the estimate columns.
  const headingLimit=Math.min(height*.32,footerY-13*unit-height*.24);
  let headingScale=1,heading=measureHeading(headingScale);
  for(let pass=0;pass<3&&heading.bottom>headingLimit;pass++){
    headingScale*=clamp((headingLimit-84*scale)/(heading.bottom-84*scale),.1,.99);
    heading=measureHeading(headingScale);
  }
  const {fit,titleSize,titleWidth,rankMetrics,rankWidth,gap,titleAscent,symbolHeight,titleTop,titleY,subtitleSize,subtitleSpacing,subtitleY}=heading;
  const groupWidth=titleWidth+rankWidth+gap,align=state.headingAlign;
  const groupLeft=align==='left'?margin:align==='right'?width-margin-groupWidth:(width-groupWidth)/2;
  const titleLeft=groupLeft+rankWidth+gap,titleFill=silver(titleTop,titleY+6*scale);
  if(rankShown){
    const cx=groupLeft+rankWidth/2,cy=titleY-titleAscent*.49,rx=rankWidth/2/1.06,ry=symbolHeight;
    const curve=(...points)=>ctx.bezierCurveTo(...points.map((point,index)=>index%2?cy+point*ry:cx+point*rx));
    // The standard hurricane silhouette: two hooked spiral arms around an open eye.
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=2*scale;ctx.strokeStyle=alpha(state.color,.68);
    ctx.beginPath();ctx.moveTo(cx+1.06*rx,cy-.72*ry);
    curve(.52,-1.12,-.25,-1.08,-.70,-.58);
    curve(-1.08,-.15,-.98,.44,-.54,.72);
    curve(-.76,.78,-.92,.78,-1.06,.72);
    curve(-.52,1.12,.25,1.08,.70,.58);
    curve(1.08,.15,.98,-.44,.54,-.72);
    curve(.76,-.78,.92,-.78,1.06,-.72);
    ctx.closePath();ctx.stroke();
    ctx.strokeStyle=alpha(state.color,.28);ctx.lineWidth=1.2*scale;
    ctx.beginPath();ctx.ellipse(cx,cy,rankWidth*.35,ry*.72,0,0,Math.PI*2);ctx.stroke();
    ctx.restore();
    text(rank,cx-rankMetrics.width/2,titleY,titleSize,{color:titleFill,face:'900',max:maxWidth,glow:state.headingGlow});
  }else if(state.topLeftBadge==='estimates')text(labels.estimate,margin,24*scale,12*scale,{spacing:1.2*scale,color:alpha(state.color,.76),max:maxWidth*.7});
  text(title,titleLeft,titleY,titleSize,{face:'900',color:titleFill,max:maxWidth,glow:state.headingGlow});
  if(state.showCounter)text(`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`,width-margin,20*scale,11*scale,{align:'right',color:alpha(state.color,.7),max:maxWidth*.28,spacing:.8*scale});

  const subtitleX=align==='left'?groupLeft:align==='right'?groupLeft+groupWidth:width/2;
  const subtitleText=text(subtitle,subtitleX,subtitleY,subtitleSize,{align,face:'700',max:maxWidth,spacing:subtitleSpacing});
  const subtitleWidth=Math.min(maxWidth,subtitleText.width);
  ctx.fillStyle=alpha(state.color,.6);ctx.fillRect(subtitleX-(align==='center'?subtitleWidth/2:align==='right'?subtitleWidth:0),subtitleY+6*scale,subtitleWidth,scale);

  const sections=graphicEstimateSections(state),column=maxWidth*.46,centers=[margin+column/2,width-margin-column/2];
  const numberText=(value,y,x,max,top)=>{
    if(top!==undefined){ctx.save();ctx.letterSpacing=`${3.4*unit}px`;const size=fittedFont(ctx,value,54*unit,max,family,9*scale,'900');y=top+(ctx.measureText(value).actualBoundingBoxAscent||size*.75);ctx.restore();}
    const g=ctx.createLinearGradient(0,y-52*unit,0,y+4*scale);
    g.addColorStop(0,blend(state.accent,'#ffffff',.17));g.addColorStop(.55,state.accent);g.addColorStop(1,blend(state.accent,'#390f33',.25));
    const result=text(value,x,y,54*unit,{face:'900',color:g,max,spacing:3.4*unit,align:'center'});
    return {top:y-result.ascent};
  };
  const label=(value,y,x,max)=>{
    const result=text(value,x,y,14*unit,{face:'700',spacing:3.3*unit,align:'center',max});
    ctx.fillStyle=alpha(state.color,.37);ctx.fillRect(x-result.width/2,y+4*scale,result.width,scale);
    return y+5*scale;
  };
  sections.forEach((section,index)=>{
    const x=centers[index];
    text(section.label,x,footerY,13*unit,{face:'700',spacing:1.4*unit,align:'center',max:column,color:alpha(state.color,.82)});
    const windUnderline=label('WIND SPEEDS',footerY+30*unit,x,column);
    const mph=section.wind?displayNumber(section.wind.mph):'—';
    const windNumber=numberText(`${mph} MPH`,footerY+81*unit,x,column);
    text(section.wind?`${displayNumber(section.wind.knots)} knots · ${displayNumber(section.wind.kph)} km/h`:'Not provided',x,footerY+106*unit,14*unit,{face:'500',align:'center',max:column,color:alpha(state.color,.72)});
    const pressureUnderline=label('PRESSURE',footerY+136*unit,x,column);
    const pressure=section.pressure===null?'—':displayNumber(section.pressure);
    numberText(`${pressure} ${state.pressureUnit.toUpperCase()}`,footerY+183*unit,x,column,pressureUnderline+windNumber.top-windUnderline);
  });
  drawFooterNote(ctx,state,width,height);
}

function drawNewAuraLabels(ctx,state,width,height,labels) {
  const scale=width/1024,unit=scale*Math.min(state.textScale/100,height<width*9/16?1:1.35)*Math.min(1,height/(width*.75));
  const margin=48*scale,maxWidth=width-2*margin,family=GRAPHIC_FONTS[state.font];
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.letterSpacing='0px';
  const text=(value,x,y,size,{color=state.color,face='600',max=maxWidth,spacing=0,align='left',top,glow=false}={})=>{
    ctx.save();ctx.textAlign=align;ctx.letterSpacing=`${spacing}px`;ctx.fillStyle=color;
    const fitted=fittedFont(ctx,value,size,max,family,9*scale,face),metrics=ctx.measureText(value),ascent=metrics.actualBoundingBoxAscent||fitted*.75;
    if(top!==undefined)y=top+ascent;
    if(glow){ctx.shadowColor=state.accent;ctx.shadowBlur=24*scale;ctx.fillText(value,x,y);ctx.shadowBlur=0;}
    if(state.shadow){ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=4*scale;ctx.shadowOffsetY=scale;}
    ctx.fillText(value,x,y);ctx.restore();return {width:metrics.width,y,top:y-ascent,size:fitted};
  };
  const title=state.name.toUpperCase()||'STORM',rank=String(state.rank),rankShown=state.topLeftBadge==='rank';
  ctx.save();ctx.font=graphicCanvasFont(family,132*unit,"900");
  const naturalRank=rankShown?ctx.measureText(rank).width+64*unit:0;
  const fit=Math.min(1,maxWidth/(ctx.measureText(title).width+naturalRank+(rankShown?28*unit:0)));
  const titleSize=132*unit*fit;ctx.font=graphicCanvasFont(family,titleSize,"900");
  const titleWidth=ctx.measureText(title).width,rankMetrics=ctx.measureText(rank),rankWidth=naturalRank*fit;
  const ascent=ctx.measureText(title).actualBoundingBoxAscent||titleSize*.75;ctx.restore();
  const gap=rankShown?28*unit*fit:0,groupWidth=titleWidth+rankWidth+gap,align=state.headingAlign;
  const left=align==='center'?(width-groupWidth)/2:align==='right'?width-margin-groupWidth:margin;
  const titleY=78*scale+ascent,subtitle=state.subtitle||state.identifier||'TROPICAL CYCLONE';
  text(state.topLeftBadge==='estimates'?labels.estimate:[state.year,'TROPICAL CYCLONE'].filter(Boolean).join(' / '),margin,35*scale,11*scale,{color:alpha(state.color,.76),spacing:2.4*scale,max:maxWidth*.72});
  if(state.showCounter)text(`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`,width-margin,35*scale,11*scale,{align:'right',color:alpha(state.color,.76),max:maxWidth*.25});
  const pearl=ctx.createLinearGradient(0,titleY-ascent,0,titleY+6*scale);
  pearl.addColorStop(0,state.color);pearl.addColorStop(.4,blend(state.color,'#ded8ea',.8));pearl.addColorStop(.72,blend(state.color,state.accent,.65));pearl.addColorStop(1,state.accent);
  if(rankShown){
    const cx=left+rankWidth/2,cy=titleY-ascent*.49,rx=rankWidth*.48,ry=ascent*.78;
    const curve=(...points)=>ctx.bezierCurveTo(...points.map((point,index)=>index%2?cy+point*ry:cx+point*rx));
    ctx.save();ctx.strokeStyle=alpha(state.accent,.7);ctx.lineWidth=1.5*scale;ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(cx+1.06*rx,cy-.72*ry);
    curve(.52,-1.12,-.25,-1.08,-.70,-.58);curve(-1.08,-.15,-.98,.44,-.54,.72);curve(-.76,.78,-.92,.78,-1.06,.72);
    curve(-.52,1.12,.25,1.08,.70,.58);curve(1.08,.15,.98,-.44,.54,-.72);curve(.76,-.78,.92,-.78,1.06,-.72);
    ctx.closePath();ctx.stroke();ctx.restore();
    text(rank,cx-rankMetrics.width/2,titleY,titleSize,{face:'900',color:pearl,glow:state.headingGlow});
  }
  text(title,left+rankWidth+gap,titleY,titleSize,{face:'900',color:pearl,glow:state.headingGlow});
  const subtitleX=align==='center'?left+groupWidth/2:align==='right'?left+groupWidth:left;
  const subtitleY=titleY+(rankShown?52:32)*unit+16*unit*Math.max(0,state.subtitleScale/100-1)*.8+(height<width*9/16&&rankShown?16*(scale-unit):0);
  text(subtitle.toUpperCase(),subtitleX,subtitleY,16*unit*state.subtitleScale/100,{spacing:1.5*unit,align,max:maxWidth,color:alpha(state.color,.86)});
  ctx.fillStyle=state.accent;ctx.fillRect(left,subtitleY+19*unit,42*unit,2*scale);

  const gutter=44*scale,column=(maxWidth-gutter)/2,footerY=height-258*unit-40*scale-footerNoteLayout(ctx,state,width,height).extra;
  const sections=graphicEstimateSections(state);
  sections.forEach((section,index)=>{
    const x=margin+index*(column+gutter),labelColor=index?state.accent:alpha(state.color,.88);
    text(section.label,x,footerY+14*unit,11*unit,{face:'700',spacing:1.6*unit,max:column,color:labelColor});
    ctx.fillStyle=alpha(state.color,.16);ctx.fillRect(x,footerY+26*unit,column,scale);
    ctx.fillStyle=alpha(state.accent,.8);ctx.fillRect(x,footerY+26*unit,28*unit,scale);
    const metricLabel=(value,y)=>{
      const result=text(value,x,y,11*unit,{face:'600',spacing:2*unit,max:column,color:alpha(state.color,.7)});
      ctx.fillStyle=alpha(state.color,.3);ctx.fillRect(x,y+4*scale,result.width,scale);
      return y+5*scale+11*unit;
    };
    const windTop=metricLabel('WIND SPEEDS',footerY+52*unit);
    const windInk=ctx.createLinearGradient(0,windTop,0,windTop+84*unit);
    windInk.addColorStop(0,state.color);windInk.addColorStop(.45,blend(state.color,state.accent,.25));windInk.addColorStop(1,blend(state.color,state.accent,.72));
    const wind=text(section.wind?displayNumber(section.wind.mph):'—',x,0,84*unit,{face:'800',max:column-74*unit,top:windTop,color:windInk});
    text('MPH',x+wind.width+10*unit,wind.y-2*unit,18*unit,{face:'700',spacing:.8*unit,max:64*unit,color:alpha(state.color,.8)});
    text(section.wind?`${displayNumber(section.wind.knots)} knots · ${displayNumber(section.wind.kph)} km/h`:'Not provided',x,footerY+157*unit,13*unit,{max:column,color:alpha(state.color,.7)});
    const pressureTop=metricLabel('PRESSURE',footerY+190*unit);
    const pressure=text(section.pressure===null?'—':displayNumber(section.pressure),x,0,44*unit,{face:'700',max:column-52*unit,top:pressureTop,color:blend(state.accent,state.color,.16)});
    text(state.pressureUnit.toUpperCase(),x+pressure.width+10*unit,pressure.y-unit,16*unit,{face:'600',spacing:1.4*unit,max:48*unit,color:alpha(state.color,.7)});
  });
  drawFooterNote(ctx,state,width,height);
}

function drawAestheticLabels(ctx,state,width,height,labels) {
  const scale=width/1024,unit=scale*Math.min(state.textScale/100,height<width*9/16?1:1.35)*Math.min(1,height/(width*.75));
  const margin=48*scale,maxWidth=width-2*margin,family=GRAPHIC_FONTS[state.font];
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.letterSpacing='0px';
  const text=(value,x,y,size,{face='700',color=state.color,max=maxWidth,align='left',spacing=0,top,glow=false,emphasis=false}={})=>{
    ctx.save();ctx.fillStyle=color;ctx.textAlign=align;ctx.letterSpacing=`${spacing}px`;
    const fitted=fittedFont(ctx,value,size,max,family,9*scale,face),metrics=ctx.measureText(value),ascent=metrics.actualBoundingBoxAscent||fitted*.75;
    if(top!==undefined)y=top+ascent;
    if(glow){ctx.shadowColor=state.accent;ctx.shadowBlur=24*scale;ctx.fillText(value,x,y);ctx.shadowBlur=0;}
    if(state.shadow){if(emphasis){ctx.strokeStyle='rgba(0,0,0,.72)';ctx.lineWidth=1.2*scale;ctx.strokeText(value,x,y);}ctx.shadowColor=emphasis?'rgba(0,0,0,.95)':'rgba(0,0,0,.7)';ctx.shadowBlur=(emphasis?4:5)*scale;ctx.shadowOffsetY=scale;}
    ctx.fillText(value,x,y);ctx.restore();return {width:metrics.width,y,top:y-ascent};
  };
  const rankShown=state.topLeftBadge==='rank',rank=String(state.rank),title=state.name.toUpperCase()||'STORM';
  const titleFace='italic 900';
  ctx.save();ctx.font=graphicCanvasFont(family,140*unit,titleFace);
  const naturalRank=rankShown?ctx.measureText(rank).width+54*unit:0;
  const fit=Math.min(1,maxWidth/(ctx.measureText(title).width+naturalRank+(rankShown?20*unit:0)));
  const size=140*unit*fit;ctx.font=graphicCanvasFont(family,size,titleFace);
  const titleMetrics=ctx.measureText(title),rankMetrics=ctx.measureText(rank),ascent=titleMetrics.actualBoundingBoxAscent||size*.75;ctx.restore();
  const rankWidth=naturalRank*fit,gap=rankShown?20*unit*fit:0,groupWidth=titleMetrics.width+rankWidth+gap;
  const align=state.headingAlign,left=align==='center'?(width-groupWidth)/2:align==='right'?width-margin-groupWidth:margin,titleY=52*scale+ascent;
  if(state.topLeftBadge==='estimates')text(labels.estimate,margin,25*scale,10*scale,{spacing:1.8*scale,max:maxWidth*.7,color:alpha(state.color,.82)});
  if(state.showCounter)text(`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`,width-margin,25*scale,10*scale,{align:'right',max:maxWidth*.3,color:alpha(state.color,.8)});
  const titleInk=ctx.createLinearGradient(0,titleY-ascent,0,titleY+6*scale);
  titleInk.addColorStop(0,state.color);titleInk.addColorStop(.62,blend(state.color,state.accent,.15));titleInk.addColorStop(1,blend(state.color,state.accent,.5));
  if(rankShown){
    const cx=left+rankWidth/2,cy=titleY-ascent*.49,rx=rankWidth*.48,ry=ascent*.72;
    const curve=(...points)=>ctx.bezierCurveTo(...points.map((point,index)=>index%2?cy+point*ry:cx+point*rx));
    ctx.save();ctx.strokeStyle=alpha(state.color,.58);ctx.lineWidth=1.35*scale;ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(cx+1.06*rx,cy-.72*ry);
    curve(.52,-1.12,-.25,-1.08,-.70,-.58);curve(-1.08,-.15,-.98,.44,-.54,.72);curve(-.76,.78,-.92,.78,-1.06,.72);
    curve(-.52,1.12,.25,1.08,.70,.58);curve(1.08,.15,.98,-.44,.54,-.72);curve(.76,-.78,.92,-.78,1.06,-.72);
    ctx.closePath();ctx.stroke();ctx.restore();
    text(rank,cx-rankMetrics.width/2,titleY,size,{face:titleFace,color:titleInk,glow:state.headingGlow});
  }
  text(title,left+rankWidth+gap,titleY,size,{face:titleFace,color:titleInk,glow:state.headingGlow});
  const subtitleX=align==='center'?left+groupWidth/2:align==='right'?left+groupWidth:left;
  const subtitle=[state.subtitle||state.identifier||'TROPICAL CYCLONE',state.year].filter(Boolean).join(' · ').toUpperCase();
  text(subtitle,subtitleX,titleY+(rankShown?54:29)*unit+3*scale+19*unit*Math.max(0,state.subtitleScale/100-1)*.8,19*unit*state.subtitleScale/100,{face:'800',spacing:2.1*unit,align,max:maxWidth,color:state.color,emphasis:true});

  const column=(maxWidth-64*scale)/2,sectionY=height-233*unit-34*scale-footerNoteLayout(ctx,state,width,height).extra;
  graphicEstimateSections(state).forEach((section,index)=>{
    const x=margin+column/2+index*(column+64*scale);
    text(section.label,x,sectionY,13*unit,{face:'800',spacing:1.8*unit,align:'center',max:column,color:index?state.accent:alpha(state.color,.9)});
    const label=(value,y)=>{
      const result=text(value,x,y,10*unit,{face:'700',spacing:2.6*unit,align:'center',max:column,color:alpha(state.color,.76)});
      ctx.fillStyle=alpha(state.color,.36);ctx.fillRect(x-result.width/2,y+4*scale,result.width,scale);
      return y+5*scale+10*unit;
    };
    const pressureTop=label('PRESSURE',sectionY+28*unit),value=section.pressure===null?'—':displayNumber(section.pressure);
    ctx.save();ctx.font=graphicCanvasFont(family,43*unit,"800");
    const pressureWidth=Math.min(column-55*unit,ctx.measureText(value).width),pressureLeft=x-(pressureWidth+55*unit)/2;ctx.restore();
    const pressure=text(value,pressureLeft,0,43*unit,{face:'800',max:column-55*unit,top:pressureTop,color:blend(state.accent,state.color,.3)});
    text(state.pressureUnit.toUpperCase(),pressureLeft+pressure.width+9*unit,pressure.y-unit,15*unit,{face:'700',max:46*unit,color:alpha(state.color,.82)});
    const windTop=label('WIND SPEEDS',sectionY+99*unit),mph=section.wind?displayNumber(section.wind.mph):'—';
    const windInk=ctx.createLinearGradient(0,windTop,0,windTop+83*unit);
    windInk.addColorStop(0,state.color);windInk.addColorStop(.55,blend(state.color,state.accent,.2));windInk.addColorStop(1,blend(state.accent,state.color,.18));
    ctx.save();ctx.font=graphicCanvasFont(family,90*unit,"italic 900");
    const windWidth=Math.min(column-60*unit,ctx.measureText(mph).width),windLeft=x-(windWidth+60*unit)/2;ctx.restore();
    const wind=text(mph,windLeft,0,90*unit,{face:'italic 900',max:column-60*unit,top:windTop,color:windInk});
    text('MPH',windLeft+wind.width+10*unit,wind.y-2*unit,17*unit,{face:'800',max:50*unit,color:alpha(state.color,.88)});
    text(section.wind?`${displayNumber(section.wind.knots)} knots · ${displayNumber(section.wind.kph)} km/h`:'Not provided',x,sectionY+205*unit,13*unit,{face:'500',align:'center',max:column,color:alpha(state.color,.8)});
  });
  drawFooterNote(ctx,state,width,height);
}

function traceAesthetic2Window(ctx,area,scale) {
  ctx.beginPath();ctx.roundRect(area.x,area.y,area.width,area.height,12*scale);
}

function drawAesthetic2Background(ctx,state,width,height) {
  const scale=width/1024,area=graphicPhotoArea(state.style,width,height,state,ctx);
  ctx.fillStyle='#f3eddf';ctx.fillRect(0,0,width,height);
  // Two cropped paper-cut shapes give the otherwise flat page a fall palette.
  ctx.fillStyle=alpha(state.accent,.13);ctx.beginPath();ctx.ellipse(width+35*scale,30*scale,172*scale,172*scale,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#d8b568';ctx.beginPath();ctx.moveTo(width-19*scale,height-44*scale);
  for(const [x,y]of [[-9,-20],[-4,-8],[-16,-11],[-10,2],[-23,6],[-9,12],[-11,23],[1,18],[8,30],[10,13],[24,13],[17,3],[27,-7],[13,-6],[13,-20],[4,-11]])ctx.lineTo(width-19*scale+x*scale,height-44*scale+y*scale);
  ctx.closePath();ctx.fill();
  drawAuraTexture(ctx,{...state,texture:state.texture*.1},width,height);
  ctx.fillStyle='rgba(62,38,26,.15)';ctx.beginPath();ctx.roundRect(area.x-2*scale,area.y-2*scale,area.width+16*scale,area.height+16*scale,20*scale);ctx.fill();
  ctx.fillStyle='#fffdf7';ctx.beginPath();ctx.roundRect(area.x-8*scale,area.y-8*scale,area.width+16*scale,area.height+16*scale,20*scale);ctx.fill();
}

function aesthetic2Cards(ctx,state,width,height) {
  const scale=width/1024,base=scale*Math.min(1,height/(width*.75)),photo=graphicPhotoArea(state.style,width,height,state,ctx),top=photo.y+photo.height+24*base;
  const cardWidth=(width-104*scale)/2;
  return [0,1].map(index=>({x:40*scale+index*(cardWidth+24*scale),y:top,width:cardWidth,height:height-50*scale-footerNoteLayout(ctx,state,width,height).extra-top,color:index?state.accent:'#642d3a'}));
}

function drawAesthetic2Frame(ctx,state,width,height) {
  const scale=width/1024;
  for(const card of aesthetic2Cards(ctx,state,width,height)){
    ctx.fillStyle='rgba(62,38,26,.12)';ctx.beginPath();ctx.roundRect(card.x+5*scale,card.y+5*scale,card.width,card.height,16*scale);ctx.fill();
    ctx.fillStyle='#fffdf7';ctx.beginPath();ctx.roundRect(card.x,card.y,card.width,card.height,16*scale);ctx.fill();
  }
}

function drawAesthetic2Labels(ctx,state,width,height,labels) {
  const scale=width/1024,base=scale*Math.min(1,height/(width*.75)),unit=base*Math.min(state.textScale/100,1),headUnit=unit;
  const margin=40*scale,maxWidth=width-2*margin,family=GRAPHIC_FONTS[state.font];
  ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.letterSpacing='0px';
  const text=(value,x,baseline,size,{face='700',color=state.color,max=maxWidth,align='left',spacing=0,glow=false,font=family}={})=>{
    ctx.save();ctx.fillStyle=color;ctx.textAlign=align;ctx.letterSpacing=`${spacing}px`;
    fittedFont(ctx,value,size,max,font,9*scale,face);const metrics=ctx.measureText(value);
    if(glow){ctx.shadowColor=state.accent;ctx.shadowBlur=16*scale;ctx.fillText(value,x,baseline);ctx.shadowBlur=0;}
    ctx.fillText(value,x,baseline);ctx.restore();return {width:metrics.width,y:baseline};
  };
  const rankShown=state.topLeftBadge==='rank',rank=String(state.rank),title=state.name.toUpperCase()||'STORM';
  ctx.save();ctx.font=graphicCanvasFont(family,108*headUnit,'900');
  const naturalRank=rankShown?ctx.measureText(rank).width+32*base:0;
  const fit=Math.min(1,maxWidth/(ctx.measureText(title).width+naturalRank+(rankShown?24*base:0)));
  const size=108*headUnit*fit;ctx.font=graphicCanvasFont(family,size,'900');
  const titleMetrics=ctx.measureText(title),rankMetrics=ctx.measureText(rank),ascent=titleMetrics.actualBoundingBoxAscent||size*.75;ctx.restore();
  const rankWidth=naturalRank*fit,gap=rankShown?24*base*fit:0,groupWidth=titleMetrics.width+rankWidth+gap;
  const align=state.headingAlign,left=align==='center'?(width-groupWidth)/2:align==='right'?width-margin-groupWidth:margin,titleY=74*base+ascent/2;
  if(state.topLeftBadge==='estimates')text(labels.estimate,margin,20*base,9*base,{max:maxWidth*.65,color:'#642d3a'});
  if(state.showCounter)text(`PEAK ${String(state.peak).padStart(2,'0')} / ${String(state.total).padStart(2,'0')}`,width-margin,20*base,9*base,{align:'right',max:maxWidth*.3,color:'#642d3a'});
  if(rankShown){
    const badgeTop=18*base,badgeHeight=112*base,cx=left+rankWidth/2,cy=badgeTop+badgeHeight/2,rx=rankWidth*.44,ry=badgeHeight*.34;
    ctx.fillStyle='rgba(62,38,26,.17)';ctx.beginPath();ctx.roundRect(left+9*scale,badgeTop+9*scale,rankWidth,badgeHeight,18*scale);ctx.fill();
    ctx.fillStyle='#fffdf7';ctx.beginPath();ctx.roundRect(left-5*scale,badgeTop-5*scale,rankWidth+10*scale,badgeHeight+10*scale,22*scale);ctx.fill();
    ctx.fillStyle=state.accent;ctx.beginPath();ctx.roundRect(left,badgeTop,rankWidth,badgeHeight,18*scale);ctx.fill();
    const curve=(...points)=>ctx.bezierCurveTo(...points.map((point,index)=>index%2?cy+point*ry:cx+point*rx));
    ctx.save();ctx.strokeStyle='rgba(255,253,247,.23)';ctx.lineWidth=1.6*scale;ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(cx+1.06*rx,cy-.72*ry);
    curve(.52,-1.12,-.25,-1.08,-.70,-.58);curve(-1.08,-.15,-.98,.44,-.54,.72);curve(-.76,.78,-.92,.78,-1.06,.72);
    curve(-.52,1.12,.25,1.08,.70,.58);curve(1.08,.15,.98,-.44,.54,-.72);curve(.76,-.78,.92,-.78,1.06,-.72);
    ctx.closePath();ctx.stroke();ctx.restore();
    text(rank,cx-rankMetrics.width/2,titleY,size,{face:'900',max:rankWidth,color:'#fff9ed',glow:state.headingGlow});
  }
  text(title,left+rankWidth+gap,titleY,size,{face:'900',max:maxWidth,glow:state.headingGlow});
  const detailX=align==='center'?left+groupWidth/2:align==='right'?left+groupWidth:left;
  const code=state.year&&state.identifier.endsWith(state.year)?state.identifier.slice(0,-4):state.identifier;
  const subtitle=[state.subtitle||code||'TROPICAL CYCLONE',state.year].filter(Boolean).join(' · ').toUpperCase();
  text(subtitle,detailX,148*base+15*headUnit*Math.max(0,state.subtitleScale/100-1)*.8,15*headUnit*state.subtitleScale/100,{face:'700',spacing:1*base,align,max:maxWidth,color:alpha(state.color,.72)});

  const sections=graphicEstimateSections(state);
  for(const [index,card]of aesthetic2Cards(ctx,state,width,height).entries()){
    const section=sections[index],x=card.x+card.width/2,column=card.width-32*scale;
    ctx.save();ctx.font=graphicCanvasFont(family,12*unit,'700');ctx.letterSpacing=`${.8*unit}px`;
    const pillWidth=Math.min(column,ctx.measureText(section.label).width+28*scale);ctx.restore();
    ctx.fillStyle=card.color;ctx.beginPath();ctx.roundRect(x-pillWidth/2,card.y+12*base,pillWidth,22*base,11*base);ctx.fill();
    text(section.label,x,card.y+27.5*base,12*unit,{face:'700',spacing:.8*unit,align:'center',max:pillWidth-20*scale,color:'#fff9ed'});
    const metric=(value,unitLabel,top,size,unitSize,color=state.color)=>{
      ctx.save();ctx.font=graphicCanvasFont(family,unitSize*unit,'700');const unitWidth=ctx.measureText(unitLabel).width;
      fittedFont(ctx,value,size*unit,column-unitWidth-10*unit,family,9*scale,'800');const numberWidth=ctx.measureText(value).width;
      const ascent=ctx.measureText('0123456789.').actualBoundingBoxAscent||size*unit*.75;ctx.restore();
      const numberLeft=x-(numberWidth+unitWidth+10*unit)/2,baseline=top+ascent;
      const number=text(value,numberLeft,baseline,size*unit,{face:'800',max:column-unitWidth-10*unit,color});
      text(unitLabel,numberLeft+number.width+10*unit,baseline-unit,unitSize*unit,{face:'700',max:unitWidth+scale,color:alpha(color,.8)});
    };
    metric(section.wind?displayNumber(section.wind.mph):'—','MPH',card.y+44*base,60,17);
    text(section.wind?`${displayNumber(section.wind.knots)} knots · ${displayNumber(section.wind.kph)} km/h`:'Not provided',x,card.y+110*base,12*unit,{face:'500',align:'center',max:column,color:alpha(state.color,.67),font:'Arial, Helvetica, sans-serif'});
    metric(section.pressure===null?'—':displayNumber(section.pressure),state.pressureUnit.toUpperCase(),card.y+126*base,24,13,card.color);
  }
  drawFooterNote(ctx,state,width,height);
}

export function drawCycloneGraphic(ctx,image,input,frame={},insetImage=null) {
  const state=normalizeGraphic(input),{width,height}=graphicDimensions(state),labels=graphicLabels(state);
  ctx.save();ctx.clearRect(0,0,width,height);
  if(dualGraphicStyle(state.style)){ctx.beginPath();ctx.roundRect(0,0,width,height,graphicCornerRadius(state)*width/1024);ctx.clip();}
  ctx.fillStyle=state.style==='aesthetic'?'#17121b':'#07111f';ctx.fillRect(0,0,width,height);
  if(state.style==='aesthetic2')drawAesthetic2Background(ctx,state,width,height);
  if(image){
    const area=graphicPhotoArea(state.style,width,height,state,ctx),r=imageFrame(image.width,image.height,area.width,area.height,frame);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.save();const a=state.auraStrength/100;
    if(state.style==='aesthetic2'){traceAesthetic2Window(ctx,area,width/1024);ctx.clip();ctx.filter=`grayscale(${state.monochrome?1:0}) contrast(${1+.18*a}) saturate(${1+.2*a})`;}
    else if(state.style==='aesthetic')ctx.filter=`grayscale(${state.monochrome?1:0}) contrast(${1+.35*a}) saturate(${1+.22*a}) brightness(${1-.08*a})`;
    else if(state.style==='aura')ctx.filter=`grayscale(${state.monochrome?1:0}) contrast(${1+.45*a}) brightness(${.92-.24*a})`;
    else if(state.style==='new-aura')ctx.filter=`grayscale(${state.monochrome?1:0}) contrast(${1+.22*a}) saturate(${1+.18*a}) brightness(${1-.12*a})`;
    else if(state.style==='old-aura')ctx.filter=`contrast(${1+.3*a}) saturate(${1+.18*a}) brightness(${1-.13*a})`;
    ctx.drawImage(image,area.x+r.x,area.y+r.y,r.width,r.height);ctx.restore();
  }
  else{ctx.fillStyle='#879ab6';ctx.font=`500 ${width/42}px Arial`;ctx.textAlign='center';ctx.fillText('Add a satellite image',width/2,height*.44);}
  if(!dualGraphicStyle(state.style)&&state.backdrop){const shade=ctx.createLinearGradient(0,height*.5,0,height);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,`rgba(0,0,0,${state.backdrop/100})`);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);}
  if(state.style==='aura'){const layout=auraLayout(ctx,state,width,height,labels);auraLighting(ctx,state,width,height,layout);drawInsetImage(ctx,image,insetImage,state,frame,width,height);drawAuraLabels(ctx,state,width,height,labels,layout);drawAuraOutline(ctx,state,width,height);ctx.restore();return {width,height,labels};}
  if(state.style==='new-aura'){auraLighting(ctx,state,width,height);drawInsetImage(ctx,image,insetImage,state,frame,width,height);drawNewAuraLabels(ctx,state,width,height,labels);drawAuraOutline(ctx,state,width,height);ctx.restore();return {width,height,labels};}
  if(state.style==='aesthetic'){
    auraLighting(ctx,state,width,height);
    drawInsetImage(ctx,image,insetImage,state,frame,width,height);drawAestheticLabels(ctx,state,width,height,labels);drawAuraOutline(ctx,state,width,height);ctx.restore();return {width,height,labels};
  }
  if(state.style==='aesthetic2'){const photo=graphicPhotoArea(state.style,width,height,state,ctx);ctx.save();traceAesthetic2Window(ctx,photo,width/1024);ctx.clip();ctx.translate(photo.x,photo.y);auraLighting(ctx,state,photo.width,photo.height);ctx.restore();drawInsetImage(ctx,image,insetImage,state,frame,width,height);drawAesthetic2Frame(ctx,state,width,height);drawAesthetic2Labels(ctx,state,width,height,labels);drawAuraOutline(ctx,state,width,height);ctx.restore();return {width,height,labels};}
  if(state.style==='old-aura'){oldAuraLighting(ctx,state,width,height);drawInsetImage(ctx,image,insetImage,state,frame,width,height);drawOldAuraLabels(ctx,state,width,height,labels);ctx.restore();return {width,height,labels};}
  drawInsetImage(ctx,image,insetImage,state,frame,width,height);
  const scale=width/1024,ts=state.textScale/100,family=GRAPHIC_FONTS[state.font],margin=32*scale,maxWidth=width-2*margin;
  ctx.fillStyle=state.color;ctx.strokeStyle='rgba(0,0,0,.42)';ctx.lineJoin='round';ctx.textBaseline='alphabetic';ctx.lineWidth=1.1*scale;
  if(state.shadow){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=4*scale;ctx.shadowOffsetY=1.5*scale;}
  const draw=(line,x,y,size,align='left')=>{ctx.textAlign=align;fittedFont(ctx,line,size*scale*ts,maxWidth,family,10*scale);if(state.shadow)ctx.strokeText(line,x,y);ctx.fillText(line,x,y);};
  if(labels.header)draw(labels.header,width-margin,57*scale,26,'right');
  drawEstimateBadge(ctx,state,labels.estimate,margin,80*scale,maxWidth);
  const bottom=height-36*scale;
  draw(labels.pressure,margin,bottom,30);
  const wind=graphicWind(state.wind),detailY=bottom-36*scale*ts,windY=detailY-36*scale*ts,headingY=windY-60*scale*ts;
  draw(state.windMissing?'Wind estimate needed':`${displayNumber(wind.knots)} knots · ${displayNumber(wind.kph)} km/h`,margin,detailY,22);
  draw(state.windMissing?'— mph':`${displayNumber(wind.mph)} mph`,margin,windY,48);
  draw(labels.heading,margin,headingY,30);
  const titleY=headingY-49*scale*ts;
  draw(labels.title,margin,titleY,36);
  if(labels.note){
    let noteSize=19*scale*ts*state.noteScale/100;ctx.font=graphicCanvasFont(family,noteSize,"700");let lines=wrapText(ctx,labels.note,maxWidth);
    while(state.noteScale===100&&lines.length>3&&noteSize>12*scale){noteSize-=scale;ctx.font=graphicCanvasFont(family,noteSize,"700");lines=wrapText(ctx,labels.note,maxWidth);}
    const gap=noteSize*1.2,baseline=titleY-46*scale*ts;
    lines.forEach((text,index)=>draw(text,margin,baseline-(lines.length-1-index)*gap,noteSize/(scale*ts)));
  }
  ctx.restore();return {width,height,labels};
}
