import assert from 'node:assert/strict';
import test from 'node:test';
import { renderOpticalStackRgb } from '../lib/opticalStack.ts';
import { finiteKmLayer, spectralSurfaceFromLinearRgb, spectralSurfaceToLinearRgb, decodeSrgbByte, encodeSrgbByte } from '../lib/colorScience.ts';
import { createPigmentField, depositStamp, compositePigmentLayers, samplePigmentLayers, encodePigmentField, encodePigmentWetness, encodePigmentGlazes, decodePigmentField, decodePigmentGlazes, capturePigmentPatch, applyPigmentPatch, totalPigmentMassAt, totalBodyMassAt, settleWetPaint, smoothStamp, resamplePigmentField } from '../lib/pigmentField.ts';
const bounds = { x: 0, y: 0, width: 1, height: 1 };
const paper = { r: 247, g: 241, b: 230 };
const flat = { relief: 0, wetDarkening: 0 };
const image = (w=1,h=1) => ({ width:w,height:h,data:new Uint8ClampedArray(w*h*4) });
function shown(sources, opts=flat) { const out=image(); compositePigmentLayers(paper,sources,out,bounds,opts); return Array.from(out.data); }
function field(p,m) { const f=createPigmentField(1,1); f.pigment[p]=1; f.mass[0]=m; return f; }
test('実合成経路で同顔料の一層と二層は全5顔料・薄厚範囲で同じ表示になる',()=>{
  for(let p=0;p<5;p++) for(const mass of [.0001,.001,.01,.1,1,4]) {
    const whole=shown([{kind:'paint',field:field(p,mass)}]);
    const split=shown([{kind:'paint',field:field(p,mass*.3)},{kind:'paint',field:field(p,mass*.7)}]);
    for(let c=0;c<3;c++) assert.ok(Math.abs(whole[c]-split[c])<=1,`${p}/${mass}: ${whole} vs ${split}`);
  }
});
test('RGB画像境界は原色を含めゼロ膜の色を変えず、有限KM極端値もNaNを出さない',()=>{
  for(const rgb of [{r:1,g:0,b:0},{r:0,g:0,b:1},{r:.91,g:.87,b:.8},{r:0,g:0,b:0},{r:1,g:1,b:1}]) {
    const restored=spectralSurfaceToLinearRgb(spectralSurfaceFromLinearRgb(rgb));
    for(const c of ['r','g','b']) assert.ok(Math.abs(rgb[c]-restored[c])<1e-6);
  }
  for(const k of [1e-308,1e308]) for(const s of [1e-308,1e308]) for(const t of [1e-308,1,1e308]) {
    const film=finiteKmLayer(k,s,t); assert.ok(Number.isFinite(film.reflectance+film.transmittance)); assert.ok(film.reflectance+film.transmittance<=1+1e-12);
  }
});
test('乾層を含む群opacityのスポイト・再塗布・保存・Undo・サイズ変更が物理層を保持する',()=>{
  const f=field(1,1); depositStamp(f,.5,.5,1,{pigment:[0,0,1,0,0],mass:.25,wetness:0,hardness:1});
  for(const opacity of [.5,.7,1]) {
    const sources=[{kind:'paint',field:f,opacity}];
    const sample=samplePigmentLayers(paper,sources,0,0,flat);
    const copy=createPigmentField(1,1);
    depositStamp(copy,.5,.5,1,{pigment:[0,.8,.2,0,0],mass:sample.exactPaint.opticalMass,wetness:0,hardness:1,opticalStack:sample.exactPaint.opticalStack});
    assert.deepEqual(shown([{kind:'paint',field:copy}]),shown(sources));
    const restored=decodePigmentField(...encodePigmentField(copy),encodePigmentWetness(copy));
    decodePigmentGlazes(restored,encodePigmentGlazes(copy));
    assert.deepEqual(shown([{kind:'paint',field:restored}]),shown(sources));
    const patch=capturePigmentPatch(copy,bounds); copy.glazes.clear(); applyPigmentPatch(copy,patch);
    assert.deepEqual(shown([{kind:'paint',field:copy}]),shown(sources));
    assert.equal(totalPigmentMassAt(resamplePigmentField(copy,2,2),0,1),totalPigmentMassAt(copy,0,1));
  }
});
function inventory(f){const result=Array(7).fill(0);for(let i=0;i<f.mass.length;i++){for(let p=0;p<5;p++)result[p]+=totalPigmentMassAt(f,i,p);result[5]+=f.mass[i]*f.wetness[i];result[6]+=f.mass[i]*f.body[i];}return result;}
test('拡散・縁への移動・紙目・ぼかしは顔料各種と水とbodyを個別に保存する',()=>{
  for(const mode of ['diffusion','edge','grain','combined','blur']) {
    const f=createPigmentField(64,64);
    depositStamp(f,23,28,15,{pigment:[1,0,0,0,0],mass:.2,wetness:.9,body:.1,hardness:.7});
    depositStamp(f,35,31,17,{pigment:[0,1,0,0,0],mass:1,wetness:.3,body:1,hardness:.8});
    const before=inventory(f);
    if(mode==='blur')smoothStamp(f,32,32,22,.8);
    else settleWetPaint(f,{x:0,y:0,width:64,height:64},{diffusion:mode==='diffusion'||mode==='combined'?4:0,edgeStrength:mode==='edge'||mode==='combined'?.7:0,granulation:mode==='grain'||mode==='combined'?.9:0});
    const after=inventory(f);
    for(let p=0;p<7;p++)assert.ok(Math.abs(before[p]-after[p])<=Math.max(1e-6,before[p]*2e-6),`${mode}/${p}: ${before[p]} -> ${after[p]}`);
  }
});

test('乾いた厚塗りのbody体積は薄いwashを重ねても保存され、PNG復元でも失われない',()=>{
  const f=createPigmentField(1,1);
  depositStamp(f,.5,.5,1,{pigment:[0,1,0,0,0],mass:2,wetness:0,body:1,hardness:1});
  depositStamp(f,.5,.5,1,{pigment:[0,0,1,0,0],mass:.1,wetness:.8,body:.12,hardness:1});
  assert.ok(Math.abs(totalBodyMassAt(f,0)-2.012)<1e-6);
  const restored=decodePigmentField(...encodePigmentField(f),encodePigmentWetness(f));
  decodePigmentGlazes(restored,encodePigmentGlazes(f));
  assert.equal(totalBodyMassAt(f,0),totalBodyMassAt(restored,0));
});

test('登録した再帰光学膜の共通rendererはcanvasの群opacity合成と全RGB一致する',()=>{
  const f=field(1,.6); depositStamp(f,.5,.5,1,{pigment:[.1,0,.9,0,0],mass:.08,wetness:0,hardness:1});
  const ground={r:decodeSrgbByte(paper.r),g:decodeSrgbByte(paper.g),b:decodeSrgbByte(paper.b)};
  for(const opacity of [.2,.5,.7,1]) {
    const sources=[{kind:'paint',field:f,opacity}];
    const sample=samplePigmentLayers(paper,sources,0,0,flat);
    const rgb=renderOpticalStackRgb(sample.exactPaint.opticalStack,1,ground);
    assert.deepEqual([encodeSrgbByte(rgb.r),encodeSrgbByte(rgb.g),encodeSrgbByte(rgb.b),255],shown(sources));
  }
});

test('異なる水/bodyの粒状化は各比率0..1を保ちPNG保存のclipによる材料消失を起こさない',()=>{
  const f=createPigmentField(64,64); let seed=1337; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<f.mass.length;i++){f.mass[i]=.1+random()*2;f.pigment[i*5+i%2]=1;f.wetness[i]=i%2===0?1:.13;f.body[i]=i%2===1?1:.12;}
  const before=inventory(f);
  settleWetPaint(f,{x:0,y:0,width:64,height:64},{diffusion:0,edgeStrength:0,granulation:1});
  for(let i=0;i<f.mass.length;i++){assert.ok(f.wetness[i]>=0&&f.wetness[i]<=1);assert.ok(f.body[i]>=0&&f.body[i]<=1);}
  const after=inventory(f);for(let p=0;p<7;p++)assert.ok(Math.abs(after[p]-before[p])<=Math.max(1e-6,before[p]*2e-6));
});
