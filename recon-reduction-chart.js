import {jwtReductionCurve} from './recon-reduction-model.js?v=jwt-2';

export function renderJwtCurve(svg,result){
  const ns='http://www.w3.org/2000/svg',make=(name,attrs={},text)=>{const el=document.createElementNS(ns,name);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;return el;};
  const {maxKm,points}=jwtReductionCurve(result.rmwKm),left=64,top=40,width=610,height=250;
  const x=km=>left+km/maxKm*width,y=ratio=>top+(1.2-ratio)/.4*height;
  const tick=(px,py,text,attrs={})=>make('text',{x:px,y:py,fill:'#a9c0cc','font-size':12,...attrs},text);
  svg.replaceChildren(make('title',{id:'jwtCurveTitle'},'JWT flight-level reduction curve'),make('desc',{id:'jwtCurveDescription'},`Logarithmic reduction ratio by flight-level RMW in kilometers. Selected radius ${result.rmwKm.toFixed(3)} km, ratio ${result.factor.toFixed(6)}, reduced wind ${result.surface.kt.toFixed(1)} knots.`));
  svg.append(make('rect',{width:700,height:350,fill:'#060c15',rx:12}),tick(64,23,'JWT RMW reduction curve',{'font-size':14,fill:'#e6f0f5','font-weight':600}));
  const defs=make('defs'),clip=make('clipPath',{id:'jwtCurveClip'});clip.append(make('rect',{x:left,y:top,width,height}));defs.append(clip);svg.append(defs);
  for(let i=0;i<=8;i++){const value=.8+i*.05,py=y(value);svg.append(make('line',{x1:left,x2:left+width,y1:py,y2:py,stroke:'#7891a3',opacity:.28}),tick(left-10,py+4,value.toFixed(2),{'text-anchor':'end'}));}
  for(let i=0;i<=5;i++){const value=maxKm*i/5,px=x(value);svg.append(make('line',{x1:px,x2:px,y1:top,y2:top+height,stroke:'#7891a3',opacity:.28}),tick(px,top+height+20,String(Number(value.toFixed(1))),{'text-anchor':'middle'}));}
  svg.append(make('rect',{x:left,y:top,width,height,fill:'none',stroke:'#a6becb','stroke-width':1}),tick(left+width/2,338,'Flight-level RMW (km)',{'text-anchor':'middle'}),tick(18,top+height/2,'Reduction ratio',{'text-anchor':'middle',transform:`rotate(-90 18 ${top+height/2})`}));
  const data=make('g',{'clip-path':'url(#jwtCurveClip)'}),path=points.map((p,i)=>(i?'L':'M')+x(p.km).toFixed(3)+' '+y(p.ratio).toFixed(3)).join(' ');
  data.append(make('path',{d:path,fill:'none',stroke:'#8bdad1','stroke-width':2.5}),make('line',{x1:x(result.rmwKm),x2:x(result.rmwKm),y1:top,y2:top+height,stroke:'#ff736f','stroke-width':1.8,'stroke-dasharray':'6 5'}),make('circle',{cx:x(result.rmwKm),cy:y(result.factor),r:5,fill:'#b3f4e7',stroke:'#060c15','stroke-width':2}));svg.append(data);
}
