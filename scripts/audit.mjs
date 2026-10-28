import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
const files=execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert(files.length,'Stage an explicit project allowlist before audit');
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/,/sk_[A-Za-z0-9]{30,}/,/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,/\/srv\/appdata\//,/\/home\/[^/]+\//];
function scan(name,bytes){const text=Buffer.from(bytes).toString('utf8');for(const pattern of patterns)assert(!pattern.test(text),`Privacy/secret pattern in ${name}`)}
for(const f of files){
 assert(!/(^|\/)(node_modules|\.git|\.env[^/]*|build|dist|tools)(\/|$)|\.(ogg|mp3|wav|log)$/.test(f),`Excluded file staged: ${f}`);
 const data=execFileSync('git',['show',`:${f}`],{maxBuffer:10*1024*1024});scan(f,data);
}
const manifest=JSON.parse(readFileSync('vendor-manifest.json','utf8'));
for(const [dir,{files: hashes}]of Object.entries(manifest))for(const [file,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(`vendor/${dir}/${file}`)).digest('hex'),hash);
const index=JSON.parse(readFileSync('index.json','utf8'));const p=index.plugins['anezium.elevenlabs-transcription'];const v=p.versions['0.1.0'];
const zip=readFileSync('dist/anezium.elevenlabs-transcription@0.1.0.zip');
assert.equal(createHash('sha256').update(zip).digest('hex'),v.sha256);assert.equal(zip.length,v.size);
for(const [name,data]of Object.entries(unzipSync(zip)))scan(name,data);
const code=readFileSync('plugins/elevenlabs-transcription/build/js/index.js','utf8');
assert(!/synthetic_key_fixture|FIXTURE SYNTH|sendMessage|receiveMessage|jsonStorage|console\./.test(code));
assert(code.includes('https://api.elevenlabs.io/v1/speech-to-text'));assert(code.includes('xi-api-key'));
console.log(`Audit OK: ${files.length} staged files; ZIP entries checked; vendor per-file hashes intact; no matching secret/private-path patterns; no logs/fixtures/Discord send/storage in runtime bundle.`);
console.log('Manual review required too: regex scanning does not prove absence of every possible secret.');
