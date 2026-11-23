import './fetch-compat.js';
import liveStorms from '../api/live-storms.js';
import media from '../api/media.js';
import catalog from '../api/public-catalog.js';
import siteDesign from '../api/site-design.js';
import ibtracsMedia from '../api/ibtracs-media.js';
import satelliteDvorak from '../api/satellite-dvorak.js';
import pressureChart from '../api/poci-roci-chart.js';
import {createMcfetchHandler} from '../api/mcfetch.js';
import {createCloudflareArchiveHandler} from './recon-archive.js';
import {createCloudflarePressureHandler} from './pressure.js';
import {createCloudflareJtwcHandler} from './jtwc.js';
import {serveLargeAsset} from './large-assets.js';
const largeAssets=typeof __LARGE_ASSETS__==='undefined'?{}:__LARGE_ASSETS__;

const routes=new Map([
  ['/api/live-storms',liveStorms],['/api/media',media],['/api/public-catalog',catalog],
  ['/api/site-design',siteDesign],['/api/ibtracs-media',ibtracsMedia],
  ['/api/satellite-dvorak',satelliteDvorak],['/api/poci-roci-chart',pressureChart],
  ['/api/recon-flights',createCloudflareArchiveHandler('hdob')],
  ['/api/recon-data',createCloudflareArchiveHandler('vortex')],
  ['/api/poci-roci',createCloudflarePressureHandler()],
  ['/api/jtwc-report',createCloudflareJtwcHandler()]
]);
const mcfetchHandlers=new WeakMap();
export default {
  async fetch(request,env,context){
    const url=new URL(request.url);
    try{
      if(largeAssets[url.pathname])return serveLargeAsset(request,env,largeAssets[url.pathname]);
      if(url.pathname==='/api/mcfetch'){
        let handler=mcfetchHandlers.get(env);
        if(!handler){handler=createMcfetchHandler({getSharedKey:()=>env.MCFETCH_ACCESS_KEY||''});mcfetchHandlers.set(env,handler);}
        return handler.fetch(request);
      }
      const route=routes.get(url.pathname.replace(/\.js$/,''));
      if(route)return route.fetch(request,env,context);
      if(/^\/(?:media\/(?:uploads|cyclone-uploads)|storage\/v1\/object\/public\/cyclone-uploads)\//.test(url.pathname))return media.fetch(request);
      if(url.pathname.startsWith('/api/'))return Response.json({message:'Endpoint not found.'},{status:404,headers:{'Cache-Control':'no-store'}});
      return env.ASSETS.fetch(request);
    }catch{
      return Response.json({message:'This request could not be completed. Please try again.'},{status:502,headers:{'Cache-Control':'no-store'}});
    }
  }
};
