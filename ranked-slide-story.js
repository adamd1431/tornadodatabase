// A one-record slide with a photo collage and a separate explanation column.
export function photoExplanationLayout(photoCount = 1, size = 1160) {
  const unit = size / 1160;
  const box = (x, y, width, height) => ({x:x*unit,y:y*unit,width:width*unit,height:height*unit});
  const count = Math.max(1, Math.min(4, Math.trunc(photoCount) || 1));
  const photos = box(52,224,600,864), gap = 16*unit;
  let frames;
  if (count === 1) frames = [photos];
  else if (count === 2) {
    const height = (photos.height-gap)/2;
    frames = [box(52,224,600,height/unit),box(52,224+(height+gap)/unit,600,height/unit)];
  } else if (count === 3) {
    const height = 520*unit, bottom = photos.height-height-gap, width = (photos.width-gap)/2;
    frames = [box(52,224,600,520),box(52,760,width/unit,bottom/unit),box(52+(width+gap)/unit,760,width/unit,bottom/unit)];
  } else {
    const width = (photos.width-gap)/2, height = (photos.height-gap)/2;
    frames = Array.from({length:4},(_,index)=>box(52+(index%2)*(width+gap)/unit,224+Math.floor(index/2)*(height+gap)/unit,width/unit,height/unit));
  }
  return {size,frames,notes:box(676,224,432,864),text:box(700,296,384,768)};
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

export function fitExplanation(ctx, text, box, {fontFamily='Inter, Arial, sans-serif',maxSize=28,minSize=18,weight=400} = {}) {
  let lines = [], size = maxSize;
  for (; size >= minSize; size--) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    lines = paragraphLines(ctx,text,box.width);
    if (lines.length*size*1.4 <= box.height) break;
  }
  size = Math.max(minSize,size);
  const limit = Math.floor(box.height/(size*1.4));
  return {size,lineHeight:size*1.4,lines,overflow:lines.length>limit,limit};
}

function rounded(ctx, box, radius) {
  ctx.beginPath();
  ctx.roundRect(box.x,box.y,box.width,box.height,radius);
}

export function drawPhotoExplanationSlide(canvas, details, drawImage) {
  const size = canvas.width, unit = size/1160;
  const images = (details.images || []).filter(info=>info?.img).slice(0,4);
  const layout = photoExplanationLayout(images.length,size), ctx = canvas.getContext('2d');
  const accent = details.accent || '#a188fc', family = details.fontFamily || 'Inter, Arial, sans-serif';
  const fit = fitExplanation(ctx,details.explanation,layout.text,{maxSize:28*unit,minSize:18*unit});
  // Do not silently omit explanation text from a downloaded slide.
  if (fit.overflow && canvas.id !== 'main-canvas') throw Error(`The explanation for #${details.rank} is too long to fit. Shorten it before exporting.`);
  ctx.save();
  ctx.clearRect(0,0,size,size);
  ctx.fillStyle = '#080d16'; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = accent; ctx.fillRect(0,0,size,5*unit);
  rounded(ctx,{x:52*unit,y:48*unit,width:102*unit,height:72*unit},16*unit);
  ctx.fillStyle = '#182435'; ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  ctx.font = `800 ${38*unit}px ${family}`; ctx.fillStyle = accent;
  ctx.fillText('#'+details.rank,103*unit,65*unit);

  const titleBox = {width:928*unit,height:100*unit};
  const title = fitExplanation(ctx,details.title,titleBox,{fontFamily:family,maxSize:48*unit,minSize:24*unit,weight:800});
  ctx.textAlign = 'left'; ctx.fillStyle = '#f4f7ff'; ctx.font = `800 ${title.size}px ${family}`;
  title.lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,180*unit,(48+index*title.size/unit*1.16)*unit));
  ctx.font = `600 ${22*unit}px Inter, Arial, sans-serif`;
  ctx.fillStyle = details.ratingColor || accent;
  ctx.fillText(details.rating || '',52*unit,161*unit);
  const ratingWidth = ctx.measureText(details.rating || '').width;
  ctx.fillStyle = '#a5b7ce';
  const date = String(details.date || '');
  ctx.fillText(date,52*unit+(ratingWidth ? ratingWidth+22*unit : 0),161*unit,578*unit-ratingWidth);
  if (details.estimate) {
    ctx.textAlign = 'right'; ctx.fillStyle = accent;
    ctx.fillText((details.estimateLabel || '')+details.estimate,1108*unit,161*unit,432*unit);
    ctx.textAlign = 'left';
  }

  layout.frames.forEach((box,index)=>{
    ctx.save(); rounded(ctx,box,details.roundPhotos ? 16*unit : 0); ctx.clip();
    drawImage(ctx,images[index] || null,box.x,box.y,box.width,box.height);
    ctx.restore();
  });
  rounded(ctx,layout.notes,18*unit); ctx.fillStyle = '#111c2b'; ctx.fill();
  ctx.strokeStyle = '#293a50'; ctx.lineWidth = unit; ctx.stroke();
  ctx.font = `700 ${19*unit}px Inter, Arial, sans-serif`; ctx.fillStyle = accent;
  ctx.fillText('EXPLANATION',700*unit,250*unit);
  ctx.font = `400 ${fit.size}px Inter, Arial, sans-serif`; ctx.fillStyle = '#e4ebf7';
  fit.lines.slice(0,fit.limit).forEach((line,index)=>ctx.fillText(line,layout.text.x,layout.text.y+index*fit.lineHeight));
  ctx.restore();
  return fit;
}
