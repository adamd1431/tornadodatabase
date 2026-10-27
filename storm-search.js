export function bindStormSearchEnter(search, select) {
  search.addEventListener('keydown',event=>{
    if(event.key!=='Enter' || event.isComposing)return;
    event.preventDefault();
    if(select.matches(':disabled'))return;
    const first=Array.from(select.options).find(option=>option.value && !option.disabled);
    if(!first)return;
    select.value=first.value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
