// A one-record slide with a photo collage and a separate explanation column.
export function photoExplanationLayout(photoCount = 1, size = 1160) {
  const unit = size / 1160;
  const box = (x, y, width, height) => ({x:x*unit,y:y*unit,width:width*unit,height:height*unit});
  const count = Math.max(1, Math.min(4, Math.trunc(photoCount) || 1));
  const photos = box(52,244,600,864), gap = 14*unit;
  let frames;
  if (count === 1) frames = [photos];
  else if (count === 2) {
    const height = (photos.height-gap)/2;
    frames = [box(52,244,600,height/unit),box(52,244+(height+gap)/unit,600,height/unit)];
  } else if (count === 3) {
    const height = 518*unit, bottom = photos.height-height-gap, width = (photos.width-gap)/2;
    const bottomY = photos.y+height+gap;
    frames = [box(52,244,600,518),box(52,bottomY/unit,width/unit,bottom/unit),box(52+(width+gap)/unit,bottomY/unit,width/unit,bottom/unit)];
  } else {
    const width = (photos.width-gap)/2, height = (photos.height-gap)/2;
    frames = Array.from({length:4},(_,index)=>box(52+(index%2)*(width+gap)/unit,244+Math.floor(index/2)*(height+gap)/unit,width/unit,height/unit));
  }
  return {size,frames,notes:box(676,244,432,864),text:box(704,326,376,754),estimate:box(808,52,300,148)};
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
  const gold = '#ead3a2', white = '#fff8e9', family = 'Inter, Arial, sans-serif';
  const gradient = ctx.createLinearGradient(box.x,box.y,box.x+box.width,box.y+box.height);
  gradient.addColorStop(0,'#28261f'); gradient.addColorStop(1,'#141b26');
  rounded(ctx,box,14*unit); ctx.fillStyle = gradient; ctx.fill();
  ctx.strokeStyle = '#76664b'; ctx.lineWidth = unit; ctx.stroke();
  ctx.fillStyle = gold; ctx.fillRect(box.x,box.y+25*unit,3*unit,box.height-50*unit);
  const padding = 24*unit, width = box.width-padding*2;
  const heading = String(label || '').replace(/:\s*$/,'').trim().toUpperCase();
  if (heading) {
    fitLine(ctx,heading,width,family,16*unit,12*unit);
    ctx.fillStyle = gold; ctx.fillText(heading,box.x+padding,box.y+20*unit,width);
  }
  const parts = String(value).match(/^(.+?)\s+(MPH|KT|KTS|KNOTS|KM\/H|KMH|M\/S)$/i);
  const number = parts ? parts[1] : String(value), units = parts ? parts[2] : '';
  ctx.font = `700 ${18*unit}px ${family}`;
  const unitWidth = units ? ctx.measureText(units).width+12*unit : 0;
  const fontSize = fitLine(ctx,number,width-unitWidth,family,72*unit,25*unit,800);
  const numberWidth = ctx.measureText(number).width;
  const baseline = box.y+box.height-24*unit;
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = white;
  ctx.fillText(number,box.x+padding,baseline,width-unitWidth);
  if (units) {
    ctx.font = `700 ${18*unit}px ${family}`; ctx.fillStyle = gold;
    ctx.fillText(units,box.x+padding+Math.min(numberWidth,width-unitWidth)+12*unit,baseline-4*unit);
  }
  ctx.textBaseline = 'top';
  return fontSize;
}

export function drawPhotoExplanationSlide(canvas, details, drawImage) {
  const size = canvas.width, unit = size/1160;
  const images = (details.images || []).filter(info=>info?.img).slice(0,4);
  const layout = photoExplanationLayout(images.length,size), ctx = canvas.getContext('2d');
  const accent = details.accent || '#a188fc', family = details.fontFamily || 'Inter, Arial, sans-serif', gold = '#dac394';
  const fit = fitExplanation(ctx,details.explanation,layout.text,{maxSize:27*unit,minSize:18*unit,lineSpacing:1.48,paragraphSpacing:.65});
  // Do not silently omit explanation text from a downloaded slide.
  if (fit.overflow && canvas.id !== 'main-canvas') throw Error(`The explanation for #${details.rank} is too long to fit. Shorten it before exporting.`);
  ctx.save();
  ctx.clearRect(0,0,size,size);
  const background = ctx.createLinearGradient(0,0,size,size);
  background.addColorStop(0,'#111924'); background.addColorStop(.55,'#0b111b'); background.addColorStop(1,'#080d15');
  ctx.fillStyle = background; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = gold; ctx.fillRect(52*unit,26*unit,64*unit,3*unit);
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.font = `700 ${14*unit}px Inter, Arial, sans-serif`; ctx.fillStyle = gold;
  ctx.fillText('RANK',52*unit,58*unit);
  fitLine(ctx,'#'+details.rank,100*unit,'Inter, Arial, sans-serif',60*unit,40*unit,800);
  ctx.fillStyle = '#f7f2e8'; ctx.fillText('#'+details.rank,49*unit,87*unit,103*unit);
  ctx.fillStyle = '#34404d'; ctx.fillRect(166*unit,56*unit,unit,136*unit);

  const titleBox = {width:(details.estimate ? 572 : 914)*unit,height:100*unit};
  const title = fitExplanation(ctx,details.title,titleBox,{fontFamily:family,maxSize:48*unit,minSize:24*unit,weight:800,lineSpacing:1.13});
  ctx.fillStyle = '#f4f3ed'; ctx.font = `800 ${title.size}px ${family}`;
  title.lines.slice(0,2).forEach((line,index)=>ctx.fillText(line,194*unit,57*unit+title.offsets[index],titleBox.width));
  ctx.font = `600 ${22*unit}px Inter, Arial, sans-serif`;
  ctx.fillStyle = details.ratingColor || accent;
  ctx.fillText(details.rating || '',194*unit,168*unit);
  const ratingWidth = ctx.measureText(details.rating || '').width;
  ctx.fillStyle = '#a5b7ce';
  const date = String(details.date || '');
  ctx.fillText(date,194*unit+(ratingWidth ? ratingWidth+22*unit : 0),168*unit,Math.max(60*unit,550*unit-ratingWidth));
  if (details.estimate) {
    drawEstimate(ctx,details.estimate,details.estimateLabel,layout.estimate,unit);
  }
  ctx.fillStyle = '#2b3747'; ctx.fillRect(52*unit,218*unit,1056*unit,unit);

  layout.frames.forEach((box,index)=>{
    ctx.save(); rounded(ctx,box,details.roundPhotos ? 16*unit : 0); ctx.clip();
    drawImage(ctx,images[index] || null,box.x,box.y,box.width,box.height);
    ctx.restore();
  });
  rounded(ctx,layout.notes,16*unit); ctx.fillStyle = '#121c29'; ctx.fill();
  ctx.strokeStyle = '#2d3b4d'; ctx.lineWidth = unit; ctx.stroke();
  ctx.font = `700 ${16*unit}px Inter, Arial, sans-serif`; ctx.fillStyle = gold;
  ctx.fillText('EXPLANATION',704*unit,272*unit);
  ctx.fillStyle = '#344050'; ctx.fillRect(704*unit,306*unit,376*unit,unit);
  ctx.font = `400 ${fit.size}px Inter, Arial, sans-serif`; ctx.fillStyle = '#e4ebf7';
  fit.lines.slice(0,fit.limit).forEach((line,index)=>ctx.fillText(line,layout.text.x,layout.text.y+fit.offsets[index]));
  ctx.restore();
  return fit;
}
