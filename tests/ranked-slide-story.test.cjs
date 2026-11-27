const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'ranked-slide-story.js'),'utf8');
const model=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const html=fs.readFileSync(path.join(root,'generator.html'),'utf8');
function fn(name){
  const start=html.indexOf('function '+name+'(');
  const next=html.slice(start+1).search(/\n(?:async )?function /);
  return html.slice(start,next<0?html.length:start+1+next);
}
function context2d(){
  return {font:'400 28px Arial',text:[],
    measureText(text){return {width:Array.from(text).length*Number(this.font.match(/([\d.]+)px/)[1])*.56};},
    fillText(text,x,y){this.text.push({text,x,y,font:this.font});},
    save(){},restore(){},clearRect(){},fillRect(){},beginPath(){},roundRect(){},clip(){},fill(){},stroke(){}};
}
test('one to four photos use distinct frames without covering the explanation column',async()=>{
  const {photoExplanationLayout:layout}=await model;
  for(const count of [1,2,3,4])for(const size of [1160,2320]){
    const {frames,notes,text}=layout(count,size);
    assert.equal(frames.length,count);
    for(let i=0;i<frames.length;i++){
      const a=frames[i];assert.ok(a.width>0&&a.height>0);assert.ok(a.x+a.width<notes.x);assert.ok(a.y+a.height<=size);
      for(let j=i+1;j<frames.length;j++){
        const b=frames[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
      }
    }
    assert.ok(text.x>notes.x&&text.x+text.width<notes.x+notes.width);
    assert.ok(text.y+text.height<notes.y+notes.height);
  }
});
test('explanations preserve paragraph breaks and fit both long words and normal prose',async()=>{
  const {fitExplanation,photoExplanationLayout}=await model;
  for(const text of ['A strong tornado.\n\nThe second paragraph explains the damage.',('Evidence and context for the ranking. ').repeat(25),'https://example.test/'+('x'.repeat(400))]){
    const ctx=context2d(),box=photoExplanationLayout(4).text,fit=fitExplanation(ctx,text,box);
    assert.equal(fit.overflow,false);assert.ok(fit.lines.length*fit.lineHeight<=box.height);
    ctx.font=`400 ${fit.size}px Arial`;
    for(const line of fit.lines)assert.ok(ctx.measureText(line).width<=box.width+.001);
    if(text.includes('\n\n'))assert.ok(fit.lines.includes(''));
  }
});
test('collage exports render the selected images and explanation, and never silently cut overflowing text',async()=>{
  const {drawPhotoExplanationSlide:draw,photoExplanationLayout}=await model;
  const ctx=context2d(),canvas={width:1160,getContext:()=>ctx},selected=[1,2,3,4].map(id=>({img:{id}})),drawn=[];
  draw(canvas,{rank:3,title:'Example tornado',date:'May 20, 2013',rating:'EF5',estimate:'210 MPH',explanation:'Evidence supporting this rank.',images:selected},(_ctx,image,...box)=>drawn.push({image,box}));
  assert.deepEqual(drawn.map(row=>row.image),selected);
  const noteBox=photoExplanationLayout(4).text;
  const notes=ctx.text.filter(row=>row.x===noteBox.x&&row.y>=noteBox.y);
  assert.equal(notes.map(row=>row.text).join(' '),'Evidence supporting this rank.');
  assert.ok(ctx.text.some(row=>row.text==='#3'));assert.ok(ctx.text.some(row=>row.text.includes('210 MPH')));
  assert.throws(()=>draw(canvas,{rank:3,explanation:'Very long explanation. '.repeat(1000)},()=>{}),/explanation for #3 is too long/);
});
test('saved explanation drafts follow the record when ranks change and stay scoped to their list',()=>{
  const storage=new Map(),c=vm.createContext({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTop100Status(){}});
  vm.runInContext(`const TOP30_EXPLANATION_STORAGE_KEY='drafts'; const top30ExplanationChoices=new Map(); const IS_USER_LIST_GENERATOR=true; let requested='list-a'; let top100RankMap=new Map([[1,{id:'record-a'}],[2,{id:'record-b'}]]); function getRequestedUserListId(){return requested;}`,c);
  for(const name of ['top30ExplanationDraftKey','loadTop30ExplanationDrafts','saveTop30ExplanationDrafts'])vm.runInContext(fn(name),c);
  vm.runInContext("top30ExplanationChoices.set(1,'My explanation');saveTop30ExplanationDrafts();top100RankMap=new Map([[2,{id:'record-a'}],[1,{id:'record-b'}]]);loadTop30ExplanationDrafts();",c);
  assert.equal(vm.runInContext('top30ExplanationChoices.get(2)',c),'My explanation');
  assert.equal(vm.runInContext('top30ExplanationChoices.has(1)',c),false);
  vm.runInContext("requested='list-b';loadTop30ExplanationDrafts()",c);
  assert.equal(vm.runInContext('top30ExplanationChoices.size',c),0);
});
test('extra photo slots remain separate and export details retain the explanation',()=>{
  const c=vm.createContext({getTop100EditedName:()=>'',getTop100EditedDate:()=>'',getTop100EditedRating:()=>'',getTop100EditedEstimate:()=>'',normalizeTop100Estimate:s=>s});
  vm.runInContext('const top100ImageChoices=new Map(),top100SecondImageChoices=new Map(),top30ThirdImageChoices=new Map(),top30FourthImageChoices=new Map(),top30ExplanationChoices=new Map([[1,"Why I ranked it here"]]);',c);
  for(const name of ['getTop100ImageChoiceMap','getTop100ExportTornado'])vm.runInContext(fn(name),c);
  vm.runInContext("getTop100ImageChoiceMap('third').set(1,'third');getTop100ImageChoiceMap('fourth').set(1,'fourth');",c);
  assert.equal(vm.runInContext("getTop100ImageChoiceMap('third').get(1)",c),'third');
  assert.equal(vm.runInContext("getTop100ImageChoiceMap('fourth').get(1)",c),'fourth');
  assert.equal(vm.runInContext("getTop100ImageChoiceMap('second').has(1)",c),false);
  assert.equal(vm.runInContext("getTop100ExportTornado(1,{id:'one',name:'Storm'}).top30Explanation",c),'Why I ranked it here');
});

test('the supporting photo cropper loads through the active media host',()=>{
  const elements=new Map();let image;
  const c=vm.createContext({Image:class{constructor(){image=this;}},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);}},
    resolveCropFrameKind:()=> 'photoExplanation',getCropBox:()=>({width:600,height:424}),
    getCropDisplayBox:()=>({width:420,height:297}),escapeHtml:s=>s,bindCropDragStart(){},
    bandwidthImageUrl:()=>'/media-archive/current.webp'});
  vm.runInContext(fn('openCropStep'),c);
  vm.runInContext("openCropStep('https://tornadodatabase.vercel.app/media-archive/old.webp')",c);
  assert.equal(image.src,'/media-archive/current.webp');assert.equal(image.crossOrigin,'anonymous');
});

test('reopening the editor after preview preserves the current draft instead of fetching and clearing its photos',async()=>{
  let fetches=0,renders=0;
  const elements=new Map();
  const c=vm.createContext({console,waitForSupabaseClient:async()=>{},IS_USER_LIST_GENERATOR:true,
    top100RankMap:new Map([[1,{id:'storm'}]]),top100ListContext:{title:'Test'},TOP30_MAX_COUNT:30,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{classList:{add(){}},innerHTML:''});return elements.get(id);}},
    fetchActiveRankGeneratorData:async()=>{fetches++;},updateTop100EditorChrome(){},renderTop100Editor(){renders++;},
    getTop100ExportChunks:()=>[],getTop30ExportLimit:()=>1,setTop100Status(){}});
  vm.runInContext('async '+fn('openTop100Editor'),c);
  await vm.runInContext('openTop100Editor()',c);
  assert.equal(fetches,0);assert.equal(renders,1);
  vm.runInContext('top100RankMap=null',c);
  await vm.runInContext('openTop100Editor()',c);
  assert.equal(fetches,1);
});

test('photo cropping matches the slot the selected image will occupy in the collage',async()=>{
  const m=await model;
  const c=vm.createContext({window:{_rankedSlideStory:m}});
  vm.runInContext("const cropFrameKind='photoExplanation',top100PickRank=1;let top100PickImageTarget='second';const top100RankMap=new Map([[1,{cover_image:'cover.png'}]]);const top100ImageChoices=new Map(),top100SecondImageChoices=new Map(),top30ThirdImageChoices=new Map(),top30FourthImageChoices=new Map();",c);
  for(const name of ['getCropBox','getTop100ImageChoiceMap'])vm.runInContext(fn(name),c);
  for(const [target,count]of [['second',2],['third',3],['fourth',4]]){
    c.target=target;
    vm.runInContext('top100PickImageTarget=target',c);
    const actual=vm.runInContext('getCropBox()',c),expected=m.photoExplanationLayout(count).frames[count-1];
    assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
    vm.runInContext("getTop100ImageChoiceMap(target).set(1,{img:{}})",c);
  }
});
