import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_LABEL, clientHost, tick } from './client-host.mjs';
// UI du VRAI bundle sur hôte synthétique (useState figé : on vérifie les contrôles rendus et les effets via le runtime,
// pas les transitions visuelles). Aucune feuille/clé/audio/réseau réel ; l’arbre du menu est une fixture, pas l’appareil.
const SECRET='synthetic_key_fixture_000000';
const switches=h=>h.collect(h.definition.SettingsComponent()).filter(x=>x.type==='TableSwitchRow').map(x=>x.props);
const rows=h=>h.collect(h.definition.SettingsComponent()).filter(x=>x.type===h.ActionSheetRow).map(x=>x.props);
const groupsOf=h=>h.collect(h.definition.SettingsComponent()).filter(x=>x.type==='Group').map(x=>x.props.title);
async function openSheet(h,record){
 const row=h.findRow(h.menu(record));assert(row,'synthetic insertion expected');row.props.onPress();await tick();assert(h.sheet,'sheet component captured');
 const props=h.opened;assert.equal(props.target.messageId,record.id);
 return ()=>h.collect(h.sheet(props));
}
const buttonsOf=render=>render().filter(x=>x.type==='Button').map(x=>x.props);

test('parent regression: manual revoke cancels in-flight work immediately even if persistence fails, and suppresses late result',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.consent.set('external',true);await rt.consent.set('publish',true);
 let cancelled=0,cleared=0,release;
 const cancel=rt.engine.cancelAll.bind(rt.engine),clear=rt.engine.clearResults.bind(rt.engine);
 rt.engine.cancelAll=()=>{cancelled++;cancel()};rt.engine.clearResults=()=>{cleared++;clear()};
 rt.engine.run=()=>new Promise(r=>release=r);
 const render=await openSheet(h,h.voice(2));buttonsOf(render).find(b=>b.text==='Transcribe (cost possible)').onPress();
 assert(release);h.failStorage(true);const revoked=rt.consent.set('external',false);
 assert.equal(cancelled>0,true);assert.equal(cleared>0,true);assert.equal(rt.consent.mode().external,false);
 await assert.rejects(revoked,{code:'preferences'});release('late synthetic text');await tick();
 assert.notEqual(rt.diagnostics.last,'Transcript received and audio cache cleaned');assert.equal(h.posts.length,0);assert.equal(h.network,0);h.stop();
});
test('parent regression: failed native deletion leaves a visible retry action without key in memory',async()=>{
 const h=clientHost();const rt=await h.ready();const original=rt.keys.vault.delete;
 rt.keys.vault.delete=async()=>{throw Error('synthetic native deletion failure')};
 await assert.rejects(rt.forget());assert.equal(rt.diagnostics.keySet,false);
 const retry=rows(h).find(x=>x.label==='Delete the key and results');assert(retry);assert.equal(retry.disabled,false);
 assert.match(retry.subLabel,/Try again/);assert.notEqual(rt.diagnostics.last,'Key deleted from the vault');
 rt.keys.vault.delete=original;retry.onPress();await tick();assert.equal(rt.diagnostics.last,'Key deleted from the vault');h.stop();
});

test('ui settings: concise native groups, manual consents off by default, persisted per account without secrets, publish gated by external, revoke immediate',async()=>{
 const h=clientHost();const rt=await h.ready();await tick();
 assert.deepEqual(groupsOf(h),['ElevenLabs API key','Manual transcription','Automatic — off by default','Details']);
 assert.equal(h.collect(h.definition.SettingsComponent()).some(x=>x.type==='TextInput'),false); // key editor hidden while a key exists
 let external=switches(h).find(x=>x.label==='Allow sending to ElevenLabs');let publish=switches(h).find(x=>x.label==='Publish my transcripts');
 assert.equal(external.value,false);assert.equal(publish.value,false);assert.equal(publish.disabled,true);assert.match(external.subLabel,/cost/i);assert.match(publish.subLabel,/Never other people’s voice messages/);
 assert.deepEqual(rt.consent.mode(),{external:false,publish:false});assert.equal(rt.diagnostics.manualExternal,false);
 external.onValueChange(true);await tick();
 assert.deepEqual(h.prefs.manual,{external:true,publish:false,accountId:'10'});assert.deepEqual(rt.consent.mode(),{external:true,publish:false});assert.equal(rt.diagnostics.manualExternal,true);
 assert(!JSON.stringify(h.prefs).includes(SECRET));assert.deepEqual(Object.keys(h.prefs.manual).sort(),['accountId','external','publish']);
 publish=switches(h).find(x=>x.label==='Publish my transcripts');assert.equal(publish.disabled,false);publish.onValueChange(true);await tick();
 assert.deepEqual(rt.consent.mode(),{external:true,publish:true});assert.equal(h.prefs.manual.publish,true);
 assert.equal(h.prefs.incoming,false);assert.equal(h.prefs.external,false);assert.equal(rt.diagnostics.incoming,false); // manual consent never touches automation
 let release;h.beforeSave(()=>new Promise(r=>release=r));
 external=switches(h).find(x=>x.label==='Allow sending to ElevenLabs');assert.equal(external.value,true);external.onValueChange(false);
 assert.deepEqual(rt.consent.mode(),{external:false,publish:false}); // revoked synchronously, before the disk write even starts
 assert.equal(switches(h).find(x=>x.label==='Publish my transcripts').disabled,true);
 await tick();assert.equal(h.prefs.manual.external,true);assert(release,'write held'); // disk deliberately stale while held
 release();await tick();assert.deepEqual(h.prefs.manual,{external:false,publish:false,accountId:'10'});h.beforeSave(async()=>{});
 h.stop();await tick();
});
test('ui settings: account switch hides consent; failed grant stays off; failed revoke is honest and session-only; restart restores persisted consent',async()=>{
 const h=clientHost();let rt=await h.ready();await rt.consent.set('external',true);
 h.account('30');assert.deepEqual(rt.consent.mode(),{external:false,publish:false});assert.equal(switches(h).find(x=>x.label==='Allow sending to ElevenLabs').value,false);
 await rt.consent.set('external',true);assert.equal(h.prefs.manual.accountId,'30');h.account('10');assert.equal(rt.consent.mode().external,false);
 h.account('30');h.failStorage(true);
 await assert.rejects(rt.consent.set('publish',true),{code:'preferences'});assert.equal(rt.consent.mode().publish,false);assert.match(rt.consent.problem,/nothing is authorized/);
 await assert.rejects(rt.consent.set('external',false),{code:'preferences'});assert.deepEqual(rt.consent.mode(),{external:false,publish:false});assert.equal(h.prefs.manual.external,true);assert.match(rt.consent.problem,/session only/);
 assert(h.collect(h.definition.SettingsComponent()).some(x=>x.type==='Text'&&x.props.accessibilityRole==='alert'&&/session only/.test(x.props.children)));
 h.failStorage(false);await rt.consent.set('external',false);assert.equal(rt.consent.problem,'');assert.equal(h.prefs.manual.external,false);
 await rt.consent.set('external',true);await rt.consent.set('publish',true);
 h.stop();await tick();assert.deepEqual(rt.consent.mode(),{external:false,publish:false});
 h.start();await tick();await tick();rt=h.rt;assert.deepEqual(rt.consent.mode(),{external:true,publish:true});
 h.stop();await tick();
});
test('ui settings: automatic switches never imply manual consent; manual record survives automation whole-document writes',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.consent.set('external',true);await rt.consent.set('publish',true);
 const incoming=switches(h).find(x=>x.label.startsWith('Others’ voice messages'));incoming.onValueChange(true);await tick();
 assert.equal(h.prefs.incoming,true);assert.deepEqual(h.prefs.manual,{external:true,publish:true,accountId:'10'});
 rows(h).find(x=>x.label==='Turn off all automation').onPress();await tick();
 assert.equal(h.prefs.external,false);assert.deepEqual(h.prefs.manual,{external:true,publish:true,accountId:'10'});assert.deepEqual(rt.consent.mode(),{external:true,publish:true});
 const g=clientHost();const grt=await g.ready();await grt.auto.configure({incoming:true,ownReplies:true});
 assert.deepEqual(grt.consent.mode(),{external:false,publish:false});
 const render=await openSheet(g,g.voice(2,true));
 assert(buttonsOf(render).some(b=>b.text.startsWith('I allow sending')));assert(!buttonsOf(render).some(b=>b.text.startsWith('Transcribe')));
 h.stop();g.stop();await tick();
});
test('ui settings: key rows use the runtime facades; danger delete; editor row toggles; details row shows placement',async()=>{
 const h=clientHost();const rt=await h.ready();
 assert(rows(h).some(r=>r.label==='Replace the key'&&r.arrow===true));
 const del=rows(h).find(r=>r.label==='Delete the key and results');assert.equal(del.variant,'danger');
 del.onPress();await tick();assert.equal(rt.key,'');assert.equal(rt.diagnostics.keySet,false);
 assert(rows(h).some(r=>r.label==='Save a key'));assert(rows(h).find(r=>r.label==='Delete the key and results'));
 assert.equal(rows(h).find(r=>r.label==='Secured key').subLabel,'No key in memory.');
 h.menu(h.voice(2));await tick();assert.match(rows(h).find(r=>r.label==='Long-press menu action').subLabel,/Inserted/);
 assert(rows(h).some(r=>r.label==='Diagnostics, limits and license'&&r.arrow===true));
 h.stop();await tick();
});
test('ui sheet: one-time consent then a single confirmed transcribe action; no transfer control without consent; revocation removes it',async()=>{
 const h=clientHost();const rt=await h.ready();const record=h.voice(2);h.records.set(`1/${record.id}`,record);
 const render=await openSheet(h,record);
 assert.equal(h.opened.target.messageId,record.id);assert(render().some(x=>x.type==='Header'&&x.props.title===ACTION_LABEL&&/1 s/.test(x.props.subtitle)));
 assert(buttonsOf(render).some(b=>b.text==='I allow sending the voice messages I choose to ElevenLabs'));assert(!buttonsOf(render).some(b=>b.text.startsWith('Transcribe')));
 assert.equal(render().some(x=>x.type==='TextInput'),false);
 buttonsOf(render).find(b=>b.text.startsWith('I allow sending')).onPress();await tick();assert.equal(h.prefs.manual.external,true);
 const transcribe=buttonsOf(render).find(b=>b.text==='Transcribe (cost possible)');assert(transcribe);assert.equal(transcribe.disabled,false);
 assert(!buttonsOf(render).some(b=>b.text.startsWith('I allow')));
 transcribe.onPress();await tick();assert.equal(h.calls.filter(x=>x==='stt').length,1);assert.equal(h.posts.length,0);assert.equal(h.network,0);
 assert(buttonsOf(render).some(b=>b.text==='Close'));buttonsOf(render).find(b=>b.text==='Close').onPress();assert(h.calls.includes('hide'));
 await rt.consent.set('external',false);assert(!buttonsOf(render).some(b=>b.text.startsWith('Transcribe')));assert(buttonsOf(render).some(b=>b.text.startsWith('I allow sending')));
 h.stop();await tick();
});
test('ui sheet: publish needs explicit one-time publish consent and own cached vocal; never for others; key editor only without key',async()=>{
 const h=clientHost();const rt=await h.ready();
 const own=h.voice(2,true);h.records.set(`1/${own.id}`,own);const other=h.voice(3);h.records.set(`1/${other.id}`,other);
 await rt.consent.set('external',true);rt.engine.cached=()=>'manual transcript';
 const renderOwn=await openSheet(h,own);
 assert(renderOwn().some(x=>x.type==='Card'));
 assert(buttonsOf(renderOwn).some(b=>b.text==='I allow publishing my transcripts'));assert(!buttonsOf(renderOwn).some(b=>b.text.startsWith('Publish')));
 buttonsOf(renderOwn).find(b=>b.text==='I allow publishing my transcripts').onPress();await tick();assert.equal(h.prefs.manual.publish,true);
 const publish=buttonsOf(renderOwn).find(b=>b.text==='Publish as a reply to my voice message');assert(publish);assert.equal(publish.disabled,false);
 publish.onPress();await tick();assert.equal(h.posts.length,1);assert.equal(h.posts[0].body.message_reference.message_id,own.id);assert.match(h.posts[0].body.content,/manual transcript/);
 assert.equal(h.posts[0].retries,0);assert(!h.prefs.ownReplies);assert(!h.prefs.publish);
 const renderOther=await openSheet(h,other);
 assert(renderOther().some(x=>x.type==='Card'));assert(!buttonsOf(renderOther).some(b=>/publi/i.test(b.text)));
 // revoked publish consent: explicit publish action disappears even though the transcript is cached
 await rt.consent.set('publish',false);assert(!buttonsOf(renderOwn).some(b=>b.text.startsWith('Publish')));
 await rt.forget();rt.engine.cached=()=>undefined;
 const renderNoKey=await openSheet(h,own);
 const input=renderNoKey().find(x=>x.type==='TextInput');assert(input);assert.equal(input.props.secureTextEntry,true);assert.equal(input.props.importantForAutofill,'no');assert.equal(input.props.autoComplete,'off');
 assert(!buttonsOf(renderNoKey).some(b=>b.text.startsWith('Transcribe')||b.text.startsWith('I allow')));
 assert.equal(h.posts.length,1);assert.equal(h.network,0);h.stop();await tick();
});
