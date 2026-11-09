// Original Storm Spectrum palette, inspired by the requested warm/green/yellow/
// red/black/magenta progression. Applied to NOAA's unenhanced 8-bit IR only.
// The nominal McIDAS brightness conversion is documented by NOAA/CIRA:
// https://rammb.cira.colostate.edu/research/calibration_validation_and_visualization/goes_image_display/conversion_ir_10_to_8.asp
export const SPECTRUM_STOPS=Object.freeze([
  [-100,[248,242,248]],[-95,[225,146,225]],[-90,[202,18,212]],
  [-85,[157,111,163]],[-80,[101,91,112]],[-75,[45,40,48]],[-70,[4,3,5]],
  [-60,[255,23,8]],[-50,[255,133,12]],[-40,[251,245,32]],
  [-30,[105,153,36]],[-20,[197,217,193]],[-10,[252,253,252]],
  [-5,[130,137,153]],[0,[13,15,34]],[20,[13,14,31]],
  [30,[57,48,55]],[40,[159,141,94]],[50,[184,100,84]]
]);
export function nominalTemperatureC(brightness){if(!Number.isInteger(brightness)||brightness<0||brightness>255)return null;return (brightness<=176?(660-brightness)/2:418-brightness)-273.15;}
export function spectrumColor(celsius){
  if(!Number.isFinite(celsius))return [0,0,0];const s=SPECTRUM_STOPS;if(celsius<=s[0][0])return [...s[0][1]];if(celsius>=s.at(-1)[0])return [...s.at(-1)[1]];
  for(let i=1;i<s.length;i++)if(celsius<=s[i][0]){const [at,a]=s[i-1],[bt,b]=s[i],f=(celsius-at)/(bt-at);return a.map((v,j)=>Math.round(v+(b[j]-v)*f));}
}
const LUT=Array.from({length:256},(_,b)=>b===0?[0,0,0]:spectrumColor(nominalTemperatureC(b)));
export function recolorInfrared(pixels,width,height,footerRows=24){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<100||height<100||width*height>4000000||pixels.length!==width*height*4||footerRows<0||footerRows>=height)throw Error('Unsupported infrared frame.');
  const output=new Uint8ClampedArray(pixels),end=width*(height-footerRows)*4;
  for(let i=0;i<end;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];if(!pixels[i+3]||r!==g||g!==b)continue;const color=LUT[r];output[i]=color[0];output[i+1]=color[1];output[i+2]=color[2];}
  return output;
}
export function paintSpectrum(canvas,source,{name,designation,animated=false}){
  const w=source.displayWidth||source.width,h=source.displayHeight||source.height;
  if(w!==720||h!==480)throw Error('This NOAA infrared frame has an unsupported layout. Choose another satellite product.');
  const raw=document.createElement('canvas');raw.width=w;raw.height=h;const input=raw.getContext('2d',{willReadFrequently:true});input.drawImage(source,0,0,w,h);const frame=input.getImageData(0,0,w,h);frame.data.set(recolorInfrared(frame.data,w,h));input.putImageData(frame,0,0);
  if(canvas.width!==1060)canvas.width=1060;if(canvas.height!==760)canvas.height=760;const ctx=canvas.getContext('2d'),x=25,y=65,pw=936,ph=593;
  ctx.fillStyle='#0a111d';ctx.fillRect(0,0,1060,760);ctx.font='700 20px Inter,Arial';ctx.fillStyle='#e9f1f5';ctx.fillText('STORM SPECTRUM  /  INFRARED',x,31);ctx.textAlign='right';ctx.font='600 17px Inter,Arial';ctx.fillStyle='#9cc9c6';ctx.fillText(`${name.toUpperCase()} · ${designation}${animated?' · LOOP':''}`,pw+x,31);ctx.textAlign='left';
  ctx.imageSmoothingEnabled=false;ctx.drawImage(raw,0,0,w,h-24,x,y,pw,ph);ctx.strokeStyle='#617680';ctx.lineWidth=1;ctx.strokeRect(x-.5,y-.5,pw+1,ph+1);
  const bx=983,bw=20;for(let row=0;row<ph;row++){ctx.fillStyle='rgb('+spectrumColor(50-row/(ph-1)*150).join(',')+')';ctx.fillRect(bx,y+row,bw,1);}ctx.strokeStyle='#8b98a5';ctx.strokeRect(bx-.5,y-.5,bw+1,ph+1);ctx.fillStyle='#a3b3c2';ctx.font='13px Arial';ctx.fillText('≈ °C',bx-1,y-15);
  for(let c=50;c>=-100;c-=10){const py=y+(50-c)/150*ph;ctx.fillStyle='#acbdc9';ctx.fillText(String(c),bx+bw+8,py+4);}
  // Preserve NOAA's acquisition-time/source footer verbatim. Its grayscale ramp
  // is replaced by the new matching color legend rather than left misleading.
  ctx.drawImage(raw,0,h-12,w,12,x,y+ph+14,pw,16);ctx.font='14px Arial';ctx.fillStyle='#9eb4c3';ctx.fillText('NOAA NESDIS / OSPO · Unenhanced IR · Approximate temperature colors from the 8-bit display',x,721);
  ctx.fillStyle='#5f7e8d';ctx.font='12px Arial';ctx.fillText('Original coastlines and scan-time caption retained. No eye temperature or intensity is inferred.',x,743);
}
