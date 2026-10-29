const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {File}=require('node:buffer');
const model=import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../upload-storage.js')).toString('base64'));
function chunk(type,data=Buffer.alloc(0)) {
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4);data.copy(result,8);
  let crc=0xffffffff;
  for(const byte of result.subarray(4,-4)) {crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
  result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;
}
function fixture(animated=false) {
  const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(256*(256*4+1),42);
  for(let row=0;row<256;row++)raw[row*1025]=0;
  const compressed=zlib.deflateSync(raw,{level:0}),middle=Math.floor(compressed.length/2);
  const chunks=[chunk('IHDR',header),chunk('tEXt',Buffer.from('Source\0Research image')),chunk('gAMA',Buffer.from([0,0,177,143]))];
  if(animated)chunks.push(chunk('acTL',Buffer.alloc(8)));
  chunks.push(chunk('IDAT',compressed.subarray(0,middle)),chunk('IDAT',compressed.subarray(middle)),chunk('IEND'));
  const file=new File([Buffer.from([137,80,78,71,13,10,26,10]),...chunks],'storm.png',{type:'image/png',lastModified:12345});
  return {file,raw,chunks};
}
function parse(bytes) {
  const chunks=[];
  for(let offset=8;offset<bytes.length;) {const end=offset+bytes.readUInt32BE(offset)+12;chunks.push({type:bytes.toString('ascii',offset+4,offset+8),bytes:bytes.subarray(offset,end)});offset=end;}
  return chunks;
}
test('PNG optimization preserves exact image data, dimensions, transparency metadata and ancillary chunks',async()=>{
  const {optimizeUploadFile}=await model,{file,raw,chunks}=fixture();
  const result=await optimizeUploadFile(file);assert.ok(result.size<file.size/10);assert.equal(result.name,file.name);assert.equal(result.lastModified,12345);
  const after=parse(Buffer.from(await result.arrayBuffer()));
  assert.deepEqual(after.filter(c=>c.type!=='IDAT').map(c=>c.bytes),chunks.filter(c=>c.toString('ascii',4,8)!=='IDAT'));
  assert.deepEqual(zlib.inflateSync(Buffer.concat(after.filter(c=>c.type==='IDAT').map(c=>c.bytes.subarray(8,-4)))),raw);
  for(const c of after)assert.deepEqual(chunk(c.type,c.bytes.subarray(8,-4)),c.bytes,'output chunk CRC is valid');
});
test('animated images, photos, documents, invalid files and already small PNGs retain original bytes',async()=>{
  const {optimizeUploadFile}=await model;
  for(const file of [fixture(true).file,new File([Buffer.alloc(50000)],'photo.jpg',{type:'image/jpeg'}),new File([Buffer.alloc(50000)],'movie.gif',{type:'image/gif'}),new File([Buffer.alloc(50000)],'paper.pdf',{type:'application/pdf'}),new File([Buffer.alloc(50000)],'bad.png',{type:'image/png'}),new File([Buffer.alloc(100)],'tiny.png',{type:'image/png'})])assert.equal(await optimizeUploadFile(file),file);
});
test('uploads keep one full-quality file without storing a second original or preview',async()=>{
  const {prepareUploadFileBundle}=await model,{file}=fixture();const result=await prepareUploadFileBundle(file);
  assert.ok(result.displayFile.size<file.size);assert.equal(result.originalFile,null);assert.equal(result.originalPreserved,false);
  const photo=new File([Buffer.alloc(1000000)],'photo.jpg',{type:'image/jpeg'});
  assert.equal((await prepareUploadFileBundle(photo)).displayFile,photo);
});
