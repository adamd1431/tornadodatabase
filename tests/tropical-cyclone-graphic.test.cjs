const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const model=import(pathToFileURL(path.join(__dirname,'../tropical-cyclone-graphic.js')).href);

test('graphic labels lead with mph and identify the selected estimate source',async()=>{
  const m=await model,s={...m.DEFAULT_GRAPHIC},before=JSON.stringify(s);
  assert.deepEqual(m.graphicLabels(s),{header:'POLO PEAK 3 out of 3',title:'(EP172026) POLO',heading:'PEAK INTENSITY:',wind:'180 mph (155 knots; 285 km/h)',pressure:'900 mbar',note:'→ third-lowest pressure for an EPac system!',estimate:'OFFICIAL FIGURES'});
  assert.equal(JSON.stringify(s),before);
  assert.deepEqual(m.graphicWind(155,.01),{knots:155,mph:178.37,kph:287.06,line:'178.37 mph (155 knots; 287.06 km/h)'});
  assert.equal(m.graphicLabels({...s,estimateSource:'owner'}).estimate,'OWNER ESTIMATES');
  assert.equal(m.graphicLabels({...s,pressure:885.136,pressureUnit:'hPa',identifier:'',showCounter:false}).pressure,'885.136 hPa');
  assert.equal(m.graphicLabels({...s,identifier:'',showCounter:false}).title,'POLO');
  assert.equal(m.graphicLabels({...s,identifier:'',showCounter:false}).header,'');
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
  m.drawCycloneGraphic(context,{width:1024,height:768},{...m.DEFAULT_GRAPHIC,style:'classic'});
  assert.deepEqual(texts.find(row=>row.text==='POLO PEAK 3 out of 3'),{text:'POLO PEAK 3 out of 3',x:992,y:57,align:'right'});
  assert.deepEqual(texts.find(row=>row.text==='900 mbar'),{text:'900 mbar',x:32,y:732,align:'left'});
  assert.equal(texts.find(row=>row.text==='(EP172026) POLO').y,551);
  assert.ok(texts.some(row=>row.text==='180 mph'));
  assert.ok(texts.some(row=>row.text==='155 knots · 285 km/h'));
  const first=texts.splice(0);m.drawCycloneGraphic(context,{width:1024,height:768},{...m.DEFAULT_GRAPHIC,style:'classic',width:2048});
  for(const row of first){const scaled=texts.find(value=>value.text===row.text);assert.equal(scaled.x,row.x*2);assert.equal(scaled.y,row.y*2);}
});

test('database estimate selection preserves each source and leaves missing owner values empty',async()=>{
  const m=await model,row={peak_winds_mph:180,lowest_pressure_mb:900,owner_estimated_winds_mph:202.1234,owner_estimated_pressure_mb:884.3};
  const official=m.graphicEstimateValues(row,'official'),owner=m.graphicEstimateValues(row,'owner');
  assert.ok(Math.abs(official.wind*1.1507794480235-180)<.0001);
  assert.ok(Math.abs(owner.wind*1.1507794480235-202.1234)<.0001);
  assert.equal(official.pressure,900);assert.equal(owner.pressure,884.3);
  assert.deepEqual(m.graphicEstimateValues({...row,owner_estimated_winds_mph:null,owner_estimated_pressure_mb:null},'owner'),{wind:'',pressure:''});
  assert.deepEqual(m.graphicEstimateValues({...row,owner_estimated_winds_mph:'',owner_estimated_pressure_mb:880},'owner'),{wind:'',pressure:880});
  const empty=m.normalizeGraphic(m.normalizeGraphic({wind:'',pressure:'',estimateSource:'owner',style:'old-aura'}));
  assert.equal(empty.style,'old-aura');assert.equal(empty.windMissing,true);assert.equal(empty.pressureMissing,true);
  assert.equal(m.graphicLabels(empty).wind,'Wind not provided');assert.equal(m.graphicLabels(empty).pressure,'Pressure not provided');
});
