import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Hôte synthétique : exécute le VRAI bundle, aucun runtime Android ni réseau.
const source = readFileSync('plugins/elevenlabs-transcription/build/js/index.js', 'utf8');
const tick = () => new Promise(r => setImmediate(r));
const ACTION_LABEL = 'Transcrire avec ElevenLabs';
// Feuille d’appui long SYNTHÉTIQUE (un groupe éligible avec icônes + un groupe danger) : ce n’est PAS l’arbre
// observé du client Discord. Elle prouve la politique d’insertion, pas la structure réelle sur appareil.
function host({compatible=true, purge=true, missing=false, vaultMissing=false, sheet, icons={TranscriptOutlineIcon:function SyntheticTranscriptIcon(){}}, assets={}}={}) {
  let savedKey = null;
  const events=[]; const cleanups=[]; const changes=new Set(); let discover; let opened; let network=0;
  const element=(type,props={})=>({type,props});
  const React={createElement:(type,props,...children)=>element(type,{...props,children}),cloneElement:(el,props,...children)=>element(el.type,{...el.props,...props,children:children.length===1?children[0]:children}),isValidElement:x=>!!x?.type&&!!x.props,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{}};
  const ActionSheet='ActionSheet'; const ActionSheetRow=Object.assign(function SyntheticRow(){}, {Group:'Group',Icon:'RowIcon'});
  const tools={element,ActionSheet,ActionSheetRow,row:(label,extra={})=>element(ActionSheetRow,{label,icon:element('RowIcon',{}),onPress(){},...extra}),group:(key,children,extra={})=>element('Group',{key,children,...extra})};
  const files={async writeFile(storage,path){events.push('write:'+path);return '/private/cache/'+path},async clearFolder(){events.push('purge');return purge},getConstants:()=>({CacheDirPath:'/private/cache'}),async fileExists(){return false},async removeFile(){events.push('remove')}};
  const valenced={
    components:{Page:'Page'},assets:{getAssetIdByName:name=>assets[name]},utils:{discord:{lookupGeneratedIconComponent:name=>icons[name]}},
    react:{React,ReactJSXRuntime:{jsx:element,jsxs:element,Fragment:'Fragment'},ReactNative:{AppState:{addEventListener(_,fn){changes.add(fn);return {remove(){changes.delete(fn);events.push('unsubscribe-app')}}}},Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View'}},
    externals:{ReactNativeClipboard:{Clipboard:{setString(){events.push('copy')}}}},
    discord:{common:{flux:{Dispatcher:{subscribe(){},unsubscribe(){},async dispatch(){}}}},flux:{Stores:{}},design:{Design:{ActionSheet,ActionSheetRow,TableRow:ActionSheetRow,TableRowGroup:'Group',TableSwitchRow:'TableSwitchRow',BottomSheetTitleHeader:'Header',Button:'Button',Text:'Text',Stack:'Stack',Card:'Card'}},actions:{ActionSheetActionCreators:{openLazy(p,key,args){opened=args;events.push('open')},hideActionSheet(){events.push('hide')}}},native:{FileModule:files,ClientInfoModule:{getConstants(){return compatible?{Version:'352.6',Build:'352206',ReleaseChannel:'canaryRelease'}:{}}}}},
    modules:{native:{async callNativeMethod(name,args){
      if(vaultMissing)throw Error('missing native bridge');
      if(name.endsWith('.load'))return {ok:true,key:savedKey};
      if(name.endsWith('.save')){savedKey=args[0];return {ok:true}};
      if(name.endsWith('.delete')){savedKey=null;return {ok:true}};
      throw Error('unsupported method');
    }},finders:{filters:{withName:name=>name,withProps:name=>name},getModules(filter,fn){if(filter==='LongPressMessageActionSheet')discover=fn;return ()=>events.push('unsubscribe-finder')}}},
    patcher:{instead(mod,key,patch){const original=mod[key];mod[key]=function(...args){return patch.call(this,args,original)};events.push('patch');return ()=>{mod[key]=original;events.push('unpatch')}}}
  };
  const XHR=function(){network++;throw new Error('Network forbidden in lifecycle fixtures')};
  const definition=new Function('valenced','plugin','XMLHttpRequest','FormData','AbortController','URL',`return ${source}`)(valenced,x=>x,XHR,function(){},missing?undefined:AbortController,URL).default;
  const defaultSheet=()=>element(ActionSheet,{children:[tools.group('synthetic-primary',[tools.row('synthetic-reply'),tools.row('synthetic-copy')],{hasIcons:true}),tools.group('synthetic-danger',[tools.row('synthetic-delete',{variant:'danger'})])]});
  const original=()=>sheet?sheet(tools):defaultSheet(); const mod={default:original};
  const voice={message:{id:'2',flags:8192,attachments:[{id:'3',url:'https://cdn.discordapp.com/attachments/1/3/a.ogg',size:3,duration_secs:1,content_type:'audio/ogg'}]},channel:{id:'1'}};
  function start(){definition.start({cleanup:fn=>cleanups.push(fn),jsonStorage:{async get(){return {}},async set(){}}})}
  function stop(){cleanups.splice(0).reverse().forEach(fn=>fn())}
  const collect=root=>{const out=[];const walk=node=>{if(Array.isArray(node)){node.forEach(walk);return}if(!node||typeof node!=='object')return;out.push(node);walk(node.props?.children)};walk(root);return out};
  const flat=children=>[children].flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false);
  const findRow=tree=>collect(tree).find(x=>x.props?.label===ACTION_LABEL);
  const groups=tree=>collect(tree).filter(x=>x.type==='Group');
  function row(){const found=findRow(mod.default(voice));assert(found,'synthetic insertion expected');return found}
  return {events,changes,definition,mod,original,voice,start,stop,row,collect,flat,findRow,groups,tools,ActionSheetRow,get discover(){return discover},get opened(){return opened},get network(){return network}};
}
test('bundle start/menu manuel : aucun transfert avant action et confirmation',async()=>{
 const h=host(); h.start();h.discover(h.mod);await tick();
 assert.notEqual(h.mod.default,h.original); assert.equal(h.network,0);
 const row=h.row();assert.equal(row.props.label,ACTION_LABEL);assert.equal(h.opened,undefined);
 row.props.onPress();const rt=h.opened.rt;assert.equal(rt.diagnostics.ready,true);assert.equal(rt.key,'');assert.equal(h.network,0);
 await rt.setKey('synthetic_key_fixture_000000');await assert.rejects(rt.engine.run(h.opened.target,rt.key,false),{code:'consent'});assert.equal(h.network,0);
 for(const change of h.changes)change('background');assert.equal(rt.key,'');assert.equal(rt.diagnostics.keySet,false);
 h.stop();await tick();assert.equal(rt.alive,false);assert.equal(h.mod.default,h.original);assert.equal(h.changes.size,0);assert(h.events.includes('unsubscribe-finder'));
 await assert.rejects(rt.engine.run(h.opened.target,'synthetic_key_fixture_000000',true),{code:'stopped'});
});
// Synthetic bridge proves JS lifecycle only, not Android Keystore/device operation.
function settingsRuntime(h) {
 const walk = node => {
  if (!node || typeof node !== 'object') return undefined;
  if (node.props?.rt) return node.props.rt;
  const children = [node.props?.children].flat(Infinity);
  for (const child of children) { const rt = walk(child); if (rt) return rt; }
 };
 return walk(h.definition.SettingsComponent());
}
test('diagnostic clé : settings et action manuelle partagent exactement le même runtime',async()=>{
 const h=host();h.start();h.discover(h.mod);await tick();
 const settings=settingsRuntime(h);assert(settings);
 await settings.setKey('synthetic_key_fixture_000000');h.row().props.onPress();
 assert.equal(h.opened.rt,settings);assert.equal(h.opened.rt.key,'synthetic_key_fixture_000000');
 assert.equal(h.opened.rt.diagnostics.keySet,true);assert.equal(h.network,0);h.stop();await tick();
});
test('diagnostic init : clé saisie avant purge conservée après résolution concurrente',async()=>{
 const h=host();h.start();h.discover(h.mod);
 const settings=settingsRuntime(h);const saved=settings.setKey('synthetic_key_fixture_000000');
 assert.equal(settings.diagnostics.ready,false);await saved;await tick();
 h.row().props.onPress();assert.equal(h.opened.rt,settings);
 assert.equal(settings.key,'synthetic_key_fixture_000000');assert.equal(settings.diagnostics.ready,true);
 assert.equal(h.network,0);h.stop();await tick();
});
test('correction lifecycle : inactive/background efface mémoire puis restaure via coffre',async()=>{
 for(const state of ['inactive','background']) {
  const h=host();h.start();h.discover(h.mod);await tick();const settings=settingsRuntime(h);
  await settings.setKey('synthetic_key_fixture_000000');
  for(const change of h.changes)change(state);
  assert.equal(settings.key,'');for(const change of h.changes)change('active');await tick();
  h.row().props.onPress();assert.equal(h.opened.rt,settings);
  assert.equal(settings.key,'synthetic_key_fixture_000000');assert.equal(settings.diagnostics.keySet,true);
  assert.equal(h.network,0);h.stop();await tick();
 }
});
test('correction restart : stop/start restaure le coffre, ancien runtime refuse la clé',async()=>{
 const h=host();h.start();h.discover(h.mod);await tick();const before=settingsRuntime(h);
 await before.setKey('synthetic_key_fixture_000000');h.stop();await tick();
 await assert.rejects(before.setKey('synthetic_key_fixture_000000'),{code:'stopped'});
 h.start();h.discover(h.mod);await tick();const after=settingsRuntime(h);
 assert.notEqual(after,before);assert.equal(after.key,'synthetic_key_fixture_000000');assert.equal(after.diagnostics.keySet,true);
 h.row().props.onPress();assert.equal(h.opened.rt,after);assert.equal(h.network,0);h.stop();await tick();
});
test('bundle refuse client différent ou primitives manquantes sans patch/réseau',()=>{
 for(const options of [{compatible:false},{missing:true}]){const h=host(options);h.start();assert.equal(h.discover,undefined);assert.equal(h.network,0);h.stop()}
});
test('bundle dépatch quand découverte ambiguë ; callbacks tardifs ignorés',async()=>{
 const frozen=host();frozen.start();assert.doesNotThrow(()=>frozen.discover(Object.freeze({default:frozen.original})));assert.equal(frozen.network,0);frozen.stop();
 const h=host();h.start();h.discover(h.mod);const second={default:h.original};h.discover(second);assert.equal(h.mod.default,h.original);assert.equal(second.default,h.original);h.stop();h.discover({default:h.original});assert.equal(h.events.filter(x=>x==='patch').length,1);await tick();assert.equal(h.network,0);
});
test('bundle ignore texte ordinaire et arbre inattendu, sans crash',()=>{
 const h=host();h.start();h.discover(h.mod);const plain=h.mod.default({...h.voice,message:{...h.voice.message,flags:0}});assert.equal(h.findRow(plain),undefined);assert.equal(h.collect(plain).length,h.collect(h.original(h.voice)).length);h.stop();
 const g=host();g.start();g.mod.default=()=>null;g.discover(g.mod);assert.equal(g.mod.default(g.voice),null);assert.equal(g.network,0);g.stop();
});
test('bundle cache non purgeable désactive transfert, puis reload propre',async()=>{
 const h=host({purge:false});h.start();h.discover(h.mod);await tick();h.row().props.onPress();assert.equal(h.opened.rt.diagnostics.ready,false);assert.equal(h.network,0);h.stop();await tick();h.start();h.discover(h.mod);await tick();assert.equal(h.events.filter(x=>x==='patch').length,2);h.stop();
});
test('bundle coffre absent : échec sans faux état enregistré et sans trafic',async()=>{
 const h=host({vaultMissing:true});h.start();h.discover(h.mod);await tick();const rt=settingsRuntime(h);
 assert.equal(rt.key,'');assert.equal(rt.diagnostics.keySet,false);assert.match(rt.diagnostics.problem,/Coffre Android/);
 await assert.rejects(rt.setKey('synthetic_key_fixture_000000'),{code:'vault'});assert.equal(rt.diagnostics.keySet,false);
 assert.equal(h.network,0);h.stop();await tick();
});
test('bundle suppression et remplacement partagés settings/menu sans réactivation erronée',async()=>{
 const h=host();h.start();h.discover(h.mod);await tick();const rt=settingsRuntime(h);
 await rt.setKey('synthetic_key_fixture_000000');await rt.forget();h.row().props.onPress();assert.equal(h.opened.rt.key,'');
 await rt.setKey('synthetic_replacement_111111');assert.equal(h.opened.rt.key,'synthetic_replacement_111111');
 h.stop();await tick();h.start();h.discover(h.mod);await tick();assert.equal(settingsRuntime(h).key,'synthetic_replacement_111111');h.stop();await tick();
});
// ---- Politique d’insertion du menu (fixtures synthétiques, pas l’arbre appareil) ----
test('menu synthétique : insertion en tête de l’unique groupe natif éligible, icône résolue par le host, aucun groupe ajouté',async()=>{
 const h=host();h.start();h.discover(h.mod);await tick();const tree=h.mod.default(h.voice);
 const groups=h.groups(tree);assert.equal(groups.length,2);
 const rows=h.flat(groups[0].props.children);assert.equal(rows.length,3);
 const row=rows[0];assert.equal(row.type,h.ActionSheetRow);assert.equal(row.props.label,ACTION_LABEL);assert.equal(typeof row.props.onPress,'function');
 assert.equal(row.props.icon.type,'RowIcon');assert.equal(typeof row.props.icon.props.IconComponent,'function');assert.equal(row.props.variant,undefined);
 assert.deepEqual(rows.slice(1).map(r=>r.props.label),['synthetic-reply','synthetic-copy']);
 assert.equal(h.flat(groups[1].props.children).length,1);assert.equal(h.flat(tree.props.children).length,2);
 await tick();assert.match(settingsRuntime(h).diagnostics.placement,/Insérée/);assert.equal(h.network,0);h.stop();
});
test('menu synthétique : refus explicite (vide, danger seul, ambigu, fragment, feuilles multiples, icône introuvable), jamais de groupe spéculatif',async()=>{
 const cases=[
  {name:'empty',sheet:t=>t.element(t.ActionSheet,{children:[]}),pattern:/aucun groupe/},
  {name:'danger-only',sheet:t=>t.element(t.ActionSheet,{children:[t.group('d',[t.row('x',{variant:'danger'})])]}),pattern:/éligible/},
  {name:'no-icons',sheet:t=>t.element(t.ActionSheet,{children:[t.group('p',[t.row('a',{icon:undefined})])]}),pattern:/éligible/},
  {name:'ambiguous',sheet:t=>t.element(t.ActionSheet,{children:[t.group('a',[t.row('a')]),t.group('b',[t.row('b')])]}),pattern:/plusieurs/},
  {name:'fragment',sheet:t=>t.element(t.ActionSheet,{children:[t.group('f',[t.element('Fragment',{children:[t.row('a')]})])]}),pattern:/éligible/},
  {name:'two-sheets',sheet:t=>t.element('View',{children:[t.element(t.ActionSheet,{children:[t.group('a',[t.row('a')])]}),t.element(t.ActionSheet,{children:[t.group('b',[t.row('b')])]})]}),pattern:/feuille/},
  {name:'no-icon',icons:{},assets:{},pattern:/icône/},
 ];
 for(const c of cases){
  const h=host(c);h.start();h.discover(h.mod);await tick();
  const tree=h.mod.default(h.voice);assert.equal(h.findRow(tree),undefined,c.name);
  assert.equal(h.collect(tree).length,h.collect(h.original(h.voice)).length,c.name); // tree untouched: no appended group
  await tick();const d=settingsRuntime(h).diagnostics;assert.match(d.placement,/^Refusée/,c.name);assert.match(d.placement,c.pattern,c.name);
  assert.equal(h.network,0);h.stop();
 }
});
test('menu synthétique : repli sur l’identifiant d’asset host quand le composant icône est absent ; la ligne ouvre bien la feuille',async()=>{
 const h=host({icons:{},assets:{TranscriptOutlineIcon:4242}});h.start();h.discover(h.mod);await tick();
 const row=h.row();assert.equal(row.props.icon.props.source,4242);assert.equal(row.props.icon.props.IconComponent,undefined);
 row.props.onPress();assert.equal(h.opened.rt,settingsRuntime(h));assert.equal(h.opened.target.messageId,'2');assert.equal(h.network,0);h.stop();
});
