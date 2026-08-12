"use strict";

  const { findByProps } = bunny.metro;
  const { instead } = bunny.api.patcher;
  const storage = bunny.plugin.createStorage();
  const React = bunny.metro.common.React;
  const RN = bunny.metro.common.ReactNative || {};
  const Toasts = bunny.ui?.toasts || bunny.api?.toasts || {};

  const OFFSET = 0x2800;
  const MAGIC = Uint8Array.from([0x53,0x44,0x43,0x32,0x47,0x43,0x4d,0x21]); // SDC2GCM!
  const MESSAGE_RE = /^([⠀-⣿]{16,}) `(?:SimpleDiscordCrypt|🔒)`(?:\r?\nhttps:\/\/(?:www\.)?klipy\.com\/gifs\/[^\s<>'"]+)*$/i;
  const ENC_RE = /^(?::?ENC(?:(?:_\w*)?:|\b)|<:ENC:\d{1,20}>)\s*/i;
  const NOENC_RE = /^(?::?NOENC:?|<:NOENC:\d{1,20}>)\s*/i;
  const SETKEY_RE = /^:SDCSET\s+(.+)$/i;
  const GENKEY_RE = /^:SDCGEN\s*$/i;
  const OFF_RE = /^:SDCOFF\s*$/i;
  const ON_RE = /^:SDCON\s*$/i;
  const STATUS_RE = /^:SDCSTATUS\s*$/i;

  let unpatchSend = null;
  let unpatchDispatch = null;
  let MessageActions = null;
  let Dispatcher = null;

  function toast(msg) {
    try { Toasts.showToast(msg, Toasts.getAssetIDByName?.("Check") ?? 0); }
    catch (_) { try { bunny.ui?.toasts?.showToast?.(msg); } catch (_) {} }
  }

  function ensureStorage() {
    if (!storage.keys) storage.keys = {};
    if (!storage.channels) storage.channels = {};
    if (storage.defaultEncrypt == null) storage.defaultEncrypt = true;
    if (storage.showMarker == null) storage.showMarker = true;
  }

  function concat(...arrays) {
    const total = arrays.reduce((n,a)=>n+a.length,0);
    const out = new Uint8Array(total);
    let p=0; for (const a of arrays) { out.set(a,p); p+=a.length; }
    return out;
  }
  function eqPrefix(a,b) { if (a.length < b.length) return false; for(let i=0;i<b.length;i++) if(a[i]!==b[i]) return false; return true; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function text(b) { return new TextDecoder().decode(b); }
  function b64(bytes) {
    let s=""; for(let i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return globalThis.btoa(s);
  }
  function fromB64(s) {
    s = String(s).trim().replace(/-/g,"+").replace(/_/g,"/");
    while (s.length % 4) s += "=";
    const raw=globalThis.atob(s); const out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
  }
  function hexToBytes(s) {
    s=String(s).trim().replace(/^0x/i,"").replace(/\s+/g,"");
    if(!/^[0-9a-f]{64}$/i.test(s)) throw new Error("La clé hex doit faire 64 caractères");
    return Uint8Array.from({length:32},(_,i)=>parseInt(s.slice(i*2,i*2+2),16));
  }
  function parseKey(s) {
    const t=String(s).trim();
    let k=/^(?:0x)?[0-9a-f]{64}$/i.test(t) ? hexToBytes(t) : fromB64(t);
    if(k.length!==32) throw new Error("La clé SDC doit faire 32 octets (256 bits)");
    return k;
  }
  function payloadEncode(bytes) {
    let out=""; for(let i=0;i<bytes.length;i+=4096) out += String.fromCharCode(...Array.from(bytes.subarray(i,i+4096),b=>b+OFFSET));
    return out;
  }
  function payloadDecode(str) { return Uint8Array.from(str,c=>c.charCodeAt(0)-OFFSET); }
  function randomBytes(n) {
    if (!globalThis.crypto?.getRandomValues) throw new Error("crypto.getRandomValues indisponible dans ce build Discord/Revenge");
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
  }
  async function sha512_16(bytes) {
    if(!globalThis.crypto?.subtle) throw new Error("WebCrypto indisponible dans ce build Discord/Revenge");
    return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-512", bytes)).slice(0,16);
  }
  async function importKey(raw) {
    if(!globalThis.crypto?.subtle) throw new Error("WebCrypto indisponible dans ce build Discord/Revenge");
    const gcm=await globalThis.crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);
    const cbc=await globalThis.crypto.subtle.importKey("raw",raw,"AES-CBC",false,["encrypt","decrypt"]);
    return {gcm,cbc};
  }
  async function encryptV2(rawKey, clear) {
    const {gcm}=await importKey(rawKey);
    const header=new Uint8Array(10); header.set(MAGIC); header[8]=1; header[9]=1;
    const nonce=randomBytes(12);
    const ct=new Uint8Array(await globalThis.crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:header,tagLength:128},gcm,clear));
    return concat(header,nonce,ct);
  }
  async function decryptAny(rawKey, enc) {
    const keys=await importKey(rawKey);
    const isV2=enc.length>=38 && eqPrefix(enc,MAGIC) && enc[9]===1;
    if(isV2) {
      const header=enc.slice(0,10);
      if(header[8]!==1) throw new Error("Purpose SDC non-message");
      const nonce=enc.slice(10,22), ct=enc.slice(22);
      return new Uint8Array(await globalThis.crypto.subtle.decrypt({name:"AES-GCM",iv:nonce,additionalData:header,tagLength:128},keys.gcm,ct));
    }
    if(enc.length<32) throw new Error("Enveloppe CBC invalide");
    const iv=enc.slice(0,16), ct=enc.slice(16);
    return new Uint8Array(await globalThis.crypto.subtle.decrypt({name:"AES-CBC",iv},keys.cbc,ct));
  }
  async function registerKey(raw) {
    const hash=await sha512_16(raw); const hash64=b64(hash);
    storage.keys[hash64]=b64(raw); return hash64;
  }
  async function setChannelKey(channelId, raw) {
    const hash64=await registerKey(raw);
    storage.channels[channelId]={ keyHash:hash64, enabled:true };
    return hash64;
  }
  function channelConfig(id) { return storage.channels?.[id] || null; }
  function getRawByHash(hash64) { const v=storage.keys?.[hash64]; return v ? fromB64(v) : null; }

  async function encryptMessage(channelId, content) {
    const cfg=channelConfig(channelId); if(!cfg?.keyHash) throw new Error("Aucune clé SDC pour ce salon");
    const raw=getRawByHash(cfg.keyHash); if(!raw) throw new Error("Clé SDC introuvable");
    const keyHash=await sha512_16(raw);
    const enc=await encryptV2(raw,utf8(content)); // Android MVP: pas de compression canvas/PNG
    return payloadEncode(concat(keyHash,enc)) + " `🔒`";
  }

  async function decryptMessageObject(message) {
    if(!message || typeof message.content!=="string") return false;
    const m=MESSAGE_RE.exec(message.content); if(!m) return false;
    try {
      const payload=payloadDecode(m[1]);
      if(payload.length<16) return false;
      const hash64=b64(payload.slice(0,16));
      const raw=getRawByHash(hash64);
      if(!raw) { message.content="🔒 [SDC] Message chiffré — clé inconnue"; return true; }
      if(payload.length===16) { message.content="🔒 [SDC]"; return true; }
      const clear=await decryptAny(raw,payload.slice(16));
      message.content=(storage.showMarker ? "🔒 " : "") + text(clear);
      return true;
    } catch(e) {
      message.content="⚠️ [SDC] Message chiffré invalide ou format compressé non pris en charge";
      return true;
    }
  }

  async function handleOutgoing(args, original) {
    const channelId=String(args?.[0] ?? "");
    const message=args?.[1];
    if(!message || typeof message.content!=="string") return original(...args);
    let content=message.content;

    let m=SETKEY_RE.exec(content);
    if(m) {
      try { await setChannelKey(channelId,parseKey(m[1])); toast("Clé SDC enregistrée pour ce salon"); }
      catch(e) { toast("SDC: "+(e?.message||e)); }
      return Promise.resolve(undefined);
    }
    if(GENKEY_RE.test(content)) {
      try {
        const raw=randomBytes(32); await setChannelKey(channelId,raw);
        storage.lastGeneratedKey=b64(raw);
        toast("Clé SDC générée. Ouvre les réglages du plugin pour la copier.");
      } catch(e) { toast("SDC: "+(e?.message||e)); }
      return Promise.resolve(undefined);
    }
    if(OFF_RE.test(content)) { if(storage.channels[channelId]) storage.channels[channelId].enabled=false; toast("SDC désactivé dans ce salon"); return Promise.resolve(undefined); }
    if(ON_RE.test(content)) { if(storage.channels[channelId]) storage.channels[channelId].enabled=true; toast("SDC activé dans ce salon"); return Promise.resolve(undefined); }
    if(STATUS_RE.test(content)) { const c=channelConfig(channelId); toast(c?.keyHash ? `SDC: ${c.enabled!==false?"actif":"inactif"}, clé ${c.keyHash.slice(0,8)}…` : "SDC: aucune clé pour ce salon"); return Promise.resolve(undefined); }

    if(NOENC_RE.test(content)) { message.content=content.replace(NOENC_RE,""); return original(...args); }
    const forced=ENC_RE.test(content); if(forced) content=content.replace(ENC_RE,"");
    const cfg=channelConfig(channelId);
    if(!forced && (!cfg?.keyHash || cfg.enabled===false || storage.defaultEncrypt===false)) return original(...args);
    try { message.content=await encryptMessage(channelId,content); }
    catch(e) { toast("SDC: "+(e?.message||e)); return original(...args); }
    return original(...args);
  }

  async function handleDispatch(args, original) {
    try {
      const ev=args?.[0];
      if(ev && (ev.type==="MESSAGE_CREATE" || ev.type==="MESSAGE_UPDATE") && ev.message) await decryptMessageObject(ev.message);
    } catch(_) {}
    return original(...args);
  }

  function Settings() {
    ensureStorage();
    const View=RN.View, Text=RN.Text, TextInput=RN.TextInput, Pressable=RN.Pressable, ScrollView=RN.ScrollView || RN.View;
    if(!View || !Text) return React.createElement("div",null,"SimpleDiscordCrypt Revenge actif");
    const [key,setKey]=React.useState(storage.lastGeneratedKey||"");
    const style={padding:16,gap:12};
    const btnStyle={padding:12,borderRadius:8,backgroundColor:"#5865F2"};
    const inputStyle={padding:12,borderWidth:1,borderColor:"#777",borderRadius:8,color:"white"};
    const save=async()=>{ try { const raw=parseKey(key); const h=await registerKey(raw); storage.lastGeneratedKey=b64(raw); toast("Clé enregistrée: "+h.slice(0,8)+"…"); } catch(e){toast("SDC: "+(e?.message||e));} };
    const gen=async()=>{ try { const k=b64(randomBytes(32)); setKey(k); storage.lastGeneratedKey=k; toast("Nouvelle clé générée"); } catch(e){toast("SDC: "+(e?.message||e));} };
    return React.createElement(ScrollView,{contentContainerStyle:style},
      React.createElement(Text,{style:{fontSize:20,fontWeight:"700",color:"white"}},"SimpleDiscordCrypt Revenge"),
      React.createElement(Text,{style:{color:"#bbb"}},"Commandes dans le chat : :SDCSET <clé>, :SDCGEN, :SDCON, :SDCOFF, :SDCSTATUS, :ENC message, :NOENC message."),
      React.createElement(Text,{style:{color:"#bbb"}},"Clé 256 bits (Base64 ou 64 caractères hex). La clé générée ci-dessous n'est pas automatiquement associée à un salon : utilise :SDCSET <clé> dans le salon voulu."),
      React.createElement(TextInput,{value:key,onChangeText:setKey,selectTextOnFocus:true,multiline:true,autoCapitalize:"none",style:inputStyle,placeholder:"Clé Base64 / hex"}),
      React.createElement(Pressable,{onPress:gen,style:btnStyle},React.createElement(Text,{style:{color:"white",fontWeight:"700"}},"Générer une clé")),
      React.createElement(Pressable,{onPress:save,style:btnStyle},React.createElement(Text,{style:{color:"white",fontWeight:"700"}},"Enregistrer la clé")),
      React.createElement(Text,{style:{color:"#bbb"}},"MVP Android : messages texte compatibles SDC2 AES-GCM et ancien AES-CBC. Compression PNG, pièces jointes et échange automatique de clés non inclus dans cette version.")
    );
  }

  function onLoad() {
    ensureStorage();
    MessageActions=findByProps("sendMessage","editMessage");
    Dispatcher=findByProps("dispatch","subscribe");
    if(!MessageActions?.sendMessage) throw new Error("SDC: module sendMessage introuvable");
    unpatchSend=instead("sendMessage",MessageActions,handleOutgoing);
    if(Dispatcher?.dispatch) unpatchDispatch=instead("dispatch",Dispatcher,handleDispatch);
    toast("SimpleDiscordCrypt Revenge chargé");
  }
  function onUnload() {
    try{unpatchSend?.();}catch(_){}; try{unpatchDispatch?.();}catch(_){};
    unpatchSend=unpatchDispatch=null;
  }

var plugin = definePlugin({
  start: onLoad,
  stop: onUnload,
  SettingsComponent: Settings
});
