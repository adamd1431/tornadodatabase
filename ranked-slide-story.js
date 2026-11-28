// A one-record slide with a scoreboard header, photos, and explanation below.
const SCORE_FONT = '"Ranked Scoreboard", "Barlow Condensed", Impact, "Arial Narrow", sans-serif';
let scoreFontPromise;
const DEFAULT_COLORS = {header:'#193b30',accent:'#b16442',estimate:'#e9e3cd'};
const MEDAL_COLORS = {
  1:{header:'#c9a64e',accent:'#8e6b24',estimate:'#f3e8c5'},
  2:{header:'#b5bec8',accent:'#697887',estimate:'#e8edf1'},
  3:{header:'#b47b53',accent:'#754b31',estimate:'#efdfce'}
};

function hexColor(value,fallback) {
  return /^#[a-f\d]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function mixColor(a,b,amount) {
  return '#'+[1,3,5].map(index=>Math.round(parseInt(a.slice(index,index+2),16)*(1-amount)+parseInt(b.slice(index,index+2),16)*amount).toString(16).padStart(2,'0')).join('');
}

function luminance(color) {
  const channels=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}

function contrastingInk(color) {
  const background=luminance(color);
  const contrast=ink=>{const foreground=luminance(ink);return (Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05);};
  const ink=contrast('#122219')>=contrast('#f0ebd9')?'#122219':'#f0ebd9';
  if (contrast(ink)>=4.5) return ink;
  return contrast('#000000')>=contrast('#ffffff')?'#000000':'#ffffff';
}

export function scorebugPalette(rank,colors={}) {
  const base=MEDAL_COLORS[Number(rank)] || Object.fromEntries(Object.entries(DEFAULT_COLORS).map(([key,fallback])=>[key,hexColor(colors?.[key],fallback)]));
  const ink=contrastingInk(base.header),badge=mixColor(base.header,ink,ink==='#122219'?.1:.05);
  return {...base,ink,muted:mixColor(base.header,ink,.86),badge,badgeInk:contrastingInk(badge),estimateInk:contrastingInk(base.estimate)};
}

export function loadStoryFonts() {
  if (!globalThis.document?.fonts || !globalThis.FontFace) return Promise.resolve();
  if (!scoreFontPromise) {
    const url = new URL('./assets/fonts/BarlowCondensed-Bold.ttf',import.meta.url);
    const face = new FontFace('Ranked Scoreboard',`url("${url.href}")`,{weight:'700',style:'normal'});
    scoreFontPromise = face.load().then(loaded=>document.fonts.add(loaded)).catch(error=>{
      console.warn('The scoreboard font could not load; using the condensed fallback.',error);
    });
  }
  return scoreFontPromise;
}

export function photoExplanationLayout(photoCount = 1, size = 1160, explanation = '') {
  const unit = size / 1160;
  const box = (x, y, width, height) => ({x:x*unit,y:y*unit,width:width*unit,height:height*unit});
  const count = Math.max(1, Math.min(4, Math.trunc(photoCount) || 1));
  const paragraphs = String(explanation).trim().split(/\n\s*\n/).filter(Boolean);
  const estimatedLines = paragraphs.reduce((total,paragraph)=>total+Math.ceil(paragraph.length/72),0)+Math.max(0,paragraphs.length-1)*.7;
  const textHeight = Math.min(336,Math.max(176,Math.ceil(estimatedLines*38)));
  const photoHeight = 844-textHeight;
  const photos = box(64,208,1032,photoHeight), gap = 16*unit;
  let frames;
  if (count === 1) frames = [photos];
  else if (count === 2) {
    const width = (photos.width-gap)/2;
    frames = [box(64,208,width/unit,photoHeight),box(64+(width+gap)/unit,208,width/unit,photoHeight)];
  } else if (count === 3) {
    const mainWidth = 680*unit, smallWidth = photos.width-mainWidth-gap, height = (photos.height-gap)/2;
    frames = [box(64,208,680,photoHeight),box(760,208,smallWidth/unit,height/unit),box(760,208+(height+gap)/unit,smallWidth/unit,height/unit)];
  } else {
    const mainWidth = 680*unit, smallWidth = photos.width-mainWidth-gap, height = (photos.height-gap*2)/3;
    frames = [box(64,208,680,photoHeight),...Array.from({length:3},(_,index)=>box(760,208+index*(height+gap)/unit,smallWidth/unit,height/unit))];
  }
  const textY = 208+photoHeight+44;
  const side = count>=3 ? frames[1] : box(760,208,336,photoHeight);
  return {size,frames,notes:box(48,textY-16,1064,textHeight+32),text:box(64,textY,1032,textHeight),estimate:{x:side.x,y:40*unit,width:side.width,height:148*unit}};
}

function paragraphLines(ctx, text, width) {
  const lines = [];
  for (const paragraph of String(text || '').trim().split(/\n\s*\n/)) {
    if (lines.length) lines.push('');
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && ctx.measureText(line+' '+word).width > width) { lines.push(line); line = ''; }
      // Break long URLs and unspaced words without crossing the text panel.
      if (ctx.measureText(word).width > width) {
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
          if (line && ctx.measureText(line+character).width > width) { lines.push(line); line = ''; }
          line += character;
        }
      } else line += (line ? ' ' : '')+word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function fitExplanation(ctx, text, box, {fontFamily='Inter, Arial, sans-serif',maxSize=28,minSize=18,weight=400,lineSpacing=1.4,paragraphSpacing=1} = {}) {
  let lines = [], size = maxSize, height = 0;
  for (; size >= minSize; size--) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    lines = paragraphLines(ctx,text,box.width);
    height = lines.reduce((total,line)=>total+size*lineSpacing*(line ? 1 : paragraphSpacing),0);
    if (height <= box.height) break;
  }
  size = Math.max(minSize,size);
  const lineHeight = size*lineSpacing, offsets = [];
  let used = 0;
  for (const line of lines) { offsets.push(used); used += lineHeight*(line ? 1 : paragraphSpacing); }
  const limit = offsets.filter((offset,index)=>offset+lineHeight*(lines[index] ? 1 : paragraphSpacing)<=box.height).length;
  return {size,lineHeight,lines,offsets,overflow:used>box.height,limit};
}

function rounded(ctx, box, radius) {
  ctx.beginPath();
  ctx.roundRect(box.x,box.y,box.width,box.height,radius);
}

function fitLine(ctx, text, maxWidth, family, maxSize, minSize, weight=700) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size--;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

function drawEstimate(ctx, value, label, box, unit, palette) {
  const family = SCORE_FONT, padding = 22*unit, width = box.width-padding*2;
  const heading = String(label || '').replace(/:\s*$/,'').trim().toUpperCase();
  ctx.fillStyle = palette.estimate; ctx.fillRect(box.x,box.y,box.width,box.height);
  ctx.textAlign = 'left';
  if (heading) {
    fitLine(ctx,heading,width,family,18*unit,12*unit,700);
    ctx.fillStyle = palette.estimateInk; ctx.fillText(heading,box.x+padding,box.y+13*unit,width);
  }
  const parts = String(value).match(/^(.+?)\s+(MPH|KT|KTS|KNOTS|KM\/H|KMH|M\/S)$/i);
  const number = parts ? parts[1] : String(value), units = parts ? parts[2] : '';
  ctx.font = `700 ${20*unit}px ${family}`;
  const unitWidth = units ? ctx.measureText(units).width+12*unit : 0;
  const fontSize = fitLine(ctx,number,width-unitWidth,family,102*unit,25*unit,700);
  const numberWidth = Math.min(ctx.measureText(number).width,width-unitWidth);
  const baseline = box.y+126*unit;
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = palette.estimateInk;
  ctx.fillText(number,box.x+padding,baseline,width-unitWidth);
  if (units) {
    ctx.font = `700 ${20*unit}px ${family}`; ctx.fillStyle = palette.estimateInk;
    ctx.fillText(units,box.x+padding+numberWidth+12*unit,baseline-4*unit);
  }
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  return fontSize;
}

function drawRankMarker(ctx, rank, unit, palette) {
  const points = [[88,50],[176,50],[186,62],[186,139],[132,182],[78,139],[78,62]];
  ctx.beginPath();
  points.forEach(([x,y],index)=>index ? ctx.lineTo(x*unit,y*unit) : ctx.moveTo(x*unit,y*unit));
  ctx.closePath(); ctx.fillStyle = palette.badge; ctx.fill();
  ctx.strokeStyle = palette.ink; ctx.lineWidth = 2*unit; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = palette.badgeInk;
  ctx.font = `700 ${14*unit}px ${SCORE_FONT}`; ctx.fillText('NO.',132*unit,64*unit);
  fitLine(ctx,String(rank),84*unit,SCORE_FONT,69*unit,34*unit,700);
  ctx.textBaseline = 'alphabetic'; ctx.fillText(String(rank),132*unit,143*unit,84*unit);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
}

export function drawPhotoExplanationSlide(canvas, details, drawImage) {
  const size = canvas.width, unit = size/1160;
  const images = (details.images || []).filter(info=>info?.img).slice(0,4);
  const layout = photoExplanationLayout(images.length,size,details.explanation), ctx = canvas.getContext('2d');
  const family = SCORE_FONT;
  const palette = scorebugPalette(details.rank,details.colors);
  const fit = fitExplanation(ctx,details.explanation,layout.text,{maxSize:27*unit,minSize:18*unit,lineSpacing:1.4,paragraphSpacing:.7});
  // Do not silently omit explanation text from a downloaded slide.
  if (fit.overflow && canvas.id !== 'main-canvas') throw Error(`The explanation for #${details.rank} is too long to fit. Shorten it before exporting.`);
  ctx.save();
  ctx.clearRect(0,0,size,size);
  ctx.fillStyle = '#101010'; ctx.fillRect(0,0,size,size);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const headerRight = layout.estimate.x-16*unit;
  const headerWidth = details.estimate ? headerRight-64*unit : 1032*unit;
  ctx.fillStyle = palette.header; ctx.fillRect(64*unit,40*unit,headerWidth,148*unit);
  drawRankMarker(ctx,details.rank,unit,palette);

  const titleBox = {width:details.estimate ? headerRight-234*unit : 862*unit,height:78*unit};
  const title = fitExplanation(ctx,String(details.title || '').toUpperCase(),titleBox,{fontFamily:family,maxSize:59*unit,minSize:24*unit,weight:700,lineSpacing:1});
  ctx.fillStyle = palette.ink; ctx.font = `700 ${title.size}px ${family}`;
  title.lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,210*unit,64*unit+title.offsets[index],titleBox.width));
  const metaY = 159*unit;
  const rating = String(details.rating || '').toUpperCase(), date = String(details.date || '').toUpperCase();
  ctx.font = `700 ${18*unit}px ${family}`;
  const ratingWidth = Math.min(ctx.measureText(rating).width,titleBox.width*.35);
  const dateMaxWidth = Math.max(80*unit,titleBox.width-(rating ? ratingWidth+28*unit : 0));
  ctx.fillStyle = palette.muted;
  ctx.fillText(date,210*unit,metaY,dateMaxWidth);
  if (rating) {
    ctx.textAlign = 'right'; ctx.fillStyle = palette.ink;
    ctx.fillText(rating,210*unit+titleBox.width,metaY,ratingWidth);
    ctx.textAlign = 'left';
  }
  if (details.estimate) {
    drawEstimate(ctx,details.estimate,details.estimateLabel,layout.estimate,unit,palette);
  }
  ctx.fillStyle = palette.accent; ctx.fillRect(64*unit,188*unit,headerWidth,4*unit);
  if (details.estimate) {
    ctx.fillRect(headerRight-4*unit,40*unit,4*unit,148*unit);
    ctx.fillRect(layout.estimate.x,40*unit,4*unit,148*unit);
    ctx.fillRect(layout.estimate.x,188*unit,layout.estimate.width,4*unit);
  }

  layout.frames.forEach((box,index)=>{
    ctx.save(); rounded(ctx,box,details.roundPhotos ? 16*unit : 0); ctx.clip();
    drawImage(ctx,images[index] || null,box.x,box.y,box.width,box.height);
    ctx.restore();
  });
  ctx.font = `400 ${fit.size}px Inter, Arial, sans-serif`; ctx.fillStyle = '#d0d0d0';
  fit.lines.slice(0,fit.limit).forEach((line,index)=>ctx.fillText(line,layout.text.x,layout.text.y+fit.offsets[index]));
  ctx.restore();
  return fit;
}
