// Workers supports manual redirects rather than fetch's redirect:error mode.
// Keep the existing handlers' no-redirect guarantee without following a new
// destination or forwarding any credentials there.
export function installRedirectCompatibility(target){
  const original=target.fetch.bind(target);
  target.fetch=async(input,options)=>{
    const redirect=options?.redirect||(typeof input==='object'?input.redirect:null);
    if(redirect!=='error')return original(input,options);
    const response=await original(input,{...options,redirect:'manual'});
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new TypeError('An upstream redirect was refused.');}
    return response;
  };
}
installRedirectCompatibility(globalThis);
