import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const tick = () => new Promise(resolve => setImmediate(resolve));
export const ACTION_LABEL = 'Transcrire avec ElevenLabs';
const source=readFileSync('plugins/elevenlabs-transcription/build/js/index.js','utf8');
const element=(type,props={})=>({type,props});
// Executes the real bundle. Every store, disk bridge, HTTP, STT endpoint, icon registry and the long-press
// sheet tree are SYNTHETIC/offline. The sheet fixture below is NOT an observed device tree: it only exercises
// the insertion policy (one eligible icon group + one danger group).
export function clientHost({prefs={},missing=[],purge=true,sheet,icons={TranscriptOutlineIcon:function SyntheticTranscriptIcon(){}},assets={}}={}) {
 let clock=1800000000000, key=null, preference={...prefs}, me='10', selected='1', permitted=true, rt, opened, sheetComponent;
 let failStorage=false, failReply=false, network=0, beforeSave=async()=>{};const calls=[], posts=[], changes=new Set(),cleanups=[], callbacks=new Map(),finders=new Map(),records=new Map(),reservations=new Set();
 class Clock extends Date { static now(){return clock} }
 const React={createElement:(type,props,...children)=>element(type,{...props,children}),cloneElement:(el,props,...children)=>element(el.type,{...el.props,...props,children}),isValidElement:x=>!!x?.type&&!!x.props,useState:x=>[typeof x==='function'?x():x,()=>{}],useEffect:()=>{}};
 const actions={openLazy(p,_key,args){rt=args.rt;opened=args;p.then(m=>{sheetComponent=m.default})},hideActionSheet(){calls.push('hide')}};
 const ActionSheetRow=Object.assign(function SyntheticRow(){}, {Group:'Group',Icon:'RowIcon'});
 const tools={element,ActionSheetRow,row:(label,extra={})=>element(ActionSheetRow,{label,icon:element('RowIcon',{}),onPress(){},...extra}),group:(key,children,extra={})=>element('Group',{key,children,...extra})};
 const defaultSheet=()=>element('ActionSheet',{children:[tools.group('synthetic-primary',[tools.row('synthetic-reply'),tools.row('synthetic-copy')],{hasIcons:true}),tools.group('synthetic-danger',[tools.row('synthetic-delete',{variant:'danger'})])]});
 const sheets={default:()=>sheet?sheet(tools):defaultSheet()};
 class RowManager { generate({message}) { return {type:1,changeType:0,message:{id:message.id,content:[{type:'text',content:message.content??''}]}} } }
 const originalRow=RowManager.prototype.generate;
 const HTTP={async post(options){posts.push(options);if(failReply)throw Error('synthetic ambiguous HTTP failure');return {status:200,body:{id:'99',channel_id:options.body.message_reference.channel_id}}}};
 const modules={HTTP:{HTTP},Endpoints:{Endpoints:{MESSAGES:id=>`/channels/${id}/messages`}},RowManager,LongPressMessageActionSheet:sheets};
 const stores={AuthenticationStore:{getId:()=>me},SelectedChannelStore:{getChannelId:()=>selected},ChannelStore:{getChannel:id=>({id,type:0})},MessageStore:{getMessage:(channel,id)=>records.get(`${channel}/${id}`)},PermissionStore:{can:()=>permitted}};
 const dispatcher={subscribe(type,fn){if(!callbacks.has(type))callbacks.set(type,new Set());callbacks.get(type).add(fn)},unsubscribe(type,fn){callbacks.get(type)?.delete(fn)},async dispatch(payload){calls.push(payload.type);for(const fn of callbacks.get(payload.type)??[])fn(payload)}};
 const valenced={components:{Page:'Page'},assets:{getAssetIdByName:name=>assets[name]},utils:{discord:{lookupGeneratedIconComponent:name=>icons[name]}},
 react:{React,ReactJSXRuntime:{jsx:element,jsxs:element,Fragment:'Fragment'},ReactNative:{AppState:{addEventListener(_,fn){changes.add(fn);return {remove(){changes.delete(fn)}}}},Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View'}},externals:{ReactNativeClipboard:{Clipboard:{setString(){throw Error('No clipboard in automation')}}}},
 discord:{common:{flux:{Dispatcher:dispatcher}},flux:{Stores:stores},design:{Design:{ActionSheet:'ActionSheet',ActionSheetRow,TableRow:ActionSheetRow,TableRowGroup:'Group',TableSwitchRow:'TableSwitchRow',BottomSheetTitleHeader:'Header',Button:'Button',Text:'Text',Stack:'Stack',Card:'Card'}},actions:{ActionSheetActionCreators:actions},native:{FileModule:{async writeFile(_storage,path){return '/private/cache/'+path},async clearFolder(){return purge},getConstants:()=>({CacheDirPath:'/private/cache'}),async fileExists(){return false},async removeFile(){}},ClientInfoModule:{getConstants:()=>({Version:'352.6',Build:'352206',ReleaseChannel:'canaryRelease'})}}},
 modules:{native:{async callNativeMethod(name,args){
  if(name.endsWith('.load'))return {ok:true,key};if(name.endsWith('.save')){key=args[0];return {ok:true}};if(name.endsWith('.delete')){key=null;return {ok:true}};
  if(name==='anezium.elevenlabs.auto.reserve'){calls.push('reserve');const id=args[0];if(reservations.has(id))return {ok:true,reserved:false};reservations.add(id);return {ok:true,reserved:true}}throw Error('unknown bridge')
 }},finders:{filters:{withName:x=>x,withProps:x=>x},getModules(filter,fn){
  if(!finders.has(filter))finders.set(filter,new Set());finders.get(filter).add(fn);
  if(!missing.includes(filter)&&modules[filter])fn(modules[filter]);return ()=>finders.get(filter)?.delete(fn);
 }}},patcher:{instead(mod,name,patch){const original=mod[name];mod[name]=function(...args){return patch.call(this,args,original)};return ()=>{mod[name]=original}}}};
 const definition=new Function('valenced','plugin','XMLHttpRequest','FormData','AbortController','URL','Date',`return ${source}`)(valenced,x=>x,function(){network++;throw Error('Live network forbidden')},function(){},AbortController,URL,Clock).default;
 function getRuntime(){
  const walk=node=>{if(!node||typeof node!=='object')return;if(node.props?.rt)return node.props.rt;for(const x of [node.props?.children].flat(Infinity)){const found=walk(x);if(found)return found}};
  return walk(definition.SettingsComponent());
 }
 // Flattens a synthetic render: pushes every element, renders plain function components (never the native row type).
 function collect(root){const out=[];const walk=node=>{if(Array.isArray(node)){node.forEach(walk);return}if(!node||typeof node!=='object')return;out.push(node);if(typeof node.type==='function'&&node.type!==ActionSheetRow){walk(node.type(node.props));return}walk(node.props?.children)};walk(root);return out}
 const flat=children=>[children].flat(Infinity).filter(x=>x!==null&&x!==undefined&&x!==false);
 function menu(record){return sheets.default({message:record,channel:{id:record.channel_id}})}
 const findRow=tree=>collect(tree).find(x=>x.props?.label===ACTION_LABEL);
 const groups=tree=>collect(tree).filter(x=>x.type==='Group');
 function start(){definition.start({cleanup:fn=>cleanups.push(fn),jsonStorage:{async get(){return {...preference}},async set(value,replace){assert.equal(replace,true);await beforeSave();if(failStorage)throw Error('synthetic disk failure');preference={...value};calls.push('preferences')}}});rt=getRuntime()}
 function stop(){cleanups.splice(0).reverse().forEach(fn=>fn())}
 function voice(offset=1,own=false){return {id:String((BigInt(clock+offset)-1420070400000n)<<22n),channel_id:'1',state:'SENT',flags:8192,content:'',author:{id:own?me:'20'},attachments:[{id:'3',url:'https://cdn.discordapp.com/attachments/1/3/a.ogg',size:3,duration_secs:1,content_type:'audio/ogg'}]}}
 async function emit(record,type='MESSAGE_CREATE',extra={}) {if(record)records.set(`${record.channel_id}/${record.id}`,record);await dispatcher.dispatch({type,...extra,...(record?{message:record}:{})});await tick();await rt?.auto?.idle();await tick()}
 async function ready(){start();await tick();await rt.setKey('synthetic_key_fixture_000000');await tick();rt.engine.run=async(target,secret,confirmed)=>{assert.equal(secret,rt.key);assert.equal(confirmed,true);calls.push('stt');return 'Texte synthétique @everyone <@123>'};return rt}
 return {ready,start,stop,emit,voice,calls,posts,RowManager,originalRow,stores,records,reservations,changes,callbacks,finders,HTTP,definition,sheets,tools,ActionSheetRow,element,collect,flat,menu,findRow,groups,
  get rt(){return rt},get opened(){return opened},get sheet(){return sheetComponent},get prefs(){return preference},get network(){return network},clock:(delta=1)=>clock+=delta,account:id=>me=id,channel:id=>selected=id,permission:v=>permitted=v,failStorage:v=>failStorage=v,failReply:v=>failReply=v,
  discover(name,value){for(const fn of finders.get(name)??[])fn(value)},beforeSave:fn=>beforeSave=fn,
 };
}
