/*
 * YouTubeInitPlayback 1.0.0 — local YouTube iOS initplayback key validation.
 *
 * Parses only OnesieRequest field 3 -> EncryptedInnertubeRequest field 5.
 * A matching local config is passed through.  A stale/mismatched key clears
 * the cache and returns one empty protobuf response so YouTube refreshes its
 * config/falls back through the already filtered player path.  No URL, key or
 * request body is sent to a third-party service.  YouTube Music is untouched.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SOURCE = "YouTubeInitPlayback";
  var STATE_KEY = "ytads.onesie.youtube.v1";
  var LOG_CONFIG = "ytads.logger.config.v1";
  var LOG_CACHE = "ytads.logger.entries.v2";
  var MAX_BODY = 2097152;
  var MAX_FIELDS = 30000;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  var enabled = args.onesie_enabled !== false && args.onesie_enabled !== "false";
  var refreshMismatch = args.onesie_refresh_on_mismatch !== false && args.onesie_refresh_on_mismatch !== "false";
  var debug = flag(args.script_debug);
  var API = /^https:\/\/[a-z0-9-]+\.googlevideo\.com\/initplayback(?:\?[^#]*)?$/i;

  function flag(value) { return value === true || value === "true"; }
  function fail(code) { var error = new Error(code); error.ytNoAdsCode = code; throw error; }
  function bytesOf(value) { if (value instanceof Uint8Array) return value; if (value instanceof ArrayBuffer) return new Uint8Array(value); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength); return null; }
  function header(headers, name) { var keys = Object.keys(headers || {}), lower = name.toLowerCase(); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === lower) return String(headers[keys[i]] || ""); return ""; }
  function isYouTubeApp() { var ua = header($request.headers,"user-agent"); return /(?:^|\s)com\.google\.ios\.youtube\//i.test(ua) && !/youtubemusic/i.test(ua); }
  function readVarint(bytes,cursor) { var value=0,factor=1,count=0; while(cursor.pos<bytes.length&&count++<10){var current=bytes[cursor.pos++];value+=(current&127)*factor;if(!Number.isSafeInteger(value))fail("unsafe-varint");if(current<128)return value;factor*=128;}fail("invalid-varint"); }
  function parse(bytes,budget) { var cursor={pos:0},records=[]; while(cursor.pos<bytes.length){if(++budget.fields>MAX_FIELDS)fail("field-limit");var tag=readVarint(bytes,cursor),no=Math.floor(tag/8),wire=tag&7;if(!no)fail("invalid-tag");var dataStart=cursor.pos,dataEnd=cursor.pos;if(wire===0){readVarint(bytes,cursor);dataEnd=cursor.pos;}else if(wire===1){cursor.pos+=8;dataEnd=cursor.pos;}else if(wire===2){var length=readVarint(bytes,cursor);if(!Number.isSafeInteger(length)||length<0||length>bytes.length-cursor.pos)fail("truncated-field");dataStart=cursor.pos;cursor.pos+=length;dataEnd=cursor.pos;}else if(wire===5){cursor.pos+=4;dataEnd=cursor.pos;}else fail("unsupported-wire");if(cursor.pos>bytes.length)fail("truncated-field");records.push({no:no,wire:wire,dataStart:dataStart,dataEnd:dataEnd});}return records; }
  function only(records,no,wire){var found=null;for(var i=0;i<records.length;i++)if(records[i].no===no&&records[i].wire===wire){if(found)fail("duplicate-schema-field");found=records[i];}return found;}
  function encryptedClientKey(body){var root=bytesOf(body);if(!root||!root.length||root.length>MAX_BODY)fail("unsupported-body");var budget={fields:0},outer=only(parse(root,budget),3,2);if(!outer)return null;var inner=root.subarray(outer.dataStart,outer.dataEnd),key=only(parse(inner,budget),5,2);return key?inner.subarray(key.dataStart,key.dataEnd):null;}
  function base64(bytes){var alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",result="";for(var i=0;i<bytes.length;i+=3){var a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;result+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|(c>>6)]:"=")+(i+2<bytes.length?alphabet[c&63]:"=");}return result;}
  function readState(){if(typeof $persistentStore==="undefined")return null;try{var raw=$persistentStore.read(STATE_KEY),state=raw&&raw.length<=8192?JSON.parse(raw):null;if(!state||state.schema!==1||state.platform!=="youtube"||typeof state.encryptKey!=="string")return null;if(!Number.isFinite(state.expiresAt)||state.expiresAt<=Date.now()){$persistentStore.write(undefined,STATE_KEY);return null;}return state;}catch(_){return null;}}
  function clearState(){if(typeof $persistentStore!=="undefined")$persistentStore.write(undefined,STATE_KEY);}
  function utf8Size(text){return unescape(encodeURIComponent(text)).length;}
  function checksum(text){var hash=2166136261;for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return "fnv1a32-utf16:"+("00000000"+(hash>>>0).toString(16)).slice(-8);}
  function captureBody(body){if(body===undefined||body===null)return{available:false,reason:"not-provided-by-runtime"};if(typeof body==="string")return{available:true,encoding:"utf8-text",bytes:utf8Size(body),data:body};var bytes=bytesOf(body);return bytes?{available:true,encoding:"base64",bytes:bytes.length,data:base64(bytes)}:{available:false,reason:"unsupported-runtime-body-type"};}
  function logConfig(){if(!flag(args.log_enabled)||typeof $persistentStore==="undefined")return null;try{var raw=$persistentStore.read(LOG_CONFIG),c=raw&&raw.length<=2048?JSON.parse(raw):null;return c&&c.enabled===true&&typeof c.session==="string"&&/^[a-z0-9-]{1,80}$/.test(c.session)?c:null;}catch(_){return null;}}
  function append(entry,payload){var c=logConfig(),written=[];if(!c)return false;try{var raw=$persistentStore.read(LOG_CACHE),old=raw?JSON.parse(raw):null,state=old&&old.session===c.session&&Array.isArray(old.entries)?old:{session:c.session,entries:[],captureBytes:0};if(state.entries.length>=600)return false;var serialized=payload?JSON.stringify(payload):null,size=serialized?utf8Size(serialized):0,budget=[16,32,64].indexOf(Number(args.capture_budget))>=0?Number(args.capture_budget)*1048576:33554432;if((state.captureBytes||0)+size>budget||size>33554432)return false;if(serialized){var chunks=[];for(var start=0;start<serialized.length;start+=131072)chunks.push(serialized.slice(start,start+131072));if(chunks.length>256)return false;var prefix="ytads.capture."+c.session+"."+payload.id+".";entry.captureRef={prefix:prefix,chunks:chunks.length,chars:serialized.length,storedBytes:size,checksum:checksum(serialized)};for(var i=0;i<chunks.length;i++){var key=prefix+i;if($persistentStore.write(chunks[i],key)!==true)fail("capture-write-failed");written.push(key);}}var next={session:c.session,entries:state.entries.concat([entry]),captureBytes:(state.captureBytes||0)+size},index=JSON.stringify(next);if(utf8Size(index)>131072||$persistentStore.write(index,LOG_CACHE)!==true)fail("index-write-failed");return true;}catch(_){for(var j=0;j<written.length;j++)try{$persistentStore.write(undefined,written[j]);}catch(_){}return false;}}
  function record(message,level,output){var now=new Date().toISOString();if(flag(args.capture_raw)){var id=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,14),request={url:$request.url,method:$request.method||"GET",headers:$request.headers||{},h2_trailers:$request.h2_trailers||{},body:captureBody($request.body)};var payload={schema:1,id:id,time:now,source:SOURCE,version:VERSION,phase:"request",endpoint:"initplayback",runtime:typeof $loon==="string"?$loon:null,correlation:{urlMethodHash:checksum(request.method+" "+request.url),exactPairing:false},request:request,processing:{exception:null,executionScript:SOURCE,elapsedMs:0,messages:[message],arguments:{onesie_enabled:enabled,onesie_refresh_on_mismatch:refreshMismatch,log_level:args.log_level||"info"}},responseAfter:output&&output.response?{synthetic:true,status:output.response.status,headers:output.response.headers,body:captureBody(output.response.body)}:null};append({source:SOURCE,version:VERSION,endpoint:"initplayback",level:"debug",time:now,phase:"request",message:"development capture: changed="+!!(output&&output.response)},payload);}else{var ranks={debug:0,info:1,warn:2,error:3},minimum=Object.prototype.hasOwnProperty.call(ranks,args.log_level)?args.log_level:"info";if(ranks[level]>=ranks[minimum])append({source:SOURCE,version:VERSION,endpoint:"initplayback",level:level,time:now,phase:"request",message:message},null);}if(debug&&typeof console!=="undefined")console.log("["+SOURCE+" "+VERSION+"] initplayback "+message);}

  var output = {};
  if (enabled && typeof $request !== "undefined" && typeof $response === "undefined" && API.test($request.url || "") && isYouTubeApp()) {
    try {
      var state = readState(), key = encryptedClientKey($request.body);
      if (!key || !key.length) record("pass: encrypted client key absent", "debug", output);
      else if (!state) record("pass: active config absent", "info", output);
      else if (base64(key) === state.encryptKey) record("matched: local config active", "debug", output);
      else {
        clearState();
        if (refreshMismatch) output = {response:{status:200,headers:{"Content-Type":"application/x-protobuf","Cache-Control":"no-store"},body:new Uint8Array(0)}};
        record("mismatch: config cleared refresh=" + refreshMismatch, "warn", output);
      }
    } catch (error) { record("pass: " + (error && error.message || "parse-failed"), "warn", output); output = {}; }
  }
  $done(output);
})();
