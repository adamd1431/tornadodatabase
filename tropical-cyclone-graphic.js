export const DEFAULT_GRAPHIC = Object.freeze({ name:'POLO',identifier:'EP172026',wind:155,pressure:900,peak:3,total:3,showCounter:true,note:'→ third-lowest pressure for an EPac system!',heading:'PEAK INTENSITY:',aspect:'4:3',width:1024,font:'arial',color:'#ffffff',rounding:5,pressureUnit:'mbar',textScale:100,backdrop:25,shadow:true });
export const GRAPHIC_FONTS = { arial:'Arial, Helvetica, sans-serif',roboto:'"Roboto Condensed", Arial, sans-serif',inter:'Inter, Arial, sans-serif' };
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const number = (value,min,max,fallback) => value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value),min,max) : fallback;
const text = (value,limit) => String(value ?? '').trim().slice(0,limit);
export function normalizeGraphic(input = {}) {
  const d=DEFAULT_GRAPHIC;
  return {name:text(input.name ?? d.name,80),identifier:text(input.identifier ?? d.identifier,30),wind:number(input.wind,0,500,d.wind),pressure:number(input.pressure,.1,2000,d.pressure),peak:Math.round(number(input.peak,1,99,d.peak)),total:Math.round(number(input.total,1,99,d.total)),showCounter:input.showCounter ?? d.showCounter,note:text(input.note ?? d.note,280),heading:text(input.heading ?? d.heading,60),aspect:['4:3','16:9','1:1'].includes(input.aspect)?input.aspect:d.aspect,width:[1024,2048,3072].includes(Number(input.width))?Number(input.width):d.width,font:Object.hasOwn(GRAPHIC_FONTS,input.font)?input.font:d.font,color:/^#[\da-f]{6}$/i.test(input.color)?input.color:d.color,rounding:[5,1,.01].includes(Number(input.rounding))?Number(input.rounding):d.rounding,pressureUnit:['mbar','mb','hPa'].includes(input.pressureUnit)?input.pressureUnit:d.pressureUnit,textScale:number(input.textScale,75,135,d.textScale),backdrop:number(input.backdrop,0,80,d.backdrop),shadow:input.shadow ?? d.shadow};
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

function fittedFont(ctx,line,size,maxWidth,family,minSize=10) {
  ctx.font=`700 ${size}px ${family}`;
  const measured=ctx.measureText(line).width;
  const fitted=measured>maxWidth?Math.max(minSize,size*maxWidth/measured):size;
  ctx.font=`700 ${fitted}px ${family}`;
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
export function drawCycloneGraphic(ctx,image,input,frame={}) {
  const state=normalizeGraphic(input),{width,height}=graphicDimensions(state),labels=graphicLabels(state);
  ctx.save();ctx.clearRect(0,0,width,height);ctx.fillStyle='#07111f';ctx.fillRect(0,0,width,height);
  if(image){const r=imageFrame(image.width,image.height,width,height,frame);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,r.x,r.y,r.width,r.height);}
  else{ctx.fillStyle='#879ab6';ctx.font=`500 ${width/42}px Arial`;ctx.textAlign='center';ctx.fillText('Add a satellite image',width/2,height*.44);}
  if(state.backdrop){const shade=ctx.createLinearGradient(0,height*.5,0,height);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,`rgba(0,0,0,${state.backdrop/100})`);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);}
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
