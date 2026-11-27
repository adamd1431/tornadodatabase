// A one-record slide: plain header, full-width photos, and explanation below.
export function photoExplanationLayout(photoCount = 1, size = 1160) {
  const unit = size / 1160;
  const box = (x, y, width, height) => ({x:x*unit,y:y*unit,width:width*unit,height:height*unit});
  const count = Math.max(1, Math.min(4, Math.trunc(photoCount) || 1));
  const photos = box(64,208,1032,504), gap = 16*unit;
  let frames;
  if (count === 1) frames = [photos];
  else if (count === 2) {
    const width = (photos.width-gap)/2;
    frames = [box(64,208,width/unit,504),box(64+(width+gap)/unit,208,width/unit,504)];
  } else if (count === 3) {
    const mainWidth = 648*unit, smallWidth = photos.width-mainWidth-gap, height = (photos.height-gap)/2;
    frames = [box(64,208,648,504),box(728,208,smallWidth/unit,height/unit),box(728,208+(height+gap)/unit,smallWidth/unit,height/unit)];
  } else {
    const width = (photos.width-gap)/2, height = (photos.height-gap)/2;
    frames = Array.from({length:4},(_,index)=>box(64+(index%2)*(width+gap)/unit,208+Math.floor(index/2)*(height+gap)/unit,width/unit,height/unit));
  }
  return {size,frames,notes:box(48,744,1064,368),text:box(64,760,1032,336),estimate:box(872,64,224,112)};
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

function drawEstimate(ctx, value, label, box, unit) {
  const family = 'Inter, Arial, sans-serif', width = box.width;
  const heading = String(label || '').replace(/:\s*$/,'').trim();
  if (heading) {
    fitLine(ctx,heading,width,family,17*unit,12*unit,400);
    ctx.fillStyle = '#a5a5a5'; ctx.fillText(heading,box.x,box.y,width);
  }
  const parts = String(value).match(/^(.+?)\s+(MPH|KT|KTS|KNOTS|KM\/H|KMH|M\/S)$/i);
  const number = parts ? parts[1] : String(value), units = parts ? parts[2] : '';
  ctx.font = `700 ${18*unit}px ${family}`;
  const unitWidth = units ? ctx.measureText(units).width+12*unit : 0;
  const fontSize = fitLine(ctx,number,width-unitWidth,family,64*unit,25*unit,600);
  const numberWidth = ctx.measureText(number).width;
  const baseline = box.y+box.height-10*unit;
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#f4f4f4';
  ctx.fillText(number,box.x,baseline,width-unitWidth);
  if (units) {
    ctx.font = `500 ${18*unit}px ${family}`; ctx.fillStyle = '#a5a5a5';
    ctx.fillText(units,box.x+Math.min(numberWidth,width-unitWidth)+12*unit,baseline-3*unit);
  }
  ctx.textBaseline = 'top';
  return fontSize;
}

export function drawPhotoExplanationSlide(canvas, details, drawImage) {
  const size = canvas.width, unit = size/1160;
  const images = (details.images || []).filter(info=>info?.img).slice(0,4);
  const layout = photoExplanationLayout(images.length,size), ctx = canvas.getContext('2d');
  const family = details.fontFamily || 'Inter, Arial, sans-serif';
  const fit = fitExplanation(ctx,details.explanation,layout.text,{maxSize:27*unit,minSize:18*unit,lineSpacing:1.4,paragraphSpacing:.7});
  // Do not silently omit explanation text from a downloaded slide.
  if (fit.overflow && canvas.id !== 'main-canvas') throw Error(`The explanation for #${details.rank} is too long to fit. Shorten it before exporting.`);
  ctx.save();
  ctx.clearRect(0,0,size,size);
  ctx.fillStyle = '#101010'; ctx.fillRect(0,0,size,size);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  fitLine(ctx,'#'+details.rank,96*unit,'Inter, Arial, sans-serif',44*unit,32*unit,600);
  ctx.fillStyle = '#f4f4f4'; ctx.fillText('#'+details.rank,64*unit,64*unit,96*unit);

  const titleBox = {width:(details.estimate ? 592 : 912)*unit,height:88*unit};
  const title = fitExplanation(ctx,details.title,titleBox,{fontFamily:family,maxSize:44*unit,minSize:24*unit,weight:600,lineSpacing:1.13});
  ctx.fillStyle = '#f4f4f4'; ctx.font = `600 ${title.size}px ${family}`;
  title.lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,184*unit,64*unit+title.offsets[index],titleBox.width));
  const metaY = (title.lines.length>1 ? 164 : 130)*unit;
  ctx.font = `500 ${20*unit}px Inter, Arial, sans-serif`;
  ctx.fillStyle = details.ratingColor || '#c3c3c3';
  ctx.fillText(details.rating || '',184*unit,metaY);
  const ratingWidth = ctx.measureText(details.rating || '').width;
  ctx.fillStyle = '#a5a5a5';
  const date = String(details.date || '');
  ctx.fillText(date,184*unit+(ratingWidth ? ratingWidth+20*unit : 0),metaY,Math.max(60*unit,572*unit-ratingWidth));
  if (details.estimate) {
    drawEstimate(ctx,details.estimate,details.estimateLabel,layout.estimate,unit);
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
