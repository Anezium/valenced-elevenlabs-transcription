import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTION_LABEL, clientHost, tick } from './client-host.mjs';
// Settings-screen redesign (UI review): status line, collapsed summaries, Status and about, sheet wording.
// Synthetic host, real bundle. Collapse state lives in the runtime (rt.toggle / rt.update) so it is testable.
const render=h=>h.collect(h.definition.SettingsComponent());
const rows=h=>render(h).filter(x=>x.type===h.ActionSheetRow).map(x=>x.props);
const switches=h=>render(h).filter(x=>x.type==='TableSwitchRow').map(x=>x.props);
const texts=h=>render(h).filter(x=>x.type==='Text');
const textOf=x=>[x.props.children].flat(Infinity).join('');
const statusText=h=>textOf(texts(h)[0]);
const buttonsOf=r=>r().filter(x=>x.type==='Button').map(x=>x.props);
async function openSheet(h,record){
 const row=h.findRow(h.menu(record));assert(row);row.props.onPress();await tick();const props=h.opened;
 return ()=>h.collect(h.sheet(props));
}
const WARNING='An upload was already attempted for this voice message: retrying may be billed a second time, even without a result.';

test('status line: computed step/ready/critical states replace the intro paragraph',async()=>{
 const h=clientHost();const rt=await h.ready();
 assert.equal(statusText(h),'Step 2: turn on Send audio to ElevenLabs.');
 await rt.forget();assert.equal(statusText(h),'Step 1: add your API key.');
 await rt.setKey('synthetic_key_fixture_000000');await rt.consent.set('external',true);
 assert.equal(statusText(h),`Ready. Long-press a voice message, then choose ${ACTION_LABEL}.`);
 // unsupported build / menu failure is visible immediately, critical, with the alert role
 rt.update({compatible:false,problem:'Different client build or missing metadata: x'});
 const critical=texts(h)[0];assert.equal(critical.props.accessibilityRole,'alert');assert.match(textOf(critical),/Not available on this Discord build/);
 rt.update({compatible:true,problem:'Several menu modules match; no patch kept.'});
 assert.equal(texts(h)[0].props.accessibilityRole,'alert');assert.match(statusText(h),/Several menu modules match/);
 h.stop();await tick();
});

test('automatic summary row is collapsed by default and ALWAYS shows its state; switches appear on expand',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.consent.set('external',true);
 const summary=()=>rows(h).find(r=>r.label==='Automatic transcription');
 assert.equal(summary().subLabel,'Off');assert.equal(switches(h).some(s=>s.label.startsWith('Transcribe others')),false); // collapsed
 rt.toggle('openAuto');assert.equal(switches(h).filter(s=>/^(Transcribe others|Auto-publish)/.test(s.label)).length,2);
 switches(h).find(s=>s.label==='Transcribe others’ messages').onValueChange(true);await tick();
 rt.toggle('openAuto'); // collapse again: the summary must still say it is on
 assert.equal(summary().subLabel,'On: others’ messages');assert.equal(switches(h).some(s=>s.label.startsWith('Transcribe others')),false);
 await rt.auto.configure({incoming:true,ownReplies:true});assert.equal(summary().subLabel,'On: others’ messages and mine');
 await rt.auto.configure({incoming:false,ownReplies:true});assert.equal(summary().subLabel,'On: my messages');
 await rt.auto.configure({incoming:false,ownReplies:false});assert.equal(summary().subLabel,'Off');
 rt.update({autoReady:false});assert.equal(summary().subLabel,'Unavailable on this build');
 h.stop();await tick();
});

test('disabled automatic switches say why; reasons are in the sublabel',async()=>{
 const h=clientHost();const rt=await h.ready();rt.toggle('openAuto');
 const auto=()=>switches(h).filter(s=>/^(Transcribe others|Auto-publish)/.test(s.label));
 assert.equal(auto().every(s=>s.disabled===false),true);
 await rt.forget();assert.equal(auto().every(s=>s.disabled===true&&s.subLabel==='Add an API key first.'),true);
 await rt.setKey('synthetic_key_fixture_000000');rt.update({autoReady:false});
 assert.equal(auto().every(s=>s.disabled===true&&s.subLabel==='Unavailable on this build.'),true);
 h.stop();await tick();
});

test('Status and about: collapsed by default; expanded rows are label/value; keeps the short device-verification line',async()=>{
 const h=clientHost();const rt=await h.ready();
 assert.equal(rows(h).some(r=>r.label==='Verification'),false);assert.equal(rows(h).some(r=>r.label==='Discord build'),false);
 rt.toggle('openStatus');
 const row=label=>rows(h).find(r=>r.label===label);
 assert.equal(row('Verification').subLabel,'Not yet verified on a device');
 assert.equal(row('Discord build').subLabel,'Supported');assert.equal(row('Limits').subLabel,'8 MiB, 5 min');assert.equal(row('Problem').subLabel,'None');
 assert.equal(row('Consents in effect').subLabel,'None');await rt.consent.set('external',true);assert.equal(row('Consents in effect').subLabel,'Sending');
 const manifest=JSON.parse(readFileSync('plugins/elevenlabs-transcription/manifest.json','utf8'));
 assert.match(row('Version').subLabel,new RegExp(`^${manifest.version.replace(/\./g,'\\.')},`)); // UI version string follows the manifest
 assert.match(row('Version').subLabel,/GPL-3\.0/);
 assert.equal(rows(h).some(r=>r.label==='Privacy and security'&&r.arrow===true),true);
 assert.equal(texts(h).some(t=>/Android Keystore/.test(textOf(t))),false);rt.toggle('openPrivacy');assert.equal(texts(h).filter(t=>/Keystore|ElevenLabs, not on this device|cleared when the app/.test(textOf(t))).length,3);
 // developer caveats are gone from the default screen
 const all=[...texts(h).map(textOf),...rows(h).map(r=>String(r.subLabel??''))].join('\n');
 assert.equal(/Device validation still required|device test needed|Phone and real API tests|verified on a device\./.test(all.replace('Not yet verified on a device','')),false);
 h.stop();await tick();
});

test('key section: one API key row (Saved / Not set), Remove stays active without a key in memory, errors go to the status banner',async()=>{
 const h=clientHost();const rt=await h.ready();
 assert.equal(rows(h).find(r=>r.label==='API key').subLabel,'Saved');
 rt.keys.vault.delete=async()=>{throw Error('synthetic native deletion failure')};
 const remove=()=>rows(h).find(r=>r.label==='Remove key');
 remove().onPress();await tick();await tick();
 assert.notEqual(rt.diagnostics.uiError,'');assert(texts(h).some(t=>t.props.accessibilityRole==='alert'&&textOf(t)===rt.diagnostics.uiError));
 assert.equal(remove().disabled,false);assert.equal(remove().subLabel,undefined);
 h.stop();await tick();
});

test('"Consents are being saved" is muted progress, not a critical error; real failures stay critical',async()=>{
 const h=clientHost();const rt=await h.ready();rt.toggle('openAuto');let release;h.beforeSave(()=>new Promise(r=>release=r));
 const done=rt.auto.configure({incoming:true,ownReplies:false});await tick();
 assert.match(rt.diagnostics.autoStatus,/Consents are being saved/);assert.equal(rt.diagnostics.autoProblem,'');
 const note=texts(h).find(t=>/Consents are being saved/.test(textOf(t)));assert(note);assert.notEqual(note.props.accessibilityRole,'alert');assert.equal(note.props.color,'text-muted');
 release();await done;assert.equal(rt.diagnostics.autoStatus,'');h.beforeSave(async()=>{});
 h.failStorage(true);await assert.rejects(rt.auto.configure({incoming:false,ownReplies:false}));
 assert.match(rt.diagnostics.autoProblem,/Consents not saved/);assert.equal(rt.diagnostics.autoStatus,'');
 assert(texts(h).some(t=>t.props.accessibilityRole==='alert'&&/Consents not saved/.test(textOf(t))));
 h.failStorage(false);h.stop();await tick();
});

test('sheet: cost note directly above Transcribe, consent button names ElevenLabs, double-billing warning unchanged',async()=>{
 const h=clientHost();const rt=await h.ready();const record=h.voice(2);h.records.set(`1/${record.id}`,record);
 const render=await openSheet(h,record);
 assert(buttonsOf(render).some(b=>b.text==='Allow sending to ElevenLabs'));assert(!buttonsOf(render).some(b=>b.text.startsWith('Transcribe')));
 buttonsOf(render).find(b=>b.text==='Allow sending to ElevenLabs').onPress();await tick();
 const sequence=()=>render();const idx=sequence().findIndex(x=>x.type==='Button'&&x.props.text==='Transcribe');assert(idx>0);
 const above=sequence()[idx-1];assert.equal(above.type,'Text');assert.match(textOf(above),/ElevenLabs/);assert.match(textOf(above),/[Cc]ost/);
 // double-billing warning: exact text, shown if and only if an upload was already attempted
 const warning=()=>render().filter(x=>x.type==='Text'&&textOf(x)===WARNING);
 assert.equal(warning().length,0);
 rt.engine.wasAttempted=()=>true;
 assert.equal(warning().length,1);assert.equal(warning()[0].props.accessibilityRole,'alert');assert.equal(warning()[0].props.color,'text-feedback-warning');
 const order=render().findIndex(x=>x.type==='Text'&&textOf(x)===WARNING);const buttonAt=render().findIndex(x=>x.type==='Button'&&x.props.text==='Transcribe');assert(order<buttonAt);
 h.stop();await tick();
});

test('sheet: publish wording and small clear action; publish consent still explicit',async()=>{
 const h=clientHost();const rt=await h.ready();const own=h.voice(2,true);h.records.set(`1/${own.id}`,own);
 await rt.consent.set('external',true);rt.engine.cached=()=>'manual transcript';
 const render=await openSheet(h,own);
 assert(buttonsOf(render).some(b=>b.text==='Allow publishing my transcripts'));assert(!buttonsOf(render).some(b=>b.text==='Publish as reply'));
 const clear=buttonsOf(render).find(b=>b.text==='Clear local transcripts');assert.equal(clear.size,'sm');assert.equal(clear.variant,'tertiary');
 await rt.consent.set('publish',true);assert(buttonsOf(render).some(b=>b.text==='Publish as reply'));
 h.stop();await tick();
});

test('review follow-up: vault problem is a critical status line; errors also appear inline under their section; a section clears only its own error',async()=>{
 const h=clientHost();const rt=await h.ready();
 rt.update({problem:'Android vault unavailable or key invalidated. No plaintext storage.'});
 assert.equal(texts(h)[0].props.accessibilityRole,'alert');assert.match(statusText(h),/Android vault unavailable/);
 rt.update({problem:''});
 // manual section: a failed consent write shows in the banner AND directly under the Manual group
 h.failStorage(true);await assert.rejects(rt.consent.set('publish',true),{code:'preferences'});h.failStorage(false);
 const manualAlerts=()=>texts(h).filter(t=>t.props.accessibilityRole==='alert'&&/nothing is authorized|session only/.test(textOf(t)));
 assert.equal(manualAlerts().length,1);assert.equal(manualAlerts()[0].props.accessibilityLiveRegion,'assertive'); // banner is the single announced alert
 const manualInline=texts(h).filter(t=>/nothing is authorized|session only/.test(textOf(t)));assert.equal(manualInline.length,2);assert.equal(manualInline.filter(t=>t.props.accessibilityRole!=='alert').length,1); // plus a plain inline copy under the group
 await rt.consent.set('publish',false);
 // automatic section: the inline copy exists only while expanded
 h.failStorage(true);await assert.rejects(rt.auto.configure({incoming:true,ownReplies:false}));h.failStorage(false);
 const autoAlerts=()=>texts(h).filter(t=>t.props.accessibilityRole==='alert'&&/Consents not saved/.test(textOf(t)));
 const autoTexts=()=>texts(h).filter(t=>/Consents not saved/.test(textOf(t)));assert.equal(autoAlerts().length,1);assert.equal(autoTexts().length,1);rt.toggle('openAuto');assert.equal(autoAlerts().length,1);assert.equal(autoTexts().length,2);
 // per-source ui errors: another section cannot clear this one
 rt.setUiError('synthetic key failure','key');rt.setUiError('','auto');assert.equal(rt.diagnostics.uiError,'synthetic key failure');
 rt.setUiError('','key');assert.equal(rt.diagnostics.uiError,'');
 h.stop();await tick();
});

test('review follow-up: key editor input keeps its accessible label; wording stays consistent on cost',async()=>{
 const h=clientHost();const rt=await h.ready();const own=h.voice(2);h.records.set(`1/${own.id}`,own);await rt.forget();
 const sheet=await openSheet(h,own);const input=sheet().find(x=>x.type==='TextInput');assert(input); // the settings editor opens on press; the sheet shows the same editor without a key
 assert.equal(input.props.secureTextEntry,true);assert.match(String(input.props.accessibilityLabel),/API key/);
 rt.toggle('openAuto');const groups=render(h).filter(x=>x.type==='TableRowGroup').map(x=>String(x.props.description??''));const all=[...texts(h).map(textOf),...rows(h).map(r=>String(r.subLabel??'')),...switches(h).map(s=>String(s.subLabel??'')),...groups].join('\n');
 assert.equal(/billed/.test(all),false);assert.match(all,/cost possible/i);
 h.stop();await tick();
});
