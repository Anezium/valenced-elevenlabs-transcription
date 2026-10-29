import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
const root = 'plugins/elevenlabs-transcription';
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
assert.equal(manifest.version, '0.2.0-dev');
assert.equal(manifest.dist.android.class, 'app.anezium.elevenlabs.ElevenLabsPlugin');
const native = readFileSync(`${root}/build/android/elevenlabs.jar`);
const jar = unzipSync(native);
assert.deepEqual(Object.keys(jar), ['classes.dex']);
const dex = Buffer.from(jar['classes.dex']);
assert(dex.subarray(0, 4).equals(Buffer.from('dex\n')));
// Parse actual DEX class definitions, not strings which also contain external references.
const strings = [];
for (let i=0; i<dex.readUInt32LE(56); i++) {
  let p=dex.readUInt32LE(dex.readUInt32LE(60)+i*4);
  while (dex[p++] & 128) {} // UTF-16 length, irrelevant for ASCII class names.
  const end=dex.indexOf(0,p); assert(end>=p); strings.push(dex.toString('utf8',p,end));
}
const types=[];
for(let i=0;i<dex.readUInt32LE(64);i++)types.push(strings[dex.readUInt32LE(dex.readUInt32LE(68)+i*4)]);
const classes=[];
for(let i=0;i<dex.readUInt32LE(96);i++)classes.push(types[dex.readUInt32LE(dex.readUInt32LE(100)+i*32)]);
assert(classes.includes('Lapp/anezium/elevenlabs/ElevenLabsPlugin;'));
// D8 37 emits this build-generated annotation for desugared Kotlin lambdas.
const allowed = name => name.startsWith('Lapp/anezium/elevenlabs/') || name === 'Lcom/android/tools/r8/annotations/LambdaMethod;';
assert(classes.length>0 && classes.every(allowed), `Unexpected defined DEX classes: ${classes.filter(name=>!allowed(name)).join(', ')}`);
const paths={ 'manifest.json':`${root}/manifest.json`, 'index.js':`${root}/build/js/index.js`,
  'elevenlabs.jar':`${root}/build/android/elevenlabs.jar`, LICENSE:'LICENSE', NOTICE:'NOTICE', 'Apache-2.0.txt':'licenses/Apache-2.0.txt' };
const entries={};
for(const [name,path] of Object.entries(paths))entries[name]=[new Uint8Array(readFileSync(path)),{mtime:new Date('2026-01-01T00:00:00Z')}];
const bytes=zipSync(entries,{level:9});const extracted=unzipSync(bytes);
assert.deepEqual(Object.keys(extracted).sort(),Object.keys(entries).sort());
for(const [name,[expected]] of Object.entries(entries))assert.deepEqual(extracted[name],expected);
mkdirSync('dist',{recursive:true});
const name=`${manifest.id}@${manifest.version}.zip`;
const sha256=createHash('sha256').update(bytes).digest('hex');
writeFileSync(`dist/${name}`,bytes);
writeFileSync('dist/V020_SHA256SUMS',`${sha256}  ${name}\n`);
writeFileSync('build/v020-package.json',JSON.stringify({file:`dist/${name}`,size:bytes.length,sha256,definedNativeClasses:classes,distribution:'LOCAL CANDIDATE ONLY; key/automation and Fable UI integrated; offline synthetic host tests only; no Android runtime or live API validation; publication requires separate review'},null,2)+'\n');
console.log(`Local DEV ZIP verified: ${name}; ${bytes.length} bytes; SHA256 ${sha256}; ${classes.length} DEX definitions (plugin + D8 annotation only). Public index unchanged.`);
