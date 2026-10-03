import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../YouTubeFeedAds.js',import.meta.url),'utf8');
const plugin=fs.readFileSync(new URL('../YouTubeNoAds.plugin',import.meta.url),'utf8');
function run(body,{endpoint='browse',host='youtubei.googleapis.com',type='application/json',status=200,url=`https://${host}/youtubei/v1/${endpoint}`,extra={}}={}) {
 let output,calls=0;const logs=[];
 const original=ArrayBuffer.isView(body)?Buffer.from(new Uint8Array(body.buffer,body.byteOffset,body.byteLength)):null;
 vm.runInNewContext(source,{$request:{url},$response:{body,headers:{'Content-Type':type},status},$argument:{script_debug:true},Uint8Array,ArrayBuffer,TextDecoder,TextEncoder,console:{log:x=>logs.push(x)},$done:x=>{output=x;calls++;},...extra},{timeout:2000});
 assert.equal(calls,1);if(original)assert.deepEqual(Buffer.from(new Uint8Array(body.buffer,body.byteOffset,body.byteLength)),original);
 return {output,logs};
}
const v=n=>{const a=[];while(n>=128){a.push(n%128+128);n=Math.floor(n/128);}return [...a,n];};
const cat=(...p)=>Uint8Array.from(p.flatMap(x=>Array.from(x)));
const msg=(f,p)=>cat(v(f*8+2),v(p.length),p);
const ad=msg(424701016,[255,1]); // opaque ad body must never be guessed as protobuf
const normal=msg(50195462,msg(1,msg(99,[255,254,0])));
const tracking=msg(4,[1,2,3]);
const initial=list=>msg(9,msg(49399797,list));
test('main plugin routes all feed endpoints exclusively to its own standalone script',()=>{
 const entry=plugin.split('\n').find(x=>x.startsWith('http-response ')&&x.includes('YouTubeFeedAds.js'));
 const re=new RegExp(entry.split(' ')[1]);
 for(const host of ['youtubei.googleapis.com','youtubei-att.googleapis.com','youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'])for(const ep of ['browse','next','search'])assert.ok(re.test(`https://${host}/youtubei/v1/${ep}?key=x`));
 for(const url of ['https://youtubei.googleapis.com.evil/youtubei/v1/browse','https://youtubei.googleapis.com/youtubei/v1/player','https://youtubei.googleapis.com/youtubei/v1/browse/extra','https://rr5.googlevideo.com/videoplayback?x=1'])assert.ok(!re.test(url));
 assert.ok(!source.includes('$httpClient')&&!source.includes('require('));
});
for(const endpoint of ['browse','next','search'])test(`${endpoint} JSON removes whole sponsored cards, retaining videos, Shorts and pagination`,()=>{
 const keep=[{videoRenderer:{title:'赞助商广告评测',videoId:'NORMAL'}},{reelItemRenderer:{title:'keep'}},{continuationItemRenderer:{continuationEndpoint:{token:'KEEP'}}},{elementRenderer:{eml:'UNKNOWN'}}];
 const payload={contents:{sectionListRenderer:{contents:[{adSlotRenderer:{value:'ad'},trackingParams:'discard'},keep[0],{richItemRenderer:{content:{promotedVideoRenderer:{title:'Robinhood'}}},trackingParams:'discard'},...keep.slice(1)]}},metadata:{promotedVideoRenderer:{title:'outside list'}}};
 const result=run(JSON.stringify(payload),{endpoint});
 const out=JSON.parse(result.output.body);assert.deepEqual(out.contents.sectionListRenderer.contents,keep);assert.deepEqual(out.metadata,payload.metadata);
 assert.ok(result.logs.some(x=>x.includes('removed=2')));assert.ok(!result.logs.join('').includes('Robinhood'));
});
test('JSON continuation action removes cards without deleting action or target ID',()=>{
 const data={onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'home',continuationItems:[{inFeedAdLayoutRenderer:{}},{videoRenderer:{videoId:'KEEP'}}]}}]};
 const out=JSON.parse(run(JSON.stringify(data)).output.body);
 assert.deepEqual(out,{onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'home',continuationItems:[{videoRenderer:{videoId:'KEEP'}}]}}]});
});
test('binary UTF-8 JSON respects view offsets and characters',()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({contents:[{adSlotRenderer:{}},{videoRenderer:{title:'中文😀'}}]}));
 const padded=cat([99],bytes,[98]);const body=new DataView(padded.buffer,1,bytes.length);
 const out=run(body).output.body;assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),{contents:[{videoRenderer:{title:'中文😀'}}]});
});
test('known browse Protobuf removes whole ad items and preserves every non-ad byte',()=>{
 const list=cat(msg(1,normal),msg(1,cat(ad,tracking)),tracking,msg(2,[255,0]),msg(1,ad));
 const expected=initial(cat(msg(1,normal),tracking,msg(2,[255,0])));
 const body=initial(list);assert.deepEqual(Buffer.from(run(body,{type:'application/x-protobuf'}).output.body),Buffer.from(expected));
});
test('Protobuf continuation and secondary recommendations use verified separate paths',()=>{
 const section=msg(10,msg(49399797,cat(msg(1,ad),msg(1,normal))));
 assert.deepEqual(Buffer.from(run(section,{type:'application/x-protobuf'}).output.body),Buffer.from(msg(10,msg(49399797,msg(1,normal)))));
 const next=msg(8,msg(51779776,cat(msg(1,msg(73920376,[])),msg(1,msg(50630979,[255])))));
 assert.deepEqual(Buffer.from(run(next,{endpoint:'next',type:'application/x-protobuf'}).output.body),Buffer.from(msg(8,msg(51779776,msg(1,msg(50630979,[255]))))));
});
test('known single-column next envelope removes list ads and preserves unrelated playback metadata',()=>{
 const payload=cat(msg(7,msg(51779735,msg(1,msg(49399797,cat(msg(1,ad),msg(1,normal)))))),msg(47,[0]));
 const expected=cat(msg(7,msg(51779735,msg(1,msg(49399797,msg(1,normal))))),msg(47,[0]));
 assert.deepEqual(Buffer.from(run(payload,{endpoint:'next',type:'application/x-protobuf'}).output.body),Buffer.from(expected));
});
test('opaque Elements and unknown messages retain ad-looking bytes without recursive scanning',()=>{
 const payload=cat(msg(9,msg(153515154,cat(ad,[255]))),msg(99,initial(msg(1,ad))));
 const r=run(payload,{type:'application/x-protobuf'});assert.equal(Object.keys(r.output).length,0);assert.ok(r.logs.join('').includes('opaque_elements=1'));
});
test('nested lengths rebuild correctly across varint length boundaries',()=>{
 const list=cat(msg(1,ad),msg(1,msg(99,new Uint8Array(126).fill(255))),tracking);
 assert.deepEqual(Buffer.from(run(initial(list),{type:'application/x-protobuf'}).output.body),Buffer.from(initial(cat(msg(1,msg(99,new Uint8Array(126).fill(255))),tracking))));
});
for(const [name,body,options] of [
 ['no ads preserves formatting',' { "contents": [{"videoRenderer": {}}] } ',{}],
 ['sponsor text is normal content',JSON.stringify({contents:[{videoRenderer:{title:'广告',badge:'Sponsored',description:'Robinhood'}}]}),{}],
 ['invalid JSON after candidate','{"contents":[{"adSlotRenderer":{}}],',{}],
 ['ambiguous JSON renderer union',JSON.stringify({contents:[{adSlotRenderer:{},videoRenderer:{}}]}),{}],
 ['invalid UTF-8',Uint8Array.from([255,254]),{}],
 ['unknown content type',JSON.stringify({contents:[{adSlotRenderer:{}}]}),{type:'text/html'}],
 ['media URL','{"contents":[{"adSlotRenderer":{}}]}',{url:'https://rr5.googlevideo.com/videoplayback?x=1'}],
 ['non-200','{"contents":[{"adSlotRenderer":{}}]}',{status:500}],
 ['search protobuf unknown',initial(msg(1,ad)),{endpoint:'search',type:'application/x-protobuf'}],
 ['wrong ad wire',initial(msg(1,cat(v(424701016*8),[1]))),{type:'application/x-protobuf'}],
 ['mixed renderer union',initial(msg(1,cat(ad,normal))),{type:'application/x-protobuf'}],
 ['truncated tail discards earlier removal',cat(initial(msg(1,ad)),[0x12,0x04,0x01]),{type:'application/x-protobuf'}],
 ['unknown schema',msg(99,msg(1,ad)),{type:'application/x-protobuf'}],
 ['gzip body',Uint8Array.from([31,139,8,0]),{type:'application/x-protobuf'}],
 ['oversized body',new Uint8Array(4194305),{type:'application/x-protobuf'}],
 ['empty body','',{}],
 ['no body',undefined,{}],
])test(`pass-through: ${name}`,()=>assert.equal(Object.keys(run(body,options).output).length,0));
test('resource limits discard all JSON modifications',()=>{
 let deep={};for(let i=0;i<66;i++)deep={child:deep};
 assert.equal(Object.keys(run(JSON.stringify({contents:[{adSlotRenderer:{}}],deep})).output).length,0);
});

test('unknown browse Tab contents are not guessed as list messages',()=>{
 const body=msg(9,msg(58173949,msg(1,msg(58174010,initial(msg(1,ad))))));
 assert.equal(Object.keys(run(body,{type:'application/x-protobuf'}).output).length,0);
});
test('rich ad wrapper mixed with normal renderer preserves the whole response',()=>{
 const body=JSON.stringify({contents:[{richItemRenderer:{content:{adSlotRenderer:{}}},videoRenderer:{title:'KEEP'}}]});
 assert.equal(Object.keys(run(body).output).length,0);
});

const text=s=>new TextEncoder().encode(s);
const emlRoutes={
 video_display_button_group_layout:{model:491441836,route:[19,8,10,4,169495254,138681778,2,138681066,3,449330433]},
 full_width_portrait_image_layout:{model:478840678,route:[27,7,10,4,169495254,138681778,2,138681066,3,449330433]},
 full_width_square_image_layout:{model:461080918,route:[55,7,10,4,169495254,138681778,2,138681066,3,449330433]},
 full_width_square_image_carousel_layout:{model:33562350,route:[5,5,10,4,169495254,138681778,2,138681066,3,449330433]},
 carousel_footered_layout:{model:505359416,route:[31,8,10,4,169495254,138681778,2,138681066,3,449330433]},
 video_display_full_buttoned_layout:{model:454362329,route:[32,8,10,4,169495254,138681778,2,138681066,3,449330433]},
 video_display_carousel_button_group_layout:{model:33561652,route:[14,8,10,4,169495254,138681778,2,138681066,3,449330433]},
 banner_text_icon_buttoned_layout:{model:378585263,route:[5,3,4,169495254,138681778,2,138681066,3,449330433]}
};
const nested=(path,payload)=>path.reduceRight((b,f)=>msg(f,b),payload);
function component(name,{model=emlRoutes[name]?.model??232954548,command=true,route=emlRoutes[name]?.route,modelData,typeSuffix='',id=`${name}.eml-fe|0123456789abcdef`}={}){
 const entry=msg(8,cat(msg(1,text('skip_ad_on_block')),msg(2,msg(2,text('SAFE-SYNTHETIC')))));
 const data=modelData??(command&&route?nested(route,entry):msg(99,text('skip_ad_on_block')));
 return cat(msg(3,msg(172035250,msg(1,text(id)))),msg(5,msg(model,data)),typeSuffix);
}
const element=(name,options={})=>msg(153515154,msg(172660663,msg(1,msg(168777401,component(name,options)))));
const section=(...contents)=>msg(50195462,cat(...contents.map(x=>msg(1,x)),tracking,[64,1]));
const home=list=>nested([9,58173949,1,58174010,4,49399797],list);
const divider=()=>section(element('cell_divider',{model:347043917,command:false}));
const normalEml=()=>section(element('video_lockup_with_attachment',{command:false}));
for(const name of Object.keys(emlRoutes))test(`sample-derived EML ${name}: removes ad card and its following divider; all other bytes remain exact`,()=>{
 const adItem=msg(1,section(element(name))),separator=msg(1,divider()),normalItem=msg(1,normalEml());
 const registry=msg(777,msg(99,element(name))); // shared definition outside cards
 const input=cat(home(cat(normalItem,separator,adItem,separator,normalItem,msg(2,text('CONTINUATION')))),registry);
 const expected=cat(home(cat(normalItem,separator,normalItem,msg(2,text('CONTINUATION')))),registry);
 const r=run(input,{type:'application/x-protobuf'});
 assert.deepEqual(Buffer.from(r.output.body),Buffer.from(expected));assert.ok(r.logs.join('').includes('removed_eml=1 removed_dividers=1'));
});
test('EML continuation and mixed ItemSection remove only identified ad contents',()=>{
 const content=element('video_display_button_group_layout'),keep=element('video_lockup_with_attachment',{command:false});
 const original=msg(10,msg(49399797,msg(1,section(keep,content,keep))));
 const expected=msg(10,msg(49399797,msg(1,section(keep,keep))));
 assert.deepEqual(Buffer.from(run(original,{type:'application/x-protobuf'}).output.body),Buffer.from(expected));
});
test('adaptive browser-derived pagead marker removes only a confirmed card entry',()=>{
 const opaque=cat(new Uint8Array(1100).fill(65),text('pagead'));
 const candidate=msg(1,section(element('unknown_layout',{model:777777,modelData:opaque,command:false})));
 const keep=msg(1,normalEml());
 const input=home(cat(candidate,keep)),expected=home(keep);
 const result=run(input,{type:'application/x-protobuf'});
 assert.deepEqual(Buffer.from(result.output.body),Buffer.from(expected));
 assert.ok(result.logs.join('').includes('adaptive_removed=1'));
 const disabled=run(input,{type:'application/x-protobuf',extra:{$argument:{script_debug:true,adaptive_feed_ads:false}}});
 assert.equal(Object.keys(disabled.output).length,0);
});
test('sample-derived watch-next standalone sponsored action is removed without touching player metadata',()=>{
 const adAction=nested([15,361588638,2],element('banner_text_icon_buttoned_layout'));
 const metadata=cat(msg(14,msg(62960614,text('normal player overlay'))),msg(47,[1]),msg(777,text('shared templates')));
 const input=cat(metadata,adAction),result=run(input,{endpoint:'next',type:'application/x-protobuf'});
 assert.deepEqual(Buffer.from(result.output.body),Buffer.from(metadata));
 assert.ok(result.logs.join('').includes('removed=1'));
 assert.ok(result.logs.join('').includes('removed_eml=1'));
});
test('watch-next standalone action stays intact unless wrapper and structural EML ad identity both match',()=>{
 const normal=nested([15,361588638,2],element('video_lockup_with_attachment',{command:false}));
 const wrongWrapper=nested([15,361588639,2],element('banner_text_icon_buttoned_layout'));
 const weakMarker=nested([15,361588638,2],element('banner_text_icon_buttoned_layout',{command:false}));
 for(const body of [normal,wrongWrapper,weakMarker]) assert.equal(Object.keys(run(body,{endpoint:'next',type:'application/x-protobuf'}).output).length,0);
});
for(const [label,name,options] of [
 ['normal template containing ad model','video_lockup_with_attachment',{model:491441836,route:emlRoutes.video_display_button_group_layout.route}],
 ['unknown template','unknown_ad_layout',{model:491441836,route:emlRoutes.video_display_button_group_layout.route}],
 ['ad template but mismatched model','video_display_button_group_layout',{model:232954548}],
 ['known pair with marker in opaque unrelated bytes','video_display_button_group_layout',{command:false}],
 ['wrong identifier boundary','video_display_button_group_layout',{id:'video_display_button_group_layout.eml-fe|0123456789abcdefEXTRA'}],
 ['mixed models','video_display_button_group_layout',{typeSuffix:msg(5,msg(232954548,[]))}],
 ['ad command absent','full_width_portrait_image_layout',{modelData:[]}]
])test(`EML pass-through: ${label}`,()=>{
 const r=run(home(msg(1,section(element(name,options)))),{type:'application/x-protobuf'});assert.equal(Object.keys(r.output).length,0);
});
test('known EML ad plus later malformed command path passes entire response',()=>{
 const name='video_display_button_group_layout',route=emlRoutes[name].route;
 const good=nested(route,msg(8,cat(msg(1,text('skip_ad_on_block')),msg(2,[]))));
 const data=cat(good,msg(route[0],[0x0a,0x03,0x01]));
 assert.equal(Object.keys(run(home(msg(1,section(element(name,{modelData:data})))),{type:'application/x-protobuf'}).output).length,0);
});
test('unknown EML type variant and mixed renderer union cannot delete normal content',()=>{
 const known=element('video_display_button_group_layout');
 const mixed=cat(known,msg(99999999,[255]));
 assert.equal(Object.keys(run(home(msg(1,section(mixed))),{type:'application/x-protobuf'}).output).length,0);
 const type=cat(msg(168777401,component('video_display_button_group_layout')),msg(99999999,[]));
 const unknown=msg(153515154,msg(172660663,msg(1,type)));
 assert.equal(Object.keys(run(home(msg(1,section(unknown))),{type:'application/x-protobuf'}).output).length,0);
});
test('known Tab path with no ad preserves the original bytes and divider',()=>{
 const body=home(cat(msg(1,normalEml()),msg(1,divider()),msg(2,text('CONTINUATION'))));
 assert.equal(Object.keys(run(body,{type:'application/x-protobuf'}).output).length,0);
});
test('following normal card and unrelated shelf are never treated as ad separators',()=>{
 const adItem=msg(1,section(element('video_display_button_group_layout'))),keep=msg(1,normalEml()),shelf=msg(1,msg(51845067,[255,0]));
 const body=home(cat(adItem,keep,shelf));
 assert.deepEqual(Buffer.from(run(body,{type:'application/x-protobuf'}).output.body),Buffer.from(home(cat(keep,shelf))));
});

const shortsArgs={$argument:{script_debug:true,hide_home_shorts:true}};
const shortsOptions={type:'application/x-protobuf',extra:shortsArgs};
const identifiedTab=(list,id='FEwhat_to_watch')=>nested([9,58173949,1,58174010],cat(msg(11,text(id)),nested([4,49399797],list)));
const shortsCell=(options={})=>element('shorts_video_cell',{model:519005951,command:false,...options});
const shortsShelf=(...cells)=>msg(51845067,cat(msg(5,msg(51431404,cat(...cells.map(c=>msg(1,c)),tracking))),msg(36,text('opaque header')),msg(52,text('opaque metadata'))));
const shortToken=(id='FEwhat_to_watch')=>Buffer.from(nested([80226972,2],text(id))).toString('base64url');
const continuation=(list,token=shortToken())=>msg(10,msg(49399797,cat(list,msg(2,msg(52047593,msg(1,text(token)))),tracking)));
test('Shorts switch is off by default and passed only to the feed script',()=>{
 assert.match(plugin,/hide_home_shorts = switch,false,tag=隐藏首页 Shorts/);
 const entries=plugin.split('\n').filter(line=>line.includes('argument=')&&line.includes('{hide_home_shorts}'));
 assert.equal(entries.length,1);assert.ok(entries[0].includes('YouTubeFeedAds.js'));
 const body=identifiedTab(msg(1,shortsShelf(shortsCell())));
 for(const value of [undefined,false,'false','1'])assert.equal(Object.keys(run(body,{type:'application/x-protobuf',extra:{$argument:{hide_home_shorts:value}}}).output).length,0);
});
test('identified homepage removes the entire Shorts shelf without altering regular cards, divider, pagination or shared templates',()=>{
 const keep=msg(1,normalEml()),shelf=msg(1,shortsShelf(shortsCell(),shortsCell()));
 const tail=cat(msg(1,divider()),msg(2,text('UNKNOWN-CONTINUATION'))),shared=msg(777,shelf);
 const body=cat(identifiedTab(cat(keep,shelf,tail)),shared);
 const expected=cat(identifiedTab(cat(keep,tail)),shared);
 for(const value of [true,'true']){
  const r=run(body,{...shortsOptions,extra:{$argument:{script_debug:true,hide_home_shorts:value}}});
  assert.deepEqual(Buffer.from(r.output.body),Buffer.from(expected));assert.ok(r.logs.join('').includes('changed: removed=0'));assert.ok(r.logs.join('').includes('hidden_shorts=1'));
 }
});
test('home continuation is identified from a structured token and preserves that token exactly',()=>{
 const list=cat(msg(1,normalEml()),msg(1,shortsShelf(shortsCell())));
 for(const token of [shortToken(),encodeURIComponent(Buffer.from(nested([80226972,2],text('FEwhat_to_watch'))).toString('base64'))]){
  assert.deepEqual(Buffer.from(run(continuation(list,token),shortsOptions).output.body),Buffer.from(continuation(msg(1,normalEml()),token)));
 }
});
test('Shorts hide and existing sponsored card cleaning work together with separate counts',()=>{
 const keep=msg(1,normalEml());
 const body=identifiedTab(cat(msg(1,section(element('video_display_button_group_layout'))),msg(1,divider()),msg(1,shortsShelf(shortsCell())),keep));
 const r=run(body,shortsOptions);assert.deepEqual(Buffer.from(r.output.body),Buffer.from(identifiedTab(keep)));
 assert.ok(r.logs.join('').includes('removed_eml=1 removed_dividers=1 hidden_shorts=1'));
});
for(const id of ['FEsubscriptions','FEshorts','UC_CHANNEL','VL_PLAYLIST'])test(`other browse Tab ${id} keeps its Shorts shelf`,()=>{
 assert.equal(Object.keys(run(identifiedTab(msg(1,shortsShelf(shortsCell())),id),shortsOptions).output).length,0);
 assert.equal(Object.keys(run(continuation(msg(1,shortsShelf(shortsCell())),shortToken(id)),shortsOptions).output).length,0);
});
test('unknown homepage identity and invalid/mixed continuation tokens do not enable Shorts hiding',()=>{
 const list=msg(1,shortsShelf(shortsCell()));
 for(const body of [home(list),initial(list),continuation(list,'FEwhat_to_watch'),continuation(list,'%INVALID'),continuation(list,shortToken('UC_OTHER')),
  msg(10,msg(49399797,cat(list,msg(2,msg(52047593,msg(1,text(shortToken())))),msg(2,msg(60487319,msg(1,text(shortToken('FEsubscriptions'))))))))]){
  assert.equal(Object.keys(run(body,shortsOptions).output).length,0);
 }
});
test('home identity is isolated between sibling Tabs',()=>{
 const tab=id=>msg(1,msg(58174010,cat(msg(11,text(id)),nested([4,49399797],msg(1,shortsShelf(shortsCell()))))));
 const expectedHome=msg(1,msg(58174010,cat(msg(11,text('FEwhat_to_watch')),nested([4,49399797],[]))));
 const body=msg(9,msg(58173949,cat(tab('FEwhat_to_watch'),tab('FEsubscriptions'))));
 assert.deepEqual(Buffer.from(run(body,shortsOptions).output.body),Buffer.from(msg(9,msg(58173949,cat(expectedHome,tab('FEsubscriptions'))))));
});
for(const [label,shelf] of [
 ['ordinary shelf containing a Shorts title',msg(51845067,msg(1,text('Shorts')))],
 ['empty shelf',shortsShelf()],
 ['mixed regular and Shorts cells',shortsShelf(shortsCell(),element('video_lockup_with_attachment'))],
 ['wrong model',shortsShelf(shortsCell({model:232954548}))],
 ['wrong template boundary',shortsShelf(shortsCell({id:'shorts_video_cell.eml-fe|0123456789abcdefEXTRA'}))],
 ['unknown content renderer',msg(51845067,msg(5,msg(99999999,[])))],
 ['mixed outer renderers',cat(shortsShelf(shortsCell()),msg(99999999,[]))],
 ['unknown cell union',shortsShelf(cat(shortsCell(),msg(99999999,[])))],
 ['nested Element children',shortsShelf(msg(153515154,msg(172660663,cat(msg(1,msg(168777401,component('shorts_video_cell',{model:519005951}))),msg(3,[])))))],
])test(`home Shorts preservation: ${label}`,()=>{
 assert.equal(Object.keys(run(identifiedTab(msg(1,shelf)),shortsOptions).output).length,0);
});
test('truncated Shorts response discards earlier ad and Shorts changes',()=>{
 const body=cat(identifiedTab(cat(msg(1,ad),msg(1,shortsShelf(shortsCell())))),[0x12,0x04,0x01]);
 assert.equal(Object.keys(run(body,shortsOptions).output).length,0);
});
const jsonShorts={reelShelfRenderer:{title:{simpleText:'Shorts'},items:[{reelItemRenderer:{videoId:'SHORT'}},{shortsLockupViewModel:{entityId:'SHORT2'}}]}};
const jsonVideo={videoRenderer:{title:{simpleText:'Shorts'},videoId:'REGULAR'}};
const jsonHomeTab=contents=>({contents:{singleColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{tabIdentifier:'FEwhat_to_watch',content:{sectionListRenderer:{contents}}}}]}}});
test('JSON home removes whole Shorts sections; default behavior and regular videos retain original data',()=>{
 const data=jsonHomeTab([jsonVideo,jsonShorts,{continuationItemRenderer:{token:'KEEP'}}]);
 const body=JSON.stringify(data);
 assert.equal(Object.keys(run(body).output).length,0);
 assert.deepEqual(JSON.parse(run(body,{extra:shortsArgs}).output.body),jsonHomeTab([jsonVideo,{continuationItemRenderer:{token:'KEEP'}}]));
});
test('JSON binary UTF-8 Shorts-only changes are returned as correctly encoded bytes',()=>{
 const body=new TextEncoder().encode(JSON.stringify(jsonHomeTab([jsonShorts,{videoRenderer:{title:'中文😀'}}])));
 const out=run(body,{extra:shortsArgs}).output.body;
 assert.ok(out instanceof Uint8Array);assert.deepEqual(JSON.parse(new TextDecoder().decode(out)),jsonHomeTab([{videoRenderer:{title:'中文😀'}}]));
});
test('JSON structured continuation and known home target remove Shorts; other endpoints do not',()=>{
 const body=JSON.stringify({continuationContents:{sectionListContinuation:{continuations:[{nextContinuationData:{continuation:shortToken()}}],contents:[jsonShorts,jsonVideo]}}});
 assert.deepEqual(JSON.parse(run(body,{extra:shortsArgs}).output.body).continuationContents.sectionListContinuation.contents,[jsonVideo]);
 const action=JSON.stringify({onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'browse-feedFEwhat_to_watch',continuationItems:[jsonShorts,jsonVideo]}}]});
 assert.deepEqual(JSON.parse(run(action,{extra:shortsArgs}).output.body).onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems,[jsonVideo]);
 for(const endpoint of ['next','search'])assert.equal(Object.keys(run(body,{endpoint,extra:shortsArgs}).output).length,0);
});
test('JSON rich grid, horizontal shelf and whole ItemSection wrappers hide only structurally identified Shorts',()=>{
 const items=[{richItemRenderer:{content:{reelItemRenderer:{videoId:'SHORT'}}}}];
 const cards=[{richSectionRenderer:{content:{richShelfRenderer:{icon:{iconType:'YOUTUBE_SHORTS_BRAND_24'},contents:items}}}},
  {shelfRenderer:{content:{horizontalListRenderer:{items}}}},
  {itemSectionRenderer:{contents:[jsonShorts],trackingParams:'SAFE'}}];
 assert.deepEqual(JSON.parse(run(JSON.stringify(jsonHomeTab([...cards,jsonVideo])),{extra:shortsArgs}).output.body),jsonHomeTab([jsonVideo]));
});
test('JSON other tabs, unknown home, mixed shelves and Shorts titles remain unchanged',()=>{
 const cards=[{reelShelfRenderer:{items:[{reelItemRenderer:{}},jsonVideo]}},
  {richSectionRenderer:{content:{richShelfRenderer:{title:{simpleText:'Shorts'},contents:[{richItemRenderer:{content:{reelItemRenderer:{}}}}]}}}},
  {reelShelfRenderer:{items:[]}}, {reelShelfRenderer:{items:[{reelItemRenderer:{},videoRenderer:{}}]}},
  {reelShelfRenderer:jsonShorts.reelShelfRenderer,videoRenderer:{}},jsonVideo];
 assert.equal(Object.keys(run(JSON.stringify(jsonHomeTab(cards)),{extra:shortsArgs}).output).length,0);
 assert.equal(Object.keys(run(JSON.stringify({contents:[jsonShorts]}),{extra:shortsArgs}).output).length,0);
 const data=jsonHomeTab([jsonShorts]);data.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.tabIdentifier='FEsubscriptions';
 assert.equal(Object.keys(run(JSON.stringify(data),{extra:shortsArgs}).output).length,0);
});
test('available request body can identify final home continuation without an outgoing token',()=>{
 const protoBody=msg(10,msg(49399797,msg(1,shortsShelf(shortsCell()))));
 const req={url:'https://youtubei.googleapis.com/youtubei/v1/browse',body:msg(7,text(shortToken()))};
 assert.deepEqual(Buffer.from(run(protoBody,{...shortsOptions,extra:{...shortsArgs,$request:req}}).output.body),Buffer.from(msg(10,msg(49399797,[]))));
 const jsonBody=JSON.stringify({contents:[jsonShorts,jsonVideo]});
 assert.deepEqual(JSON.parse(run(jsonBody,{extra:{...shortsArgs,$request:{...req,body:JSON.stringify({browseId:'FEwhat_to_watch'})}}}).output.body),{contents:[jsonVideo]});
});
for(const [label,options] of [
 ['no structural ad command',{command:false}],
 ['wrong model despite square image layout',{model:232954548}],
 ['marker without a map value',{modelData:nested(emlRoutes.full_width_square_image_layout.route,msg(8,msg(1,text('skip_ad_on_block'))))}],
])test(`square image sponsored card retained when ${label}`,()=>{
 const body=home(msg(1,section(element('full_width_square_image_layout',options))));
 assert.equal(Object.keys(run(body,{type:'application/x-protobuf'}).output).length,0);
});
for(const name of ['full_width_square_image_carousel_layout','carousel_footered_layout','video_display_full_buttoned_layout']) {
 for(const [label,options] of [
  ['missing ad command',{command:false}],
  ['mismatched model',{model:232954548}],
  ['marker at wrong command route',{route:emlRoutes.video_display_button_group_layout.route}],
  ['map key without value',{modelData:nested(emlRoutes[name].route,msg(8,msg(1,text('skip_ad_on_block'))))}],
 ])test(`${name} retains unverified cards: ${label}`,()=>{
  assert.equal(Object.keys(run(home(msg(1,section(element(name,options)))),{type:'application/x-protobuf'}).output).length,0);
 });
 test(`${name} continuation removes only the ad and associated divider`,()=>{
  const before=msg(10,msg(49399797,cat(msg(1,normalEml()),msg(1,section(element(name))),msg(1,divider()),msg(1,normalEml()),msg(2,text('KEEP_TOKEN')))));
  const after=msg(10,msg(49399797,cat(msg(1,normalEml()),msg(1,normalEml()),msg(2,text('KEEP_TOKEN')))));
  assert.deepEqual(Buffer.from(run(before,{type:'application/x-protobuf'}).output.body),Buffer.from(after));
 });
}
