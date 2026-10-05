/**
 * 文件：YouTubeLogger.js
 * 功能：管理本地日志会话、完整链路记录、分块校验和单文件导出。
 * 版本：2.9.0
 * 更新时间：2026-10-05
 * 运行环境：Loon JavaScript
 */
/**
 * 功能：按保存级别筛选新事件；info 保存完整脱敏链路，error 只保留错误并避免写入正常样本。
 * 更新时间：2026-10-05T11:54:46+08:00
 * @param {Object} entry 事件摘要。
 * @param {Object|null} payload 待脱敏的结构诊断。
 * @param {string} level 主插件选择的级别。
 * @returns {boolean} 是否保存当前事件。
 */
function ytDiagnosticShouldRecord(entry,payload,level) {
  var processing=payload&&payload.processing;
  var isError=entry.level==="error" || !!(payload&&payload.responseBefore&&Number(payload.responseBefore.status)>=400&&Number(payload.responseBefore.status)<=599) || !!(processing&&processing.exception) || /inner=(?:authentication_failed|compression_failed|invalid_config_key|protocol_cleanup_failed)/.test(entry.message);
  if(isError)entry.level="error";
  if(level==="error")return isError;
  if(level==="warn")return isError||entry.level==="warn";
  if(level!=="debug"&&entry.level==="debug")entry.level="info";
  return true;
}
/**
 * 功能：样本写完后重新读取最新索引追加事件，减少长时间处理导致的并发覆盖，并拒绝暂停或旧会话写入。
 * 更新时间：2026-10-05T09:16:03+08:00
 * @param {Object} pending 本次待提交的索引，其末项为新事件。
 * @param {number} budget 日志字节容量上限。
 * @returns {boolean} 索引提交成功；失败时抛出固定错误供调用方清理样本。
 */
function ytDiagnosticCommitEntry(pending, budget) {
  var configKey = "ytads.logger.config.v1", key = "ytads.logger.entries.v2";
  var current = JSON.parse($persistentStore.read(configKey) || "null");
  if (!current || !current.enabled || current.session !== pending.session) throw Error("log-session-inactive");
  var raw = $persistentStore.read(key);
  if (raw && raw.length > 131072) throw Error("log-index-invalid");
  var old = raw ? JSON.parse(raw) : null;
  var state = old && old.session === pending.session && Array.isArray(old.entries) ? old : {session:pending.session, entries:[], captureBytes:0};
  var entry = pending.entries[pending.entries.length - 1];
  var size = entry.captureRef ? entry.captureRef.storedBytes : 0;
  var used = Number(state.captureBytes || 0);
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(size) || size < 0) throw Error("log-index-invalid");
  var reason = state.entries.length >= 600 ? "entry-limit" : used + size > budget ? "capture-budget-limit" : null;
  var next = JSON.stringify({session:pending.session, entries:state.entries.concat([entry]), captureBytes:used + size});
  if (!reason && unescape(encodeURIComponent(next)).length > 131072) reason = "log-index-limit";
  if (reason) {
    current.enabled = false; current.haltReason = reason; current.haltedAt = new Date().toISOString();
    if ($persistentStore.write(JSON.stringify(current), configKey) !== true) throw Error("log-stop-write-failed");
    throw Error(reason);
  }
  if ($persistentStore.write(next, key) !== true) throw Error("log-index-write-failed");
  return true;
}
/**
 * 功能：首次使用脱敏版日志时清除旧缓存中未脱敏的正文块，保留无身份信息的事件摘要。
 * 更新时间：2026-10-04T14:45:25+08:00
 * @returns {void} 删除失败时抛出异常，阻止本次日志写入。
 */
function ytDiagnosticPurgeLegacy() {
  if (typeof $persistentStore === 'undefined') return;
  var key='ytads.logger.privacy.v1';
  if ($persistentStore.read(key)==='structure-only-v1') return;
  var raw=$persistentStore.read('ytads.logger.entries.v2'),state=raw?JSON.parse(raw):null;
  if(state&&Array.isArray(state.entries)) {
    for(var n=0;n<state.entries.length;n++) {
      var entry=state.entries[n],ref=entry&&entry.captureRef;
      if(!ref)continue;
      if(typeof ref.prefix!=='string'||!/^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(ref.prefix)||!Number.isInteger(ref.chunks)||ref.chunks<1||ref.chunks>256)throw Error('privacy-invalid-reference');
      for(var i=0;i<ref.chunks;i++)if($persistentStore.write(undefined,ref.prefix+i)!==true)throw Error('privacy-delete-failed');
      delete entry.captureRef;entry.message='legacy capture removed for privacy';
    }
    state.captureBytes=0;
    if($persistentStore.write(JSON.stringify(state),'ytads.logger.entries.v2')!==true)throw Error('privacy-index-failed');
  }
  if($persistentStore.write('structure-only-v1',key)!==true)throw Error('privacy-marker-failed');
}
/**
 * 功能：只读分析 UMP 分片；本地认证解密播放器响应后交由脱敏器处理，媒体和未知密文不返回原文。
 * 更新时间：2026-10-05T12:34:24+08:00
 * @param {Uint8Array} bytes 完整响应字节，仅在当前执行内存中使用。
 * @param {Function} structure 将 API 正文转换为无凭据的字段树。
 * @returns {Object} 分片目录、处理状态和可用的脱敏播放器结构。
 */
function ytDiagnosticUMPStructure(bytes, structure) {
  var LIMIT=8*1048576, pos=0, header=null;
  var out={format:'ump',bytes:bytes.length,parts:[],complete:true};
  /**
   * 功能：产生固定诊断代码，不将原始协议字节拼入异常消息。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function fail(code){throw Error(code);}
  /**
   * 功能：读取 UMP 专用整数编码，并检查剩余字节。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function umpInt(){if(pos>=bytes.length)fail('ump-truncated-integer');var first=bytes[pos++],size=first<128?1:first<192?2:first<224?3:first<240?4:5,bits=8-size,value=size===5?0:first%Math.pow(2,bits),scale=size===5?1:Math.pow(2,bits);for(var i=1;i<size;i++){if(pos>=bytes.length)fail('ump-truncated-integer');value+=bytes[pos++]*scale;scale*=256;}return value;}
  /**
   * 功能：读取有限大小的 Protobuf 字段；只在内存中定位认证和播放器正文。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function records(b){var p=0,fields=[];
    /**
     * 功能：安全读取 Protobuf 变长整数。
     * 更新时间：2026-10-05T12:34:24+08:00
     */
    function integer(){var n=0,f=1;for(var i=0;i<10&&p<b.length;i++){var v=b[p++];n+=(v&127)*f;if(v<128){if(!Number.isSafeInteger(n))fail('integer-range');return n;}f*=128;}fail('protobuf-truncated');}
    while(p<b.length){if(fields.length>=30000)fail('field-limit');var tag=integer(),wire=tag%8,no=Math.floor(tag/8),v={field:no,wire:wire};if(!no||no>536870911)fail('invalid-field');if(wire===0)v.value=integer();else if(wire===2){var n=integer();if(n>b.length-p)fail('protobuf-truncated');v.body=b.subarray(p,p+n);p+=n;}else if(wire===1||wire===5)p+=wire===1?8:4;else fail('unsupported-wire');if(p>b.length)fail('protobuf-truncated');fields.push(v);}return fields;}
  /**
   * 功能：拒绝重复或类型错误的认证字段，防止解析歧义。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function only(fields,no,wire){var found=null;for(var i=0;i<fields.length;i++)if(fields[i].field===no){if(found||fields[i].wire!==wire)fail('schema-mismatch');found=fields[i];}return found;}
  /**
   * 功能：拼接认证输入，临时字节不进入日志。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function concat(parts){var n=0,p=0;for(var i=0;i<parts.length;i++)n+=parts[i].length;var b=new Uint8Array(n);for(i=0;i<parts.length;i++){b.set(parts[i],p);p+=parts[i].length;}return b;}
  /**
   * 功能：读取仍有效的本地 YouTube 配置密钥，仅用于响应认证，不导出配置内容。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function localKey(){if(typeof $persistentStore==='undefined')fail('config-absent');var text=$persistentStore.read('ytads.onesie.youtube.v1'),s=text&&text.length<=8192?JSON.parse(text):null;if(!s||s.schema!==1||s.platform!=='youtube'||!Number.isFinite(s.expiresAt)||s.expiresAt<=Date.now()||typeof s.clientKey!=='string'||s.clientKey.length!==44)fail('config-absent');var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',a=[],v=0,bits=0;for(var i=0;i<s.clientKey.length&&s.clientKey[i]!=='=';i++){var n=alphabet.indexOf(s.clientKey[i]);if(n<0)fail('config-invalid');v=(v<<6)|n;bits+=6;if(bits>=8){bits-=8;a.push((v>>>bits)&255);}}if(a.length!==32)fail('config-invalid');return new Uint8Array(a);}
  /**
   * 功能：执行 rotate 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function rotate(value,bits){return (value>>>bits)|(value<<(32-bits));}
  /**
   * 功能：执行 sha256 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function sha256(data){var constants=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];var length=data.length,total=Math.ceil((length+9)/64)*64,buffer=new Uint8Array(total),view=new DataView(buffer.buffer),bits=length*8;buffer.set(data);buffer[length]=128;view.setUint32(total-8,Math.floor(bits/4294967296));view.setUint32(total-4,bits>>>0);var hash=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],words=new Uint32Array(64);for(var offset=0;offset<total;offset+=64){for(var i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);for(i=16;i<64;i++){var s0=rotate(words[i-15],7)^rotate(words[i-15],18)^(words[i-15]>>>3),s1=rotate(words[i-2],17)^rotate(words[i-2],19)^(words[i-2]>>>10);words[i]=(words[i-16]+s0+words[i-7]+s1)>>>0;}var a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];for(i=0;i<64;i++){var upper=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(h+upper+choice+constants[i]+words[i])>>>0,lower=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(lower+majority)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}hash[0]=(hash[0]+a)>>>0;hash[1]=(hash[1]+b)>>>0;hash[2]=(hash[2]+c)>>>0;hash[3]=(hash[3]+d)>>>0;hash[4]=(hash[4]+e)>>>0;hash[5]=(hash[5]+f)>>>0;hash[6]=(hash[6]+g)>>>0;hash[7]=(hash[7]+h)>>>0;}var result=new Uint8Array(32),resultView=new DataView(result.buffer);for(i=0;i<8;i++)resultView.setUint32(i*4,hash[i]);return result;}
  /**
   * 功能：执行 hmac256 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function hmac256(key,data){if(key.length>64)key=sha256(key);var inner=new Uint8Array(64+data.length),outer=new Uint8Array(96);for(var i=0;i<64;i++){var value=i<key.length?key[i]:0;inner[i]=value^54;outer[i]=value^92;}inner.set(data,64);outer.set(sha256(inner),64);return sha256(outer);}
  /**
   * 功能：执行 equal 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function equal(a,b){if(!a||!b||a.length!==b.length)return false;var difference=0;for(var i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;}
  var AES_SBOX=new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
  /**
   * 功能：执行 aesSchedule 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesSchedule(key){if(!key||key.length!==16)fail("invalid-aes-key");var expanded=new Uint8Array(176);expanded.set(key);var generated=16,rcon=1,temp=new Uint8Array(4);while(generated<176){for(var i=0;i<4;i++)temp[i]=expanded[generated-4+i];if(generated%16===0){var first=temp[0];temp[0]=AES_SBOX[temp[1]]^rcon;temp[1]=AES_SBOX[temp[2]];temp[2]=AES_SBOX[temp[3]];temp[3]=AES_SBOX[first];rcon=((rcon<<1)^((rcon&128)?27:0))&255;}for(i=0;i<4;i++){expanded[generated]=expanded[generated-16]^temp[i];generated++;}}return expanded;}
  /**
   * 功能：执行 aesBlock 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesBlock(input,roundKeys){var state=new Uint8Array(input),round,i,column,a0,a1,a2,a3,t;/**
 * 功能：执行 addKey 对应的内部处理步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function addKey(offset){for(i=0;i<16;i++)state[i]^=roundKeys[offset+i];}/**
 * 功能：执行 xtime 对应的内部处理步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function xtime(value){return ((value<<1)^((value&128)?27:0))&255;}addKey(0);for(round=1;round<=10;round++){for(i=0;i<16;i++)state[i]=AES_SBOX[state[i]];t=state[1];state[1]=state[5];state[5]=state[9];state[9]=state[13];state[13]=t;t=state[2];state[2]=state[10];state[10]=t;t=state[6];state[6]=state[14];state[14]=t;t=state[3];state[3]=state[15];state[15]=state[11];state[11]=state[7];state[7]=t;if(round<10)for(column=0;column<4;column++){i=column*4;a0=state[i];a1=state[i+1];a2=state[i+2];a3=state[i+3];t=a0^a1^a2^a3;state[i]=a0^t^xtime(a0^a1);state[i+1]=a1^t^xtime(a1^a2);state[i+2]=a2^t^xtime(a2^a3);state[i+3]=a3^t^xtime(a3^a0);}addKey(round*16);}return state;}
  /**
   * 功能：执行 incrementCounter 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function incrementCounter(counter){for(var i=15;i>=0;i--){counter[i]=(counter[i]+1)&255;if(counter[i]!==0)return;}}
  /**
   * 功能：执行 aesCtr 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function aesCtr(data,key,iv){if(!iv||iv.length!==16)fail("invalid-aes-iv");var roundKeys=aesSchedule(key),counter=new Uint8Array(iv),output=new Uint8Array(data.length);for(var offset=0;offset<data.length;offset+=16){var stream=aesBlock(counter,roundKeys),length=Math.min(16,data.length-offset);for(var i=0;i<length;i++)output[offset+i]=data[offset+i]^stream[i];incrementCounter(counter);}return output;}

  /**
   * 功能：认证并解析 Onesie 播放器响应；返回脱敏 API 结构，不保留响应头或密钥。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function player(b,h){var fields=records(h),type=only(fields,1,0);if(type&&type.value!==0)return {status:'non-player-onesie'};var crypto=only(fields,4,2),data=b,state='clear';if(!crypto)fail('crypto-params-absent');var params=records(crypto.body),iv=only(params,5,2),mac=only(params,4,2),compression=only(params,6,0);if(!iv||!mac)fail('crypto-params-absent');if(iv.body.length||mac.body.length){if(iv.body.length!==16||mac.body.length!==32)fail('crypto-params-invalid');var key=localKey();if(!equal(hmac256(key.subarray(16),concat([b,iv.body])),mac.body))fail('authentication-failed');data=aesCtr(b,key.subarray(0,16),iv.body);state='authenticated';}
    if(data.length>LIMIT)fail('player-size-limit');
    if(compression&&compression.value!==0&&compression.value!==1)fail('compression-unsupported');
    if(compression&&compression.value===1){if(typeof $utils==='undefined'||typeof $utils.ungzip!=='function')fail('gzip-unavailable');data=$utils.ungzip(data);if(data instanceof ArrayBuffer)data=new Uint8Array(data);if(!(data instanceof Uint8Array)||data.length>LIMIT)fail('gzip-invalid');}
    var response=records(data),http=only(response,2,0),proxy=only(response,1,0),body=only(response,4,2);var result={status:state,httpStatus:http&&http.value,proxyStatus:proxy&&proxy.value};if(body)result.player=structure(body.body);else result.status='player-body-absent';return result;
  }
  /**
   * 功能：提取已确认 Cuepoint 路径上的有限类型和事件编号，用于判断广告预取、开始及结束。
   * 更新时间：2026-10-05T13:09:46+08:00
   */
  function cues(b){var list=records(b),result=[];for(var i=0;i<list.length;i++){if(list[i].field!==1||list[i].wire!==2)continue;var info=records(list[i].body),cue=only(info,1,2);if(!cue)continue;var fields=records(cue.body),type=only(fields,1,0),event=only(fields,2,0);if(type&&event&&type.value>=0&&type.value<=255&&event.value>=0&&event.value<=255)result.push({type:type.value,event:event.value,ad:type.value===1,prefetch:type.value===1&&event.value===6});}return result;}
  try {
    while(pos<bytes.length){if(out.parts.length>=10000){out.complete=false;out.reason='part-limit';break;}var type=umpInt(),length=umpInt(),available=Math.min(length,bytes.length-pos),b=bytes.subarray(pos,pos+available);pos+=available;var item={type:type,bytes:length,observedBytes:available};out.parts.push(item);if(available!==length){item.omitted='partial-part';out.complete=false;out.reason='partial-part';break;}
      if(type===10){header=null;if(length>LIMIT){item.omitted='metadata-size-limit';continue;}try{var f=records(b),t=only(f,1,0);item.headerType=t?t.value:0;header=b;item.cryptoPresent=!!only(f,4,2);}catch(_){item.omitted='header-invalid';}}
      else if(type===11){if(!header){item.omitted='header-absent';continue;}if(length>LIMIT){item.omitted='metadata-size-limit';header=null;continue;}try{item.onesie=player(b,header);}catch(e){item.onesie={status:/^(config-absent|config-invalid|authentication-failed|crypto-params-absent|crypto-params-invalid|compression-unsupported|gzip-unavailable|gzip-invalid|player-size-limit|schema-mismatch|protobuf-truncated|unsupported-wire|invalid-field|field-limit|integer-range)$/.test(e.message)?e.message:'player-parse-failed'};}header=null;}
      else if([20,22,31,35,36,37,38,42,43,44,45,46,47,48,51,54,55,58,62,66,67,68,69,70,71,72].indexOf(type)>=0){if(length>LIMIT)item.omitted='metadata-size-limit';else {item.structure=structure(b);if(type===69)try{item.cues=cues(b);}catch(_){item.cueStatus='schema-unrecognized';}}}
      else item.omitted=type===21?'media-content':type===12?'encrypted-media':'unknown-or-sensitive-part';
    }
  }catch(_){out.complete=false;out.reason='ump-framing-invalid';}
  return out;
}

/**
 * 功能：在日志落盘前移除身份信息，只保留协议字段、长度和广告结构标记；未知正文不保存原文。
 * 更新时间：2026-10-04T14:45:25+08:00
 * @param {Object} payload 原始诊断事件。
 * @returns {Object} 可安全持久化的结构诊断事件。
 */
function ytDiagnosticSanitize(payload) {
  if (!payload) return payload;
  var markers = /(?:[a-z_]+\.eml-fe\|[0-9a-f]{16}|skip_ad_on_block|googleadservices\.com\/pagead\/|youtube\.com\/pagead\/|yt-ads-web-view-id|FEwhat_to_watch|FEsubscriptions|FEshorts)/g;
  /**
   * 功能：只提取用于广告分类的固定标记，模板哈希归零。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function labels(text) { return (String(text).match(markers) || []).map(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function (s) { return s.replace(/\|[0-9a-f]{16}$/, '|0000000000000000'); }); }
  /**
   * 功能：移除 URL 的全部查询参数和片段，阻止签名、令牌、IP 及账号标识写入。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function url(text) { var m=/^(https?:\/\/[^/?#]+)(\/[^?#]*)?/.exec(String(text||''));return m?m[1]+(m[2]||'/'):'[removed]'; }
  /**
   * 功能：仅保留 MIME、压缩方式和长度等无身份信息的传输头。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function headers(value) { var out={};Object.keys(value||{}).forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){var text=String(value[k]);if(/^(content-type|content-length|content-encoding|accept-encoding)$/i.test(k)&&/^[a-z0-9\s/.,;+_=\-]{0,160}$/i.test(text)||/^transfer-encoding$/i.test(k)&&/^(?:chunked|gzip|deflate|br|identity)(?:,\s*(?:chunked|gzip|deflate|br|identity))*$/i.test(text)||/^accept-ranges$/i.test(k)&&/^(?:bytes|none)$/i.test(text)||/^content-range$/i.test(k)&&/^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/.test(text))out[k]=text;});return out; }
  /**
   * 功能：读取 Base64 到临时内存；原始字节不会写入日志。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function decode(text) { var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[],v=0,bits=0;for(var i=0;i<text.length&&text[i]!=='=';i++){var n=alphabet.indexOf(text[i]);if(n<0)throw Error('base64');v=(v<<6)|n;bits+=6;if(bits>=8){bits-=8;out.push((v>>>bits)&255);}}return new Uint8Array(out); }
  var fields=0;
  /**
   * 功能：导出 Protobuf 字段树；仅保存字段号、线型、长度、布尔值和固定广告标记。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function proto(b,depth) {
    if(depth>32||fields>30000)return {bytes:b.length,omitted:true};
    var i=0,out=[];
    /**
     * 功能：读取结构分析使用的变长整数，限制最大编码长度。
     * 更新时间：2026-10-04T14:45:25+08:00
     */
    function integer(){var n=0,f=1;for(var c=0;c<10&&i<b.length;c++){var x=b[i++];n+=(x&127)*f;if(x<128)return n;f*=128;}throw Error('varint');}
    while(i<b.length){if(++fields>30000)throw Error('limit');var tag=integer(),no=Math.floor(tag/8),wire=tag%8;if(!no)throw Error('tag');var item={field:no,wire:wire};
      if(wire===0){var n=integer();item.value=n===0||n===1?n:'[removed]';}
      else if(wire===1||wire===5){var size=wire===1?8:4;i+=size;item.bytes=size;}
      else if(wire===2){var len=integer();if(!Number.isSafeInteger(len)||len<0||len>b.length-i)throw Error('length');var child=b.subarray(i,i+len);i+=len;item.bytes=len;try{item.fields=proto(child,depth+1);}catch(_){var text='';for(var j=0;j<child.length;j++)text+=child[j]>=32&&child[j]<127?String.fromCharCode(child[j]):' ';item.markers=labels(text);}}
      else throw Error('wire');if(i>b.length)throw Error('truncated');out.push(item);
    }return out;
  }
  /**
   * 功能：导出 JSON 结构，清除字符串内容及非布尔数值，并过滤身份键名。
   * 更新时间：2026-10-04T14:45:25+08:00
   */
  function json(value,depth){if(depth>32)return '[omitted]';if(typeof value==='string')return {chars:value.length,markers:labels(value)};if(typeof value==='number')return value===0||value===1?value:'[removed]';if(Array.isArray(value))return value.map(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(v){return json(v,depth+1);});if(value&&typeof value==='object'){var out={};Object.keys(value).forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){if(!/token|cookie|auth|visitor|account|signature|clientkey|encryptkey|trackingparams|clicktracking/i.test(k)&&/^[a-zA-Z_][a-zA-Z0-9_]{0,80}$/.test(k))out[k]=json(value[k],depth+1);});return out;}return value;}
  /**
   * 功能：将临时 API 正文字节转换为脱敏 JSON 或 Protobuf 结构；无法解析时不回退到原文。
   * 更新时间：2026-10-05T12:34:24+08:00
   */
  function apiStructure(b){try{var text=typeof TextDecoder==='function'&&(b[0]===123||b[0]===91)?new TextDecoder('utf-8',{fatal:true}).decode(b):null;return text?json(JSON.parse(text),0):proto(b,0);}catch(_){return {bytes:b.length,omitted:true};}}
  /**
   * 功能：将可用 API 正文及已认证的内层播放器请求转换为脱敏字段树；配置密钥和媒体正文不保存。
   * 更新时间：2026-10-05T12:09:41+08:00
   */
  function body(v,request,inner){if(!v||v.reference||!v.available)return v;var out={available:false,reason:'privacy-structure-only',bytes:v.bytes,redacted:true};if(!inner&&/^(config|log_event)$/.test(payload.endpoint))return out;if(!inner&&/^(initplayback|ump)$/.test(payload.endpoint)){if(request)return out;try{var bytes=v.memoryBytes instanceof Uint8Array?v.memoryBytes:v.encoding==='base64'?decode(v.data):null;if(bytes)out.structure=ytDiagnosticUMPStructure(bytes,apiStructure);else out.reason='unsupported-ump-body';}catch(_){out.reason='ump-analysis-failed';}return out;}try{var b=v.encoding==='base64'?decode(v.data):null;if(b){try{var text=typeof TextDecoder==='function'&&(b[0]===123||b[0]===91)?new TextDecoder('utf-8',{fatal:true}).decode(b):null;out.structure=text?json(JSON.parse(text),0):proto(b,0);}catch(_){out.structure={bytes:b.length,omitted:true};}}else out.structure=json(JSON.parse(v.data),0);}catch(_){out.structure={omitted:true};}return out;}
  ['request','requestAfter','requestInner','requestInnerAfter','responseBefore','responseAfter'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(key){var v=payload[key];if(!v)return;var out={};['status','method','synthetic','changed','transportHeadersRecomputedByLoon'].forEach(/**
 * 功能：筛选或转换脱敏诊断字段，不复制身份信息。
 * 更新时间：2026-10-04T14:45:25+08:00
 */
function(k){if(v[k]!==undefined)out[k]=v[k];});if(v.url)out.url=url(v.url);if(v.headers)out.headers=headers(v.headers);if(v.headerOverrides)out.headerOverrides=headers(v.headerOverrides);out.body=body(v.body,key==='request'||key==='requestAfter',key==='requestInner'||key==='requestInnerAfter');payload[key]=out;});
  if(payload.processing&&payload.processing.exception)payload.processing.exception={code:'processing-failed'};
  payload.privacy='structure-only-v1';return payload;
}






/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
(function () {
  "use strict";
  var CONFIG = "ytads.logger.config.v1";
  var CACHE = "ytads.logger.entries.v2";
  var ACTIVE_SOURCES = ["YouTubeFeed", "YouTubePlayback", "YouTubeConfig", "YouTubeLogger"];
  var LEGACY_SOURCES = ["YouTubePlayerRequest", "YouTubePlaybackAds", "YouTubeStreamAds", "YouTubeFeedAds", "YouTubeShortsAds", "YouTubeAdBreak", "YouTubeOnesieConfig", "YouTubeInitPlayback"];
  var SOURCES = ACTIVE_SOURCES.concat(LEGACY_SOURCES);
  var BASE = "http://youtube-logs.invalid/";
  var VERSION = "2.9.0";
  var LIMIT = 600;
  var API_CAPTURE = /^https:\/\/(?:youtubei(?:-att)?\.googleapis\.com|(?:www\.|m\.|music\.)?youtube\.com)\/youtubei\/v1\/(player|get_watch|browse|next|search|reel\/reel_watch_sequence|log_event|config)(?:\?[^#]*)?$/i;
  var MEDIA_CAPTURE = /^https:\/\/[\w-]+\.googlevideo\.com\/(videoplayback|initplayback)(?:\?[^#]*)?$/i;
  var args = typeof $argument === "object" && $argument ? $argument : {};
  args.log_level=String(args.log_level||"info").toLowerCase();
  if (typeof args.capture_raw === "undefined") args.capture_raw = args.log_enabled;
  var ranks = {debug:0, info:1, warn:2, error:3};
  var minimum = Object.prototype.hasOwnProperty.call(ranks, args.log_level) ? args.log_level : "info";

  var devMessages = [];
  var devException = null;
  /**
   * 功能：保存运行异常的结构化信息，供完整日志导出。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFailure(error) {
    if (!devFlag(args.capture_raw)) return;
    try { devException = {name:String(error.name || "Error"), message:String(error.message || ""), stack:typeof error.stack === "string" ? error.stack : null, code:error.ytNoAdsCode || null}; } catch (_) {}
  }
  var devStarted = Date.now();

  /**
   * 功能：判断开发日志参数是否明确开启。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devFlag(value) { return value === true || value === "true"; }
  /**
   * 功能：读取并校验当前日志记录会话配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devConfig() {
    if (!devFlag(args.log_enabled) || typeof $persistentStore === "undefined") return null;
    var raw = $persistentStore.read("ytads.logger.config.v1");
    var c = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    return c && c.enabled === true && typeof c.session === "string" && /^[a-z0-9-]{1,80}$/.test(c.session) ? c : null;
  }
  /**
   * 功能：计算字符串序列化为 UTF-8 后的字节数。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devUTF8Size(text) {
    var size = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  /**
   * 功能：把二进制数据编码为 Base64 文本。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devBase64(bytes) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var parts = [], text = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      text += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
      if (text.length >= 32768) { parts.push(text); text = ""; }
    }
    parts.push(text);
    return parts.join("");
  }
  /**
   * 功能：把运行时正文转换为可导出的文本或二进制结构。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devBody(body) {
    if (body === undefined || body === null) return {available:false, reason:"not-provided-by-runtime"};
    if (typeof body === "string") {
      var size = devUTF8Size(body);
      if (size > 8388608) throw new Error("capture-body-limit");
      return {available:true, encoding:"utf8-text", bytes:size, data:body};
    }
    var bytes;
    if (body instanceof Uint8Array) bytes = body;
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else if (ArrayBuffer.isView(body)) bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    else return {available:false, reason:"unsupported-runtime-body-type"};
    if (bytes.length > 8388608) throw new Error("capture-body-limit");
    return {available:true, encoding:"base64", bytes:bytes.length, data:devBase64(bytes)};
  }
  /**
   * 功能：将已缓冲的 UMP 正文交给写入前脱敏器，避免 Base64 复制；原始字节不会序列化。
   * 更新时间：2026-10-05T13:06:10+08:00
   */
  function devMediaBody(body,headers){if(body===undefined||body===null)return {available:false,reason:'not-provided-by-runtime'};var mime=String(headers&&(headers['Content-Type']||headers['content-type'])||'');if(!/^application\/vnd\.yt-ump(?:\s*;|$)/i.test(mime))return {available:false,reason:'unexpected-content-type'};var bytes=body instanceof Uint8Array?body:body instanceof ArrayBuffer?new Uint8Array(body):ArrayBuffer.isView(body)?new Uint8Array(body.buffer,body.byteOffset,body.byteLength):null;if(!bytes)return {available:false,reason:'unsupported-runtime-body-type'};return {available:true,bytes:bytes.length,memoryBytes:bytes};}

  /**
   * 功能：在日志容量或存储异常时暂停继续写入。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devHalt(c, reason) {
    if (c) {
      var latest = JSON.parse($persistentStore.read("ytads.logger.config.v1") || "null");
      if (!latest || !latest.enabled || latest.session !== c.session) return;
      c.enabled = false;
      c.haltReason = reason;
      c.haltedAt = new Date().toISOString();
      $persistentStore.write(JSON.stringify(c), "ytads.logger.config.v1");
    }
    if (typeof console !== "undefined") console.log("[YouTubeLogger] recording-stopped: " + reason);
  }
  /**
   * 功能：把摘要与原始样本追加到统一日志缓存。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devAppend(entry, payload) {
    var written = [], c = null;
    try {
      c = devConfig();
      if (!c) return false;
      if (!ytDiagnosticShouldRecord(entry,payload,args.log_level)) return true;
      ytDiagnosticPurgeLegacy();
      var raw = $persistentStore.read("ytads.logger.entries.v2");
      if (raw && devUTF8Size(raw) > 131072) throw new Error("log-index-invalid");
      var old = raw ? JSON.parse(raw) : null;
      var state = old && old.session === c.session && Array.isArray(old.entries) ? old : {session:c.session, entries:[], captureBytes:0};
      if (state.entries.length >= 600) { devHalt(c, "entry-limit"); return false; }
      var serialized = payload ? JSON.stringify(ytDiagnosticSanitize(payload)) : null;
      if (serialized && serialized.length > 33554432) { devHalt(c, "capture-event-limit"); return false; }
      var used = state.captureBytes || 0;
      var budget = [16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) * 1048576 : 33554432;
      var size = serialized ? devUTF8Size(serialized) : 0;
      if (used + size > budget) { devHalt(c, "capture-budget-limit"); return false; }
      var chunks = [];
      if (serialized) {
        for (var start = 0; start < serialized.length;) {
          var end = Math.min(start + 131072, serialized.length);
          if (end < serialized.length && serialized.charCodeAt(end - 1) >= 55296 && serialized.charCodeAt(end - 1) <= 56319 && serialized.charCodeAt(end) >= 56320 && serialized.charCodeAt(end) <= 57343) end--;
          chunks.push(serialized.slice(start, end));
          start = end;
        }
        if (chunks.length > 256) { devHalt(c, "capture-event-limit"); return false; }
        var prefix = "ytads.capture." + c.session + "." + payload.id + ".";
        entry.captureRef = {prefix:prefix, chunks:chunks.length, chars:serialized.length, storedBytes:size, checksum:devChecksum(serialized)};
      }
      var next = {session:c.session, entries:state.entries.concat([entry]), captureBytes:used + size};
      var index = JSON.stringify(next);
      if (devUTF8Size(index) > 131072) { devHalt(c, "log-index-limit"); return false; }
      if (serialized) {
        for (var i = 0; i < entry.captureRef.chunks; i++) {
          var key = entry.captureRef.prefix + i;
          if ($persistentStore.write(chunks[i], key) !== true) throw new Error("capture-write-failed");
          written.push(key);
        }
      }
      if (ytDiagnosticCommitEntry(next, budget) !== true) throw new Error("log-index-write-failed");
      return true;
    } catch (_) {
      written.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { try { $persistentStore.write(undefined, key); } catch (_) {} });
      try { devHalt(c, "storage-or-serialization-failed"); } catch (_) {}
      return false;
    }
  }
  /**
   * 功能：计算日志分块的一致性校验值。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devChecksum(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }
  /**
   * 功能：生成请求与响应之间的本地关联标识。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function devCorrelation(method, url) {

    return devChecksum(method + " " + url);
  }
  /**
   * 功能：记录脱敏诊断样本；仅响应头模式不读取请求或媒体正文。
   * 更新时间：2026-10-04T15:35:00+08:00
   */
  function devCapture(source, phase, endpoint, version, output, headersOnly) {
    if (!devFlag(args.capture_raw)) return;
    var c = null;
    try {
      c = devConfig();
      if (!c || typeof $request === "undefined") return;
      var now = new Date().toISOString();
      var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
      var request = {url:$request.url, method:$request.method || "GET", headers:$request.headers || {}, h2_trailers:$request.h2_trailers || {}, body:headersOnly || /^(initplayback|ump)$/.test(endpoint) ? {available:false,reason:"request-not-buffered"} : devBody($request.body)};
      var payload = {schema:1, id:id, time:now, source:source, version:version, phase:phase, endpoint:endpoint,
        runtime:typeof $loon === "string" ? $loon : null,
        correlation:{urlMethodHash:devCorrelation(request.method, request.url), exactPairing:false},
        request:request,
        processing:{exception:devException, executionScript:phase === "request" ? "YouTubeLogger" : source, bodyBuffering:!headersOnly, elapsedMs:Date.now() - devStarted, messages:devMessages.slice(),
          arguments:{development_capture:devFlag(args.capture_raw), background_playback:devFlag(args.background_playback), log_level:args.log_level || "info"}}};
      if (phase === "response" && typeof $response !== "undefined") {
        payload.responseBefore = {status:$response.status, headers:$response.headers || {}, h2_trailers:$response.h2_trailers || {}, body:headersOnly ? {available:false,reason:"headers-only-not-buffered"} : /^(initplayback|ump)$/.test(endpoint)?devMediaBody($response.body,$response.headers):devBody($response.body)};
        var changed = output && Object.prototype.hasOwnProperty.call(output, "body");
        payload.responseAfter = {changed:!!changed, status:output && output.status !== undefined ? output.status : $response.status,
          headerOverrides:output && output.headers || null, transportHeadersRecomputedByLoon:true,
          body:changed ? devBody(output.body) : {reference:"responseBefore.body"}};
      }
      var level="debug";
      if(phase==="response"&&/^(initplayback|ump)$/.test(endpoint)){
        payload=ytDiagnosticSanitize(payload);
        var sample=payload.responseBefore.body.structure,issues=[];
        if(sample&&sample.parts)for(var i=0;i<sample.parts.length;i++){var result=sample.parts[i].onesie;if(result&&result.status&&!/^(authenticated|clear|non-player-onesie|config-absent)$/.test(result.status))issues.push(result.status);}
        if(issues.length){level="error";payload.processing.samplingErrors=issues;}
      }
      devAppend({source:source, version:version, endpoint:endpoint, level:level, time:now, phase:phase,
        message:"development capture: " + phase + (payload.responseAfter ? " changed=" + payload.responseAfter.changed : "")}, payload);
    } catch (error) {
      try { devHalt(c, error.message === "capture-body-limit" ? "capture-body-limit" : "capture-serialization-failed"); } catch (_) {}
    }
  }

  /**
   * 功能：从 Loon 持久化存储安全读取数据。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function read(key) {
    var raw = $persistentStore.read(key);
    if (!raw) return null;
    if (typeof raw !== "string" || raw.length > 131072) throw new Error("invalid-store");
    return JSON.parse(raw);
  }
  /**
   * 功能：读取当前日志工具配置。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function config() {
    var c = read(CONFIG);
    if (!c || typeof c.session !== "string" || !/^[a-z0-9-]{1,80}$/.test(c.session)) return null;
    return c;
  }
  /**
   * 功能：向 Loon 持久化存储安全写入数据。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function write(value, key) {
    if ($persistentStore.write(JSON.stringify(value), key) !== true) throw new Error("write-failed");
  }
  /**
   * 功能：执行 shared 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function shared(c) {
    ytDiagnosticPurgeLegacy();
    var state = read(CACHE);
    if (state) return state;

    var entries = [];
    SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) {
      var old = read("ytads.logger." + source + ".v1");
      if (!old || old.session !== c.session || !Array.isArray(old.entries)) return;
      old.entries.slice(-300).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
        if (!r || typeof r.message !== "string") return;
        var level = r.message.indexOf("changed:") === 0 ? "info" :
          r.message === "pass: parse/schema check failed" ? "error" :
          /^(pass: (removed=|mode=|non-UMP))/.test(r.message) ? "debug" : "warn";
        entries.push({source:source, level:level, time:r.time, version:r.version, endpoint:r.endpoint, message:r.message});
      });
    });
    entries.sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a,b) { return String(a.time).localeCompare(String(b.time)); });
    var serialized = JSON.stringify({session:c.session, entries:entries.slice(-LIMIT), captureBytes:0});
    if (devUTF8Size(serialized) > 131072) {
      devHalt(c, "legacy-migration-limit");

      return {session:c.session, entries:entries, captureBytes:0, migrationDeferred:true};
    }
    if ($persistentStore.write(serialized, CACHE) !== true) throw new Error("write-failed");
    SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
    return JSON.parse(serialized);
  }
  /**
   * 功能：执行 records 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function records(c) {
    var rows = [];
    if (!c) return rows;
    var state = shared(c);
    if (!state || state.session !== c.session || !Array.isArray(state.entries)) return rows;
    state.entries.slice(-LIMIT).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {

        if (!r || SOURCES.indexOf(r.source) === -1 || !Object.prototype.hasOwnProperty.call(ranks, r.level) || typeof r.time !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.time) ||
            typeof r.version !== "string" || !/^\d+\.\d+\.\d+$/.test(r.version) ||
            !/^(player|get_watch|browse|next|search|reel_watch_sequence|log_event|config|initplayback|ad_break|ump|unknown)$/.test(r.endpoint) ||
            typeof r.message !== "string" || r.message.length > 600 || /[\r\n<>]/.test(r.message)) return;
        var row = { time:r.time, source:r.source, level:r.level, version:r.version, endpoint:r.endpoint, message:r.message };
        // 功能：仅导出明确的非负耗时数值，旧记录缺失时不填占位 0，不复制任意索引字段。
        // 更新时间：2026-10-05；时间不包含网络等待或最后的索引提交。
        if (r.timing && typeof r.timing === "object") {
          var timing = {}, timingKeys = ["capturePrepareMs","sampleWriteMs","scriptBeforeIndexCommitMs"];
          for (var t = 0; t < timingKeys.length; t++) {
            var timingValue = r.timing[timingKeys[t]];
            if (typeof timingValue === "number" && Number.isFinite(timingValue) && timingValue >= 0 && timingValue <= 600000) timing[timingKeys[t]] = timingValue;
          }
          if (Object.keys(timing).length) row.timing = timing;
        }
        if (r.captureRef && typeof r.captureRef.prefix === "string" &&
            /^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(r.captureRef.prefix) &&
            r.captureRef.prefix.indexOf("ytads.capture." + c.session + ".") === 0 &&
            Number.isInteger(r.captureRef.chunks) && r.captureRef.chunks > 0 && r.captureRef.chunks <= 256 &&
            Number.isInteger(r.captureRef.chars) && r.captureRef.chars > 0 && r.captureRef.chars <= 33554432) {
          row.captureRef = r.captureRef;
          row.phase = r.phase;
        } else if (r.captureRef) row.captureError = "invalid-capture-reference";
        rows.push(row);
    });
    rows.sort(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    return rows;
  }
  /**
   * 功能：构造日志页面使用的本地 HTTP 响应。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function response(status, body, type, extra) {
    var headers = {"Content-Type":type || "text/html; charset=utf-8", "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
    Object.keys(extra || {}).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (key) { headers[key] = extra[key]; });
    return {response:{status:status, headers:headers, body:body}};
  }
  /**
   * 功能：执行 developmentExport 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function developmentExport(c, rows) {
    var issues = [];
    var events = rows.map(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (row) {
      var event = {summary:row, capture:null};
      if (!row.captureRef) {
        if (row.captureError) { event.captureError = row.captureError; issues.push({time:row.time, source:row.source, reason:row.captureError}); }
        return event;
      }
      try {
        var parts = [];
        for (var i = 0; i < row.captureRef.chunks; i++) {
          var part = $persistentStore.read(row.captureRef.prefix + i);
          if (typeof part !== "string" || part.length > 131072) throw new Error("missing-or-invalid-chunk");
          parts.push(part);
        }
        var text = parts.join("");
        if (text.length !== row.captureRef.chars) throw new Error("capture-length-mismatch");
        if (devChecksum(text) !== row.captureRef.checksum) throw new Error("capture-checksum-mismatch");
        var capture = JSON.parse(text);
        if (capture.schema !== 1 || capture.source !== row.source || capture.time !== row.time || capture.phase !== row.phase) throw new Error("capture-metadata-mismatch");
        event.capture = capture;
      } catch (_) {
        event.captureError = "capture-unavailable-or-corrupt";
        issues.push({time:row.time, source:row.source, reason:event.captureError});
      }
      return event;
    });
    return {schema:1, exportedAt:new Date().toISOString(), session:c && c.session || null,
      recording:!!(c && c.enabled), stoppedReason:c && c.haltReason || null, coverage:coverage(rows),
      settings:{rawCapture:devFlag(args.capture_raw), summaryMinimumLevel:minimum, budgetMB:[16,32,64].indexOf(Number(args.capture_budget)) >= 0 ? Number(args.capture_budget) : 32},
      completeness:{allReferencedSamplesReadable:issues.length === 0, stoppedDueToLimitOrError:!!(c && c.haltReason), issues:issues,
        limitations:["Only matched player/get_watch/browse/next/search/reel_watch_sequence/log_event/config/initplayback/player/ad_break and enabled UMP response scripts; not all YouTube traffic.",
          "Media logging records headers only and does not buffer media bodies.",
          "Runtime bodies may already be decoded; these are not TLS/HTTP wire bytes.",
          "Missing runtime bodies are marked unavailable; before/after transport headers are not reconstructed.",
          "URL/method hashes are grouping hints, not guaranteed request/response pairs.",
          "Index is refreshed after sample writes; Loon has no atomic append, so simultaneous final commits may still lose entries.",
          "Script timeouts, TLS failures and requests bypassing MitM are not observed."]}, events:events};
  }
  /**
   * 功能：执行 exportPage 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function exportPage() {


    var script = '(' + browserExport.toString() + ')();';
    return response(200, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 导出</title><p id="status">正在读取本地记录，请保持 Loon 开启…</p><a id="save" hidden>保存日志文件</a><p>文件生成后点击保存；Safari 也可通过分享菜单存储到“文件”。</p><script>' + script + '</script></html>', "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
  }
  /**
   * 功能：在日志页面中读取分块并生成单个完整日志文件。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  async function browserExport(event) {
    var status = document.getElementById("status"), save = document.getElementById("save"), download = document.getElementById("download");
    if(download&&download.disabled)return;
    if(download)download.disabled=true;
    try {
      if(event) {
        if(event.preventDefault)event.preventDefault();
        var pause=await fetch("/pause",{method:"POST",cache:"no-store"});
        if(!pause.ok)throw new Error("暂停失败，请检查 Loon 是否运行。");
      }
      status.textContent="正在生成日志文件，请保持 Loon 开启…";
      /**
       * 功能：执行 get 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      async function get(path) {
        var r = await fetch(path, {cache:"no-store"});
        if (!r.ok) throw new Error("本地读取失败（" + r.status + "），请暂停记录后重新导出。");
        return await r.json();
      }
      /**
       * 功能：执行 checksum 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function checksum(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619);}
        return "fnv1a32-utf16:" + ("00000000" + (hash >>> 0).toString(16)).slice(-8);
      }
      /**
       * 功能：执行 value 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function value(v) { if (v === null) return "null"; if (v === undefined) return "unavailable"; return typeof v === "string" ? v.replace(/\r/g,"\\r").replace(/\n/g,"\\n") : String(v); }
      /**
       * 功能：执行 structure 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function structure(label, v, lines, depth) {
        var indent = new Array(depth + 1).join("  ");
        if (v === null || v === undefined || typeof v !== "object") { lines.push(indent + label + ": " + value(v)); return; }
        if (Array.isArray(v)) { lines.push(indent + label + ": array(" + v.length + ")"); for (var i=0;i<v.length;i++) structure("["+i+"]",v[i],lines,depth+1); return; }
        var keys=Object.keys(v).sort(); lines.push(indent+label+": object("+keys.length+")");
        for(var k=0;k<keys.length;k++) structure(keys[k],v[keys[k]],lines,depth+1);
      }
      /**
       * 功能：执行 body 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function body(label,v,lines) {
        lines.push(label+":");
        if(v&&v.reference){lines.push("  Reference: "+value(v.reference));return;}
        if(!v||v.available!==true){lines.push("  Available: false");lines.push("  Reason: "+value(v&&v.reason));if(v&&v.bytes!==undefined)lines.push("  Bytes: "+value(v.bytes));if(v&&v.structure)structure("Structure",v.structure,lines,1);return;}
        lines.push("  Available: true");lines.push("  Encoding: "+value(v.encoding));lines.push("  Bytes: "+value(v.bytes));
        if(Object.prototype.hasOwnProperty.call(v,"data")){var encoding=v.encoding==="base64"?"BASE64":"UTF-8 TEXT";lines.push("  ----- BEGIN "+encoding+" -----");lines.push(String(v.data));lines.push("  ----- END "+encoding+" -----");}
      }
      /**
       * 功能：执行 exchange 对应的内部处理步骤。
       * 更新时间：2026-10-04T08:54:22+08:00
       */
      function exchange(label,v,lines){
        lines.push(label+":");if(!v){lines.push("  unavailable");return;}
        var names=["url","method","status","synthetic","changed","transportHeadersRecomputedByLoon"];
        for(var i=0;i<names.length;i++)if(Object.prototype.hasOwnProperty.call(v,names[i]))lines.push("  "+names[i]+": "+value(v[names[i]]));
        if(Object.prototype.hasOwnProperty.call(v,"headers"))structure("headers",v.headers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"h2_trailers"))structure("h2_trailers",v.h2_trailers,lines,1);
        if(Object.prototype.hasOwnProperty.call(v,"body"))body("  body",v.body,lines);
      }
      /**
       * 功能：生成单条日志正文，按需包含采样计时，不将缺失耗时当作零。
       * 更新时间：2026-10-05
       */
      function eventText(index,row,capture,captureError){
        var lines=["","================================================================================","EVENT "+(index+1),"================================================================================","Time: "+row.time,"Level: "+String(row.level).toUpperCase(),"Source: "+row.source,"Version: "+row.version,"Endpoint: "+row.endpoint,"Phase: "+value(row.phase),"Summary: "+row.message];
        if(row.timing)structure("Capture-Timing-Ms",row.timing,lines,0);
        if(captureError)lines.push("Capture-Error: "+captureError);if(!capture){lines.push("Capture: unavailable");return lines.join("\n")+"\n";}
        lines.push("Runtime: "+value(capture.runtime));structure("Correlation",capture.correlation,lines,0);structure("Processing",capture.processing,lines,0);
        exchange("Request-Inner-Before",capture.requestInner,lines);exchange("Request-Inner-After",capture.requestInnerAfter,lines);exchange("Request-Before",capture.request,lines);exchange("Request-After",capture.requestAfter,lines);exchange("Response-Before",capture.responseBefore,lines);exchange("Response-After",capture.responseAfter,lines);
        return lines.join("\n")+"\n";
      }
      var manifest = await get("/export-manifest.json");
      var rows = manifest.rows, data = manifest.data, parts = [], issues = [];
      parts.push(["YouTube full diagnostic log","Format-Version: 2","Exported-UTC: "+data.exportedAt,"Session: "+value(data.session),"Recording: "+(data.recording?"on":"paused"),"Stopped-Reason: "+value(data.stoppedReason),"Entries: "+rows.length,"Recorded-Endpoints: "+data.coverage.summary,"Playback-Initialization-Observed: "+data.coverage.hasPlaybackInitialization,"Initialization-Versions: "+data.coverage.initializationVersions.join(","),"Structure-Capture-Enabled: "+value(data.settings.rawCapture),"Summary-Minimum-Level: "+value(data.settings.summaryMinimumLevel),"Capture-Budget-MB: "+value(data.settings.budgetMB),"Scope: browse, refresh/config, player, initplayback, ad-break, Shorts and UMP media events matched by the plugin","Body-Storage: redacted protocol structure only","Privacy: credentials, query values, raw bodies, config keys, media content and unknown values are removed before storage","Completeness: best-effort Loon script capture; see LIMITATIONS at end",""].join("\n"));
      for (var n = 0; n < rows.length; n++) {
        var row = rows[n], capture = null, captureError = row.captureError || null;
        status.textContent = "正在读取记录 " + (n + 1) + " / " + rows.length;
        if (row.captureRef) {
          var ref = row.captureRef, chunks = [];
          for (var k = 0; k < ref.chunks; k++) {
            var piece = await get("/export-chunk/" + manifest.session + "/" + n + "/" + k);
            if (typeof piece.chunk !== "string") throw new Error("本地样本块无效，请重新导出。");
            chunks.push(piece.chunk);
          }
          var text = chunks.join("");
          if (text.length !== ref.chars || checksum(text) !== ref.checksum) throw new Error("样本校验失败，请保留已有记录并检查存储。");
          capture = JSON.parse(text);
          if (capture.schema !== 1 || capture.source !== row.source || capture.time !== row.time || capture.phase !== row.phase) throw new Error("样本元数据不匹配，请重新导出。");
        } else if (captureError) issues.push(row.time+" "+row.source+" "+captureError);
        parts.push(eventText(n,row,capture,captureError));
      }
      parts.push("\n================================================================================\nLIMITATIONS\n================================================================================\n");
      for(var q=0;q<data.completeness.limitations.length;q++)parts.push((q+1)+". "+data.completeness.limitations[q]+"\n");
      parts.push("All-Referenced-Samples-Readable: "+(issues.length===0)+"\n");for(q=0;q<issues.length;q++)parts.push("Issue: "+issues[q]+"\n");
      var blob = new Blob(parts, {type:"text/plain;charset=utf-8"});
      if(save.href&&save.href.indexOf("blob:")===0)URL.revokeObjectURL(save.href);
      save.href = URL.createObjectURL(blob);
      save.download = "YouTube-" + data.exportedAt.replace(/[:.]/g, "-") + ".log";
      save.hidden = false;
      status.textContent = "已生成日志文件（" + rows.length + " 条记录），正在下载；若 Safari 未弹出下载提示，可点击保存日志文件。";
      save.click();
    } catch (error) {
      status.textContent = error.message || "导出失败，请检查 Loon 是否运行。";
      save.hidden = true;
    } finally {
      if(download)download.disabled=false;
    }
  }
  /**
   * 功能：执行 exportRows 对应的内部处理步骤。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function exportRows(c) { return records(c); }
  /**
   * 功能：统计日志实际记录到的接口与初始化版本，避免把声明范围误认为完整链路。
   * 更新时间：2026-10-04T16:55:00+08:00
   * @param {Object[]} rows 当前会话的事件摘要。
   * @returns {Object} 接口计数、初始化观察状态和安全的版本列表。
   */
  function coverage(rows) {
    var names = ['browse','next','search','config','log_event','initplayback','player','get_watch','ad_break','reel_watch_sequence','ump'];
    var counts = {}, versions = [], parts = [], initialized = false;
    for (var i = 0; i < names.length; i++) counts[names[i]] = 0;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!Object.prototype.hasOwnProperty.call(counts, row.endpoint)) continue;
      counts[row.endpoint]++;
      if (/^(initplayback|player|get_watch)$/.test(row.endpoint)) {
        initialized = true;
        if (row.endpoint === "initplayback" && row.phase === "response" && row.source === "YouTubeLogger") continue;
        if (/^\d+\.\d+\.\d+$/.test(row.version) && versions.indexOf(row.version) < 0) versions.push(row.version);
      }
    }
    for (i = 0; i < names.length; i++) parts.push(names[i] + '=' + counts[names[i]]);
    return {counts:counts, summary:parts.join(' / '), hasPlaybackInitialization:initialized, initializationVersions:versions};
  }
  /**
   * 功能：生成本地日志管理页面。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function page(c, rows) {
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube 日志</title>' +
      '<style>body{font:17px system-ui;margin:32px auto;padding:0 24px;max-width:620px;line-height:1.7}button,a{font:inherit}button{margin:6px 0;padding:8px 16px}a{display:block;margin:22px 0}[hidden]{display:none!important}</style>' +
      '<h1>YouTube 日志</h1><p>状态：' + (c && c.enabled === true ? '正在记录' : '已暂停') + '；保留 ' + rows.length + ' 条。保存级别：' + minimum + '。</p>' +
      '<form method="post" action="/start"><button>开始记录（保留本次日志）</button></form>' +
      '<form method="post" action="/pause"><button>暂停记录</button></form>' +
      '<form method="post" action="/mark-ad"><button>标记：正在播放广告</button></form>' +
      '<form method="post" action="/mark-content"><button>标记：正在播放正片</button></form>' +
      '<button id="download" type="button">下载日志</button><p id="status" role="status"></p><a id="save" hidden>保存日志文件</a>' +
      '<p>开发抓包：' + (devFlag(args.capture_raw) ? '已开启，保存脱敏结构' : '未开启，只保存摘要') + '。' +
      (c && c.haltReason ? '记录已因容量或存储问题停止；请先导出，再清空重试。' : '') + '</p>' +
      '<p>下载后在 Safari 保存或通过分享菜单存储到“文件”。共用缓存最多 600 条或 128 KiB 索引，脱敏记录另按主插件所选容量保存。达到上限停止记录，保留旧记录。</p>' +
      '<p>日志工具在主插件手动开启，请先选择容量，再开始记录。开启日志工具时等待初始化和 UMP 完整响应，解析可用的播放器配置；暂停只停止写入，下载后应关闭主插件日志工具以停止缓冲。唯一的 .log 文件保存去除查询参数的接口地址、安全传输头、协议字段树、广告标记和处理结果；令牌、Cookie、账号标识、密钥与媒体正文在写入前移除。</p>' +
      '<p>在主插件选择日志保存级别：info 保存完整脱敏记录，包含浏览、刷新、播放及处理结果；error 只保存错误；debug 保存完整记录并保留调试级别；warn 只保存警告和错误。调整级别只影响新记录，旧记录仍保留。</p>' +
      '<p>下载日志会自动暂停记录，在当前页面生成一个 .log 并触发下载。完整记录指脚本实际捕获的脱敏数据，不保证覆盖所有网络请求；媒体正文不保存。日志无法读取 Loon 的连接、证书或脚本超时记录。</p>' +
      '<form method="post" action="/clear"><button>清空日志并暂停（不可恢复）</button></form><script>document.getElementById("download").onclick=' + browserExport.toString() + ';</script></html>';
  }
  /**
   * 功能：根据当前 Loon 请求或响应执行对应处理流程。
   * 更新时间：2026-10-04T08:54:22+08:00
   */
  function run() {
    if (args.log_enabled !== true && args.log_enabled !== "true") {
      if (typeof $request !== "undefined") {
        if (/^http:\/\/youtube-logs\.invalid(?::80)?(?:\/|$)/.test($request.url || "")) return response(403, "请先在主插件手动开启日志工具。", "text/plain; charset=utf-8");
        return {};
      }
      return {title:"YouTube 日志", content:"请先在主插件手动开启日志工具。"};
    }
    if (typeof $request !== "undefined") {
      var api = API_CAPTURE.exec($request.url || "");
      var media = MEDIA_CAPTURE.exec($request.url || "");
      if (api || media) {
        var apiName = api ? api[1].toLowerCase() : media[1].toLowerCase();
        var source = /^(browse|next|search)$/i.test(apiName) ? "YouTubeFeed" :
          /^(log_event|config|initplayback)$/i.test(apiName) ? "YouTubeConfig" : api || apiName === "videoplayback" ? "YouTubePlayback" : "YouTubeLogger";
        var endpoint = apiName === "reel/reel_watch_sequence" ? "reel_watch_sequence" : apiName === "videoplayback" ? "ump" : apiName;
        if (media) devMessages.push((apiName === "initplayback" ? "initialization_response" : "media") + (typeof $response !== "undefined" ? ": development_response=true body_buffering=true" : ": headers_only=true body_buffering=false"));
        if(media&&apiName === "initplayback"&&typeof $response !== "undefined")source="YouTubeLogger";
        devCapture(source, typeof $response !== "undefined" ? "response" : "request", endpoint, VERSION, {}, typeof $response === "undefined");
        return {};
      }
    }
    if (typeof $request === "undefined") {
      if (typeof $notification !== "undefined") $notification.post("YouTube 日志", "点击打开日志页面", "开始记录、暂停或下载 .log 文件", {openUrl:BASE});
      return {title:"YouTube 日志", content:"在浏览器打开 " + BASE + "，点击开始记录，复现后下载日志。"};
    }
    var match = /^http:\/\/youtube-logs\.invalid(?::80)?(\/[^?#]*)?(?:\?[^#]*)?$/.exec($request.url || "");
    if (!match) return {};
    var path = match[1] || "/";
    var method = String($request.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") return response(405, "Method not allowed", "text/plain; charset=utf-8", {Allow:"GET, POST"});
    var origin = $request.headers && ($request.headers.Origin || $request.headers.origin);
    if (method === "POST" && origin && origin !== "http://youtube-logs.invalid" && origin !== "http://youtube-logs.invalid:80") return response(403, "Foreign origin rejected", "text/plain; charset=utf-8");
    var c = path === "/clear" ? null : config();
    if (path === "/start" || path === "/pause" || path === "/clear" || path === "/mark-ad" || path === "/mark-content") {
      if (method !== "POST") return response(405, "Use the buttons on the log page.", "text/plain; charset=utf-8", {Allow:"POST"});
      if (path === "/mark-ad" || path === "/mark-content") {
        if (!c || c.enabled !== true) return response(409, "请先开始记录，再标记播放状态。", "text/plain; charset=utf-8");
        if (!devAppend({source:"YouTubeLogger", version:VERSION, endpoint:"unknown", time:new Date().toISOString(), level:"info", message:"user mark: " + (path === "/mark-ad" ? "ad-playing" : "content-playing")}, null)) return response(507, "标记未保存，请先导出记录并检查停止原因。", "text/plain; charset=utf-8");
        return response(303, "", "text/plain; charset=utf-8", {Location:BASE});
      }
      if (path === "/clear") {

        c = {enabled:false, session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        write(c, CONFIG);
        var previous = null;
        try { previous = read(CACHE); } catch (_) {}
        if (previous && Array.isArray(previous.entries)) previous.entries.slice(0, LIMIT).forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (r) {
          var ref = r && r.captureRef;
          if (!ref || typeof ref.prefix !== "string" || !/^ytads\.capture\.[a-z0-9-]+\.[a-z0-9-]+\.$/.test(ref.prefix) || !Number.isInteger(ref.chunks) || ref.chunks < 1 || ref.chunks > 256) return;
          for (var i = 0; i < ref.chunks; i++) $persistentStore.write(undefined, ref.prefix + i);
        });
        write({session:c.session, entries:[], captureBytes:0}, CACHE);
        SOURCES.forEach(
/**
 * 功能：封装局部作用域或执行当前回调步骤。
 * 更新时间：2026-10-04T08:54:22+08:00
 */
function (source) { $persistentStore.write(undefined, "ytads.logger." + source + ".v1"); });
      } else {
        if (!c) c = {session:Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)};
        c.enabled = path === "/start";
        if (c.enabled) { delete c.haltReason; delete c.haltedAt; }
        shared(c);
        write(c, CONFIG);
      }
      return response(303, "", "text/plain; charset=utf-8", {Location:BASE});
    }
    if (method !== "GET") return response(405, "Method not allowed", "text/plain; charset=utf-8", {Allow:"GET"});
    if (path === "/export") return exportPage();
    if (path === "/export-manifest.json") {
      if (c && c.enabled) return response(409, "请先在日志页面暂停记录，然后导出。", "text/plain; charset=utf-8");
      var manifestRows = exportRows(c);
      var manifestData = developmentExport(c, []);
      manifestData.coverage = coverage(manifestRows);
      return response(200, JSON.stringify({session:c && c.session || "none", rows:manifestRows, data:manifestData}), "application/json; charset=utf-8");
    }
    var chunkPath = /^\/export-chunk\/([a-z0-9-]{1,80})\/(\d{1,3})\/(\d{1,3})$/.exec(path);
    if (chunkPath) {
      if (!c || c.enabled || c.session !== chunkPath[1]) return response(409, "记录状态已变化，请暂停后重新导出。", "text/plain; charset=utf-8");
      var rowNumber = Number(chunkPath[2]), chunkNumber = Number(chunkPath[3]);
      var chunkRows = exportRows(c);
      var ref = chunkRows[rowNumber] && chunkRows[rowNumber].captureRef;
      if (!ref || chunkNumber >= ref.chunks) return response(404, "Sample not found", "text/plain; charset=utf-8");
      var chunk = $persistentStore.read(ref.prefix + chunkNumber);
      if (typeof chunk !== "string" || chunk.length > 131072) return response(503, "样本块丢失或损坏，未生成截断文件。", "text/plain; charset=utf-8");
      return response(200, JSON.stringify({chunk:chunk}), "application/json; charset=utf-8");
    }
    if (path !== "/" && path !== "/download.log") return response(404, "Not found", "text/plain; charset=utf-8");
    var rows = records(c);
    if (path === "/") return response(200, page(c, rows), "text/html; charset=utf-8", {"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});

    return response(303, "", "text/plain; charset=utf-8", {Location:BASE + "export"});
  }
  var output;
  try { output = run(); }
  catch (_) {
    if (typeof $request !== "undefined" && /^http:\/\/youtube-logs\.invalid(?::80)?(?:\/|$)/.test($request.url || "")) {
      output = response(503, "日志存储不可用，请检查脚本是否更新，或在 Loon 日志中查看存储错误。", "text/plain; charset=utf-8");
    } else output = {title:"YouTube 日志", content:"日志入口无法打开，请检查脚本。"};
  }
  $done(output);
})();
