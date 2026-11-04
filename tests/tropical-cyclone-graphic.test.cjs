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
    let pen=[0,0],outlineBottom=-Infinity;
    const texts=[],stack=[],ctx={font:'10px Arial',letterSpacing:'0px',textAlign:'left',
      save(){stack.push({font:this.font,letterSpacing:this.letterSpacing,textAlign:this.textAlign});},restore(){Object.assign(this,stack.pop());},
      clearRect(){},fillRect(){},beginPath(){},roundRect(){},clip(){},fill(){},stroke(){},strokeText(){},ellipse(){},closePath(){},
      moveTo(x,y){pen=[x,y];},
      bezierCurveTo(x1,y1,x2,y2,x3,y3){
        for(let step=0;step<=32;step++){const t=step/32,u=1-t;outlineBottom=Math.max(outlineBottom,u*u*u*pen[1]+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3);}
        pen=[x3,y3];
      },
      createLinearGradient(){return{addColorStop(){}}},createRadialGradient(){return{addColorStop(){}}},
      measureText(value){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:value.length*size*.6,actualBoundingBoxAscent:size*.75};},
      fillText(value,x,y){texts.push({value,x,y,font:this.font,align:this.textAlign,width:this.measureText(value).width,shadowColor:this.shadowColor,shadowBlur:this.shadowBlur});}
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
    const tops=numbers.map(row=>row.y-Number(row.font.match(/([\d.]+)px/)[1])*.75);
    assert.ok(Math.max(...tops)-Math.min(...tops)<.001,'Wind and pressure glyphs share the same top edge.');
    for(const row of numbers)assert.ok(row.x>=0&&row.x+row.width<=1024,'Estimate numbers stay within the slide.');
    assert.equal(rows.find(row=>row.value==='20').font,rows.find(row=>row.value==='MANGKHUT').font);
    const subtitle=rows.find(row=>row.value==='TYPHOON');
    assert.ok(subtitle.y-Number(subtitle.font.match(/([\d.]+)px/)[1])*.75>=rows.outlineBottom+8,'New Aura subtitle clears the hurricane outline.');
  }
});
