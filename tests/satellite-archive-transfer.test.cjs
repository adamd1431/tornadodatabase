const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const transfer=import(pathToFileURL(path.join(__dirname,'../satellite-archive-transfer.js')).href);
const id='12345678-abcd-4123-8123-123456789abc';
const bytes=fs.readFileSync(path.join(__dirname,'fixtures/image-import.png'));

test('generator opens the transferred original image and applies its cyclone details after image load',async()=>{
  const {loadArchiveGraphic}=await transfer,storm={id:'storm',name:'Typhoon Gay',year:1992};let loaded,applied,said;
  const blob=new Blob([bytes],{type:'image/png'});
  assert.equal(await loadArchiveGraphic({search:'?archiveImage='+id,read:async key=>{assert.equal(key,id);return{blob,name:'gay.png',archive:{storm}};},loadImage:async(b,name,opts)=>{loaded={b,name};opts.onLoaded();return true;},applyStorm:row=>applied=row,say:message=>said=message}),true);
  assert.equal(loaded.b,blob);assert.equal(loaded.name,'gay.png');assert.equal(applied,storm);assert.match(said,/Satellite image opened/);
});
test('expired or invalid transfers cannot apply mismatched storm details or silently load the example',async()=>{
  const {loadArchiveGraphic}=await transfer;let calls=0;
  for(const [search,record]of [['?archiveImage=invalid',null],['?archiveImage='+id,null],['?archiveImage='+id,{blob:new Blob(['not PNG'],{type:'image/png'}),archive:{storm:{name:'wrong'}}}]]){
    let error;assert.equal(await loadArchiveGraphic({search,read:async()=>record,loadImage:async()=>{calls++;},applyStorm:()=>{calls++;},say:(message,isError)=>error={message,isError}}),false);assert.equal(error.isError,true);
  }
  assert.equal(calls,0);
});
test('normal generator visits do not query browser imports',async()=>{
  const {loadArchiveGraphic}=await transfer;
  assert.equal(await loadArchiveGraphic({search:'',read:async()=>{throw Error('Should not read');}}),false);
});
