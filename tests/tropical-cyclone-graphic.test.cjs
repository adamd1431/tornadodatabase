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
  for(const aspect of ['4:3','16:9','1:1']){
    const size=m.graphicDimensions({aspect}),area=m.graphicPhotoArea('aesthetic',size.width,size.height);
    assert.deepEqual(area,{x:0,y:0,width:size.width,height:size.height});
    const crop=m.imageFrame(1600,900,area.width,area.height,{zoom:1.5,x:100,y:100});
    assert.ok(Math.abs(crop.x+crop.width-area.width)<.001&&Math.abs(crop.y+crop.height-area.height)<.001);
    const photo=m.graphicPhotoArea('aesthetic2',size.width,size.height);
    assert.ok(photo.x>0&&photo.y>0&&photo.x+photo.width<size.width&&photo.y+photo.height<size.height);
    assert.ok(photo.height>size.height*.45,'The atlas layout reserves a large image window.');
    const footerCrop=m.imageFrame(900,1600,photo.width,photo.height,{zoom:1.5,x:100,y:100});
    assert.ok(Math.abs(footerCrop.x+footerCrop.width-photo.width)<.001&&Math.abs(footerCrop.y+footerCrop.height-photo.height)<.001,'Atlas layout pans inside its photo window.');
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
  for(const aspect of ['4:3','16:9','1:1'])for(const textScale of [100,135]){
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
  for(const aspect of ['4:3','16:9','1:1']){
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
  for(const aspect of ['4:3','16:9','1:1'])for(const textScale of [75,100,135]){
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
      assert.ok(pressure.y<m.graphicDimensions({aspect}).height-30,'Pressure stays clear of the footer.');
    }
    const title=rows.find(row=>row.value==='MANGKHUT');
    assert.equal(rows.find(row=>row.value==='20').font,title.font);
    assert.ok(title.font.startsWith('italic 900'));
    const subtitle=rows.find(row=>row.value==='TYPHOON · 2014');
    assert.ok(top(subtitle)>=rows.outlineBottom+8,'Aesthetic subtitle clears the hurricane outline.');
    assert.ok(top(rows.find(row=>row.value==='OFFICIAL ESTIMATES (JTWC)'))-subtitle.y>80,`The photo keeps open space: ${aspect}, ${textScale}%, gap ${top(rows.find(row=>row.value==='OFFICIAL ESTIMATES (JTWC)'))-subtitle.y}.`);
  }
  for(const aspect of ['4:3','16:9','1:1'])for(const textScale of [75,100,135])for(const headingAlign of ['left','center','right']){
    const rows=render({style:'aesthetic2',font:'cormorantGaramond',name:'MANGKHUT',aspect,textScale,headingAlign,officialWind:156.4157,ownerWind:178.1401,officialPressure:878,ownerPressure:878});
    const title=rows.find(row=>row.value==='MANGKHUT'),rank=rows.find(row=>row.value==='20'),height=m.graphicDimensions({aspect}).height,photo=m.graphicPhotoArea('aesthetic2',1024,height);
    const top=row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75;
    assert.equal(rank.font,title.font);
    assert.ok(rank.x>=72&&title.x+title.width<=952.001,'The manuscript heading fits inside the page.');
    const subtitle=rows.find(row=>row.value==='TYPHOON · 2014');
    assert.ok(top(subtitle)>=rows.outlineBottom+8,'The subtitle clears the hurricane outline.');
    assert.ok(subtitle.y<photo.y-8,'The heading stays above the photo window.');
    const sources=rows.filter(row=>['OFFICIAL ESTIMATES (JTWC)','MY ESTIMATE'].includes(row.value));
    assert.equal(sources.length,2);assert.equal(sources[0].y,sources[1].y);
    assert.ok(sources.every(row=>row.align==='center'&&top(row)>photo.y+photo.height),'The estimates stay below the photo.');
    const pressures=rows.filter(row=>row.value==='878.0');assert.equal(pressures.length,2);assert.equal(pressures[0].y,pressures[1].y);
    assert.equal(rows.find(row=>row.value==='180.0').y,rows.find(row=>row.value==='205.0').y,'Both wind readings share a baseline.');
    for(const [index,value]of ['180.0','205.0'].entries()){
      const wind=rows.find(row=>row.value===value),pressure=pressures[index],left=index?563.2:92.16;
      for(const number of [wind,pressure])assert.ok(number.x>=left&&number.x+number.width<=left+368.65,'Each number stays in its estimate column.');
      assert.ok(top(wind)>sources[index].y&&top(pressure)>wind.y);
      assert.ok(pressure.y<height-32,'The pressure clears the note.');
      const conversion=rows.find(row=>row.value===(index?'178.1 knots · 329.9 km/h':'156.4 knots · 289.7 km/h'));
      assert.ok(conversion.align==='center'&&top(conversion)>wind.y&&conversion.y<top(pressure),'Secondary units have their own line.');
    }
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
