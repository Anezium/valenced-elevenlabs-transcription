import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Hôte synthétique : exécute le VRAI bundle, aucun runtime Android ni réseau.
const source = readFileSync('plugins/elevenlabs-transcription/build/js/index.js', 'utf8');
const tick = () => new Promise(r => setImmediate(r));
function host({compatible=true, purge=true, missing=false}={}) {
  const events=[]; const cleanups=[]; const changes=new Set(); let discover; let opened; let network=0;
  const element=(type,props={})=>({type,props});
  const React={createElement:(type,props,...children)=>element(type,{...props,children}),cloneElement:(el,props,...children)=>element(el.type,{...el.props,...props,children:children.length===1?children[0]:children}),isValidElement:x=>!!x?.type&&!!x.props,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{}};
  const ActionSheet='ActionSheet'; const ActionSheetRow=Object.assign(()=>{}, {Group:'Group'});
  const files={async writeFile(storage,path){events.push('write:'+path);return '/private/cache/'+path},async clearFolder(){events.push('purge');return purge},getConstants:()=>({CacheDirPath:'/private/cache'}),async fileExists(){return false},async removeFile(){events.push('remove')}};
  const valenced={
    components:{Page:'Page'},react:{React,ReactJSXRuntime:{jsx:element,jsxs:element,Fragment:'Fragment'},ReactNative:{AppState:{addEventListener(_,fn){changes.add(fn);return {remove(){changes.delete(fn);events.push('unsubscribe-app')}}}},Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View'}},
    externals:{ReactNativeClipboard:{Clipboard:{setString(){events.push('copy')}}}},
    discord:{design:{Design:{ActionSheet,ActionSheetRow,BottomSheetTitleHeader:'Header'}},actions:{ActionSheetActionCreators:{openLazy(p,key,args){opened=args;events.push('open')},hideActionSheet(){events.push('hide')}}},native:{FileModule:files,ClientInfoModule:{getConstants(){return compatible?{Version:'352.6',Build:'352206',ReleaseChannel:'canaryRelease'}:{}}}}},
    modules:{finders:{filters:{withName:name=>name},getModules(filter,fn){assert.equal(filter,'LongPressMessageActionSheet');discover=fn;return ()=>events.push('unsubscribe-finder')}}},
    patcher:{instead(mod,key,patch){const original=mod[key];mod[key]=function(...args){return patch.call(this,args,original)};events.push('patch');return ()=>{mod[key]=original;events.push('unpatch')}}}
  };
  const XHR=function(){network++;throw new Error('Network forbidden in lifecycle fixtures')};
  const definition=new Function('valenced','plugin','XMLHttpRequest','FormData','AbortController','URL',`return ${source}`)(valenced,x=>x,XHR,function(){},missing?undefined:AbortController,URL).default;
  const original=()=>element(ActionSheet,{children:[]}); const mod={default:original};
  const voice={message:{id:'2',flags:8192,attachments:[{id:'3',url:'https://cdn.discordapp.com/attachments/1/3/a.ogg',size:3,duration_secs:1,content_type:'audio/ogg'}]},channel:{id:'1'}};
  function start(){definition.start({cleanup:fn=>cleanups.push(fn)})}
  function stop(){cleanups.splice(0).reverse().forEach(fn=>fn())}
  function row(){return mod.default(voice).props.children.at(-1)?.props.children}
  return {events,changes,definition,mod,original,voice,start,stop,row,get discover(){return discover},get opened(){return opened},get network(){return network}};
}
test('bundle start/menu manuel : aucun transfert avant action et confirmation',async()=>{
 const h=host(); h.start();h.discover(h.mod);await tick();
 assert.notEqual(h.mod.default,h.original); assert.equal(h.network,0);
 const row=h.row();assert.equal(row.props.label,'Transcrire avec ElevenLabs');assert.equal(h.opened,undefined);
 row.props.onPress();const rt=h.opened.rt;assert.equal(rt.diagnostics.ready,true);assert.equal(rt.key,'');assert.equal(h.network,0);
 rt.setKey('synthetic_key_fixture_000000');await assert.rejects(rt.engine.run(h.opened.target,rt.key,false),{code:'consent'});assert.equal(h.network,0);
 for(const change of h.changes)change('background');assert.equal(rt.key,'');assert.equal(rt.diagnostics.keySet,false);
 h.stop();await tick();assert.equal(rt.alive,false);assert.equal(h.mod.default,h.original);assert.equal(h.changes.size,0);assert(h.events.includes('unsubscribe-finder'));
 await assert.rejects(rt.engine.run(h.opened.target,'synthetic_key_fixture_000000',true),{code:'stopped'});
});
test('bundle refuse client différent ou primitives manquantes sans patch/réseau',()=>{
 for(const options of [{compatible:false},{missing:true}]){const h=host(options);h.start();assert.equal(h.discover,undefined);assert.equal(h.network,0);h.stop()}
});
test('bundle dépatch quand découverte ambiguë ; callbacks tardifs ignorés',async()=>{
 const frozen=host();frozen.start();assert.doesNotThrow(()=>frozen.discover(Object.freeze({default:frozen.original})));assert.equal(frozen.network,0);frozen.stop();
 const h=host();h.start();h.discover(h.mod);const second={default:h.original};h.discover(second);assert.equal(h.mod.default,h.original);assert.equal(second.default,h.original);h.stop();h.discover({default:h.original});assert.equal(h.events.filter(x=>x==='patch').length,1);await tick();assert.equal(h.network,0);
});
test('bundle ignore texte ordinaire et arbre inattendu, sans crash',()=>{
 const h=host();h.start();h.discover(h.mod);assert.deepEqual(h.mod.default({...h.voice,message:{...h.voice.message,flags:0}}).props.children,[]);h.stop();
 const g=host();g.start();g.mod.default=()=>null;g.discover(g.mod);assert.equal(g.mod.default(g.voice),null);assert.equal(g.network,0);g.stop();
});
test('bundle cache non purgeable désactive transfert, puis reload propre',async()=>{
 const h=host({purge:false});h.start();h.discover(h.mod);await tick();h.row().props.onPress();assert.equal(h.opened.rt.diagnostics.ready,false);assert.equal(h.network,0);h.stop();await tick();h.start();h.discover(h.mod);await tick();assert.equal(h.events.filter(x=>x==='patch').length,2);h.stop();
});
