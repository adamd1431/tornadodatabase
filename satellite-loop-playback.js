import {LOOP_DEFAULTS} from './satellite-loop-model.js';
export function createLoopPlayback({onFrame,onState=()=>{},fps=LOOP_DEFAULTS.fps,schedule=setTimeout,cancel=clearTimeout,now=()=>performance.now()}={}){
  const entries=new Map();let playing=true,timer=null,current=null,disposed=false,busy=false;
  const frames=()=>[...entries.values()].sort((a,b)=>a.slot-b.slot);
  const state=()=>({playing,index:frames().findIndex(f=>f.slot===current),count:entries.size,fps});
  function clear(){if(timer!==null)cancel(timer);timer=null;}
  async function show(frame){if(!frame||disposed)return;current=frame.slot;await onFrame(frame);if(!disposed)onState(state());}
  function queue(delay=1000/fps){if(!disposed&&playing&&entries.size>1&&timer===null&&!busy)timer=schedule(tick,delay);}
  async function tick(){timer=null;if(disposed||!playing)return;busy=true;const start=now(),list=frames(),i=list.findIndex(f=>f.slot===current);try{await show(list[(i+1)%list.length]);}finally{busy=false;queue(Math.max(0,1000/fps-(now()-start)));}}
  return {
    async add(frame){if(disposed)return;entries.set(frame.slot,frame);if(current===null)await show(frame);if(disposed)return;onState(state());queue();},
    setPlaying(value){playing=!!value;clear();onState(state());queue();},
    setSpeed(value){if(!Number.isFinite(value)||value<1||value>30)throw Error('Invalid playback speed.');fps=value;clear();onState(state());queue();},
    async seek(index){playing=false;clear();await show(frames()[Math.max(0,Math.min(entries.size-1,index))]);onState(state());},
    async step(delta){const list=frames(),index=list.findIndex(f=>f.slot===current);await this.seek((index+delta+list.length)%list.length);},
    getFrames:frames,getState:state,
    dispose(){disposed=true;playing=false;clear();entries.clear();}
  };
}
