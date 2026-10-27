const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const helper=import(pathToFileURL(path.join(__dirname,'../storm-search.js')).href);

function picker(options,{disabled=false}={}) {
  const search=new EventTarget(),select=new EventTarget();
  Object.assign(select,{options,value:'previous',matches:()=>disabled});
  let changes=0;select.addEventListener('change',()=>changes++);
  const press=(key,extra={})=>{
    const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,...extra});
    search.dispatchEvent(event);return event;
  };
  return {search,select,press,changes:()=>changes};
}

test('Enter locks in the first matching storm and updates selection without submitting',async()=>{
  const {bindStormSearchEnter}=await helper;
  const ui=picker([{value:''},{value:'disabled',disabled:true},{value:'first'},{value:'second'}]);
  bindStormSearchEnter(ui.search,ui.select);
  assert.equal(ui.press('Enter').defaultPrevented,true);
  assert.equal(ui.select.value,'first');assert.equal(ui.changes(),1);
});

test('empty or disabled storm pickers cannot submit and other keys or IME composition leave selection alone',async()=>{
  const {bindStormSearchEnter}=await helper;
  for(const ui of [picker([{value:''}]),picker([{value:'first'}],{disabled:true})]) {
    bindStormSearchEnter(ui.search,ui.select);
    assert.equal(ui.press('Enter').defaultPrevented,true);
    assert.equal(ui.select.value,'previous');assert.equal(ui.changes(),0);
  }
  const ui=picker([{value:'first'}]);bindStormSearchEnter(ui.search,ui.select);
  assert.equal(ui.press('ArrowDown').defaultPrevented,false);
  assert.equal(ui.press('Enter',{isComposing:true}).defaultPrevented,false);
  assert.equal(ui.select.value,'previous');assert.equal(ui.changes(),0);
});
