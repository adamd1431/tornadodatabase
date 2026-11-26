const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const model=import(pathToFileURL(path.join(__dirname,'../cyclones.js')).href);
const storm={name:'Historical cyclone',year:'1780',peak_winds_mph:'Unknown',lowest_pressure_mb:'Not recorded'};

test('text and missing intensity can be submitted, reopened and changed back to numeric values',async()=>{
  const {validateCyclone,cycloneFields,submitCyclone,cycloneWindLabel,cycloneIntensityLabel}=await model;
  const row=validateCyclone(storm);
  assert.equal(row.peak_winds_mph,null);assert.equal(row.lowest_pressure_mb,null);
  assert.equal(row.peak_winds_mph_text,'Unknown');assert.equal(row.lowest_pressure_mb_text,'Not recorded');
  const html=cycloneFields(row);assert.match(html,/name="peak_winds_mph" type="text"[^>]*value="Unknown"/);
  assert.match(html,/name="lowest_pressure_mb" type="text"[^>]*value="Not recorded"/);
  assert.equal(cycloneWindLabel(row),'Unknown');assert.equal(cycloneIntensityLabel(row,'lowest_pressure_mb','mb'),'Not recorded');
  let sent;
  await submitCyclone({rpc:async(name,args)=>{sent={name,args};return {data:{id:args.p_id,status:'pending'}};}},storm,'same-request');
  assert.equal(sent.name,'submit_tropical_cyclone_intensity');assert.equal(sent.args.p_peak_winds_mph,null);
  assert.equal(sent.args.p_peak_winds_mph_text,'Unknown');assert.equal(sent.args.p_lowest_pressure_mb_text,'Not recorded');
  assert.equal(sent.args.p_status,undefined);
  const numeric=validateCyclone({...storm,peak_winds_mph:'190',lowest_pressure_mb:'900'});
  assert.equal(numeric.peak_winds_mph,190);assert.equal(numeric.peak_winds_mph_text,null);assert.equal(numeric.lowest_pressure_mb_text,null);
  const empty=validateCyclone({...storm,peak_winds_mph:'',lowest_pressure_mb:''});
  assert.equal(empty.peak_winds_mph,null);assert.equal(empty.lowest_pressure_mb,null);assert.equal(cycloneWindLabel(empty),'Unknown');
});

test('a knots range keeps its units without inventing an mph conversion or hurricane category',async()=>{
  const {validateCyclone,cycloneFields,cycloneWindLabel,cyclonePeak}=await model;
  const row=validateCyclone({...storm,peak_winds_mph:'',peak_winds_kts:'170–185',wind_input_unit:'kts',lowest_pressure_mb:'~890'});
  assert.equal(row.peak_winds_kts_text,'170–185');assert.equal(row.peak_winds_mph,null);
  assert.equal(cycloneWindLabel(row),'170–185 kts');assert.equal(cyclonePeak(row.peak_winds_mph).category,null);
  assert.match(cycloneFields(row),/name="wind_input_unit" value="kts"/);
  assert.equal((await model).cycloneIntensityLabel(row,'lowest_pressure_mb','mb'),'~890 mb');
});

test('numeric sorting keeps unknown and text values last in either direction, preserving zero wind',async()=>{
  const {compareCycloneIntensity}=await model;
  const rows=[{id:'missing',year:2000,peak_winds_mph:null},{id:'weak',year:2000,peak_winds_mph:0},{id:'strong',year:2000,peak_winds_mph:200}];
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneIntensity(a,b,'peak_winds_mph')).map(r=>r.id),['weak','strong','missing']);
  assert.deepEqual([...rows].sort((a,b)=>compareCycloneIntensity(a,b,'peak_winds_mph',true)).map(r=>r.id),['strong','weak','missing']);
});

test('owner text estimates are escaped, preserved, and never fill a numeric measurement',async()=>{
  const {validateCycloneEstimates,cycloneEstimateStats}=await model;
  const row=validateCycloneEstimates({owner_estimated_winds_mph:'180–190 mph',owner_estimated_pressure_mb:'Unknown <source>'});
  assert.equal(row.owner_estimated_winds_mph,null);assert.equal(row.owner_estimated_pressure_mb,null);
  const html=cycloneEstimateStats(row);assert.match(html,/180–190 mph/);assert.match(html,/Unknown &lt;source&gt;/);
  assert.doesNotMatch(html,/Unknown.* mb|NaN|<source>/);
});

test('typing text clears stale wind conversion and numeric input still converts',async()=>{
  const {bindCycloneWindInputs}=await model;let listener;
  const fields={peak_winds_mph:{value:'215'},peak_winds_kts:{value:'185'},wind_input_unit:{value:'mph'}};
  const form={elements:{namedItem:key=>fields[key]}};
  bindCycloneWindInputs({addEventListener:(_,handler)=>listener=handler});
  listener({target:{name:'peak_winds_mph',value:'Unknown',closest:()=>form}});
  assert.equal(fields.peak_winds_kts.value,'');
  listener({target:{name:'peak_winds_kts',value:'140',closest:()=>form}});
  assert.equal(fields.peak_winds_mph.value,'160');
});
