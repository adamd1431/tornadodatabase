const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const model=import(pathToFileURL(path.join(__dirname,'../tropical-cyclone-graphic.js')).href);

test('graphic labels lead with mph and identify the selected estimate source',async()=>{
  const m=await model,s={...m.DEFAULT_GRAPHIC},before=JSON.stringify(s);
  assert.deepEqual(m.graphicLabels(s),{header:'',title:'(EP172026) POLO 2026',heading:'PEAK INTENSITY:',wind:'OFFICIAL ESTIMATES (JTWC): 178.4 mph (155.0 knots; 287.1 km/h). MY ESTIMATE: Wind not provided',pressure:'OFFICIAL ESTIMATES (JTWC): 900.0 mb. MY ESTIMATE: Pressure not provided',note:'→ third-lowest pressure for an EPac system!',estimate:'OFFICIAL + MY ESTIMATE'});
  assert.equal(JSON.stringify(s),before);
  assert.equal(m.graphicTopLeftBadge(s),'[#20]');
  assert.equal(m.graphicTopLeftBadge({...s,topLeftBadge:'estimates'}),'OFFICIAL + MY ESTIMATE');
  assert.equal(m.graphicTopLeftBadge({...s,topLeftBadge:'rank',rank:20}),'[#20]');
  assert.equal(m.graphicTopLeftBadge({...s,topLeftBadge:'hidden'}),'');
  assert.equal(m.graphicTopLeftBadge({...s,style:'old-aura',topLeftBadge:'rank'}),'');
  assert.deepEqual(m.graphicWind(155),{knots:155,mph:178.4,kph:287.1,line:'178.4 mph (155.0 knots; 287.1 km/h)'});
  assert.equal(m.graphicLabels({...s,style:'old-aura',estimateSource:'owner'}).estimate,'MY ESTIMATE');
  assert.equal(m.graphicLabels({...s,style:'old-aura',pressure:885.136,pressureUnit:'hPa',identifier:'',showCounter:false}).pressure,'885.1 hPa');
  assert.equal(m.graphicLabels({...s,identifier:'',showCounter:false}).title,'POLO 2026');
  assert.equal(m.graphicLabels({...s,year:'',identifier:''}).title,'POLO');
  assert.equal(m.graphicLabels({...s,style:'old-aura',year:'2014'}).title,'(EP172026) POLO');
  assert.equal(m.graphicLabels({...s,style:'old-aura'}).estimate,'OFFICIAL FIGURES');
  assert.equal(m.graphicLabels({...s,identifier:'',showCounter:false}).header,'');
});

test('new Aura includes both independent estimate sets and never fills missing owner values from official values',async()=>{
  const m=await model,s={...m.DEFAULT_GRAPHIC,officialWind:155,officialPressure:900,ownerWind:170,ownerPressure:880};
  const sections=m.graphicEstimateSections(s);
  assert.equal(sections.length,2);assert.equal(sections[0].wind.mph,178.4);assert.equal(sections[0].pressure,900);
  assert.equal(sections[1].wind.mph,195.6);assert.equal(sections[1].pressure,880);
  assert.equal(m.graphicLabels({...s,estimateSource:'owner'}).estimate,'OFFICIAL + MY ESTIMATE');
  const missing=m.graphicEstimateSections(m.normalizeGraphic({...s,ownerWind:'',ownerPressure:null}));
  assert.equal(missing[0].wind.knots,155);assert.equal(missing[1].wind,null);assert.equal(missing[1].pressure,null);
});

test('export sizes and cover/contain framing preserve image proportions at every crop edge',async()=>{
  const m=await model;
  assert.deepEqual(m.graphicDimensions({width:1024,aspect:'4:3'}),{width:1024,height:768});
  assert.deepEqual(m.graphicDimensions({width:2048,aspect:'4:3'}),{width:2048,height:1536});
  assert.deepEqual(m.graphicDimensions({width:3072,aspect:'16:9'}),{width:3072,height:1728});
  assert.deepEqual(m.graphicDimensions({width:1024,aspect:'1:1'}),{width:1024,height:1024});
  const center=m.imageFrame(1600,900,1024,768);
  assert.ok(Math.abs(center.width/center.height-1600/900)<1e-12);assert.equal(center.height,768);assert.equal(center.y,0);assert.ok(center.x<0);
  const left=m.imageFrame(1600,900,1024,768,{x:0,zoom:2}),right=m.imageFrame(1600,900,1024,768,{x:100,zoom:2});
  assert.ok(Math.abs(left.x)<1e-12);assert.ok(Math.abs(right.x+right.width-1024)<1e-9);
  const contained=m.imageFrame(1600,900,1024,768,{fit:'contain'});assert.equal(contained.width,1024);assert.equal(contained.height,576);assert.equal(contained.y,96);
  assert.deepEqual(m.graphicPhotoArea('aura',1024,768),{x:0,y:0,width:1024,height:768});
  for(const aspect of ['4:3','16:9','1:1','9:16','3:2','2.39:1']){
    const size=m.graphicDimensions({aspect}),area=m.graphicPhotoArea('aesthetic',size.width,size.height);
    assert.deepEqual(area,{x:0,y:0,width:size.width,height:size.height});
    const crop=m.imageFrame(1600,900,area.width,area.height,{zoom:1.5,x:100,y:100});
    assert.ok(Math.abs(crop.x+crop.width-area.width)<.001&&Math.abs(crop.y+crop.height-area.height)<.001);
    const photo=m.graphicPhotoArea('aesthetic2',size.width,size.height);
    assert.ok(photo.x>0&&photo.y>0&&photo.x+photo.width<size.width&&photo.y+photo.height<size.height);
    assert.ok(photo.height>size.height*(aspect==='2.39:1'?.4:.45),'The fall layout reserves a large image window.');
    const footerCrop=m.imageFrame(900,1600,photo.width,photo.height,{zoom:1.5,x:100,y:100});
    assert.ok(Math.abs(footerCrop.x+footerCrop.width-photo.width)<.001&&Math.abs(footerCrop.y+footerCrop.height-photo.height)<.001,'The photo sticker pans inside its image window.');
  }
  assert.throws(()=>m.imageFrame(0,900,1024,768));
});

test('storm names and downloaded filenames retain meaningful names without paths or unsafe punctuation',async()=>{
  const m=await model;
  assert.equal(m.shortStormName('Super Typhoon Nuri (Paeng)'),'Nuri');
  assert.equal(m.shortStormName('Hurricane Polo'),'Polo');
  assert.equal(m.graphicFilename(m.DEFAULT_GRAPHIC),'polo-ep172026-peak-3.png');
  assert.equal(m.graphicFilename({name:'../Choi-wan <test>',identifier:'WP/01',peak:2}),'choi-wan-test-wp01-peak-2.png');
});

test('classic drawing keeps its layout aligned and scales export positions consistently',async()=>{
  const m=await model,texts=[];
  const context={save(){},restore(){},clearRect(){},fillRect(){},drawImage(){},beginPath(){},roundRect(){},fill(){},stroke(){},createLinearGradient(){return{addColorStop(){}}},measureText(t){return{width:[...t].length*10}},strokeText(){},fillText(text,x,y){texts.push({text,x,y,align:this.textAlign})}};
  m.drawCycloneGraphic(context,{width:1024,height:768},{...m.DEFAULT_GRAPHIC,style:'classic',showCounter:true});
  assert.deepEqual(texts.find(row=>row.text==='POLO PEAK 3 out of 3'),{text:'POLO PEAK 3 out of 3',x:992,y:57,align:'right'});
  assert.deepEqual(texts.find(row=>row.text==='900.0 mb'),{text:'900.0 mb',x:32,y:732,align:'left'});
  assert.equal(texts.find(row=>row.text==='(EP172026) POLO').y,551);
  assert.ok(texts.some(row=>row.text==='178.4 mph'));
  assert.ok(texts.some(row=>row.text==='155.0 knots · 287.1 km/h'));
  const first=texts.splice(0);m.drawCycloneGraphic(context,{width:1024,height:768},{...m.DEFAULT_GRAPHIC,style:'classic',showCounter:true,width:2048});
  for(const row of first){const scaled=texts.find(value=>value.text===row.text);assert.equal(scaled.x,row.x*2);assert.equal(scaled.y,row.y*2);}
});

test('database estimate selection preserves each source and leaves missing owner values empty',async()=>{
  const m=await model,row={peak_winds_mph:180,lowest_pressure_mb:900,owner_estimated_winds_mph:202.1234,owner_estimated_pressure_mb:884.3};
  const official=m.graphicEstimateValues(row,'official'),owner=m.graphicEstimateValues(row,'owner');
  assert.ok(Math.abs(official.wind*1.1507794480235-180)<.0001);
  assert.ok(Math.abs(owner.wind*1.1507794480235-202.1234)<.0001);
  assert.equal(m.graphicEstimateValues({...row,peak_winds_kts:155},'official').wind,155);
  assert.equal(m.graphicEstimateValues({...row,owner_estimated_winds_kts:178.1},'owner').wind,178.1);
  assert.equal(official.pressure,900);assert.equal(owner.pressure,884.3);
  assert.deepEqual(m.graphicEstimateValues({...row,owner_estimated_winds_mph:null,owner_estimated_pressure_mb:null},'owner'),{wind:'',pressure:''});
  assert.deepEqual(m.graphicEstimateValues({...row,owner_estimated_winds_mph:'',owner_estimated_pressure_mb:880},'owner'),{wind:'',pressure:880});
  const empty=m.normalizeGraphic(m.normalizeGraphic({wind:'',pressure:'',estimateSource:'owner',style:'old-aura'}));
  assert.equal(empty.style,'old-aura');assert.equal(empty.windMissing,true);assert.equal(empty.pressureMissing,true);
  assert.equal(m.graphicLabels(empty).wind,'Wind not provided');assert.equal(m.graphicLabels(empty).pressure,'Pressure not provided');
});

test('Aura fits rank and name together and aligns the complete heading without changing estimate columns',async()=>{
  const m=await model;
  function render(state){
    let pen=[0,0],outlineBottom=-Infinity,pathBottom=-Infinity,lastCurveBottom=-Infinity;
    const texts=[],stack=[],ctx={font:'10px Arial',letterSpacing:'0px',textAlign:'left',
      save(){stack.push({font:this.font,letterSpacing:this.letterSpacing,textAlign:this.textAlign});},restore(){Object.assign(this,stack.pop());},
      clearRect(){},fillRect(){},beginPath(){pathBottom=-Infinity;},roundRect(){},clip(){},translate(){},fill(){},stroke(){if(Number.isFinite(pathBottom))lastCurveBottom=pathBottom;},strokeText(){},ellipse(){},closePath(){},
      moveTo(x,y){pen=[x,y];},
      lineTo(x,y){pen=[x,y];},
      bezierCurveTo(x1,y1,x2,y2,x3,y3){
        for(let step=0;step<=32;step++){const t=step/32,u=1-t;pathBottom=Math.max(pathBottom,u*u*u*pen[1]+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3);}
        pen=[x3,y3];
      },
      createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
      measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:value.length*size*.6,actualBoundingBoxAscent:size*.75};},
      fillText(value,x,y){if(value===String(state.rank??m.DEFAULT_GRAPHIC.rank))outlineBottom=lastCurveBottom;texts.push({value,x,y,font:this.font,align:this.textAlign,width:this.measureText(value).width,shadowColor:this.shadowColor,shadowBlur:this.shadowBlur});}
    };
    m.drawCycloneGraphic(ctx,null,{...m.DEFAULT_GRAPHIC,topShadow:50,bottomShadow:50,texture:0,note:'',name:'NURI',identifier:'',subtitle:'TYPHOON',year:'2014',...state});
    texts.outlineBottom=outlineBottom;return texts;
  }
  const left=render({headingAlign:'left'}),center=render({headingAlign:'center'}),right=render({headingAlign:'right'});
  for(const rows of [left,center,right]){
    const rank=rows.find(r=>r.value==='20'),name=rows.find(r=>r.value==='NURI');
    assert.equal(rank.font,name.font);assert.equal(rank.y,name.y);
    assert.ok(rank.x+rank.width<name.x);assert.ok(name.x+name.width<=988.001);
  }
  const x=(rows,value)=>rows.find(r=>r.value===value).x;
  assert.ok(x(left,'NURI')<x(center,'NURI'));assert.ok(x(center,'NURI')<x(right,'NURI'));
  assert.equal(left.find(r=>r.value==='TYPHOON · 2014').align,'left');
  assert.equal(center.find(r=>r.value==='TYPHOON · 2014').x,512);
  assert.equal(right.find(r=>r.value==='TYPHOON · 2014').align,'right');
  for(const label of ['OFFICIAL ESTIMATES (JTWC)','MY ESTIMATE'])assert.equal(x(left,label),x(right,label));
  const long=render({name:'A VERY LONG TROPICAL CYCLONE NAME',rank:99999,textScale:135,aspect:'16:9'});
  const longRank=long.find(r=>r.value==='99999'),longName=long.find(r=>r.value==='A VERY LONG TROPICAL CYCLONE NAME');
  assert.equal(longRank.font,longName.font);assert.ok(longRank.x>=36);assert.ok(longName.x+longName.width<=988.001);
  for(const aspect of ['4:3','16:9','1:1','9:16','3:2','2.39:1'])for(const textScale of [100,135]){
    const rows=render({name:'POLO',subtitle:'SUPER TYPHOON EP17',aspect,textScale});
    const subtitle=rows.find(r=>r.value==='SUPER TYPHOON EP17 · 2014'),size=Number(subtitle.font.match(/([\d.]+)px/)[1]);
    const subtitleTop=subtitle.y-size*.75,height=m.graphicDimensions({aspect}).height;
    assert.ok(subtitleTop>=rows.outlineBottom+8,'Subtitle clears the hurricane outline.');
    assert.ok(subtitle.y+7<=height*.32+.1,'Heading stays in the top third.');
    const estimates=rows.find(r=>r.value==='OFFICIAL ESTIMATES (JTWC)'),estimateSize=Number(estimates.font.match(/([\d.]+)px/)[1]);
    assert.ok(estimates.y-estimateSize*.75-(subtitle.y+7)>=height*.24,'Image keeps a clear band above the estimates.');
    const glyphTop=row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75;
    const windGap=glyphTop(rows.find(row=>row.value==='178.4 MPH'))-rows.find(row=>row.value==='WIND SPEEDS').y-5;
    const pressureGap=glyphTop(rows.find(row=>row.value==='900.0 MB'))-rows.find(row=>row.value==='PRESSURE').y-5;
    assert.ok(Math.abs(windGap-pressureGap)<.001,'Both underlines keep the same gap to the number glyphs.');
  }
  const glowing=render({headingGlow:true,auraStrength:68});
  for(const value of ['20','NURI'])assert.ok(glowing.some(row=>row.value===value&&row.shadowColor===m.DEFAULT_GRAPHIC.accent&&row.shadowBlur>0));
  assert.ok(!center.some(row=>row.shadowColor===m.DEFAULT_GRAPHIC.accent&&row.shadowBlur>0));
  for(const aspect of ['4:3','16:9','1:1','9:16','3:2','2.39:1']){
    const rows=render({style:'new-aura',name:'MANGKHUT',aspect,officialWind:156.4157,ownerWind:178.1401,officialPressure:878,ownerPressure:878});
    assert.ok(rows.some(row=>row.value==='OFFICIAL ESTIMATES (JTWC)'));
    assert.ok(rows.some(row=>row.value==='MY ESTIMATE'));
    const numbers=rows.filter(row=>['180.0','205.0','878.0'].includes(row.value));
    assert.equal(numbers.length,4);
    const top=row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75;
    const windLabels=rows.filter(row=>row.value==='WIND SPEEDS'),pressureLabels=rows.filter(row=>row.value==='PRESSURE');
    const pressures=rows.filter(row=>row.value==='878.0');
    for(const [index,value]of ['180.0','205.0'].entries()){
      const windGap=top(rows.find(row=>row.value===value))-windLabels[index].y-5;
      const pressureGap=top(pressures[index])-pressureLabels[index].y-5;
      assert.ok(Math.abs(windGap-pressureGap)<.001,'New Aura matches the number gaps beneath both underlines.');
    }
    for(const row of numbers)assert.ok(row.x>=0&&row.x+row.width<=1024,'Estimate numbers stay within the slide.');
    assert.equal(rows.find(row=>row.value==='20').font,rows.find(row=>row.value==='MANGKHUT').font);
    const subtitle=rows.find(row=>row.value==='TYPHOON');
    assert.ok(subtitle.y-Number(subtitle.font.match(/([\d.]+)px/)[1])*.75>=rows.outlineBottom+8,'New Aura subtitle clears the hurricane outline.');
  }
  for(const aspect of ['4:3','16:9','1:1','9:16','3:2','2.39:1'])for(const textScale of [75,100,135]){
    const rows=render({style:'aesthetic',name:'MANGKHUT',aspect,textScale,officialWind:156.4157,ownerWind:178.1401,officialPressure:878,ownerPressure:878});
    assert.ok(rows.some(row=>row.value==='OFFICIAL ESTIMATES (JTWC)')&&rows.some(row=>row.value==='MY ESTIMATE'));
    const values=['180.0','205.0'],pressures=rows.filter(row=>row.value==='878.0');assert.equal(pressures.length,2);
    const windLabels=rows.filter(row=>row.value==='WIND SPEEDS'),pressureLabels=rows.filter(row=>row.value==='PRESSURE');
    const top=row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75;
    for(const [index,value]of values.entries()){
      const wind=rows.find(row=>row.value===value),pressure=pressures[index];
      assert.ok(Math.abs((top(wind)-windLabels[index].y)-(top(pressure)-pressureLabels[index].y))<.001);
      for(const number of [wind,pressure])assert.ok(number.x>=48&&number.x+number.width<=976,'Aesthetic figures stay within the slide.');
      assert.ok(wind.font.startsWith('italic 900'),'Aesthetic uses bold italic wind figures.');
      assert.ok(pressure.y<windLabels[index].y,'Aesthetic puts the complete pressure block above wind.');
      const conversion=rows.find(row=>row.value===(index?'178.1 knots · 329.9 km/h':'156.4 knots · 289.7 km/h'));
      assert.ok(conversion.y>wind.y&&conversion.y<m.graphicDimensions({aspect}).height-38,'Secondary wind units stay below wind and clear of the note.');
      assert.ok(pressure.y<m.graphicDimensions({aspect}).height-30,'Pressure stays clear of the footer.');
    }
    const title=rows.find(row=>row.value==='MANGKHUT');
    assert.equal(rows.find(row=>row.value==='20').font,title.font);
    assert.ok(title.font.startsWith('italic 900'));
    const subtitle=rows.find(row=>row.value==='TYPHOON · 2014');
    assert.ok(subtitle.font.startsWith('800 '),'The Aesthetic subtitle uses a stronger weight.');
    assert.ok(Number(subtitle.font.match(/([\d.]+)px/)[1])>Number(rows.find(row=>row.value==='OFFICIAL ESTIMATES (JTWC)').font.match(/([\d.]+)px/)[1]),'The subtitle is larger than the source labels.');
    assert.ok(top(subtitle)>=rows.outlineBottom+8,'Aesthetic subtitle clears the hurricane outline.');
    assert.ok(top(rows.find(row=>row.value==='OFFICIAL ESTIMATES (JTWC)'))-subtitle.y>80,`The photo keeps open space: ${aspect}, ${textScale}%, gap ${top(rows.find(row=>row.value==='OFFICIAL ESTIMATES (JTWC)'))-subtitle.y}.`);
  }
  for(const aspect of ['4:3','16:9','1:1','9:16','3:2','2.39:1'])for(const textScale of [75,100,135])for(const headingAlign of ['left','center','right']){
    const rows=render({style:'aesthetic2',font:'barlowCondensed',name:'MANGKHUT',aspect,textScale,headingAlign,officialWind:156.4157,ownerWind:178.1401,officialPressure:878,ownerPressure:878});
    const title=rows.find(row=>row.value==='MANGKHUT'),rank=rows.find(row=>row.value==='20'),height=m.graphicDimensions({aspect}).height,photo=m.graphicPhotoArea('aesthetic2',1024,height);
    const top=row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75;
    assert.equal(rank.font,title.font);
    assert.ok(rank.x>=40&&title.x+title.width<=984.001,'The sports heading fits inside the page.');
    const subtitle=rows.find(row=>row.value==='TYPHOON · 2014');
    assert.ok(top(subtitle)>=rows.outlineBottom+8,'The subtitle clears the hurricane outline.');
    assert.ok(subtitle.y<photo.y-8,'The heading stays above the photo window.');
    const sources=rows.filter(row=>['OFFICIAL ESTIMATES (JTWC)','MY ESTIMATE'].includes(row.value));
    assert.equal(sources.length,2);assert.equal(sources[0].y,sources[1].y);
    assert.ok(sources.every(row=>row.align==='center'&&top(row)>photo.y+photo.height),'The estimates stay below the photo.');
    const pressures=rows.filter(row=>row.value==='878.0');assert.equal(pressures.length,2);assert.equal(pressures[0].y,pressures[1].y);
    assert.equal(rows.find(row=>row.value==='180.0').y,rows.find(row=>row.value==='205.0').y,'Both wind readings share a baseline.');
    for(const [index,value]of ['180.0','205.0'].entries()){
      const wind=rows.find(row=>row.value===value),pressure=pressures[index],left=index?540:56;
      for(const number of [wind,pressure])assert.ok(number.x>=left&&number.x+number.width<=left+428.01,'Each number stays in its estimate column.');
      assert.ok(top(wind)>sources[index].y&&top(pressure)>wind.y);
      assert.ok(pressure.y<height-32,'The pressure clears the note.');
      const conversion=rows.find(row=>row.value===(index?'178.1 knots · 329.9 km/h':'156.4 knots · 289.7 km/h'));
      assert.ok(conversion.align==='center'&&top(conversion)>wind.y&&conversion.y<top(pressure),'Secondary units have their own line.');
    }
  }

  const fontSize=row=>Number(row.font.match(/([\d.]+)px/)[1]);
  const top=row=>row.y-fontSize(row)*.75;
  for(const style of ['aura','new-aura','aesthetic','aesthetic2']){
    const input={style,font:'barlowCondensed',subtitle:'SUPER TYPHOON 18W',year:'2013',note:'A short estimate note.'};
    const original=render(input),subtitleOnly=render({...input,subtitleScale:200}),noteOnly=render({...input,noteScale:200});
    const subtitle=rows=>rows.find(row=>row.value.startsWith('SUPER TYPHOON 18W'));
    const note=rows=>rows.find(row=>row.value==='A short estimate note.');
    assert.ok(fontSize(subtitle(subtitleOnly))>fontSize(subtitle(original))*1.5,`${style}: subtitle control increases its font size.`);
    assert.equal(fontSize(note(subtitleOnly)),fontSize(note(original)),`${style}: subtitle control leaves note size alone.`);
    assert.equal(fontSize(subtitle(noteOnly)),fontSize(subtitle(original)),`${style}: note control leaves subtitle size alone.`);
    assert.equal(fontSize(note(noteOnly)),2*fontSize(note(original)),`${style}: note control doubles its font size.`);
    assert.equal(fontSize(render({...input,noteScale:50}).find(row=>row.value===input.note)),fontSize(note(original))/2);
  }
  for(const aspect of ['4:3','16:9','1:1'])for(const width of [1024,2048]){
    const note='Estimate method: aircraft observations, satellite analysis, radar measurements and independent intensity estimates. '.repeat(3).slice(0,280);
    const input={style:'aesthetic2',font:'barlowCondensed',aspect,width,subtitle:'SUPER TYPHOON 18W',year:'2013',note,subtitleScale:250,noteScale:250};
    const rows=render(input),height=m.graphicDimensions(input).height,scale=width/1024;
    const notes=rows.filter(row=>row.font.includes('Arial, Helvetica')&&!row.value.includes('knots')&&row.value!=='Not provided');
    const pressure=rows.filter(row=>row.value==='900.0');
    assert.ok(notes.length>1,'Large notes wrap instead of shrinking.');
    assert.ok(notes.every(row=>row.width<=width-80*scale+.01),'Wrapped notes fit the slide width.');
    assert.ok(notes.every(row=>fontSize(row)===25*scale),'The selected note size survives wrapping and PNG scaling.');
    assert.ok(Math.min(...notes.map(top))>Math.max(...pressure.map(row=>row.y))+8*scale,'Large notes clear the estimates.');
    const subtitle=rows.find(row=>row.value==='SUPER TYPHOON 18W · 2013');
    const measure={save(){},restore(){},measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:value.length*size*.6,actualBoundingBoxAscent:size*.75};}};
    const photo=m.graphicPhotoArea('aesthetic2',width,height,input,measure);
    assert.ok(subtitle.y<photo.y-8*scale,'Enlarged subtitles clear the photo border.');
    assert.ok(photo.height>height*.15,'Even the largest note keeps a useful photo area.');
  }
});


test('TC font choices include every tornado generator font with matching stacks and special faces',async()=>{
  const fs=require('node:fs/promises'),m=await model;
  const tornado=await fs.readFile(path.join(__dirname,'../generator.html'),'utf8');
  const tc=await fs.readFile(path.join(__dirname,'../tropical-cyclone-generator.html'),'utf8');
  const fonts=await import(pathToFileURL(path.join(__dirname,'../graphic-fonts.js')).href);
  const options=[...tornado.match(/<select id="fface"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)];
  const sourceStacks=[...tornado.match(/const FONT_STACKS = \{([\s\S]*?)\n\};/)[1].matchAll(/^  (\w+): '([^']*)'/gm)];
  assert.equal(options.length,27);
  assert.ok(tc.includes('<option value="inter" selected>Inter</option>'),'The existing default font stays Inter.');
  for(const [,key,label]of options){
    assert.ok(fonts.GRAPHIC_FONT_CATALOG.some(font=>font.key===key&&font.label===label));
    assert.ok(tc.includes(`value="${key}"`),`${label} has a selectable TC option.`);
    assert.equal(m.normalizeGraphic({font:key}).font,key);
  }
  for(const [,key,stack]of sourceStacks)assert.equal(m.GRAPHIC_FONTS[key],stack);
  assert.equal(m.normalizeGraphic({font:'serif'}).font,'georgia');
  assert.equal(m.normalizeGraphic({font:'roboto'}).font,'robotoCondensed');
  assert.match(fonts.graphicCanvasFont('top100Title',40,'500'),/^italic 900 40px/);
  assert.match(fonts.graphicCanvasFont('handlee',40,'900'),/^400 40px/);
  assert.match(fonts.graphicCanvasFont('signproject',40,'700'),/^oblique 400 40px/);
  for(const font of fonts.GRAPHIC_FONT_CATALOG){
    const requests=fonts.graphicFontRequests(font.key);assert.ok(requests.length>0&&requests.length<=7);
    for(const request of requests)assert.ok(request.includes(font.family));
  }
});


test('slide outlines follow the clipped edge at every radius and export size',async()=>{
  const m=await model;
  for(const style of ['aura','new-aura','aesthetic','aesthetic2'])for(const cornerRadius of [0,28,64,100])for(const width of [1024,2048,3072])for(const outlineColor of ['silver','#21c8db']){
    const paths=[],clips=[],strokes=[],stack=[];
    const ctx={font:'10px Arial',letterSpacing:'0px',textAlign:'left',
      save(){stack.push({font:this.font,letterSpacing:this.letterSpacing,textAlign:this.textAlign});},restore(){Object.assign(this,stack.pop());},
      clearRect(){},fillRect(){},beginPath(){},roundRect(...args){paths.push(args);},clip(){clips.push(paths.at(-1));},stroke(){strokes.push({path:paths.at(-1),lineWidth:this.lineWidth,color:this.strokeStyle});},
      fill(){},strokeText(){},fillText(){},translate(){},ellipse(){},moveTo(){},lineTo(){},bezierCurveTo(){},closePath(){},
      createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
      measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:value.length*size*.6,actualBoundingBoxAscent:size*.75};}
    };
    m.drawCycloneGraphic(ctx,null,{style,width,cornerRadius,outline:outlineColor==='silver'?'silver':'custom',outlineColor,topLeftBadge:'hidden',topShadow:50,bottomShadow:50,texture:0,note:''});
    const scale=width/1024,{height}=m.graphicDimensions({width}),clip=clips[0],outline=strokes.at(-1),[x,y,w,h,r]=outline.path,inset=outline.lineWidth/2;
    assert.deepEqual(clip,[0,0,width,height,cornerRadius*scale]);
    assert.equal(x-inset,0);assert.equal(y-inset,0);
    assert.equal(x+w+inset,width);assert.equal(y+h+inset,height);
    assert.equal(r,Math.max(0,clip[4]-inset),'The border and clipping share the same outer curve.');
    if(outlineColor!=='silver')assert.equal(outline.color,outlineColor,'The custom border uses the chosen color exactly.');
  }
  assert.equal(m.graphicCornerRadius({style:'aura'}),32);
  assert.equal(m.graphicCornerRadius({style:'aesthetic2'}),28);
  assert.equal(m.graphicCornerRadius({style:'old-aura',cornerRadius:64}),0);
});


test('custom ratios preserve decimal proportions and guard against oversized canvas allocations',async()=>{
  const m=await model;
  for(const [ratioWidth,ratioHeight]of [[3,2],[9,16],[5,4],[2.39,1],[1.91,1],[7.5,11.25],[1080,1920]])for(const width of [1024,2048,3072]){
    const custom={aspect:'custom',ratioWidth,ratioHeight,width},size=m.graphicDimensions(custom);
    assert.equal(size.width,width);
    assert.ok(Math.abs(size.height-width*(ratioHeight/ratioWidth))<=.5,'The custom ratio rounds only to the nearest whole output pixel.');
    assert.deepEqual(m.graphicDimensions({...custom,aspect:`${ratioWidth}:${ratioHeight}`}),size);
    const photo=m.graphicPhotoArea('aesthetic2',size.width,size.height,custom);
    const image=m.imageFrame(1600,900,photo.width,photo.height);
    assert.ok(Math.abs(image.width/image.height-1600/900)<1e-10,'Custom output ratios crop the photo without stretching it.');
  }
  assert.deepEqual(m.graphicDimensions({aspect:'custom'}),{width:1024,height:768});
  assert.deepEqual(m.graphicDimensions({aspect:' 3 : 2 '}),{width:1024,height:683});
  for(const aspect of ['0:1','-1:2','foo','1:Infinity','1:NaN','1:','1:2:3'])assert.equal(m.normalizeGraphic({aspect}).aspect,'4:3');
  assert.deepEqual(m.graphicDimensions({aspect:'1e300:1e300'}),{width:1024,height:1024});
  assert.throws(()=>m.graphicDimensions({aspect:'1:100000'}),RangeError);
  assert.throws(()=>m.graphicDimensions({aspect:'custom',ratioWidth:1,ratioHeight:4,width:3072}),RangeError);
});


test('second images keep their proportions inside the primary photo’s bottom-right quadrant',async()=>{
  const m=await model;
  for(const style of ['aura','new-aura','aesthetic','aesthetic2','old-aura','classic'])for(const aspect of ['4:3','9:16','2.39:1'])for(const width of [1024,2048])for(const insetSize of [15,32,45])for(const fit of ['cover','contain'])for(const image of [{width:1600,height:900},{width:900,height:1600}])for(const inset of [{width:900,height:600},{width:600,height:900}]){
    const state={style,aspect,width,insetSize,note:''},frame={fit,zoom:1,x:25,y:75},{height}=m.graphicDimensions(state);
    const area=m.graphicPhotoArea(style,width,height,state),crop=m.imageFrame(image.width,image.height,area.width,area.height,frame),box=m.graphicInsetFrame(image,inset,state,frame);
    const left=Math.max(area.x,area.x+crop.x),top=Math.max(area.y,area.y+crop.y),right=Math.min(area.x+area.width,area.x+crop.x+crop.width),bottom=Math.min(area.y+area.height,area.y+crop.y+crop.height);
    assert.ok(box,'An inset fits in every supported style and common output ratio.');
    assert.ok(box.x>=(left+right)/2&&box.y>=(top+bottom)/2,'The inset stays in the lower-right quadrant of the actual photo, including contain mode.');
    assert.ok(box.x+box.width<right&&box.y+box.height<bottom,'The inset leaves a margin inside the photo.');
    assert.ok(Math.abs(box.width/box.height-inset.width/inset.height)<1e-10,'The second image is never stretched.');
  }
  const small=m.graphicInsetFrame({width:1600,height:900},{width:640,height:640},{style:'aesthetic2',insetSize:15});
  const large=m.graphicInsetFrame({width:1600,height:900},{width:640,height:640},{style:'aesthetic2',insetSize:45});
  assert.ok(large.width>small.width*2,'The size control keeps working for square and portrait insets.');
  assert.equal(m.graphicInsetFrame(null,{width:100,height:100},{}),null);
  assert.equal(m.graphicInsetFrame({width:100,height:100},null,{}),null);
});

test('the inset is included in PNG drawing above image effects and below text',async()=>{
  const m=await model,primary={width:1600,height:900},inset={width:900,height:600};
  for(const style of ['aura','new-aura','aesthetic','aesthetic2','old-aura','classic']){
    const events=[],stack=[],ctx={font:'10px Arial',letterSpacing:'0px',filter:'none',textAlign:'left',
      save(){stack.push({font:this.font,letterSpacing:this.letterSpacing,textAlign:this.textAlign,filter:this.filter});},restore(){Object.assign(this,stack.pop());},
      clearRect(){},fillRect(){},beginPath(){},roundRect(){},clip(){},fill(){},stroke(){},strokeText(){},translate(){},ellipse(){},moveTo(){},lineTo(){},bezierCurveTo(){},closePath(){},
      createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
      measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:value.length*size*.6,actualBoundingBoxAscent:size*.75};},
      drawImage(image,...box){events.push({image,box,filter:this.filter});},fillText(text){events.push({text});}
    };
    const state={style,topShadow:50,bottomShadow:50,texture:0,note:''};
    m.drawCycloneGraphic(ctx,primary,state,{},inset);
    const mainIndex=events.findIndex(event=>event.image===primary),insetIndex=events.findIndex(event=>event.image===inset),textIndex=events.findIndex(event=>event.text);
    assert.ok(mainIndex>=0&&insetIndex>mainIndex&&insetIndex<textIndex,`${style}: photo, inset and text draw in that order.`);
    assert.equal(events[insetIndex].filter,'none','The second image stays clear above the main photo filters.');
    const box=m.graphicInsetFrame(primary,inset,state);
    assert.deepEqual(events[insetIndex].box,[box.x,box.y,box.width,box.height]);
    events.length=0;m.drawCycloneGraphic(ctx,primary,state);
    assert.ok(!events.some(event=>event.image===inset),'Removing the optional inset restores the one-image graphic.');
  }
});
