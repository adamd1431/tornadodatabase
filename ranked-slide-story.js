// A one-record slide: plain header, full-width photos, and explanation below.
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
  return {size,frames,notes:box(48,textY-16,1064,textHeight+32),text:box(64,textY,1032,textHeight),estimate:box(760,44,336,140)};
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
  const family = 'Georgia, "Times New Roman", serif', width = box.width;
  const heading = String(label || '').replace(/:\s*$/,'').trim().toUpperCase();
  ctx.textAlign = 'left';
  if (heading) {
    const tracking = 1.7*unit;
    fitLine(ctx,heading,Math.max(40*unit,width-(heading.length-1)*tracking),'Inter, Arial, sans-serif',13*unit,11*unit,500);
    ctx.fillStyle = '#aaa9a5';
    let cursor = box.x;
    for (const character of heading) {
      ctx.fillText(character,cursor,box.y);
      cursor += ctx.measureText(character).width+tracking;
    }
  }
  const parts = String(value).match(/^(.+?)\s+(MPH|KT|KTS|KNOTS|KM\/H|KMH|M\/S)$/i);
  const number = parts ? parts[1] : String(value), units = parts ? parts[2] : '';
  ctx.font = `500 ${17*unit}px Inter, Arial, sans-serif`;
  const unitWidth = units ? ctx.measureText(units).width+16*unit : 0;
  const fontSize = fitLine(ctx,number,width-unitWidth,family,88*unit,25*unit,400);
  const numberWidth = Math.min(ctx.measureText(number).width,width-unitWidth);
  const baseline = box.y+98*unit;
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#eeeae2';
  ctx.fillText(number,box.x,baseline,width-unitWidth);
  if (units) {
    ctx.font = `500 ${17*unit}px Inter, Arial, sans-serif`; ctx.fillStyle = '#b7b5af';
    ctx.fillText(units,box.x+numberWidth+16*unit,baseline-3*unit);
  }
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  return fontSize;
}

export function drawPhotoExplanationSlide(canvas, details, drawImage) {
  const size = canvas.width, unit = size/1160;
  const images = (details.images || []).filter(info=>info?.img).slice(0,4);
  const layout = photoExplanationLayout(images.length,size,details.explanation), ctx = canvas.getContext('2d');
  const family = 'Georgia, "Times New Roman", serif';
  const fit = fitExplanation(ctx,details.explanation,layout.text,{maxSize:27*unit,minSize:18*unit,lineSpacing:1.4,paragraphSpacing:.7});
  // Do not silently omit explanation text from a downloaded slide.
  if (fit.overflow && canvas.id !== 'main-canvas') throw Error(`The explanation for #${details.rank} is too long to fit. Shorten it before exporting.`);
  ctx.save();
  ctx.clearRect(0,0,size,size);
  ctx.fillStyle = '#101010'; ctx.fillRect(0,0,size,size);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = `italic ${19*unit}px ${family}`;
  ctx.fillStyle = '#aaa9a5'; ctx.fillText('No. '+details.rank,64*unit,43*unit,180*unit);

  const titleBox = {width:(details.estimate ? 656 : 1032)*unit,height:76*unit};
  const title = fitExplanation(ctx,details.title,titleBox,{fontFamily:family,maxSize:52*unit,minSize:24*unit,weight:400,lineSpacing:1.1});
  ctx.fillStyle = '#eeeae2'; ctx.font = `400 ${title.size}px ${family}`;
  title.lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,64*unit,78*unit+title.offsets[index],titleBox.width));
  const metaY = 164*unit;
  ctx.font = `400 ${17*unit}px Inter, Arial, sans-serif`;
  const rating = String(details.rating || ''), date = String(details.date || '');
  const ratingWidth = ctx.measureText(rating).width;
  const dateMaxWidth = Math.max(80*unit,titleBox.width-(rating ? ratingWidth+24*unit : 0));
  const dateWidth = Math.min(ctx.measureText(date).width,dateMaxWidth);
  ctx.fillStyle = '#aaa9a5';
  ctx.fillText(date,64*unit,metaY,dateMaxWidth);
  if (rating) {
    ctx.font = `500 ${17*unit}px Inter, Arial, sans-serif`;
    ctx.fillStyle = '#d1cec6';
    ctx.fillText(rating,64*unit+(date ? dateWidth+24*unit : 0),metaY,Math.max(40*unit,titleBox.width-dateWidth-24*unit));
  }
  if (details.estimate) {
    drawEstimate(ctx,details.estimate,details.estimateLabel,layout.estimate,unit);
  }
  ctx.fillStyle = '#3c3b37'; ctx.fillRect(64*unit,194*unit,1032*unit,unit);

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
