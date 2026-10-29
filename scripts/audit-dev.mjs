import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/,/sk_[A-Za-z0-9]{30,}/,/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,/\/srv\/appdata\//,/\/home\/[^/]+\//];
function scan(name,data){const text=Buffer.from(data).toString('utf8');for(const p of patterns)assert(!p.test(text),`Pattern ${p} in ${name}`)}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(`${dir}/${x.name}`):[`${dir}/${x.name}`])}
const paths=['package.json','package-lock.json','README.md','V020_TECHNICAL.md',
 'scripts/setup-native.py','scripts/build-native.py','scripts/package-dev.mjs','scripts/audit-dev.mjs',
 ...files('plugins/elevenlabs-transcription/js'),...files('plugins/elevenlabs-transcription/android'),...files('tests')];
for(const path of paths)scan(path,readFileSync(path));
const vendors=JSON.parse(readFileSync('vendor-manifest.json','utf8'));
let vendorCount=0;
for(const [dir,{files}]of Object.entries(vendors))for(const [name,expected]of Object.entries(files)){assert.equal(hash(readFileSync(`vendor/${dir}/${name}`)),expected);vendorCount++}
const index=readFileSync('index.json');assert.deepEqual(index,execFileSync('git',['show','HEAD:index.json']));
const pkg=JSON.parse(readFileSync('build/v020-package.json','utf8'));
const zip=readFileSync(pkg.file);assert.equal(zip.length,pkg.size);assert.equal(hash(zip),pkg.sha256);
const entries=unzipSync(zip);for(const [name,data]of Object.entries(entries))scan(name,data);
const dex=unzipSync(entries['elevenlabs.jar'])['classes.dex'];scan('classes.dex',dex);
for(const [name,data]of Object.entries({'index.js':entries['index.js'],'classes.dex':dex}))assert(!/synthetic_(?:key|fixture|replacement)|FIXTURE SYNTH|console\./.test(Buffer.from(data).toString('utf8')),`Fixture or logging in ${name}`);
const runtime=Buffer.from(entries['index.js']).toString('utf8');assert(!/getToken|Authorization|receiveMessage/.test(runtime));
assert(runtime.includes('enforce_nonce') && runtime.includes('message_reference'));
assert(runtime.includes('anezium.elevenlabs.auto.reserve'));
assert(runtime.includes('anezium.elevenlabs.vault.'));assert(runtime.includes('xi-api-key'));
const report={sourceFilesScanned:paths.length,vendorFilesVerified:vendorCount,publicIndexUnchanged:true,sha256:pkg.sha256,zipSize:pkg.size,checks:'Pattern scan; no runtime fixtures/logging/direct account-token access; JSON preferences contain only consent booleans and account binding (integration tests); native encrypted key; referenced reply and nonce guards present. Not a proof of absence of all secrets.'};
writeFileSync('build/v020-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
