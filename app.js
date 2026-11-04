/* 主题切换：默认跟随系统，点一下在浅色 / 深色之间切换 */
(function(){
  const SUN='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    MOON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>';
  const mq=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):null;
  let pick=null; try{const v=localStorage.getItem('hy-theme');if(v==='light'||v==='dark')pick=v}catch(e){}
  const cur=()=>pick||(mq&&mq.matches?'dark':'light');
  function apply(){const r=document.documentElement; if(pick)r.setAttribute('data-theme',pick); else r.removeAttribute('data-theme');
    const b=document.getElementById('themeBtn'); if(!b)return; const d=cur()==='dark';
    b.innerHTML=d?MOON:SUN; const t=d?'当前深色，点击切换到浅色':'当前浅色，点击切换到深色'; b.title=t; b.setAttribute('aria-label',t)}
  apply();
  document.addEventListener('DOMContentLoaded',apply);
  if(mq&&mq.addEventListener)mq.addEventListener('change',apply);
  document.addEventListener('click',e=>{if(!e.target.closest('#themeBtn'))return;
    pick=cur()==='dark'?'light':'dark'; try{localStorage.setItem('hy-theme',pick)}catch(e){} apply()});
})();

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const FONT='"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const rid=p=>(p||'x')+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const rseed=()=>Math.floor(Math.random()*1e5)+1;
function rng(seed){let s=(seed*2654435761)>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return (s%100000)/100000}}
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
let toastT;function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}
function wrap(c,text,maxW){const out=[];let line='';for(const ch of text){if(c.measureText(line+ch).width>maxW&&line){out.push(line);line=ch}else line+=ch}if(line)out.push(line);return out}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const pad2=n=>String(n).padStart(2,'0');
const num=n=>Number(n).toLocaleString('zh-CN');
function hm(t){const d=new Date(t);return pad2(d.getHours())+':'+pad2(d.getMinutes())}
function dayLabel(t){const d=new Date(t),n=new Date(),k=x=>x.toDateString();if(k(d)===k(n))return '今天';const y=new Date(n);y.setDate(n.getDate()-1);if(k(d)===k(y))return '昨天';return (d.getMonth()+1)+' 月 '+d.getDate()+' 日'}
const rafFlags={};function onFrame(key,fn){if(rafFlags[key])return;rafFlags[key]=requestAnimationFrame(()=>{rafFlags[key]=0;fn()})}

/* =====================================================================
   模型接入：部署了后端（server/index.mjs）时走真实模型，否则走画布演示。
   生图 Seedream 4.0 · 分镜 DeepSeek V4.1 Flash · 视频 Seedance 2.0 mini / 可灵 2.5 Turbo
   ===================================================================== */
const LIVE={on:false,auth:false,ffmpeg:false,models:{},token:''};
try{LIVE.token=localStorage.getItem('hy-token')||''}catch(e){}
async function detectLive(){
  if(!/^https?:$/.test(location.protocol))return;
  try{const r=await fetch('/api/health',{cache:'no-store'});if(!r.ok)return;const j=await r.json();
    if(j&&j.ok===true&&j.models)Object.assign(LIVE,{on:true,auth:!!j.auth,ffmpeg:!!j.ffmpeg,models:j.models,settings:j.settings!==false})}catch(e){}
}
async function api(path,body,method){
  method=method||(body?'POST':'GET');
  const r=await fetch(path,{method,headers:{...(method!=='GET'?{'content-type':'application/json'}:{}),...(LIVE.token?{'x-access-token':LIVE.token}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){showGate();throw new Error('需要访问口令')}
  if(!r.ok||j.error)throw new Error(j.error||('服务器返回 '+r.status));
  return j;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;await fn(items[k],k)}}))}
function imgData(img,max=1536){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,k=Math.min(1,max/Math.max(w,h));const c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.9)}
function waitImg(src){return new Promise((ok,bad)=>{const t=setTimeout(()=>bad(new Error('图片加载失败')),15000);const im=loadImg(src,()=>{clearTimeout(t);ok(IMG.get(src).im)});if(im){clearTimeout(t);ok(im)}})}
async function skuRef(sku){if(!sku)return null;if(sku.sample)return imgData(productImg(sku));const src=srcOf(sku);return src?imgData(await waitImg(src)):null}
async function charRef(ch){const src=srcOf(ch);return src?imgData(await waitImg(src),1024):null}
// 关键帧（含局部重绘补丁）合成为一张图，用作局部重绘的底图和视频首帧
async function frameData(s){
  const [W,H]=dr().ratio==='16:9'?[1280,720]:[720,1280];
  if(s.kfUrl)await waitImg(s.kfUrl);for(const pt of s.patches||[])if(pt.url)await waitImg(pt.url).catch(()=>{});
  const c=document.createElement('canvas');c.width=W;c.height=H;drawFrame(c.getContext('2d'),W,H,s,0,{});return c.toDataURL('image/jpeg',.92);
}

const STYLE_PROMPT={minimal:'极简白色调，大面积留白，干净克制',cream:'奶油暖调，米色与焦糖色，柔和漫射光',tech:'深蓝色科技感，冷色边缘光与光晕，未来感',fresh:'自然清新，浅绿色调，植物元素，明亮日光',guochao:'国潮红金配色，中式纹样与祥云元素，喜庆华丽',gray:'高级灰色调，低饱和度，硬朗光影，质感高级'};
const TYPE_PROMPT={
  white:()=>'纯白背景（#FFFFFF）的电商白底商品图，商品居中完整展示，底部有柔和的接地阴影，不要任何文字、道具和装饰',
  main:sku=>{const pts=(sku.points||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,3),pr=(sku.price||'').trim();
    return `电商主图，商品是画面视觉中心。画面上用醒目清晰的中文排版写出商品名「${sku.name||''}」${pts.length?`，用小标签写出卖点：${pts.map(x=>'「'+x+'」').join('、')}`:''}${pr?`，角落用价格标写「到手价 ¥${pr}」`:''}。文字必须准确、没有错别字，排版干净有设计感`},
  scene:()=>'生活方式场景图，商品自然地放在与品类相符的真实使用场景里，搭配少量相关道具，浅景深，自然光，不要任何文字'};
function shopPrompt(j,sku){
  const z=size(j.size),st=STYLE_PROMPT[j.style]||'';
  if(j.task==='resize')return `参考图第一张是已经做好的商品图。把它重新排版为 ${z.w}:${z.h} 的画幅（${z.label}），商品、文字内容、配色和风格保持完全一致，只调整构图让画面自然地填满新画幅。`;
  if(j.task==='restyle')return `参考图第一张是已经做好的商品图。保持商品外观、构图和文字内容不变，把整体视觉风格改为：${st}。${TYPE_PROMPT[j.type](sku)}。`;
  return `参考图里的商品是「${sku.name||'商品'}」，必须保持商品的外形、颜色、包装和印刷文字完全一致。${TYPE_PROMPT[j.type](sku)}。视觉风格：${st}。画幅 ${z.w}:${z.h}，商业摄影质感，高清细节。`;
}
const CAM_TXT={推:'镜头缓慢推进',拉:'镜头缓慢拉远',摇:'镜头水平摇移',跟:'镜头跟随人物移动',手持:'手持镜头轻微晃动'};
function areaText(r){const pc=v=>Math.round(v*100)+'%';return `画面中横向 ${pc(r.x)}～${pc(r.x+r.w)}、纵向 ${pc(r.y)}～${pc(r.y+r.h)} 的矩形区域`}

const API={
  /** 电商图：jobs=[{skuId,type,style,size,seed,task?,from?}] → 同一批 job，带 url；失败的带 error */
  async generateImages(jobs,onProgress){
    if(!LIVE.on)return mockProgress(1400+jobs.length*50,onProgress).then(()=>jobs.map(({from,task,...j})=>({...j,seed:j.seed||rseed()})));
    let done=0;const out=new Array(jobs.length),refs={};onProgress&&onProgress(.02);
    await pool(jobs,3,async(j,i)=>{const {from,task,...rest}=j;
      try{const sku=skuById(j.skuId);refs[j.skuId]=refs[j.skuId]||skuRef(sku).catch(()=>null);const ref=await refs[j.skuId],z=size(j.size);
        const r=await api('/api/image',{prompt:shopPrompt(j,sku||{}),images:[from,ref].filter(Boolean),width:z.w,height:z.h});out[i]={...rest,seed:j.seed||rseed(),url:r.url}}
      catch(e){out[i]={...rest,error:e.message}}
      done++;onProgress&&onProgress(Math.max(.02,done/jobs.length))});
    return out;
  },
  /** 分镜脚本：story={genre,title,syn,chars,nShots,len,ratio} → 镜头数组 */
  async generateStoryboard(story){
    if(!LIVE.on)return mockProgress(1100).then(()=>mockStoryboard(story));
    const r=await api('/api/storyboard',{story:slimStory(story),enums:shotEnums()});
    return r.shots.map(x=>toShot([x.scale,x.mood,x.desc,x.line,x.dur,x.cam,x.cast],story.chars));
  },
  /** 重写单个镜头（只在正式模式调用）：带上整部分镜做上下文 → 新的镜头字段 */
  async rewriteShot(story,shots,index){
    const r=await api('/api/shot',{story:slimStory(story),enums:shotEnums(),index,shots:shots.map(x=>({scale:x.scale,cam:x.cam,dur:x.dur,desc:x.desc,line:x.line}))});
    const x=r.shot,t=toShot([x.scale,x.mood,x.desc,x.line,x.dur,x.cam,x.cast],story.chars);
    return{scale:t.scale,mood:t.mood,desc:t.desc,line:t.line,dur:t.dur,cam:t.cam,cast:t.cast};
  },
  /** 关键帧：req={shot,prompt,region|null,note} → {seed,url}；失败 {error} */
  async generateKeyframe(req,onProgress){
    if(!LIVE.on)return mockProgress(req.region?700:1000,onProgress).then(()=>({seed:rseed()}));
    const s=req.shot,wide=dr().ratio==='16:9',[W,H]=wide?[1920,1080]:[1080,1920];
    let p=0;const tm=setInterval(()=>{p=Math.min(.92,p+.035);onProgress&&onProgress(p)},700);
    try{
      const refs=[];if(req.region)refs.push(await frameData(s));
      for(const ch of (s.cast||[]).map(charById).filter(Boolean)){const d=await charRef(ch).catch(()=>null);if(d)refs.push(d)}
      const roleNote=refs.length>(req.region?1:0)?'\n出镜角色的定妆照已作为参考图提供，人物长相、发型和服装必须与参考图一致。':'';
      const prompt=req.region
        ?`参考图第一张是当前关键帧。保持整体构图、人物、光线和画风不变，只修改${areaText(req.region)}：${req.note||'重新绘制这一块，让它更自然'}。${roleNote}`
        :`${req.prompt}${roleNote}\n电影级画面，${wide?'横屏':'竖屏'}短剧关键帧，构图完整，画面中不要出现字幕、文字和水印。`;
      const r=await api('/api/image',{prompt,images:refs,width:W,height:H});onProgress&&onProgress(1);return{seed:rseed(),url:r.url};
    }catch(e){return{error:e.message}}finally{clearInterval(tm)}
  },
  /** 视频：shot 带已确认的关键帧；model=seedance|kling → {url}；失败 {error}
      拿到任务 id 后会写进 s.vTask 并调用 onTask，方便保存；刷新页面后用 pollVideo 接着查 */
  async generateVideo(s,model,onProgress,onTask){
    if(!LIVE.on)return mockProgress(1000+s.dur*260,onProgress).then(()=>({ok:true}));
    try{
      const image=!s.kfUrl||(s.patches||[]).some(x=>x.url)?await frameData(s):s.kfUrl;
      const prompt=`${s.desc}${s.cam&&s.cam!=='固定'?CAM_TXT[s.cam]+'。':'镜头固定。'}${s.line?`人物说：“${s.line}”。`:''}画面风格与首帧一致，人物动作自然流畅。`;
      const {id}=await api('/api/video',{provider:model,image,prompt,duration:s.dur,ratio:dr().ratio});
      s.vTask=id;s.vAt=Date.now();onTask&&onTask();
      return await API.pollVideo(id,model,onProgress,s.vAt);
    }catch(e){return{error:e.message}}
  },
  async pollVideo(id,model,onProgress,t0=Date.now()){
    const exp=model==='kling'?150:70;let fails=0;
    try{
      for(;;){await sleep(5000);let r;try{r=await api('/api/video/'+id);fails=0}catch(e){if(++fails>=4)throw e;continue}
        if(r.status==='succeeded'){onProgress&&onProgress(1);return{url:r.url}}
        if(r.status==='failed')return{error:r.error||'生成失败'};
        onProgress&&onProgress(Math.min(.95,(Date.now()-t0)/1000/exp))}
    }catch(e){return{error:e.message}}
  },
};
function slimStory(story){return{...story,chars:story.chars.map(c=>({name:c.name,role:c.role,look:c.look}))}}
function shotEnums(){return{scales:SCALES,moods:Object.keys(MOODS),moodNames:MOOD_NAME,cams:CAMS}}
function mockProgress(ms,cb){return new Promise(res=>{const t0=performance.now();const tick=()=>{const p=Math.min(1,(performance.now()-t0)/ms);cb&&cb(p);if(p>=1)res();else setTimeout(tick,110)};tick()})}

/* 价格（单位：积分，1 积分 = 0.1 元）。按模型成本约 2 倍定价：
   Seedream 4.0 0.2 元/张 · DeepSeek V4.1 Flash 每次分镜不到 0.01 元 · Seedance 2.0 mini 720p 0.5 元/秒（最短 4 秒） · 可灵 2.5 Turbo 1080p 约 2.5 元/5 秒 */
const PRICING={image:4,storyboard:2,rewrite:1,keyframe:4,inpaint:4,seedancePerSec:10,klingPer5s:50};
function refund(p,n){if(n<=0)return;APP.credits+=n;p.spent=Math.max(0,(p.spent||0)-n);Store.saveWallet().catch(()=>{});renderWallet()}
function saveUrl(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove()}
function showGate(){$('#gate').hidden=false;setTimeout(()=>$('#gateIn').focus(),50)}
function applyMode(){
  if(!LIVE.on)return;const M=LIVE.models,any=M.image||M.llm||M.seedance;
  $('#modeKicker').innerHTML=any?'<b>已就绪</b>AI 生图、分镜与视频生成均可使用':'<b>待配置</b>还没有填写模型密钥 · <a data-view-link="settings">去设置</a>';
  $$('.modeBadge').forEach(b=>b.innerHTML=any?'<b style="color:var(--ok)">●</b> 已就绪':'<b>●</b> <a data-view-link="settings">未配置，去设置</a>');
  if(LIVE.auth&&!LIVE.token)showGate();
}
const DEFAULT_CREDITS=3000;

/* ================= 存储：Claude 云端 → 浏览器本地 → 仅本次会话 ================= */
const APP={base:null,projects:[],history:[],view:'shop',credits:DEFAULT_CREDITS};
let SHOP=null,DRAMA=null;
const LS={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
const IDB={db:null,
  open(){return new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error('no idb'));const r=indexedDB.open('visual-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('images');r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)})},
  put(id,blob){return new Promise((res,rej)=>{const tx=this.db.transaction('images','readwrite');tx.objectStore('images').put(blob,id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})},
  all(){return new Promise((res,rej)=>{const out={},rq=this.db.transaction('images').objectStore('images').openCursor();rq.onsuccess=()=>{const c=rq.result;if(c){out[c.key]=c.value;c.continue()}else res(out)};rq.onerror=()=>rej(rq.error)})}};
const LOCAL_URL={};
function withTimeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))])}
const Store={mode:'memory',db:null,assets:null,
  async init(){
    try{
      if(!window.claude||!claude.use)throw new Error('no viewer');
      const [db,user,assets]=await withTimeout(Promise.all([claude.use('db'),claude.use('user'),claude.use('assets')]),10000);
      if(!db||!user)throw new Error('unavailable');
      const id=await user.id();if(!id)throw new Error('no id');
      this.db=db;this.assets=assets;APP.base='data/users/'+id+'/ws';
      const [ps,hs,w]=await withTimeout(Promise.all([
        db.collection(APP.base+'/projects').orderBy('updatedAt','desc').limit(200).get(),
        db.collection(APP.base+'/history').orderBy('at','desc').limit(300).get(),
        db.doc(APP.base).get()]),10000);
      APP.projects=ps.docs.map(d=>({id:d.id,...d.data(),saved:true}));
      APP.history=hs.docs.map(d=>({id:d.id,...d.data()}));
      const c=w.exists?w.data().credits:undefined;APP.credits=typeof c==='number'?c:DEFAULT_CREDITS;
      this.mode='cloud';return;
    }catch(e){this.db=null}
    // 连上了帧间服务：数据存到本机 data 文件夹，换浏览器、清缓存都不会丢
    if(LIVE.on){
      try{
        let d=await api('/api/store');
        if(!d.projects.length&&!d.history.length&&d.credits===null)d=await migrateLocal()||d;
        APP.projects=d.projects.map(x=>({...x,saved:true}));APP.history=d.history;
        APP.credits=typeof d.credits==='number'?d.credits:DEFAULT_CREDITS;
        this.mode='server';return;
      }catch(e){console.warn('本机存储不可用，改用浏览器存储',e)}
    }
    try{
      localStorage.setItem('vs:t','1');localStorage.removeItem('vs:t');
      const map=LS.get('vs:projects',{});APP.projects=Object.entries(map).map(([id,d])=>({id,...d,saved:true}));
      APP.history=LS.get('vs:history',[]);APP.credits=LS.get('vs:credits',DEFAULT_CREDITS);
      try{await IDB.open();const all=await IDB.all();for(const k in all)LOCAL_URL[k]=URL.createObjectURL(all[k])}catch(e){IDB.db=null}
      this.mode='local';return;
    }catch(e){}
    this.mode='memory';
  },
  async saveProject(p){
    const doc=projDoc(p);
    if(this.mode==='cloud')return this.db.doc(APP.base+'/projects/'+p.id).set(doc);
    if(this.mode==='server')return api('/api/store/projects/'+p.id,doc,'PUT');
    if(this.mode==='local'){const m=LS.get('vs:projects',{});m[p.id]=doc;if(!LS.set('vs:projects',m))throw new Error('浏览器存储空间不足');return}
  },
  async deleteProject(id){
    if(this.mode==='cloud')return this.db.doc(APP.base+'/projects/'+id).delete();
    if(this.mode==='server')return api('/api/store/projects/'+id,undefined,'DELETE');
    if(this.mode==='local'){const m=LS.get('vs:projects',{});delete m[id];LS.set('vs:projects',m)}
  },
  async addHistory(h){
    if(this.mode==='cloud')return this.db.collection(APP.base+'/history').add(h);
    if(this.mode==='server')return api('/api/store/history',h);
    if(this.mode==='local'){const a=LS.get('vs:history',[]);a.unshift(h);LS.set('vs:history',a.slice(0,300))}
  },
  async saveWallet(){
    if(this.mode==='cloud')return this.db.doc(APP.base).set({credits:APP.credits});
    if(this.mode==='server')return api('/api/store/wallet',{credits:APP.credits},'PUT');
    if(this.mode==='local')LS.set('vs:credits',APP.credits);
  },
  async putImage(file){
    if(this.mode==='server'){try{const url=await uploadBlob(file);return{fileUrl:url,src:url}}catch(e){toast('图片没能保存到本机：'+e.message+'，仅本次会话可用')}}
    if(this.mode==='cloud'&&this.assets){try{const r=await this.assets.upload(file);return{src:r.url,assetId:r.id}}catch(e){toast('图片未能存到云端，仅本次会话可用')}}
    if(this.mode==='local'&&IDB.db){try{const id=rid('img');await IDB.put(id,file);LOCAL_URL[id]=URL.createObjectURL(file);return{localId:id,src:LOCAL_URL[id]}}catch(e){}}
    const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(file)});return{src:dataUrl};
  },
};
const srcOf=o=>o.src||o.fileUrl||(o.assetId?'/_blob/'+o.assetId:o.localId?LOCAL_URL[o.localId]:null);
const keepImg=o=>o.fileUrl||o.assetId||o.localId||o.sample;
const blobToDataUrl=b=>new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>bad(r.error);r.readAsDataURL(b)});
async function uploadBlob(b){return (await api('/api/upload',{dataUrl:await blobToDataUrl(b)})).url}
/* 旧版本把数据存在浏览器里。第一次用本机存储时，把项目、历史、积分和上传过的图片搬过去（只搬一次） */
async function migrateLocal(){
  let map,hist,credits;
  try{if(localStorage.getItem('vs:migrated'))return null;map=LS.get('vs:projects',{});hist=LS.get('vs:history',[]);credits=LS.get('vs:credits',null)}catch(e){return null}
  const ids=Object.keys(map);if(!ids.length&&!hist.length&&credits===null)return null;
  let blobs={};try{await IDB.open();blobs=await IDB.all()}catch(e){}
  const moved={},fix=async o=>{if(!o||!o.localId)return;const b=blobs[o.localId];if(b){try{moved[o.localId]=moved[o.localId]||await uploadBlob(b);o.fileUrl=moved[o.localId];delete o.localId}catch(e){}}};
  const projects=[];
  for(const id of ids){const d=map[id];const st=d.state||{};
    for(const k of st.skus||[])await fix(k);for(const c of st.chars||[])await fix(c);
    await api('/api/store/projects/'+id,d,'PUT');projects.push({...d,id})}
  for(const h of hist.slice().reverse())await api('/api/store/history',h); // 后端把新的插在最前面，所以从旧到新依次写入
  if(typeof credits==='number')await api('/api/store/wallet',{credits},'PUT');
  try{localStorage.setItem('vs:migrated',String(Date.now()))}catch(e){}
  setTimeout(()=>toast(`已把浏览器里的 ${ids.length} 个项目迁移到本机 data 文件夹`),1500);
  return{projects,history:hist,credits:typeof credits==='number'?credits:null};
}
const STORE_TXT={server:['on','数据保存在本机 data 文件夹'],cloud:['on','已连接云端存储'],local:['on','数据保存在本浏览器'],memory:['off','未连接存储，仅保存在本次会话']};

const saveTimers={},saving={},pendingSave={};
function projDoc(p){return{name:p.name,kind:p.kind,updatedAt:p.updatedAt,spent:p.spent||0,state:p.kind==='shop'?packShop(p.state):packDrama(p.state)}}
function touch(p){if(!p)return;p.updatedAt=Date.now();p.dirty=true;p.sample=false;showSave(p,Store.mode==='memory'?null:'待保存');clearTimeout(saveTimers[p.id]);saveTimers[p.id]=setTimeout(()=>saveProject(p),900)}
async function saveProject(p){
  if(Store.mode==='memory'||!APP.projects.includes(p)){showSave(p);return}
  if(saving[p.id]){pendingSave[p.id]=true;return}
  saving[p.id]=true;showSave(p,'保存中…');
  try{await Store.saveProject(p);p.saved=true;p.dirty=false;showSave(p)}
  catch(e){showSave(p,'保存失败：'+(e.message||e.code||'请稍后重试'))}
  saving[p.id]=false;if(pendingSave[p.id]){pendingSave[p.id]=false;saveProject(p)}
}
function showSave(p,txt){
  const el=p===SHOP?$('#saveShop'):p===DRAMA?$('#saveDrama'):null;if(!el)return;
  const where=Store.mode==='cloud'?'已保存到云端':Store.mode==='server'?'已保存到本机':'已保存在本浏览器';
  if(!txt)txt=Store.mode==='memory'?'仅本次会话，刷新后丢失':p.saved&&!p.dirty?where+' · '+hm(p.updatedAt):p.sample?'示例项目，修改后自动保存':'未保存';
  el.innerHTML=`<span class="dot ${Store.mode==='memory'?'off':p.saved&&!p.dirty?'on':''}"></span>${esc(txt)}`;
}
function renderWallet(){
  $('#walletSide').textContent=num(APP.credits);
  [[SHOP,'#spentShop'],[DRAMA,'#spentDrama']].forEach(([p,id])=>{if(p)$(id).innerHTML=`本项目已消耗 <b>${num(p.spent||0)}</b> 积分 · 余额 <b>${num(APP.credits)}</b>`});
}
function spend(p,n){
  if(n<=0)return true;
  if(APP.credits<n){toast(`积分不足：需要 ${num(n)}，余额 ${num(APP.credits)}。可点右上角积分旁的「重置」恢复演示额度`);return false}
  APP.credits-=n;p.spent=(p.spent||0)+n;Store.saveWallet().catch(()=>{});renderWallet();touch(p);return true;
}
function estHtml(n,label='预计消耗'){const short=n>APP.credits;return `<span class="est ${short?'short':''}"><span class="hint">${label}</span><b>${num(n)} 积分</b>${short?'<span class="hint">余额不足</span>':''}</span>`}
$('#walletReset').onclick=()=>{APP.credits=DEFAULT_CREDITS;Store.saveWallet().catch(()=>{});renderWallet();toast('演示额度已重置为 '+num(DEFAULT_CREDITS)+' 积分');refreshEstimates()};
function refreshEstimates(){if(SHOP)renderPlan();if(DRAMA){const st=DRAMA.state;if(st.step===1)setScriptBtn();if(st.step===3)renderKf();if(st.step===4)renderStudio()}}
async function logHistory(p,text,detail,cost){
  const h={pid:p.id,pname:p.name,kind:p.kind,text,detail:detail||'',cost:cost||0,at:Date.now()};
  APP.history.unshift({id:rid('h'),...h});
  try{await Store.addHistory(h)}catch(e){}
  if(APP.view==='history')renderHistory();
}
const IMG=new Map();
function loadImg(src,onReady){
  let e=IMG.get(src);
  if(!e){const im=new Image();e={im,ok:false,cbs:[]};IMG.set(src,e);im.onload=()=>{e.ok=true;e.cbs.splice(0).forEach(f=>f())};im.onerror=()=>{e.err=true;e.cbs=[]};im.src=src}
  if(e.ok)return e.im;if(onReady&&!e.err&&!e.cbs.includes(onReady))e.cbs.push(onReady);return null;
}

/* ================= 电商图 ================= */
const SIZES={
  sq:{label:'淘宝 / 天猫主图',w:800,h:800},
  jd:{label:'京东主图',w:800,h:800},
  detail:{label:'详情页首屏',w:750,h:1000},
  xhs:{label:'小红书笔记',w:1080,h:1440},
  dy:{label:'抖音 / 视频号竖版',w:1080,h:1920},
  amz:{label:'亚马逊主图',w:2000,h:2000},
  banner:{label:'店铺横幅',w:1920,h:600},
};
const STYLES={
  minimal:{name:'简约白',bg:['#FFFFFF','#ECEDEF'],floor:'#E2E3E6',ink:'#15161A',acc:'#15161A',accInk:'#FFFFFF'},
  cream:{name:'奶油暖调',bg:['#F7EBDA','#E6CBA8'],floor:'#DDBF97',ink:'#4A321E',acc:'#A8672E',accInk:'#FFF6EA'},
  tech:{name:'科技冷光',bg:['#0B1633','#1E4290'],floor:'#0A1228',ink:'#EAF2FF',acc:'#4FC6FF',accInk:'#04121F'},
  fresh:{name:'自然清新',bg:['#E6F4E8','#B9DEC2'],floor:'#A7D1B1',ink:'#1C3A25',acc:'#2F8A4A',accInk:'#F2FFF5'},
  guochao:{name:'国潮红金',bg:['#B4161E','#650A0F'],floor:'#560810',ink:'#FCE6B0',acc:'#F2C14E',accInk:'#5A0A0E'},
  gray:{name:'高级灰',bg:['#DCDCDE','#97989D'],floor:'#8A8B90',ink:'#18181A',acc:'#18181A',accInk:'#F1F1F2'},
};
const TYPES={white:'白底商品图',main:'主图',scene:'场景图'};

const SAMPLES={
  serum(){const c=document.createElement('canvas');c.width=360;c.height=640;const x=c.getContext('2d');
    x.fillStyle='#1B1B1E';x.beginPath();x.ellipse(180,72,46,58,0,0,7);x.fill();
    let g=x.createLinearGradient(118,0,242,0);g.addColorStop(0,'#2A2A2E');g.addColorStop(.4,'#55555B');g.addColorStop(1,'#151517');x.fillStyle=g;rr(x,118,112,124,80,10);x.fill();
    g=x.createLinearGradient(70,0,290,0);g.addColorStop(0,'#D99A4C');g.addColorStop(.55,'#B87430');g.addColorStop(1,'#7A4216');x.fillStyle=g;rr(x,70,186,220,440,44);x.fill();
    x.fillStyle='rgba(255,255,255,.35)';rr(x,96,214,16,380,8);x.fill();
    x.fillStyle='#F7F1E8';rr(x,104,330,152,190,10);x.fill();
    x.fillStyle='#3B2410';x.textAlign='center';x.font='700 34px '+FONT;x.fillText('GLOW',180,392);
    x.font='500 17px '+FONT;x.fillText('焕亮修护精华',180,430);x.font='13px '+FONT;x.fillStyle='#8A6A4A';x.fillText('SERUM · 30ml',180,470);return c},
  cream(){const c=document.createElement('canvas');c.width=520;c.height=380;const x=c.getContext('2d');
    let g=x.createLinearGradient(0,0,0,120);g.addColorStop(0,'#F0DFDA');g.addColorStop(1,'#C9A49D');x.fillStyle=g;rr(x,56,30,408,100,24);x.fill();
    x.fillStyle='rgba(255,255,255,.4)';rr(x,80,44,360,14,7);x.fill();
    g=x.createLinearGradient(80,0,440,0);g.addColorStop(0,'#FFFFFF');g.addColorStop(.6,'#F3ECEA');g.addColorStop(1,'#D8CBC7');x.fillStyle=g;rr(x,76,126,368,230,34);x.fill();
    x.fillStyle='#8A5A55';x.textAlign='center';x.font='700 38px '+FONT;x.fillText('SOFT CREAM',260,232);x.font='500 20px '+FONT;x.fillText('柔润保湿霜 · 50g',260,276);return c},
  tube(){const c=document.createElement('canvas');c.width=260;c.height=660;const x=c.getContext('2d');
    x.fillStyle='#C9D9DC';rr(x,24,14,212,30,4);x.fill();
    const g=x.createLinearGradient(20,0,240,0);g.addColorStop(0,'#D5EEF1');g.addColorStop(.5,'#9FD0D8');g.addColorStop(1,'#6FA9B3');x.fillStyle=g;
    x.beginPath();x.moveTo(28,40);x.lineTo(232,40);x.lineTo(180,520);x.lineTo(80,520);x.closePath();x.fill();
    x.fillStyle='#24414A';rr(x,82,516,96,124,12);x.fill();
    x.save();x.translate(140,290);x.rotate(-Math.PI/2);x.fillStyle='#14353D';x.textAlign='center';x.font='700 44px '+FONT;x.fillText('AQUA',0,0);x.font='500 18px '+FONT;x.fillText('氨基酸洁面乳',0,36);x.restore();return c},
};
const SAMPLE_SKU={id:'_sample',name:'焕亮修护精华液',points:'28天淡化暗沉\n敏感肌可用',price:'199',sample:'serum'};
const SAMPLE_CANVAS={};
function productImg(sku,onReady){
  if(sku.sample)return SAMPLE_CANVAS[sku.sample]||(SAMPLE_CANVAS[sku.sample]=SAMPLES[sku.sample]());
  const s=srcOf(sku);return s?loadImg(s,onReady):null;
}

function newShopState(sample){
  const st={skus:[],active:null,plan:{types:['white','main','scene'],style:'cream',sizes:['sq','xhs'],per:1},results:[],customSizes:{},filter:'all'};
  if(sample){
    st.skus=[
      {id:'k1',name:'焕亮修护精华液',points:'28天淡化暗沉\n敏感肌可用\n30ml 便携装',price:'199',sample:'serum',on:true},
      {id:'k2',name:'柔润保湿面霜',points:'72小时长效保湿\n神经酰胺修护\n50g 大容量',price:'159',sample:'cream',on:true},
      {id:'k3',name:'清透氨基酸洁面',points:'弱酸性温和配方\n绵密泡沫\n120g',price:'89',sample:'tube',on:true}];
    st.active='k1';
    const pre=[['k1','main','cream','sq'],['k1','scene','fresh','xhs'],['k1','white','minimal','sq'],['k2','main','gray','sq'],['k2','scene','cream','dy'],['k3','main','tech','banner'],['k3','scene','fresh','sq']];
    st.results=pre.map((a,i)=>({id:'r'+i,skuId:a[0],type:a[1],style:a[2],size:a[3],seed:17+i*31,ver:1,demo:true}));
  }
  return st;
}
// 已扣积分但还没拿到结果的图片任务。页面中途刷新时，打开项目会把这部分退回
function inflight(p,n){p.state.pendingCost=Math.max(0,(p.state.pendingCost||0)+n)}
function packShop(st){return{...st,skus:st.skus.map(({src,...k})=>keepImg(k)?k:{...k,lost:true}),results:st.results.map(({sel,dirty,...r})=>r)}}
function unpackShop(st){st=JSON.parse(JSON.stringify(st||{}));const d=newShopState(false);st={...d,...st,plan:{...d.plan,...(st.plan||{})}};st.customSizes=st.customSizes||{};return st}

const sh=()=>SHOP.state;
const size=k=>SIZES[k]||sh().customSizes[k]||SIZES.sq;
const skuById=id=>sh().skus.find(s=>s.id===id);
const priceImage=k=>PRICING.image;
const CANV=new Map(),PREV=new Map();

function renderImage(cv,r,maxSide=560){
  const sz=size(r.size),k=Math.min(maxSide/sz.w,maxSide/sz.h);
  const W=Math.round(sz.w*k),H=Math.round(sz.h*k);cv.width=W;cv.height=H;
  if(r.url){const c0=cv.getContext('2d'),im=loadImg(r.url,()=>{r.dirty=true;if(APP.view==='shop')onFrame('groups',renderGroups)});
    if(im){const q=Math.max(W/im.naturalWidth,H/im.naturalHeight),iw=im.naturalWidth*q,ih=im.naturalHeight*q;c0.drawImage(im,(W-iw)/2,(H-ih)/2,iw,ih)}
    else{c0.fillStyle='#E9EAEE';c0.fillRect(0,0,W,H);c0.fillStyle='#8A8F96';c0.font='500 '+Math.min(W,H)*.05+'px '+FONT;c0.textAlign='center';c0.fillText('图片加载中…',W/2,H/2)}
    return}
  const c=cv.getContext('2d'),st=STYLES[r.style]||STYLES.minimal,R=rng(r.seed),m=Math.min(W,H);
  const wide=W/H>1.5,tall=H/W>1.25,sku=r.sku||skuById(r.skuId)||{name:'',points:'',price:''};
  const img=productImg(sku,r.sku?null:()=>{sh().results.forEach(x=>{if(x.skuId===sku.id)x.dirty=true});PREV.clear();renderGroups();renderSkuList();renderPlan()});
  if(r.type==='white'){
    c.fillStyle='#FFFFFF';c.fillRect(0,0,W,H);
    const g=c.createRadialGradient(W/2,H*.55,0,W/2,H*.55,m*.7);g.addColorStop(0,st.bg[0]+'66');g.addColorStop(1,'#FFFFFF00');c.fillStyle=g;c.fillRect(0,0,W,H);
  }else{const g=c.createLinearGradient(0,0,W*(.3+R()*.5),H);g.addColorStop(0,st.bg[0]);g.addColorStop(1,st.bg[1]);c.fillStyle=g;c.fillRect(0,0,W,H)}
  let cx=W/2,base=H*.84,ph=m*.66;
  if(r.type==='scene'){
    const fy=H*(wide?.74:.7);
    c.save();c.globalAlpha=.22;c.fillStyle='#FFFFFF';const wx=W*(.08+R()*.5),ww=W*.3,wh=H*.38;c.translate(wx,H*.08);c.transform(1,0,-.18,1,0,0);
    c.fillRect(0,0,ww*.47,wh*.47);c.fillRect(ww*.53,0,ww*.47,wh*.47);c.fillRect(0,wh*.53,ww*.47,wh*.47);c.fillRect(ww*.53,wh*.53,ww*.47,wh*.47);c.restore();
    const fg=c.createLinearGradient(0,fy,0,H);fg.addColorStop(0,st.floor);fg.addColorStop(1,st.bg[1]);c.fillStyle=fg;c.fillRect(0,fy,W,H-fy);
    c.fillStyle='rgba(255,255,255,.18)';c.fillRect(0,fy,W,Math.max(1,m*.006));
    const props=2+Math.floor(R()*3);
    for(let i=0;i<props;i++){const px=W*(i%2?0.1+R()*.16:0.74+R()*.18),s=m*(.08+R()*.12);c.fillStyle=i%2?st.acc+'AA':'rgba(255,255,255,.55)';
      if(R()>.5){c.beginPath();c.arc(px,fy-s*.5,s*.5,0,7);c.fill()}else{rr(c,px-s*.5,fy-s,s,s,s*.12);c.fill()}}
    c.save();c.translate(W*(R()>.5?.88:.12),fy);for(let i=0;i<5;i++){c.save();c.rotate(-.9+i*.45);c.fillStyle=i%2?'#4E8A5B':'#6BA877';c.beginPath();c.ellipse(0,-m*.13,m*.03,m*.12,0,0,7);c.fill();c.restore()}c.restore();
    cx=wide?W*.5:W*(.44+R()*.12);base=fy+m*.02;ph=m*(wide?.62:.5);
  }else if(r.type==='main'){
    if(wide){cx=W*.74;base=H*.9;ph=H*.8}else{cx=W/2;base=H*(tall?.8:.9);ph=m*(tall?.62:.56)}
    c.fillStyle=st.acc+'22';c.beginPath();c.ellipse(cx,base,m*.34,m*.06,0,0,7);c.fill();
  }
  if(img){
    const iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight,ratio=iw/ih;
    let h=ph,w=h*ratio;if(w>W*.62){w=W*.62;h=w/ratio}
    c.save();c.fillStyle='rgba(0,0,0,.22)';c.filter='blur('+Math.max(2,h*.03)+'px)';c.beginPath();c.ellipse(cx,base,w*.55,h*.045,0,0,7);c.fill();c.restore();
    if(r.type==='white'){c.save();c.globalAlpha=.1;c.translate(0,base*2);c.scale(1,-1);c.drawImage(img,cx-w/2,base-h,w,h);c.restore()}
    c.drawImage(img,cx-w/2,base-h,w,h);
  }else{c.fillStyle=st.ink+'99';c.font='500 '+m*.045+'px '+FONT;c.textAlign='center';c.fillText(sku.lost?'商品图未保存，请重新上传':'商品图加载中…',cx,base-ph/2)}
  if(r.type==='main'){
    const name=sku.name||'商品名称',pts=(sku.points||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,3),price=(sku.price||'').trim();
    c.fillStyle=st.ink;const fs=m*(wide?.12:.082);c.font='700 '+fs+'px '+FONT;
    let tx,ty;if(wide){c.textAlign='left';tx=W*.06;ty=H*.36}else{c.textAlign='center';tx=W/2;ty=H*(tall?.11:.13)}
    const lines=wrap(c,name,wide?W*.5:W*.86).slice(0,2);lines.forEach((l,i)=>c.fillText(l,tx,ty+i*fs*1.15));
    ty+=(lines.length-1)*fs*1.15+fs*.75;
    const pf=m*(wide?.06:.038);c.font='500 '+pf+'px '+FONT;
    const ws=pts.map(p=>c.measureText(p).width+pf*1.4),gap=pf*.5,tot=ws.reduce((a,b)=>a+b,0)+gap*Math.max(0,ws.length-1);
    let px=wide?tx:W/2-tot/2;
    pts.forEach((p,i)=>{c.fillStyle=st.acc;rr(c,px,ty,ws[i],pf*1.8,pf*.9);c.fill();c.fillStyle=st.accInk;c.textAlign='center';c.fillText(p,px+ws[i]/2,ty+pf*1.25);px+=ws[i]+gap});
    if(price){const bs=m*(wide?.2:.17),bx=wide?W*.06+bs/2:W-bs*.72,by=wide?H*.78:H*(tall?.6:.72);
      c.fillStyle=st.acc;c.beginPath();c.arc(bx,by,bs/2,0,7);c.fill();c.fillStyle=st.accInk;c.textAlign='center';c.font='500 '+bs*.15+'px '+FONT;c.fillText('到手价',bx,by-bs*.08);c.font='700 '+bs*.27+'px '+FONT;c.fillText('¥'+price,bx,by+bs*.2)}
  }
  return cv;
}
function skuThumb(sku,px){const c=document.createElement('canvas');const img=productImg(sku,()=>{renderSkuList();renderGroups()});if(!img){c.width=px;c.height=px;return c}const iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight,k=Math.min(px/iw,px/ih);c.width=Math.max(1,iw*k);c.height=Math.max(1,ih*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c}
function ratioGlyph(k){const s=size(k),mx=16,w=s.w>=s.h?mx:mx*s.w/s.h,h=s.h>=s.w?mx:mx*s.h/s.w;return `<span class="ratio-glyph"><i style="width:${w}px;height:${h}px"></i></span>`}

/* 风格预览：用当前选中的商品（图片还没加载好时用示例商品）按方案里的首个类型出一张示例 */
function previewSku(){const a=skuById(sh().active);return a&&productImg(a,()=>{PREV.clear();renderPlan()})?a:SAMPLE_SKU}
function stylePreview(style,type){
  const sku=previewSku(),key=[style,type,sku.id,sku.rev||0].join('|');
  if(!PREV.has(key)){const cv=document.createElement('canvas');renderImage(cv,{sku,type,style,size:'sq',seed:7},160);PREV.set(key,cv)}
  const out=document.createElement('canvas'),src=PREV.get(key);out.width=src.width;out.height=src.height;out.getContext('2d').drawImage(src,0,0);return out;
}
function fillStyleGrid(el,selected){
  const type=sh().plan.types.includes('main')?'main':sh().plan.types[0]||'main';
  el.innerHTML='';Object.entries(STYLES).forEach(([k,v])=>{const b=document.createElement('button');b.type='button';b.className='style-card';b.dataset.v=k;b.setAttribute('aria-pressed',k===selected);b.appendChild(stylePreview(k,type));b.insertAdjacentHTML('beforeend',`<span>${v.name}</span>`);el.appendChild(b)});
}

function renderShopAll(){$('#pnameShop').value=SHOP.name;showSave(SHOP);renderWallet();PREV.clear();renderSkuList();renderSkuEdit();renderPlan();renderGroups()}
function renderSkuList(){
  const st=sh();$('#skuCount').textContent=st.skus.length?`${st.skus.filter(s=>s.on).length}/${st.skus.length} 已勾选`:'';
  const L=$('#skuList');L.innerHTML='';
  if(!st.skus.length){L.innerHTML='<div class="hint" style="padding:6px">还没有商品。点「批量上传」一次选多张商品图，每张图会成为一个 SKU。<br><button class="btn sm" id="useSample" style="margin-top:8px">载入 3 个示例商品</button></div>';
    $('#useSample').onclick=()=>{const s=newShopState(true);st.skus=s.skus;st.active='k1';touch(SHOP);renderShopAll()};return}
  st.skus.forEach(s=>{const n=st.results.filter(r=>r.skuId===s.id).length;const el=document.createElement('div');el.className='sku'+(s.id===st.active?' on':'');el.dataset.id=s.id;
    el.innerHTML=`<input type="checkbox" ${s.on?'checked':''} aria-label="参与批量生成"><div class="th"></div><div class="nm">${esc(s.name||'未命名商品')}<small>${n} 张图${s.lost&&!srcOf(s)?' · 图片需重新上传':''}</small></div><span class="mono hint">${s.price?'¥'+esc(s.price):''}</span>`;
    $('.th',el).appendChild(skuThumb(s,80));L.appendChild(el)});
}
$('#skuList').onclick=e=>{const el=e.target.closest('.sku');if(!el)return;const s=skuById(el.dataset.id);
  if(e.target.matches('input[type=checkbox]')){s.on=e.target.checked;touch(SHOP);renderSkuList();renderPlan();return}
  sh().active=s.id;renderSkuList();renderSkuEdit();renderPlan()};
function renderSkuEdit(){
  const s=skuById(sh().active),E=$('#skuEdit');E.hidden=!s;if(!s)return;
  E.innerHTML=`<div class="field"><label class="label" for="kName">商品名称</label><input type="text" id="kName" value="${esc(s.name)}"></div>
  <div class="field"><label class="label" for="kPoints">卖点（每行一条，主图最多展示 3 条）</label><textarea id="kPoints" style="min-height:64px">${esc(s.points)}</textarea></div>
  <div class="field"><label class="label" for="kPrice">到手价（元）</label><input type="text" id="kPrice" value="${esc(s.price)}"></div>
  <div class="sku-edit-acts"><label class="btn sm file-label" for="kFile">替换商品图<input type="file" id="kFile" accept="image/*"></label><button class="btn sm ghost danger" id="kDel">删除此 SKU</button></div>`;
  let t;const upd=()=>{s.name=$('#kName').value;s.points=$('#kPoints').value;s.price=$('#kPrice').value;s.rev=(s.rev||0)+1;sh().results.forEach(r=>{if(r.skuId===s.id)r.dirty=true});touch(SHOP);clearTimeout(t);t=setTimeout(()=>{renderSkuList();renderGroups();renderPlan()},400)};
  ['kName','kPoints','kPrice'].forEach(id=>$('#'+id).addEventListener('input',upd));
  $('#kFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const r=await Store.putImage(f);delete s.sample;delete s.lost;delete s.assetId;delete s.localId;delete s.fileUrl;Object.assign(s,r);s.rev=(s.rev||0)+1;sh().results.forEach(x=>{if(x.skuId===s.id)x.dirty=true});touch(SHOP);renderSkuList();renderGroups();renderPlan();toast('已替换商品图，相关图片已重绘')};
  $('#kDel').onclick=()=>{const b=$('#kDel');if(b.dataset.c){const st=sh();st.skus=st.skus.filter(x=>x.id!==s.id);st.results=st.results.filter(r=>r.skuId!==s.id);st.active=st.skus[0]?.id||null;touch(SHOP);renderShopAll();toast('已删除 SKU 及其图片')}else{b.dataset.c=1;b.textContent='再点一次确认删除'}};
}
$('#addSku').onclick=()=>{const s={id:rid('k'),name:'新商品',points:'',price:'',on:true};sh().skus.push(s);sh().active=s.id;touch(SHOP);renderSkuList();renderSkuEdit();renderPlan();$('#kName').select()};
$('#skuFiles').onchange=async e=>{
  const files=[...e.target.files];if(!files.length)return;toast(`正在导入 ${files.length} 个商品…`);let first=null;const proj=SHOP;
  for(const f of files){const r=await Store.putImage(f);const s={id:rid('k'),name:f.name.replace(/\.[^.]+$/,''),points:'',price:'',on:true,...r};proj.state.skus.push(s);first=first||s.id}
  proj.state.active=first;e.target.value='';touch(proj);if(SHOP===proj){renderSkuList();renderSkuEdit();renderPlan()}toast(`已导入 ${files.length} 个 SKU，可以补充名称、卖点和价格`);
};

function allSizeKeys(){return [...Object.keys(SIZES),...Object.keys(sh().customSizes)]}
function planJobs(){const p=sh().plan,out=[];sh().skus.filter(s=>s.on).forEach(s=>p.types.forEach(t=>p.sizes.forEach(z=>{for(let i=0;i<p.per;i++)out.push({skuId:s.id,type:t,style:p.style,size:z})})));return out}
let genBusy=false;
function renderPlan(){
  const p=sh().plan;
  $('#typeChips').innerHTML=Object.entries(TYPES).map(([k,v])=>`<button type="button" class="chip" data-v="${k}" aria-pressed="${p.types.includes(k)}">${v}</button>`).join('');
  fillStyleGrid($('#styleGrid'),p.style);
  $('#sizeChips').innerHTML=allSizeKeys().map(k=>{const s=size(k),cu=!SIZES[k];return `<button type="button" class="chip" data-v="${k}" aria-pressed="${p.sizes.includes(k)}" title="${s.w}×${s.h}">${ratioGlyph(k)}${esc(s.label)}<span class="mono dim">${s.w}×${s.h}</span>${cu?'<span class="x" data-rm="'+k+'" aria-label="删除这个尺寸">×</span>':''}</button>`}).join('');
  $('#perVal').textContent=p.per;
  const n=sh().skus.filter(s=>s.on).length,each=p.types.length*p.sizes.length*p.per,jobs=planJobs(),cost=jobs.reduce((a,j)=>a+priceImage(j.size),0);
  $('#planSum').innerHTML=n&&each?`<span><b>${n}</b> 个 SKU × 每套 <b>${each}</b> 张（${p.types.length} 类型 × ${p.sizes.length} 尺寸 × ${p.per}）= 共 <b>${jobs.length}</b> 张</span>${estHtml(cost)}<span class="hint">每张 ${PRICING.image} 积分</span>`:'<span class="hint">请至少勾选一个 SKU、一种类型和一个尺寸</span>';
  $('#genBtn').disabled=genBusy||!(n&&each)||cost>APP.credits;
  $('#genBtn').innerHTML=genBusy?'生成中…':`生成整套图${n&&each?` <span class="cost">· ${num(cost)} 积分</span>`:''}`;
}
$('#typeChips').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;const t=sh().plan.types,k=b.dataset.v;sh().plan.types=t.includes(k)?t.filter(x=>x!==k):[...t,k];touch(SHOP);renderPlan()};
$('#styleGrid').onclick=e=>{const b=e.target.closest('.style-card');if(!b)return;sh().plan.style=b.dataset.v;touch(SHOP);$$('#styleGrid .style-card').forEach(x=>x.setAttribute('aria-pressed',x===b))};
$('#sizeChips').onclick=e=>{
  const rm=e.target.closest('[data-rm]');if(rm){const k=rm.dataset.rm;if(sh().results.some(r=>r.size===k)){toast('已有图片在用这个尺寸，先删除相关图片再移除');return}delete sh().customSizes[k];sh().plan.sizes=sh().plan.sizes.filter(x=>x!==k);touch(SHOP);renderPlan();return}
  const b=e.target.closest('.chip');if(!b)return;const s=sh().plan.sizes,k=b.dataset.v;sh().plan.sizes=s.includes(k)?s.filter(x=>x!==k):[...s,k];touch(SHOP);renderPlan()};
$('#perMinus').onclick=()=>{sh().plan.per=Math.max(1,sh().plan.per-1);touch(SHOP);renderPlan()};
$('#perPlus').onclick=()=>{sh().plan.per=Math.min(4,sh().plan.per+1);touch(SHOP);renderPlan()};
function bindCustomAdd(box,after){
  const [nm,w,h]=$$('input',box);
  $('button',box).onclick=e=>{e.stopPropagation();const W=Math.round(+w.value),H=Math.round(+h.value);
    if(!(W>=100&&W<=4096&&H>=100&&H<=4096)){toast('宽和高需在 100 到 4096 像素之间');return}
    const k='c'+W+'x'+H;if(SIZES[k]||sh().customSizes[k]){toast('这个尺寸已经存在');return}
    sh().customSizes[k]={label:nm.value.trim()||`自定义 ${W}×${H}`,w:W,h:H};nm.value=w.value=h.value='';touch(SHOP);after(k);toast('已添加自定义尺寸')}}
bindCustomAdd($('#customAddPlan'),k=>{sh().plan.sizes.push(k);renderPlan()});
bindCustomAdd($('#customAddPop'),k=>{renderPlan();renderSizeList([...$$('#sizeList input:checked').map(i=>i.value),k])});

function renderGroups(){
  const st=sh(),G=$('#groups');
  const used=st.skus.filter(s=>st.results.some(r=>r.skuId===s.id));
  if(st.filter!=='all'&&!used.find(s=>s.id===st.filter))st.filter='all';
  $('#filter').innerHTML=used.length>1?[`<button class="chip" data-f="all" aria-pressed="${st.filter==='all'}">全部 SKU</button>`,...used.map(s=>`<button class="chip" data-f="${s.id}" aria-pressed="${st.filter===s.id}">${esc(s.name||'未命名')}</button>`)].join(''):'';
  const skel=$('.skel-wrap',G);
  $$('.group:not(.skel-wrap)',G).forEach(g=>g.remove());$$('.empty',G).forEach(g=>g.remove());
  if(!st.results.length){if(!skel)G.insertAdjacentHTML('beforeend','<div class="panel empty">还没有图片。在左侧勾选 SKU、设好套图方案后点「生成整套图」。</div>');updateSel();return}
  const show=st.filter==='all'?used:used.filter(s=>s.id===st.filter);
  show.forEach(s=>{
    const rs=st.results.filter(r=>r.skuId===s.id);const sec=document.createElement('section');sec.className='group';sec.dataset.sku=s.id;
    sec.innerHTML=`<div class="group-h"><div class="th"></div><h3>${esc(s.name||'未命名商品')}</h3><span class="hint">${rs.length} 张</span><button class="btn sm ghost" data-gsel>${rs.every(r=>r.sel)?'取消本组':'全选本组'}</button></div><div class="grid"></div>`;
    $('.th',sec).appendChild(skuThumb(s,56));const grid=$('.grid',sec);
    rs.slice().reverse().forEach(r=>{
      let cv=CANV.get(r.id);if(!cv||r.dirty){cv=cv||document.createElement('canvas');r.dirty=false;renderImage(cv,r);CANV.set(r.id,cv)}
      const sz=size(r.size),el=document.createElement('article');el.className='panel card'+(r.sel?' sel':'');el.dataset.id=r.id;
      el.innerHTML=`<div class="frame"><button class="check" aria-label="选择">✓</button><span class="ver">${r.demo?'示例':'v'+r.ver}</span></div><div class="meta"><div class="tags"><span class="tag t">${TYPES[r.type]}</span><span class="tag">${(STYLES[r.style]||STYLES.minimal).name}</span><span class="tag">${esc(sz.label)}</span></div><div class="card-actions"><span class="mono">${sz.w}×${sz.h}</span><button class="btn ghost sm" data-act="regen" title="消耗 ${priceImage(r.size)} 积分">重新生成</button></div></div>`;
      $('.frame',el).prepend(cv);grid.appendChild(el)});
    G.appendChild(sec);
  });
  updateSel();
}
$('#filter').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;sh().filter=b.dataset.f;renderGroups()};
function updateSel(){const R=sh().results,n=R.filter(r=>r.sel).length;$('#selCount').innerHTML=`共 <b>${R.length}</b> 张 · 已选 <b>${n}</b> 张`;['resizeBtn','restyleBtn','exportBtn','delBtn'].forEach(id=>$('#'+id).disabled=!n);$('#selAll').textContent=n&&n===R.length?'取消全选':'全选'}
$('#groups').onclick=e=>{
  const gs=e.target.closest('[data-gsel]');if(gs){const id=gs.closest('.group').dataset.sku,rs=sh().results.filter(r=>r.skuId===id),all=rs.every(r=>r.sel);rs.forEach(r=>r.sel=!all);renderGroups();return}
  const card=e.target.closest('.card[data-id]');if(!card)return;const r=sh().results.find(x=>x.id==card.dataset.id);if(!r)return;
  if(e.target.closest('.check')){r.sel=!r.sel;card.classList.toggle('sel',r.sel);updateSel();const g=card.closest('.group'),rs=sh().results.filter(x=>x.skuId===g.dataset.sku);$('[data-gsel]',g).textContent=rs.every(x=>x.sel)?'取消本组':'全选本组';return}
  if(e.target.closest('[data-act=regen]')){const proj=SHOP,cost=priceImage(r.size);if(!spend(proj,cost))return;const b=e.target.closest('[data-act]');b.disabled=true;b.textContent='生成中…';inflight(proj,cost);
    API.generateImages([{skuId:r.skuId,type:r.type,style:r.style,size:r.size,seed:rseed()}]).then(([j])=>{inflight(proj,-cost);if(j.error){refund(proj,cost);b.disabled=false;b.textContent='重新生成';toast('生成失败，已退回积分：'+j.error);return}r.seed=j.seed;r.url=j.url;r.ver++;r.demo=false;r.dirty=true;touch(proj);if(SHOP===proj)renderGroups();toast(`已重新生成，消耗 ${cost} 积分`);logHistory(proj,'重新生成 1 张图',`${skuById(r.skuId)?.name||''} · ${TYPES[r.type]}`,cost)});return}
  if(e.target.closest('.frame')){renderImage($('#modalCv'),r,1000);const s=size(r.size);$('#modalMeta').textContent=`${skuById(r.skuId)?.name||''} · ${TYPES[r.type]} · ${STYLES[r.style].name} · ${s.label} ${s.w}×${s.h}`;$('#modal').hidden=false}
};
$('#modal').onclick=()=>$('#modal').hidden=true;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#modal').hidden=true;$('#kfEd').hidden=true;$$('.pop').forEach(p=>p.hidden=true)}});

function showSkeleton(total,label){
  const G=$('#groups');$$('.empty',G).forEach(e=>e.remove());const w=document.createElement('div');w.className='skel-wrap group';
  const n=Math.min(total,6);w.innerHTML=`<div class="group-h"><h3>生成中</h3><span class="hint">${esc(label)} · 共 ${total} 张</span></div><div class="grid">${Array.from({length:n},()=>`<article class="panel card"><div class="frame" style="cursor:default"><div style="width:100%"><div class="skel-bar"><i></i></div><div class="skel-txt">排队中</div></div></div></article>`).join('')}</div>`;
  G.prepend(w);
  return{update(p){const pct=p*100;$$('.skel-bar i',w).forEach((b,i)=>{const v=Math.max(0,Math.min(100,pct*1.4-i*8));b.style.width=v+'%';b.parentNode.nextElementSibling.textContent=v>0?'生成中':'排队中'})},remove(){w.remove()}};
}
function runImageJobs(proj,jobs,label,after){
  const cost=jobs.reduce((a,j)=>a+priceImage(j.size),0);if(!spend(proj,cost))return;
  genBusy=true;renderPlan();const sk=showSkeleton(jobs.length,label);inflight(proj,cost);
  API.generateImages(jobs,p=>sk.update(p)).then(res=>{sk.remove();genBusy=false;inflight(proj,-cost);const bad=res.filter(j=>j.error),ok=res.filter(j=>!j.error),back=bad.reduce((a,j)=>a+priceImage(j.size),0);refund(proj,back);if(ok.length)after(ok,cost-back);if(bad.length)toast(`${bad.length} 张生成失败，已退回 ${num(back)} 积分：${bad[0].error}`);touch(proj);if(SHOP===proj){renderGroups();renderSkuList()}renderPlan()});
}
$('#genBtn').onclick=()=>{
  const proj=SHOP,p=sh().plan,skus=sh().skus.filter(s=>s.on),jobs=planJobs().map(j=>({...j,seed:rseed()}));if(!jobs.length)return;
  runImageJobs(proj,jobs,`${skus.length} 个 SKU 的整套图`,(res,cost)=>{proj.state.results.push(...res.map(j=>({...j,id:rid('r'),ver:1})));toast(`已为 ${skus.length} 个 SKU 生成 ${res.length} 张图，消耗 ${num(cost)} 积分`);logHistory(proj,`生成整套图 ${res.length} 张`,`${skus.length} 个 SKU · ${p.types.map(t=>TYPES[t]).join('/')} · ${STYLES[p.style].name}`,cost)});
};
$('#selAll').onclick=()=>{const R=sh().results,all=R.every(r=>r.sel);R.forEach(r=>r.sel=!all);renderGroups()};
$('#delBtn').onclick=()=>{const st=sh(),n=st.results.filter(r=>r.sel).length;st.results=st.results.filter(r=>{if(r.sel)CANV.delete(r.id);return!r.sel});touch(SHOP);renderGroups();renderSkuList();toast(`已删除 ${n} 张`)};
$('#exportBtn').onclick=()=>{
  if(!LIVE.on){toast('演示模式不能导出。部署后端后可下载原尺寸图片');return}
  const sel=sh().results.filter(r=>r.sel);
  sel.forEach((r,i)=>setTimeout(()=>{const z=size(r.size),cv=document.createElement('canvas');renderImage(cv,r,Math.max(z.w,z.h));
    cv.toBlob(bl=>{const u=URL.createObjectURL(bl);saveUrl(u,`${(skuById(r.skuId)?.name||'商品').replace(/[\\/:*?"<>|]/g,'')}_${TYPES[r.type]}_${z.w}x${z.h}.png`);setTimeout(()=>URL.revokeObjectURL(u),4000)},'image/png')},i*350));
  toast(`开始下载 ${sel.length} 张原尺寸图片`)};
function togglePop(id){$$('.pop').forEach(p=>{if(p.id!==id)p.hidden=true});$('#'+id).hidden=!$('#'+id).hidden}
function resizeJobs(){const sizes=$$('#sizeList input:checked').map(i=>i.value),jobs=[];sh().results.filter(r=>r.sel).forEach(r=>sizes.forEach(s=>{if(s!==r.size)jobs.push({skuId:r.skuId,type:r.type,style:r.style,seed:r.seed,size:s,...(r.url?{from:r.url,task:'resize'}:{})})}));return{sizes,jobs}}
function updResizeEst(){const {jobs}=resizeJobs(),cost=jobs.reduce((a,j)=>a+priceImage(j.size),0);$('#resizeEst').outerHTML=`<span class="est" id="resizeEst">${jobs.length} 张 · ${num(cost)} 积分</span>`;$('#resizeApply').disabled=!jobs.length||cost>APP.credits}
function renderSizeList(checked){$('#sizeList').innerHTML=allSizeKeys().map(k=>{const v=size(k);return `<label class="size-opt"><input type="checkbox" value="${k}" ${checked.includes(k)?'checked':''}>${ratioGlyph(k)}<span>${esc(v.label)}</span><span class="mono">${v.w}×${v.h}</span></label>`}).join('');updResizeEst()}
$('#sizeList').addEventListener('change',updResizeEst);
$('#resizeBtn').onclick=e=>{e.stopPropagation();renderSizeList(['xhs','dy']);togglePop('resizePop')};
$('#restyleBtn').onclick=e=>{e.stopPropagation();fillStyleGrid($('#restyleGrid'),'cream');const sel=sh().results.filter(r=>r.sel),cost=sel.reduce((a,r)=>a+priceImage(r.size),0);$('#restyleEst').textContent=`${sel.length} 张 · ${num(cost)} 积分`;$('#restyleApply').disabled=cost>APP.credits;togglePop('restylePop')};
$('#restyleGrid').onclick=e=>{const b=e.target.closest('.style-card');if(!b)return;$$('#restyleGrid .style-card').forEach(x=>x.setAttribute('aria-pressed',x===b))};
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('.pop').hidden=true);
document.addEventListener('click',e=>{if(!e.target.closest('.pop')&&!e.target.closest('#resizeBtn,#restyleBtn'))$$('.pop').forEach(p=>p.hidden=true)});
$('#resizeApply').onclick=()=>{
  const proj=SHOP,{sizes,jobs}=resizeJobs();$('#resizePop').hidden=true;if(!jobs.length)return;
  runImageJobs(proj,jobs,'按新尺寸重排版',(res,cost)=>{proj.state.results.push(...res.map(j=>({...j,id:rid('r'),ver:1})));proj.state.results.forEach(r=>r.sel=false);toast(`已生成 ${res.length} 张新尺寸图片，消耗 ${num(cost)} 积分`);logHistory(proj,`批量改尺寸 ${res.length} 张`,sizes.map(k=>size(k).label).join('、'),cost)});
};
$('#restyleApply').onclick=()=>{
  const proj=SHOP,st=$('#restyleGrid [aria-pressed=true]').dataset.v,sel=sh().results.filter(r=>r.sel);$('#restylePop').hidden=true;
  runImageJobs(proj,sel.map(r=>({rid:r.id,skuId:r.skuId,type:r.type,style:st,size:r.size,seed:r.seed,...(r.url?{from:r.url,task:'restyle'}:{})})),'替换风格',(res,cost)=>{res.forEach(j=>{const r=sel.find(x=>x.id===j.rid);if(!r)return;r.style=st;r.url=j.url;r.seed=j.seed;r.ver++;r.demo=false;r.dirty=true});toast(`已将 ${res.length} 张改为「${STYLES[st].name}」，消耗 ${num(cost)} 积分`);logHistory(proj,`批量改风格 ${sel.length} 张`,'改为 '+STYLES[st].name,cost)});
};
$('#pnameShop').addEventListener('input',e=>{SHOP.name=e.target.value||'未命名项目';touch(SHOP)});

/* ================= 短剧 ================= */
const MOODS={
  night:{bg:['#0B1230','#26386B'],rim:'#8FB2FF',fig:'#05070F'},
  warm:{bg:['#3E2014','#C27A43'],rim:'#FFD29A',fig:'#1A0C06'},
  cold:{bg:['#162327','#4C6A72'],rim:'#BFE7EE',fig:'#070D0F'},
  day:{bg:['#8FC0E6','#EAF2F7'],rim:'#FFFFFF',fig:'#2A3440'},
  red:{bg:['#2C070C','#8E1F28'],rim:'#FF9C9C',fig:'#0C0204'},
};
const MOOD_NAME={night:'夜景',warm:'暖光',cold:'冷调',day:'日景',red:'压迫'};
const LOOK_NAME={real:'写实',film:'电影感',anime:'动漫'};
const SCALES=['远景','全景','中景','近景','特写'],CAMS=['固定','推','拉','摇','跟','手持'];
const CHAR_COLORS=['#E4572E','#3A86FF','#2A9D8F','#F4A261','#C44569','#7A9E3A'];
const GENRES={
  '都市逆袭':{title:'重回发布会',syn:'被合伙人踢出公司的产品经理林夏，在新品发布会当天带着自己的原型机重返现场，当众拿出带时间戳的设计稿，揭穿对方窃取方案。',
    chars:[['林夏','女主，前产品负责人','短发，灰色西装'],['周屹','前合伙人，现任 CEO','梳背头，深蓝领带'],['主持人','发布会主持','黑色礼服']],shots:[
    ['远景','night','雨夜，写字楼灯火通明，林夏抱着纸箱走出旋转门。','旁白：三年心血，一纸通知就没了。',4,'推',[0]],
    ['近景','cold','纸箱里的原型机屏幕自己亮起，显示「项目未结束」。','',3,'推',[]],
    ['中景','warm','发布会后台，周屹对着镜子整理领带，助理递来讲稿。','周屹：今天之后，这个产品只姓周。',4,'跟',[1]],
    ['全景','day','发布会现场座无虚席，大屏亮起产品名。','主持人：有请周总！',3,'摇',[2]],
    ['近景','night','林夏推开会场侧门，逆光站定。','林夏：周总，演示之前，先看看这个。',4,'推',[0]],
    ['特写','red','周屹的笑容僵住，握着话筒的手慢慢收紧。','',3,'推',[1]],
    ['中景','warm','林夏把原型机接上大屏，屏幕上出现带时间戳的设计稿。','林夏：每一版，我都留了底。',5,'固定',[0,1]],
    ['全景','day','台下哗然，记者纷纷起身拍照，林夏转身离场。','旁白：属于她的发布会，现在才开始。',4,'拉',[0]]]},
  '甜宠':{title:'咖啡续杯',syn:'打工第一天就把咖啡泼在客人身上的苏小满，第二天才发现那位客人是咖啡馆的老板顾言，而他每天都来点同一杯咖啡。',
    chars:[['苏小满','女主，咖啡馆新店员','马尾，米色围裙'],['顾言','男主，咖啡馆老板','白衬衫，金边眼镜']],shots:[
    ['全景','day','清晨的街角咖啡馆，苏小满手忙脚乱地系围裙。','旁白：打工第一天，她就闯了祸。',3,'摇',[0]],
    ['近景','warm','咖啡泼在顾言的白衬衫上，两人同时愣住。','苏小满：对、对不起！',3,'推',[0,1]],
    ['特写','warm','顾言低头看了眼衬衫，嘴角微微上扬。','',2,'固定',[1]],
    ['中景','day','顾言把名片放在吧台上，推到她面前。','顾言：赔偿方案，明早八点，我来取咖啡。',4,'固定',[1,0]],
    ['近景','warm','苏小满翻过名片，看到「本店老板」四个字，捂住了脸。','',3,'推',[0]],
    ['全景','day','第二天清晨，顾言准时推门而入，窗外阳光正好。','旁白：后来，她每天都多做一杯。',4,'拉',[1]]]},
  '悬疑':{title:'第七个房客',syn:'陈默租下一间便宜得反常的老公寓。入住第一晚，有人从门缝塞进一张照片，照片上是三年前的他自己。',
    chars:[['陈默','男主，新租客','黑色连帽衫'],['房东','中年女人','手腕有伤痕']],shots:[
    ['远景','cold','老旧公寓楼，只有七楼的一扇窗亮着灯。','旁白：这栋楼，三年前就该没人住了。',4,'推',[]],
    ['中景','night','陈默提着行李站在楼道，声控灯忽明忽暗。','',3,'跟',[0]],
    ['近景','cold','房东递来钥匙，手腕上有一道新鲜的划痕。','房东：晚上听到敲门，别开。',4,'固定',[1,0]],
    ['特写','night','门缝下缓缓塞进一张泛黄的照片。','',3,'推',[]],
    ['近景','red','照片上是陈默自己，日期写着三年前。','陈默：这不可能……',3,'推',[0]],
    ['全景','night','陈默猛地拉开门，楼道空无一人，只剩一串湿脚印。','旁白：第七个房客，已经到了。',4,'手持',[0]]]},
};
const FILLERS=[
  ['全景','day','转场：城市延时摄影，车流与灯光交替。','',2,'摇',[]],
  ['近景','cold','主角独处，回想刚才发生的一切，神情复杂。','旁白：有些事，已经回不去了。',3,'推',[0]],
  ['特写','night','手机屏幕亮起，一条未读消息。','',2,'固定',[]],
  ['中景','warm','两人隔着桌子对视，空气安静下来。','',3,'固定',[0,1]],
];
const VARIANTS=['，镜头从人物背后切入','，以玻璃倒影呈现','，做慢动作处理','，前景加入虚化遮挡','，光影从侧面打入'];

function newDramaState(genre='都市逆袭'){const st={genre,dirty:false,len:30,nShots:8,ratio:'9:16',look:'real',voice:'AI 配音 + 字幕',step:1,maxStep:1,chars:[],shots:[],time:0};fillGenreInto(st,genre);return st}
function fillGenreInto(st,g){const x=GENRES[g];st.title=x.title;st.syn=x.syn;st.chars=x.chars.map((c,i)=>({id:rid('c'),name:c[0],role:c[1],look:c[2],color:CHAR_COLORS[i%CHAR_COLORS.length]}));st.dirty=false}
// 生成中的状态（kf=run、video=wait/run）原样保存，下次打开项目时由 recoverInterrupted 处理
function packDrama(st){const{time,...rest}=st;return{...rest,chars:st.chars.map(({src,...c})=>c),shots:st.shots.map(s=>({...s,p:0,kp:0}))}}
function unpackDrama(st){const d=newDramaState();st=JSON.parse(JSON.stringify(st||{}));return{...d,...st,time:0}}
const dr=()=>DRAMA.state;
const charById=id=>dr().chars.find(c=>c.id===id);

function toShot(a,chars){return{id:rid('s'),scale:a[0],mood:a[1],desc:a[2],line:a[3],dur:a[4],cam:a[5],cast:(a[6]||[]).map(i=>chars[i]?.id).filter(Boolean),seed:rseed(),kf:'none',video:'none',patches:[]}}
function mockStoryboard(story){
  const pool=GENRES[story.genre].shots,n=story.nShots,out=[];
  for(let i=0;i<n;i++)out.push(toShot(i<pool.length?pool[i]:FILLERS[(i-pool.length)%FILLERS.length],story.chars));
  if(n>pool.length){const extra=out.splice(pool.length);out.splice(Math.max(1,pool.length-1),0,...extra)}
  return out;
}
function defaultPrompt(s){
  const cast=(s.cast||[]).map(charById).filter(Boolean).map(c=>`${c.name}（${[c.role,c.look].filter(Boolean).join('，')}）`).join('、');
  return `${s.scale}，${s.cam}镜头。${s.desc}${cast?`\n出镜角色：${cast}，保持与角色卡参考图一致。`:''}\n光线：${MOOD_NAME[s.mood]}。画风：${LOOK_NAME[dr().look]}。画面比例：${dr().ratio}。`;
}

function figure(c,x,base,h,col,tint,rim,lw,img){
  const hr=h*.11,hy=base-h+hr;
  c.fillStyle=col;c.beginPath();c.moveTo(x-h*.21,base);c.quadraticCurveTo(x-h*.23,base-h*.62,x-h*.07,base-h+hr*2.15);c.lineTo(x+h*.07,base-h+hr*2.15);c.quadraticCurveTo(x+h*.23,base-h*.62,x+h*.21,base);c.closePath();c.fill();
  if(tint){c.save();c.globalAlpha=.55;c.fillStyle=tint;c.fill();c.restore();c.strokeStyle=tint;c.lineWidth=lw;c.stroke()}
  c.beginPath();c.arc(x,hy,hr,0,7);
  if(img){c.save();c.clip();const iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight,k=Math.max(hr*2/iw,hr*2/ih);c.drawImage(img,x-iw*k/2,hy-ih*k/2,iw*k,ih*k);c.restore()}
  else{c.fillStyle=col;c.fill()}
  c.beginPath();c.arc(x,hy,hr,0,7);c.strokeStyle=tint||rim;c.lineWidth=lw*1.2;c.stroke();
  return hy-hr;
}
function drawScene(c,W,H,sh,t,opt){
  const p=MOODS[sh.mood]||MOODS.night,R=rng(sh.seed+1);
  c.save();
  const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,p.bg[0]);g.addColorStop(1,p.bg[1]);c.fillStyle=g;c.fillRect(0,0,W,H);
  let s=1,tx=0,ty=0;
  if(sh.cam==='推')s=1+.14*t;else if(sh.cam==='拉')s=1.14-.14*t;else if(sh.cam==='摇')tx=(t-.5)*W*.12;else if(sh.cam==='跟'){tx=(.5-t)*W*.06;s=1.05}else if(sh.cam==='手持'){tx=Math.sin(t*23)*W*.008;ty=Math.cos(t*17)*H*.006;s=1.04}
  c.translate(W/2,H/2);c.scale(s,s);c.translate(-W/2+tx,-H/2+ty);
  const m=Math.min(W,H),idx=Math.max(0,SCALES.indexOf(sh.scale));
  if(idx<=1){const hz=H*(idx===0?.62:.7);
    for(let i=0;i<14;i++){const bw=W*(.05+R()*.08),bh=H*(.12+R()*.35),bx=i*W/12-W*.05;c.fillStyle='rgba(0,0,0,'+(.25+R()*.2)+')';c.fillRect(bx,hz-bh,bw,bh);c.fillStyle=p.rim+'55';for(let k=0;k<6;k++)if(R()>.45)c.fillRect(bx+bw*.2+R()*bw*.5,hz-bh+R()*bh*.9,m*.008,m*.012)}
    c.fillStyle='rgba(0,0,0,.35)';c.fillRect(0,hz,W,H-hz);
  }else if(idx===2){c.fillStyle='rgba(255,255,255,.06)';c.fillRect(W*(.06+R()*.08),H*.12,W*.32,H*.4);c.fillRect(W*(.54+R()*.08),H*.12,W*.32,H*.4);c.fillStyle='rgba(0,0,0,.28)';c.fillRect(0,H*.74,W,H*.26)}
  else{for(let i=0;i<9;i++){c.fillStyle=p.rim+(R()>.5?'22':'14');c.beginPath();c.arc(R()*W,R()*H*.7,m*(.04+R()*.1),0,7);c.fill()}}
  if(/雨/.test(sh.desc)){c.strokeStyle='rgba(200,220,255,.28)';c.lineWidth=Math.max(1,m*.003);for(let i=0;i<70;i++){const x=R()*W,y=(R()*H+t*H*2)%H;c.beginPath();c.moveTo(x,y);c.lineTo(x-m*.01,y+m*.05);c.stroke()}}
  const cast=(sh.cast||[]).map(charById).filter(Boolean).slice(0,3),n=cast.length;
  const wideK=W>H?1.2:1,fh=[.16,.34,.6,.95,1.5][idx]*H*wideK,base=[H*.64,H*.74,H*.98,H*1.18,H*1.6][idx];
  const xs=n===1?[W*(.42+R()*.16)]:n===2?[W*.32,W*.68]:n===3?[W*.22,W*.5,W*.78]:[];
  if(n===0&&idx>=3){c.fillStyle='rgba(255,255,255,.12)';rr(c,W*.25,H*.4,W*.5,H*.2,m*.02);c.fill();c.fillStyle=p.rim+'88';c.fillRect(W*.3,H*.46,W*.4,m*.012);c.fillRect(W*.3,H*.5,W*.28,m*.012)}
  const tags=[];
  cast.forEach((ch,i)=>{const src=srcOf(ch),img=src?loadImg(src,opt.onImg):null;const top=figure(c,xs[i],base,fh*(i?0.96:1),p.fig,ch.color,p.rim,Math.max(1,m*.006),img);tags.push([xs[i],top,ch])});
  c.restore();return tags;
}
const imgRepaint=()=>onFrame('dramaImg',()=>{if(APP.view!=='drama'||!DRAMA)return;const st=DRAMA.state;if(st.step===3)renderKf();else if(st.step===4)renderStudio();else if(st.step===2&&typeof renderShots==='function')renderShots()});
function drawReal(c,W,H,sh,t,opt){
  const on=opt.onImg||imgRepaint,im=loadImg(sh.kfUrl,on);
  c.fillStyle='#0C0D10';c.fillRect(0,0,W,H);
  if(!im){c.fillStyle='#8A8F96';c.font=Math.max(10,Math.min(W,H)*.05)+'px '+FONT;c.textAlign='center';c.fillText('加载中…',W/2,H/2);return true}
  let k=1,tx=0;if(opt.meta){if(sh.cam==='推')k=1+.08*t;else if(sh.cam==='拉')k=1.08-.08*t;else if(sh.cam==='摇')tx=(t-.5)*W*.06}
  const cover=img=>{const q=Math.max(W/img.naturalWidth,H/img.naturalHeight)*k,iw=img.naturalWidth*q,ih=img.naturalHeight*q;return[(W-iw)/2+tx,(H-ih)/2,iw,ih]};
  c.drawImage(im,...cover(im));
  (sh.patches||[]).forEach(pt=>{if(!pt.url)return;const pi=loadImg(pt.url,on);if(!pi)return;c.save();c.beginPath();c.rect(pt.x*W,pt.y*H,pt.w*W,pt.h*H);c.clip();c.drawImage(pi,...cover(pi));c.restore()});
  return true;
}
function drawFrame(c,W,H,sh,t,opt={}){
  const look=opt.look||dr().look,m=Math.min(W,H);
  c.clearRect(0,0,W,H);
  const real=!!sh.kfUrl&&drawReal(c,W,H,sh,t,opt);
  const tags=real?[]:drawScene(c,W,H,sh,t,opt);
  if(!real)(sh.patches||[]).forEach(pt=>{const off=document.createElement('canvas');off.width=W;off.height=H;drawScene(off.getContext('2d'),W,H,{...sh,seed:pt.seed},t,opt);
    c.save();c.beginPath();c.rect(pt.x*W,pt.y*H,pt.w*W,pt.h*H);c.clip();c.drawImage(off,0,0);c.restore()});
  if(opt.tags)tags.forEach(([x,top,ch])=>{const fs=Math.max(9,m*.04);c.font='500 '+fs+'px '+FONT;const w=c.measureText(ch.name).width+fs;const y=Math.max(fs*1.6,Math.min(H-fs*2,top-fs*.6));c.fillStyle=ch.color;rr(c,x-w/2,y-fs*1.2,w,fs*1.5,fs*.4);c.fill();c.fillStyle='#fff';c.textAlign='center';c.fillText(ch.name,x,y)});
  if(!real&&look==='anime'){c.save();c.globalCompositeOperation='overlay';c.fillStyle='rgba(255,170,215,.28)';c.fillRect(0,0,W,H);c.restore();c.save();c.globalCompositeOperation='soft-light';c.fillStyle='rgba(255,255,255,.25)';c.fillRect(0,0,W,H);c.restore()}
  if(!real&&look==='film'){c.save();c.globalCompositeOperation='overlay';c.fillStyle='rgba(30,90,110,.25)';c.fillRect(0,0,W,H);c.restore()}
  const lb=!real&&look==='film'?H*(W>H?.1:.08):0;if(lb){c.fillStyle='#000';c.fillRect(0,0,W,lb);c.fillRect(0,H-lb,W,lb)}
  const v=c.createRadialGradient(W/2,H/2,m*.3,W/2,H/2,Math.max(W,H)*.75);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,'+(look==='anime'?.2:.45)+')');c.fillStyle=v;if(!real)c.fillRect(0,0,W,H);
  if(opt.meta){c.fillStyle='rgba(255,255,255,.75)';c.font='500 '+m*.04+'px "IBM Plex Mono",monospace';c.textAlign='left';c.fillText(`S${pad2(opt.no||1)} · ${sh.scale} · ${sh.cam}`,m*.05,lb+m*.08)}
  if(opt.sub&&sh.line){const fs=m*.05;c.font='500 '+fs+'px '+FONT;c.textAlign='center';const lines=wrap(c,sh.line,W*.84);let y=H-lb-m*.1-(lines.length-1)*fs*1.3;
    lines.forEach(l=>{c.lineWidth=fs*.18;c.strokeStyle='rgba(0,0,0,.7)';c.strokeText(l,W/2,y);c.fillStyle='#fff';c.fillText(l,W/2,y);y+=fs*1.3})}
}
function frameDims(w){return dr().ratio==='16:9'?[w,Math.round(w*9/16)]:[Math.round(w*9/16),w]}
function paintShot(cv,sh,no,w,opt={}){const [W,H]=frameDims(w);cv.width=W;cv.height=H;drawFrame(cv.getContext('2d'),W,H,sh,.5,{no,...opt})}

function renderDramaAll(){
  const st=dr();$('#pnameDrama').value=DRAMA.name;showSave(DRAMA);renderWallet();
  $('#dTitle').value=st.title;$('#dSyn').value=st.syn;$('#dLen').value=String(st.len);$('#dShots').value=String(st.nShots);$('#vVoice').value=st.voice;
  $$('#ratioSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===st.ratio));
  $('#genreChips').innerHTML=Object.keys(GENRES).map(g=>`<button type="button" class="chip" data-v="${g}" aria-pressed="${g===st.genre}">${g}</button>`).join('');
  delete $('#toScript').dataset.c;setScriptBtn();renderCast();goStep(st.step,true);
}
function setScriptBtn(){const b=$('#toScript');if(b.disabled)return;b.innerHTML=b.dataset.c?'会覆盖现有分镜，再点一次确认':`生成分镜脚本 <span class="cost">· ${PRICING.storyboard} 积分</span>`}
function renderSteps(){
  const st=dr(),names=['故事设定','分镜脚本','关键帧确认','视频生成'],S=st.shots,okS=S.filter(s=>s.kf==='ok');
  const done=[S.length>0,S.length>0&&st.maxStep>2,S.length>0&&okS.length===S.length,okS.length>0&&okS.every(s=>s.video==='done')];
  $('#steps').innerHTML=names.map((n,i)=>{const d=done[i]&&st.step!==i+1;return `${i?'<span class="step-sep"></span>':''}<button class="step ${d?'done':''}" data-s="${i+1}" aria-current="${st.step===i+1}" ${i+1>st.maxStep?'disabled':''}><span class="n">${d?'✓':i+1}</span>${n}</button>`}).join('');
}
$('#steps').onclick=e=>{const b=e.target.closest('.step');if(b&&!b.disabled)goStep(+b.dataset.s)};
function goStep(n,quiet){const st=dr();st.step=n;st.maxStep=Math.max(st.maxStep,n);['d1','d2','d3','d4'].forEach((id,i)=>$('#'+id).hidden=i+1!==n);renderSteps();if(n===1)renderLooks();if(n===2)renderShots();if(n===3)renderKf();if(n===4)renderStudio();stopPlay();if(!quiet)touch(DRAMA)}

$('#genreChips').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;const st=dr();st.genre=b.dataset.v;$$('#genreChips .chip').forEach(x=>x.setAttribute('aria-pressed',x===b));if(!st.dirty){fillGenreInto(st,st.genre);$('#dTitle').value=st.title;$('#dSyn').value=st.syn;renderCast()}touch(DRAMA)};
$('#dTitle').addEventListener('input',e=>{dr().title=e.target.value;dr().dirty=true;touch(DRAMA)});
$('#dSyn').addEventListener('input',e=>{dr().syn=e.target.value;dr().dirty=true;touch(DRAMA)});
$('#dLen').onchange=e=>{dr().len=+e.target.value;touch(DRAMA)};
$('#dShots').onchange=e=>{dr().nShots=+e.target.value;touch(DRAMA)};
$('#ratioSeg').onclick=e=>{const b=e.target.closest('button');if(!b||b.dataset.v===dr().ratio)return;dr().ratio=b.dataset.v;$$('#ratioSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b));resetFrames('画面比例已更改，关键帧和视频需要重新生成');touch(DRAMA);renderLooks()};
function resetFrames(msg){const st=dr();if(st.shots.some(s=>s.kf!=='none'||s.video!=='none')){st.shots.forEach(s=>{s.kf='none';s.video='none';s.patches=[];delete s.kfUrl;delete s.videoUrl});renderSteps();toast(msg)}}

/* 画风预览：用本剧第一个有角色出镜的镜头（还没有分镜时用题材示例镜头）各出一张 */
function lookSampleShot(){const st=dr();const s=st.shots.find(x=>x.cast&&x.cast.length)||st.shots[0];if(s)return{...s,patches:[],kfUrl:undefined};const g=GENRES[st.genre].shots;return{...toShot(g.find(a=>a[6].length)||g[0],st.chars),seed:11}}
function renderLooks(){
  const G=$('#lookGrid'),s=lookSampleShot(),cur=dr().look;G.innerHTML='';
  Object.entries(LOOK_NAME).forEach(([k,v])=>{const b=document.createElement('button');b.type='button';b.className='style-card';b.dataset.v=k;b.setAttribute('aria-pressed',k===cur);
    const cv=document.createElement('canvas');const [W,H]=frameDims(dr().ratio==='16:9'?240:200);cv.width=W;cv.height=H;drawFrame(cv.getContext('2d'),W,H,s,.5,{look:k,onImg:()=>renderLooks()});
    b.appendChild(cv);b.insertAdjacentHTML('beforeend',`<span>${v}</span>`);G.appendChild(b)});
}
$('#lookGrid').onclick=e=>{const b=e.target.closest('.style-card');if(!b||b.dataset.v===dr().look)return;dr().look=b.dataset.v;$$('#lookGrid .style-card').forEach(x=>x.setAttribute('aria-pressed',x===b));resetFrames('画风已更改，关键帧和视频需要重新生成');touch(DRAMA)};

function drawAvatar(cv,ch){
  cv.width=168;cv.height=210;const c=cv.getContext('2d');const g=c.createLinearGradient(0,0,0,210);g.addColorStop(0,ch.color+'55');g.addColorStop(1,ch.color);c.fillStyle=g;c.fillRect(0,0,168,210);
  const src=srcOf(ch),img=src?loadImg(src,renderCast):null;
  if(img){const iw=img.naturalWidth,ih=img.naturalHeight,k=Math.max(168/iw,210/ih);c.drawImage(img,84-iw*k/2,105-ih*k/2,iw*k,ih*k)}
  else{figure(c,84,250,230,'rgba(10,10,14,.75)',null,'rgba(255,255,255,.6)',2,null);c.fillStyle='rgba(255,255,255,.92)';c.font='700 30px '+FONT;c.textAlign='center';c.fillText((ch.name||'?').slice(0,1),84,74)}
}
function renderCast(){
  const st=dr(),C=$('#cast');C.innerHTML='';
  st.chars.forEach(ch=>{
    const el=document.createElement('div');el.className='char';el.dataset.id=ch.id;
    el.innerHTML=`<div class="av"><canvas></canvas><span class="src">${srcOf(ch)?'参考图':'自动形象'}</span></div><div class="char-f">
      <input type="text" class="nm" data-k="name" value="${esc(ch.name)}" aria-label="角色名">
      <input type="text" data-k="role" value="${esc(ch.role)}" placeholder="身份" aria-label="身份">
      <input type="text" data-k="look" value="${esc(ch.look)}" placeholder="外形，如 短发、灰色西装" aria-label="外形">
      <div class="char-acts"><div class="swatches">${CHAR_COLORS.map(c=>`<button type="button" style="background:${c}" data-color="${c}" aria-pressed="${c===ch.color}" aria-label="主色"></button>`).join('')}</div>
      <label class="btn sm ghost file-label">参考图<input type="file" accept="image/*" data-up></label><button class="btn sm ghost danger" data-rm>删除</button></div></div>`;
    drawAvatar($('canvas',el),ch);C.appendChild(el)});
  C.insertAdjacentHTML('beforeend','<button class="add-char" id="addChar">＋ 添加角色</button>');
  if(dr().step===1)renderLooks();
}
$('#cast').addEventListener('input',e=>{const el=e.target.closest('.char'),k=e.target.dataset.k;if(!el||!k)return;const ch=charById(el.dataset.id);ch[k]=e.target.value;dr().dirty=true;if(k==='name')drawAvatar($('canvas',el),ch);touch(DRAMA)});
$('#cast').addEventListener('change',async e=>{if(!e.target.matches('[data-up]'))return;const f=e.target.files[0];if(!f)return;const proj=DRAMA,ch=charById(e.target.closest('.char').dataset.id);const r=await Store.putImage(f);delete ch.assetId;delete ch.localId;delete ch.fileUrl;Object.assign(ch,r);proj.state.dirty=true;touch(proj);if(DRAMA===proj){resetFrames('参考图已更新，关键帧需要重新生成');renderCast()}toast(`已为「${ch.name}」设置参考图`)});
$('#cast').addEventListener('click',e=>{
  if(e.target.id==='addChar'){const st=dr();st.chars.push({id:rid('c'),name:'新角色',role:'',look:'',color:CHAR_COLORS[st.chars.length%CHAR_COLORS.length]});st.dirty=true;touch(DRAMA);renderCast();$$('#cast .nm').pop().select();return}
  const el=e.target.closest('.char');if(!el)return;const ch=charById(el.dataset.id);
  const sw=e.target.closest('[data-color]');if(sw){ch.color=sw.dataset.color;dr().dirty=true;touch(DRAMA);renderCast();return}
  const rm=e.target.closest('[data-rm]');if(rm){if(!rm.dataset.c){rm.dataset.c=1;rm.textContent='确认删除';return}const st=dr();st.chars=st.chars.filter(c=>c.id!==ch.id);st.shots.forEach(s=>s.cast=s.cast.filter(id=>id!==ch.id));st.dirty=true;touch(DRAMA);renderCast()}
});

function storyOf(st){return{genre:st.genre,title:st.title,syn:st.syn,chars:st.chars,nShots:st.nShots,len:st.len,ratio:st.ratio}}
function genStoryboard(proj,after){
  if(!spend(proj,PRICING.storyboard))return false;
  API.generateStoryboard(storyOf(proj.state)).then(shots=>{proj.state.shots=shots;proj.state.maxStep=Math.max(2,Math.min(proj.state.maxStep,2));touch(proj);logHistory(proj,`生成分镜脚本 ${shots.length} 镜`,proj.state.title,PRICING.storyboard);after(shots)}).catch(e=>{refund(proj,PRICING.storyboard);after(null,e)});
  return true;
}
$('#toScript').onclick=()=>{
  const proj=DRAMA,st=dr(),b=$('#toScript');if(!st.chars.length){toast('请至少添加一个角色');return}
  if(st.shots.length&&!b.dataset.c){b.dataset.c=1;setScriptBtn();return}
  delete b.dataset.c;
  if(!genStoryboard(proj,(shots,err)=>{b.disabled=false;setScriptBtn();if(!shots){toast('分镜生成失败，已退回积分：'+err.message);return}st.maxStep=2;if(DRAMA===proj)goStep(2);toast(`已生成 ${shots.length} 个镜头，消耗 ${PRICING.storyboard} 积分`)})){setScriptBtn();return}
  b.disabled=true;b.textContent='正在拆解剧情…';
};
$('#regenAll').onclick=()=>{const proj=DRAMA,b=$('#regenAll');if(genStoryboard(proj,(shots,err)=>{b.disabled=false;b.textContent='重新生成全部';if(!shots){renderStats();toast('分镜生成失败，已退回积分：'+err.message);return}if(DRAMA===proj){renderShots();renderSteps()}toast('已重新生成分镜')})){b.disabled=true;b.textContent='生成中…'}};
const totalDur=(arr=dr().shots)=>arr.reduce((a,s)=>a+(Math.max(1,+s.dur||1)),0);
function renderStats(){
  const st=dr(),tot=totalDur(),target=st.len,ok=Math.abs(tot-target)<=target*.15;
  $('#sbStats').innerHTML=`<div class="stat"><span>剧名</span><b style="font-family:var(--f-display);font-weight:700">${esc(st.title||'未命名')}</b></div><div class="stat"><span>镜头</span><b>${st.shots.length}</b></div><div class="stat"><span>总时长 / 目标</span><b>${tot}s / ${target}s<span class="fit ${ok?'ok':'warn'}">${ok?'时长合适':tot>target?'偏长':'偏短'}</span></b></div>`;
  $('#regenAll').innerHTML=`重新生成全部 <span class="cost">· ${PRICING.storyboard} 积分</span>`;
}
const opts=(arr,v,lab)=>arr.map(a=>`<option value="${a}" ${a===v?'selected':''}>${lab?lab[a]:a}</option>`).join('');
function castChips(s){return dr().chars.map(c=>`<button type="button" class="chip" data-cast="${c.id}" aria-pressed="${s.cast.includes(c.id)}"><span class="sw" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('')}
function renderShots(){
  renderStats();const S=$('#shots');
  S.innerHTML=dr().shots.map((s,i)=>`<article class="panel shot" data-id="${s.id}">
    <div class="shot-no">${pad2(i+1)}</div><div class="shot-thumb"><canvas></canvas></div>
    <div class="shot-body">
      <div class="shot-props">
        <select data-k="scale" aria-label="景别">${opts(SCALES,s.scale)}</select>
        <select data-k="cam" aria-label="运镜">${opts(CAMS,s.cam)}</select>
        <select data-k="mood" aria-label="光线">${opts(Object.keys(MOODS),s.mood,MOOD_NAME)}</select>
      </div>
      <div class="shot-cast"><span class="hint">出镜：</span>${castChips(s)}<span class="hint" style="margin-left:auto">时长</span><input type="number" data-k="dur" min="1" max="15" value="${s.dur}" style="width:64px;padding:4px 8px" aria-label="时长（秒）"><span class="hint">秒</span></div>
      <textarea data-k="desc" aria-label="画面描述">${esc(s.desc)}</textarea>
      <input type="text" data-k="line" value="${esc(s.line)}" placeholder="台词 / 旁白（可空）" aria-label="台词">
    </div>
    <div class="shot-acts"><button class="btn ghost sm" data-act="rewrite">重写此镜${LIVE.on&&LIVE.models.llm?` <span class="cost">· ${PRICING.rewrite}</span>`:''}</button><button class="btn ghost sm" data-act="del">删除</button></div>
  </article>`).join('');
  $$('.shot',S).forEach((el,i)=>paintShot($('canvas',el),dr().shots[i],i+1,170,{tags:true,onImg:repaintCur}));
}
function repaintCur(){const st=dr();if(st.step===1)renderLooks();else if(st.step===2)renderShots();else if(st.step===3)renderKf();else if(st.step===4)renderStudio()}
function shotEdited(s){if(s.kf!=='none'||s.video!=='none'){s.kf='none';s.video='none'}s.patches=[];delete s.prompt;delete s.kfUrl;delete s.videoUrl}
$('#shots').addEventListener('input',e=>{
  const el=e.target.closest('.shot'),k=e.target.dataset.k;if(!el||!k)return;const s=dr().shots.find(x=>x.id===el.dataset.id);
  s[k]=k==='dur'?Math.max(1,+e.target.value||1):e.target.value;shotEdited(s);touch(DRAMA);
  if(k!=='line')paintShot($('canvas',el),s,dr().shots.indexOf(s)+1,170,{tags:true});if(k==='dur')renderStats();
});
$('#shots').onclick=e=>{
  const cb=e.target.closest('[data-cast]');
  if(cb){const s=dr().shots.find(x=>x.id===cb.closest('.shot').dataset.id),id=cb.dataset.cast;s.cast=s.cast.includes(id)?s.cast.filter(x=>x!==id):[...s.cast,id].slice(-3);shotEdited(s);touch(DRAMA);renderShots();return}
  const b=e.target.closest('[data-act]');if(!b)return;const el=b.closest('.shot'),arr=dr().shots,i=arr.findIndex(x=>x.id===el.dataset.id),s=arr[i];
  if(b.dataset.act==='del'){arr.splice(i,1);touch(DRAMA);renderShots();toast(`已删除镜头 ${pad2(i+1)}`)}
  else if(LIVE.on&&LIVE.models.llm){
    const proj=DRAMA;if(b.disabled||!spend(proj,PRICING.rewrite))return;b.disabled=true;b.textContent='重写中…';
    API.rewriteShot(storyOf(proj.state),arr,i).then(x=>{Object.assign(s,x);s.seed=rseed();shotEdited(s);touch(proj);
      const no=pad2(proj.state.shots.indexOf(s)+1);if(DRAMA===proj&&proj.state.step===2)renderShots();toast(`已重写镜头 ${no}，消耗 ${PRICING.rewrite} 积分`);logHistory(proj,`重写镜头 S${no}`,s.desc,PRICING.rewrite)})
    .catch(e=>{refund(proj,PRICING.rewrite);if(DRAMA===proj&&proj.state.step===2)renderShots();toast('重写失败，已退回积分：'+e.message)})}
  else{const base=s.desc.replace(new RegExp('('+VARIANTS.join('|')+')。?$'),'').replace(/。$/,'');s.desc=base+VARIANTS[Math.floor(Math.random()*VARIANTS.length)]+'。';
    s.scale=SCALES[Math.floor(Math.random()*5)];s.cam=CAMS[Math.floor(Math.random()*CAMS.length)];s.mood=Object.keys(MOODS)[Math.floor(Math.random()*5)];s.seed=rseed();shotEdited(s);touch(DRAMA);renderShots();toast(`已重写镜头 ${pad2(i+1)}`)}
};
$('#addShot').onclick=()=>{const st=dr();st.shots.push(toShot(['中景','warm','新镜头：在这里描述画面内容。','',3,'固定',[0]],st.chars));touch(DRAMA);renderShots();const t=$('#shots .shot:last-child textarea');t.focus();t.select()};
$('#toKf').onclick=()=>{if(!dr().shots.length){toast('至少需要一个镜头');return}goStep(3)};

// ---- 关键帧确认
function renderKf(){
  const st=dr(),S=st.shots,ok=S.filter(s=>s.kf==='ok'),ready=S.filter(s=>s.kf==='ready').length,none=S.filter(s=>s.kf==='none');
  const genCost=none.length*PRICING.keyframe;
  $('#kfStats').innerHTML=`<div class="stat"><span>已确认</span><b style="color:var(--ok)">${ok.length}<span style="color:var(--mute);font-size:13px"> / ${S.length}</span></b></div><div class="stat"><span>待确认</span><b>${ready}</b></div><div class="stat"><span>未生成</span><b>${none.length}</b></div><div class="stat"><span>确认后视频预计</span><b>${num(videoCost(ok))}<span style="color:var(--mute);font-size:13px"> 积分</span></b></div>`;
  $('#kfOkAll').disabled=!ready;$('#toVideo').disabled=!ok.length;$('#kfGenAll').disabled=!none.length||genCost>APP.credits;
  $('#kfGenAll').innerHTML=`生成全部关键帧${none.length?` <span class="cost">· ${num(genCost)} 积分</span>`:''}`;
  const G=$('#kfGrid');G.classList.toggle('wide',st.ratio==='16:9');
  G.innerHTML=S.map((s,i)=>{
    const has=s.kf==='ok'||s.kf==='ready'||(s.kf==='run'&&s.kfPrev&&s.kfPrev!=='none');
    const badge=s.kf==='ok'?'<span class="badge ok">已确认</span>':s.kf==='ready'?'<span class="badge ready">待确认</span>':s.kf==='run'?`<span class="badge">${s.kfJob||'绘制中'} ${Math.floor(s.kp||0)}%</span>`:'<span class="badge">未生成</span>';
    const acts=s.kf==='ready'?'<button class="btn sm primary" data-k="ok">确认</button><button class="btn sm" data-k="redo" title="同提示词重画，'+PRICING.keyframe+' 积分">重画</button><button class="btn sm" data-k="edit">调整…</button>'
      :s.kf==='ok'?'<button class="btn sm ghost" data-k="undo">撤销确认</button><button class="btn sm" data-k="edit">调整…</button>'
      :s.kf==='none'?`<button class="btn sm" data-k="gen">生成关键帧 <span class="cost">· ${PRICING.keyframe}</span></button>`:'<button class="btn sm" disabled>处理中…</button>';
    const meta=[s.kfVer>1?'v'+s.kfVer:'',s.prompt?'已改提示词':'',(s.patches||[]).length?`局部重绘 ${s.patches.length} 处`:''].filter(Boolean).join(' · ');
    return `<article class="panel kf ${s.kf==='ok'?'ok':''}" data-id="${s.id}"><div class="kf-img">${has?'<canvas></canvas>':''}${badge}${s.kf==='run'?`<div class="run"><i style="width:${s.kp||0}%"></i></div>`:''}</div><div class="kf-body"><div style="display:flex;justify-content:space-between;gap:8px"><span class="mono">S${pad2(i+1)}</span><span class="hint">${s.scale} · ${s.cam} · ${s.dur}s</span></div><p>${esc(s.desc)}</p>${meta?`<span class="hint">${meta}</span>`:''}<div class="kf-acts">${acts}</div></div></article>`}).join('');
  $$('.kf',G).forEach(el=>{const cv=$('canvas',el);if(cv){const s=S.find(x=>x.id===el.dataset.id);paintShot(cv,s,S.indexOf(s)+1,360,{tags:true,onImg:repaintCur})}});
  renderSteps();
}
function kfRender(proj){if(DRAMA===proj&&proj.state.step===3)onFrame('kf',renderKf)}
/* kind: new 首次生成 | redraw 整张重画（可带新提示词）| inpaint 局部重绘 */
function startKf(proj,shots,kind,extra={}){
  const cost=shots.length*(kind==='inpaint'?PRICING.inpaint:PRICING.keyframe);if(!spend(proj,cost))return false;
  const jobName={new:'绘制中',redraw:'重画中',inpaint:'局部重绘中'}[kind];
  const unit=kind==='inpaint'?PRICING.inpaint:PRICING.keyframe;
  shots.forEach(s=>{s.kfPrev=s.kf==='run'?s.kfPrev:s.kf;s.kf='run';s.kp=0;s.kfJob=jobName;s.kfPaid=unit;s.video='none';delete s.videoUrl});
  const q=[...shots];let active=0;
  const next=()=>{while(active<3&&q.length){const s=q.shift();active++;
    API.generateKeyframe({shot:s,prompt:s.prompt||defaultPrompt(s),region:kind==='inpaint'?extra.region:null,note:extra.note||''},p=>{s.kp=p*100;kfRender(proj)}).then(r=>{
      delete s.kfPaid;
      if(r.error){s.kf=s.kfPrev||'none';delete s.kfPrev;delete s.kfJob;refund(proj,unit);toast('关键帧生成失败，已退回积分：'+r.error);active--;kfRender(proj);if(!q.length&&!active)touch(proj);else next();return}
      if(kind==='inpaint')(s.patches=s.patches||[]).push({...extra.region,seed:r.seed,url:r.url,note:extra.note||''});else{s.seed=r.seed;s.kfUrl=r.url;s.patches=[]}
      s.kfVer=(s.kfVer||0)+1;s.kf='ready';delete s.kfPrev;delete s.kfJob;active--;kfRender(proj);
      if(!q.length&&!active)touch(proj);else next()})}};
  next();kfRender(proj);return cost;
}
$('#kfGenAll').onclick=()=>{const proj=DRAMA,todo=dr().shots.filter(s=>s.kf==='none');const c=startKf(proj,todo,'new');if(c)logHistory(proj,`生成关键帧 ${todo.length} 张`,dr().title,c)};
$('#kfOkAll').onclick=()=>{const r=dr().shots.filter(s=>s.kf==='ready');r.forEach(s=>s.kf='ok');touch(DRAMA);renderKf();toast(`已确认 ${r.length} 张关键帧`)};
$('#kfGrid').onclick=e=>{
  const b=e.target.closest('[data-k]');if(!b)return;const proj=DRAMA,S=dr().shots,s=S.find(x=>x.id===b.closest('.kf').dataset.id),no=pad2(S.indexOf(s)+1);
  const k=b.dataset.k;
  if(k==='ok'){s.kf='ok';touch(proj);renderKf()}
  else if(k==='undo'){s.kf='ready';s.video='none';delete s.videoUrl;touch(proj);renderKf()}
  else if(k==='edit')openEditor(s);
  else if(k==='gen'){const c=startKf(proj,[s],'new');if(c)logHistory(proj,`生成关键帧 S${no}`,s.desc,c)}
  else if(k==='redo'){const c=startKf(proj,[s],'redraw');if(c)logHistory(proj,`重画关键帧 S${no}`,s.desc,c)}
};
$('#toVideo').onclick=()=>goStep(4);

// ---- 关键帧编辑器：改提示词重画 / 局部重绘
const ED={shot:null,mode:'full',region:null,drag:null};
function openEditor(s){
  const S=dr().shots,no=S.indexOf(s)+1;ED.shot=s;ED.region=null;
  $('#edTitle').textContent=`调整关键帧 S${pad2(no)}`;$('#edPrompt').value=s.prompt||defaultPrompt(s);$('#edNote').value='';
  paintShot($('#edCv'),s,no,dr().ratio==='16:9'?720:560,{tags:true,meta:true});setEdMode('full');$('#kfEd').hidden=false;
}
function setEdMode(m){ED.mode=m;$$('#edMode button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===m));$('#edFull').hidden=m!=='full';$('#edLocal').hidden=m!=='local';$('#edStage').classList.toggle('local',m==='local');updEd()}
function updEd(){
  const r=ED.region,box=$('#selBox'),show=ED.mode==='local'&&r;box.hidden=!show;
  if(show){box.style.left=r.x*100+'%';box.style.top=r.y*100+'%';box.style.width=r.w*100+'%';box.style.height=r.h*100+'%'}
  $('#edRegion').textContent=r?`选区约占画面 ${Math.round(r.w*r.h*100)}%`:'尚未框选';
  const cost=ED.mode==='full'?PRICING.keyframe:PRICING.inpaint;$('#edEst').innerHTML=estHtml(cost,'消耗');
  $('#edGo').textContent=ED.mode==='full'?'按提示词重画':'重绘选区';
  $('#edGo').disabled=cost>APP.credits||(ED.mode==='local'&&!(r&&r.w>.03&&r.h>.03));
}
$('#edMode').onclick=e=>{const b=e.target.closest('button');if(b)setEdMode(b.dataset.v)};
const edPos=e=>{const b=$('#edCv').getBoundingClientRect();return[Math.min(1,Math.max(0,(e.clientX-b.left)/b.width)),Math.min(1,Math.max(0,(e.clientY-b.top)/b.height))]};
$('#edCv').addEventListener('pointerdown',e=>{if(ED.mode!=='local')return;e.preventDefault();ED.drag=edPos(e);$('#edCv').setPointerCapture(e.pointerId)});
$('#edCv').addEventListener('pointermove',e=>{if(!ED.drag)return;const [x1,y1]=edPos(e),[x0,y0]=ED.drag;ED.region={x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)};updEd()});
$('#edCv').addEventListener('pointerup',()=>{ED.drag=null});
$('#edClear').onclick=()=>{ED.region=null;updEd()};
$('#edCancel').onclick=()=>$('#kfEd').hidden=true;
$('#kfEd').addEventListener('click',e=>{if(e.target.id==='kfEd')$('#kfEd').hidden=true});
$('#edGo').onclick=()=>{
  const proj=DRAMA,s=ED.shot,no=pad2(dr().shots.indexOf(s)+1);
  if(ED.mode==='full'){
    const txt=$('#edPrompt').value.trim(),def=defaultPrompt(s);const prev=s.prompt;s.prompt=txt&&txt!==def?txt:undefined;
    const c=startKf(proj,[s],'redraw');if(!c){s.prompt=prev;return}
    $('#kfEd').hidden=true;logHistory(proj,`按新提示词重画 S${no}`,(s.prompt||'默认提示词').slice(0,60),c);
  }else{
    const note=$('#edNote').value.trim();const c=startKf(proj,[s],'inpaint',{region:ED.region,note});if(!c)return;
    $('#kfEd').hidden=true;logHistory(proj,`局部重绘 S${no}`,note||'未填写说明',c);
  }
  touch(proj);
};

// ---- 视频生成
const playList=()=>dr().shots.filter(s=>s.kf==='ok');
const vModel=()=>LIVE.on&&!LIVE.models.seedance&&LIVE.models.kling?'kling':'seedance';
const shotVCost=(s,m=vModel())=>m==='kling'?(s.dur>5?2:1)*PRICING.klingPer5s:Math.max(4,Math.min(15,Math.round(s.dur)))*PRICING.seedancePerSec;
const videoCost=(arr,m)=>arr.reduce((a,s)=>a+shotVCost(s,m),0);
function renderStudio(){
  const st=dr(),S=st.shots,ok=playList(),done=ok.filter(s=>s.video==='done').length,todo=ok.filter(s=>s.video!=='done'),busy=S.some(s=>s.video==='run'||s.video==='wait');
  $('#screen').classList.toggle('wide',st.ratio==='16:9');
  $('#vHint').textContent=`${ok.length} 个已确认镜头 · ${totalDur(ok)} 秒 · 已完成 ${done}/${ok.length}${ok.length<S.length?` · ${S.length-ok.length} 镜关键帧未确认，不会生成`:''}`;
  $('#exportVideo').disabled=!(ok.length&&done===ok.length);$('#playBtn').disabled=!done;
  const cost=videoCost(todo);
  $('#genVideo').disabled=!todo.length||busy||cost>APP.credits;
  $('#genVideo').innerHTML=busy?'生成中…':`生成视频${todo.length?` <span class="cost">· ${num(cost)} 积分</span>`:''}`;
  $('#queue').innerHTML=S.map((s,i)=>{
    const locked=s.kf!=='ok';
    const stt=locked?'<span class="st-lock">关键帧未确认</span>':s.video==='done'?'<span class="st-done">已完成</span>':s.video==='run'?`<span class="st-run">生成中 ${Math.floor(s.p||0)}%</span><div class="bar"><i style="width:${s.p||0}%"></i></div>`:s.video==='wait'?'<span class="st-wait">排队中</span>':`<span class="st-wait">待生成 · ${shotVCost(s)} 积分</span>`;
    return `<div class="q ${locked?'locked':''}" data-i="${i}"><span class="mono">${pad2(i+1)}</span><div class="q-thumb"><canvas></canvas></div><div class="q-desc">${esc(s.desc)}<small>${s.scale} · ${s.cam} · ${s.dur}s</small></div><div class="q-state">${stt}</div></div>`}).join('');
  $$('#queue .q').forEach(q=>paintShot($('canvas',q),S[q.dataset.i],+q.dataset.i+1,110));
  renderTimeline();sizePlayer();drawPlayer();renderSteps();
}
function renderTimeline(){
  const L=playList();
  $('#timeline').innerHTML=L.map((s,i)=>`<div class="seg-t ${s.video==='done'?'':'pending'}" style="flex:${Math.max(1,s.dur)} 1 0" data-i="${i}">${s.video==='done'?'<canvas></canvas>':''}<b>${dr().shots.indexOf(s)+1}</b></div>`).join('')+'<div class="playhead" id="ph"></div>';
  $$('#timeline .seg-t canvas').forEach(cv=>{const s=L[cv.parentNode.dataset.i];cv.width=80;cv.height=44;drawFrame(cv.getContext('2d'),80,44,s,.5,{})});movePH();
}
$('#timeline').onclick=e=>{const r=$('#timeline').getBoundingClientRect();dr().time=Math.max(0,(e.clientX-r.left)/r.width*totalDur(playList()));movePH();drawPlayer()};
function movePH(){const L=playList(),tot=totalDur(L)||1,ph=$('#ph');if(ph)ph.style.left=Math.min(100,dr().time/tot*100)+'%';$('#timeLbl').textContent=fmt(dr().time)+' / '+fmt(L.length?tot:0)}
function fmt(s){s=Math.floor(s);return pad2(Math.floor(s/60))+':'+pad2(s%60)}
function sizePlayer(){const cv=$('#pv');if(dr().ratio==='16:9'){if(cv.width!==640){cv.width=640;cv.height=360}}else if(cv.width!==360){cv.width=360;cv.height=640}}
function shotAt(L,time){let acc=0;for(let i=0;i<L.length;i++){const d=Math.max(1,+L[i].dur||1);if(time<acc+d||i===L.length-1)return{i,t:Math.min(1,Math.max(0,(time-acc)/d))};acc+=d}return{i:0,t:0}}
function drawPlayer(){
  const cv=$('#pv'),c=cv.getContext('2d'),L=playList(),vid=$('#pvVid');vid.hidden=true;
  const msg=t=>{c.fillStyle='#0C0D10';c.fillRect(0,0,cv.width,cv.height);c.fillStyle='#8A8F96';c.font='15px '+FONT;c.textAlign='center';c.fillText(t,cv.width/2,cv.height/2)};
  if(!L.length){msg('先在上一步确认关键帧');return}
  const {i,t}=shotAt(L,dr().time),s=L[i],no=dr().shots.indexOf(s)+1;
  if(s.video!=='done'){msg(s.video==='run'?`镜头 ${no} 生成中…`:`镜头 ${no} 尚未生成`);return}
  if(s.videoUrl){showVid(vid,s,t);return}
  drawFrame(c,cv.width,cv.height,s,t,{no,meta:true,sub:dr().voice!=='无'});
}
function showVid(v,s,t){
  if(v.dataset.src!==s.videoUrl){v.dataset.src=s.videoUrl;v.src=s.videoUrl}
  v.hidden=false;const want=t*Math.max(1,+s.dur||1),lim=(v.duration||want+1)-.05;
  if(playing){if(v.paused)v.play().catch(()=>{});if(Math.abs(v.currentTime-want)>.4&&want<lim)v.currentTime=want}
  else{if(!v.paused)v.pause();if(Math.abs(v.currentTime-want)>.05){try{v.currentTime=Math.max(0,Math.min(want,lim))}catch(e){}}}
}
let raf,last,playing=false;
function stopPlay(){playing=false;cancelAnimationFrame(raf);$('#playBtn').textContent='播放';const v=$('#pvVid');if(v&&!v.paused)v.pause()}
$('#playBtn').onclick=()=>{if(playing){stopPlay();return}const tot=totalDur(playList());if(dr().time>=tot-.05)dr().time=0;playing=true;$('#playBtn').textContent='暂停';last=performance.now();
  const loop=now=>{dr().time+=(now-last)/1000;last=now;if(dr().time>=tot){dr().time=tot;stopPlay()}movePH();drawPlayer();if(playing)raf=requestAnimationFrame(loop)};raf=requestAnimationFrame(loop)};
$('#vVoice').onchange=e=>{dr().voice=e.target.value;touch(DRAMA);drawPlayer()};
$('#genVideo').onclick=()=>{
  const proj=DRAMA,m=vModel(),todo=playList().filter(s=>s.video!=='done');if(!todo.length)return;
  const cost=videoCost(todo,m);if(!spend(proj,cost))return;
  todo.forEach(s=>{s.video='wait';s.p=0;s.vPaid=shotVCost(s,m);s.vRun=m;delete s.vTask});touch(proj);
  const rer=()=>{if(DRAMA===proj&&proj.state.step===4)onFrame('studio',renderStudio)};
  const q=[...todo];let active=0,failed=0,back=0,lastErr='';
  const next=()=>{while(active<2&&q.length){const s=q.shift();active++;s.video='run';
    API.generateVideo(s,m,p=>{s.p=p*100;rer()},()=>touch(proj)).then(r=>{
      const c=s.vPaid??shotVCost(s,m);delete s.vPaid;delete s.vTask;delete s.vRun;
      if(r&&r.error){s.video='none';s.p=0;failed++;back+=c;refund(proj,c);lastErr=r.error}
      else{s.video=s.kf==='ok'?'done':'none';s.p=100;s.vModel=m;if(r&&r.url)s.videoUrl=r.url}
      active--;rer();
      if(!q.length&&!active){touch(proj);const ok=todo.length-failed;
        if(ok)logHistory(proj,`生成视频 ${ok} 镜`,proj.state.title,cost-back);
        if(DRAMA===proj)toast(failed?`${failed} 个镜头生成失败，已退回 ${num(back)} 积分：${lastErr}`:`全部镜头已生成，消耗 ${num(cost)} 积分`)}
      else next()})}};
  next();rer();
};
// 刷新或关闭页面时还在跑的视频任务：后端还在生成，接着查进度
function resumeVideos(proj,shots){
  const rer=()=>{if(DRAMA===proj&&proj.state.step===4)onFrame('studio',renderStudio)};
  let left=shots.length,ok=0,back=0,lastErr='';
  shots.forEach(s=>{const m=s.vRun==='kling'?'kling':'seedance';s.video='run';s.p=s.p||0;
    API.pollVideo(s.vTask,m,p=>{s.p=p*100;rer()},s.vAt||Date.now()).then(r=>{
      const c=s.vPaid||0;delete s.vPaid;delete s.vTask;delete s.vRun;
      if(r.error){s.video='none';s.p=0;back+=c;refund(proj,c);lastErr=r.error}
      else{s.video=s.kf==='ok'?'done':'none';s.p=100;s.vModel=m;s.videoUrl=r.url;ok++}
      rer();
      if(!--left){touch(proj);if(ok)logHistory(proj,`生成视频 ${ok} 镜`,`续查未完成任务 · ${proj.state.title}`,0);
        toast(back?`有 ${shots.length-ok} 个镜头生成失败，已退回 ${num(back)} 积分：${lastErr}`:`「${proj.name}」未完成的 ${ok} 个视频已生成`)}
    })});
  rer();toast(`「${proj.name}」有 ${shots.length} 个视频任务还在生成，正在继续查询`);
}
$('#exportVideo').onclick=async()=>{
  const L=playList();if(!LIVE.on||!L.every(s=>s.videoUrl)){toast('演示模式不能导出。部署后端后可导出 MP4 成片');return}
  const b=$('#exportVideo');b.disabled=true;b.textContent='合成中…';
  try{const r=await api('/api/concat',{urls:L.map(s=>s.videoUrl),durs:L.map(s=>s.dur)});saveUrl(r.url,`${dr().title||'短剧'}.mp4`);toast('成片已合成，开始下载')}
  catch(e){toast(e.message+'，改为逐个下载镜头');L.forEach((s,i)=>setTimeout(()=>saveUrl(s.videoUrl,`S${pad2(dr().shots.indexOf(s)+1)}.mp4`),i*400))}
  finally{b.textContent='导出成片';renderStudio()}
};
$('#pnameDrama').addEventListener('input',e=>{DRAMA.name=e.target.value||'未命名项目';touch(DRAMA)});

/* ================= 项目 / 历史 ================= */
function newProject(kind,o={}){
  const p={id:rid('p'),kind,name:o.name||(kind==='shop'?'新电商项目':'新短剧项目'),updatedAt:Date.now(),saved:false,sample:!!o.sample,unpacked:true,spent:0,
    state:kind==='shop'?newShopState(!!o.sample):newDramaState()};
  APP.projects.unshift(p);return p;
}
function prep(p){if(!p.unpacked){p.state=p.kind==='shop'?unpackShop(p.state):unpackDrama(p.state);p.unpacked=true;recoverInterrupted(p)}return p}
/* 上次关页面时还没完成的任务：已提交到后端的视频接着查，其余（没拿到结果的图片、关键帧、排队中的视频）退回积分 */
function recoverInterrupted(p){
  const st=p.state;let back=0;const resume=[];
  if(p.kind==='shop'){back+=st.pendingCost||0;st.pendingCost=0}
  else (st.shots||[]).forEach(s=>{
    if(s.kf==='run'){back+=s.kfPaid||0;s.kf=s.kfPrev||'none';delete s.kfPrev;delete s.kfJob;delete s.kfPaid}
    if(s.video==='run'&&s.vTask&&LIVE.on)resume.push(s);
    else if(s.video==='run'||s.video==='wait'){back+=s.vPaid||0;s.video='none';s.p=0;delete s.vTask;delete s.vPaid;delete s.vRun}
  });
  if(back>0){refund(p,back);toast(`「${p.name}」上次有未完成的生成任务，已退回 ${num(back)} 积分`)}
  if(back>0||resume.length)touch(p);
  if(resume.length)setTimeout(()=>resumeVideos(p,resume),0);
}
function openProject(p){
  if(!p)return;stopPlay();prep(p);
  if(p.kind==='shop'){SHOP=p;CANV.clear();renderShopAll();setView('shop')}else{DRAMA=p;renderDramaAll();setView('drama')}
  try{localStorage.setItem('vs-last-'+p.kind,p.id)}catch(e){}
}
function projSummary(p){
  const st=p.state||{};
  if(p.kind==='shop')return `${(st.skus||[]).length} 个 SKU · ${(st.results||[]).length} 张图`;
  const S=st.shots||[];if(!S.length)return '尚未生成分镜';
  return `${S.length} 镜 · 关键帧 ${S.filter(s=>s.kf==='ok').length}/${S.length} · 视频 ${S.filter(s=>s.video==='done').length}/${S.length}`;
}
function renderProjects(){
  $('#projList').innerHTML=[['shop','电商图片项目'],['drama','短剧项目']].map(([k,t])=>{
    const ps=APP.projects.filter(p=>p.kind===k).sort((a,b)=>b.updatedAt-a.updatedAt),cur=k==='shop'?SHOP:DRAMA;
    return `<section class="proj-sec"><div class="proj-sec-h"><h2>${t}</h2><button class="btn" data-new="${k}">新建</button></div><div class="proj-grid">${ps.map(p=>`<article class="panel proj ${p===cur?'cur':''}" data-id="${p.id}"><div><h4>${esc(p.name)}</h4><div class="sub">${projSummary(p)} · 已消耗 ${num(p.spent||0)} 积分</div></div><div class="sub">${p===cur?'当前打开 · ':''}${p.saved?'更新于 '+dayLabel(p.updatedAt)+' '+hm(p.updatedAt):p.sample?'示例项目':Store.mode==='memory'?'仅本次会话':'未保存'}</div><div class="proj-acts"><button class="btn sm ghost danger" data-del>删除</button><button class="btn sm primary" data-open>打开</button></div></article>`).join('')||'<div class="hint">还没有项目。</div>'}</div></section>`}).join('');
}
$('#projList').onclick=async e=>{
  const nb=e.target.closest('[data-new]');if(nb){openProject(newProject(nb.dataset.new));return}
  const card=e.target.closest('.proj');if(!card)return;const p=APP.projects.find(x=>x.id===card.dataset.id);if(!p)return;
  if(e.target.closest('[data-open]')){openProject(p);return}
  const d=e.target.closest('[data-del]');if(d){if(!d.dataset.c){d.dataset.c=1;d.textContent='确认删除';return}
    clearTimeout(saveTimers[p.id]);
    if(p.saved){try{await Store.deleteProject(p.id)}catch(err){toast('删除失败，请稍后重试');return}}
    APP.projects=APP.projects.filter(x=>x!==p);
    if(SHOP===p)SHOP=null;if(DRAMA===p)DRAMA=null;
    ensureCurrent();renderProjects();toast(`已删除「${p.name}」`)}
};
function renderHistory(){
  const H=$('#histList');if(!APP.history.length){H.innerHTML='<div class="empty">还没有生成记录。生成套图、分镜、关键帧或视频后会出现在这里。</div>';return}
  let lastDay='',html='';
  APP.history.slice().sort((a,b)=>b.at-a.at).forEach(h=>{const d=dayLabel(h.at);if(d!==lastDay){html+=`<div class="hday">${d}</div>`;lastDay=d}
    const p=APP.projects.find(x=>x.id===h.pid);
    html+=`<div class="hrow"><span class="mono">${hm(h.at)}</span><span class="tag ${h.kind==='shop'?'t':''}" style="justify-self:start">${h.kind==='shop'?'电商图片':'短剧'}</span><div class="what">${esc(h.text)}<small>${esc(p?p.name:h.pname)}${h.detail?' · '+esc(h.detail):''}</small></div><span class="mono pts">${h.cost?'−'+num(h.cost)+' 积分':''}</span>${p?`<button class="btn sm" data-pid="${h.pid}">打开项目</button>`:'<span class="hint">项目已删除</span>'}</div>`});
  H.innerHTML=html;
}
$('#histList').onclick=e=>{const b=e.target.closest('[data-pid]');if(b)openProject(APP.projects.find(p=>p.id===b.dataset.pid))};
$$('[data-goto]').forEach(b=>b.onclick=()=>setView(b.dataset.goto));
$('#newShop').onclick=()=>{openProject(newProject('shop'));toast('已新建电商项目')};
$('#newDrama').onclick=()=>{openProject(newProject('drama'));toast('已新建短剧项目')};

/* ---------- 设置：填写 / 测试模型密钥 ---------- */
const CARD_KEYS={ark:['ark'],deepseek:['deepseek'],kling:['klingAk','klingSk']};
let SET=null;
async function renderSettings(){
  const note=$('#setNote'),grid=$('#setGrid'),foot=$('#setFoot');
  const block=msg=>{note.hidden=false;note.innerHTML=msg;grid.hidden=foot.hidden=true};
  if(!LIVE.on)return block('现在是<b>演示模式</b>，没有连接到帧间服务，这里的设置不可用。下载帧间并双击启动后，再来这里填写密钥。');
  if(!LIVE.settings)return block('密钥只能在运行帧间的那台电脑上修改。');
  note.hidden=true;grid.hidden=foot.hidden=false;
  try{SET=await api('/api/settings')}catch(e){return block('读取设置失败：'+esc(e.message))}
  fillSettings();
}
function fillSettings(){
  if(!SET)return;const K=SET.keys;
  $$('#setGrid [data-cur]').forEach(el=>{const k=K[el.dataset.cur];el.textContent=k.set?`已保存 ••••${k.tail}${k.source==='env'?'（来自 .env 文件）':''}`:'未填写'});
  $$('#setGrid input[data-key]').forEach(i=>{i.value='';i.placeholder=K[i.dataset.key].set?'留空则保持不变':'在这里粘贴'});
  $$('#setGrid [data-state]').forEach(el=>{const ok=CARD_KEYS[el.dataset.state].every(k=>K[k].set);el.innerHTML=`<span class="dot ${ok?'on':''}"></span>${ok?'已配置':'未配置'}`});
  $$('#setGrid [data-clear]').forEach(b=>{b.hidden=!CARD_KEYS[b.dataset.clear].some(k=>K[k].set);delete b.dataset.c;b.textContent='清除'});
}
function keyMsg(which,txt,cls){const m=$(`#setGrid [data-msg="${which}"]`);m.textContent=txt;m.className='kmsg hint'+(cls?' '+cls:'')}
async function testCard(which){
  const val=k=>$(`#setGrid input[data-key="${k}"]`).value.trim();
  const body=which==='kling'?{which,ak:val('klingAk'),sk:val('klingSk')}:{which,key:val(which)};
  keyMsg(which,'测试中…');
  try{const r=await api('/api/settings/test',body);keyMsg(which,r.ok?'✓ '+r.message:'✗ '+r.message,r.ok?'ok':'bad');return r.ok}
  catch(e){keyMsg(which,'✗ '+e.message,'bad');return false}
}
async function afterSettingsChange(){await detectLive();applyMode();renderWallet();refreshEstimates()}
$('#setGrid').addEventListener('click',async e=>{
  const t=e.target.closest('[data-test]');if(t){t.disabled=true;await testCard(t.dataset.test);t.disabled=false;return}
  const c=e.target.closest('[data-clear]');if(!c)return;
  if(!c.dataset.c){c.dataset.c=1;c.textContent='再点一次确认清除';return}
  const which=c.dataset.clear,body={};CARD_KEYS[which].forEach(k=>body[k]='');
  try{SET=await api('/api/settings',body);fillSettings();keyMsg(which,'已清除');await afterSettingsChange()}catch(err){toast('清除失败：'+err.message)}
});
$('#setGrid').addEventListener('input',e=>{const card=e.target.closest('.kcard');if(card)keyMsg(card.dataset.which,'')});
$('#setSave').onclick=async()=>{
  const body={},changed=new Set();
  $$('#setGrid input[data-key]').forEach(i=>{const v=i.value.trim();if(v){body[i.dataset.key]=v;changed.add(i.closest('.kcard').dataset.which)}});
  if(!changed.size){toast('没有需要保存的内容');return}
  const b=$('#setSave');b.disabled=true;b.textContent='保存中…';
  try{
    SET=await api('/api/settings',body);fillSettings();await afterSettingsChange();
    toast('已保存，正在测试连接…');
    const res=await Promise.all([...changed].map(testCard));
    toast(res.every(Boolean)?'设置已保存，连接正常，可以开始生成了':'设置已保存，但有密钥没通过测试，请检查');
  }catch(e){toast('保存失败：'+e.message)}
  finally{b.disabled=false;b.textContent='保存设置'}
};

/* ---------- 首页 ---------- */
function homeShop(sku,type,style,size,seed,max){const cv=document.createElement('canvas');renderImage(cv,{sku,type,style,size,seed},max);return cv}
function homeFrame(shot,look,wide,w,redo){const cv=document.createElement('canvas');const W=wide?w:Math.round(w*9/16),H=wide?Math.round(w*9/16):w;cv.width=W;cv.height=H;drawFrame(cv.getContext('2d'),W,H,{...shot,patches:[]},.5,{look,onImg:redo});return cv}
function homeShots(){const st=dr();return st.shots&&st.shots.length?st.shots:mockStoryboard(storyOf(st))}
let homeT=0;function homeSoon(){clearTimeout(homeT);homeT=setTimeout(()=>{if(APP.view==='home')renderHome()},120)}
function renderHome(){
  const skus=(sh().skus||[]).filter(Boolean),shots=homeShots();
  const es=$('#entryShop');es.innerHTML='';
  if(skus.length){[['main','cream','sq'],['scene','fresh','detail'],['main','tech','sq']].forEach(([t,st,sz],i)=>es.appendChild(homeShop(skus[i%skus.length],t,st,sz,30+i,i===1?132:104)))}
  const ed=$('#entryDrama');ed.innerHTML='';
  shots.slice(0,3).forEach((s,i)=>ed.appendChild(homeFrame(s,['film','real','anime'][i],false,i===1?176:148,homeSoon)));
  // 最近项目
  const ps=APP.projects.slice().sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,7);
  $('#recentHint').textContent=ps.length?`共 ${APP.projects.length} 个项目`:'';
  const R=$('#recent');R.innerHTML='';
  ps.forEach(pj=>{const b=document.createElement('button');b.type='button';b.className='panel rcard';b.dataset.id=pj.id;
    b.innerHTML=`<div class="rcover"><span class="kind">${pj.kind==='shop'?'电商图片':'短剧'}</span></div><div class="rbody"><h4>${esc(pj.name)}</h4><span>${projSummary(pj)}</span><span>${pj.saved?'更新于 '+dayLabel(pj.updatedAt)+' '+hm(pj.updatedAt):pj.sample?'示例项目':'未保存'}</span></div>`;
    const cov=b.querySelector('.rcover');let cv=null;
    try{
      if(pj===SHOP&&sh().results.length){const r=sh().results[0];cv=homeShop(skuById(r.skuId)||skus[0],r.type,r.style,'sq',r.seed,320)}
      else if(pj===DRAMA){const s=homeShots()[0];if(s)cv=homeFrame(s,dr().look,true,320,homeSoon)}
    }catch(e){cv=null}
    if(cv)cov.prepend(cv);else cov.insertAdjacentHTML('beforeend',`<span class="ph">${pj.kind==='shop'?'图':'影'}</span>`);
    R.appendChild(b)});
  R.insertAdjacentHTML('beforeend','<button type="button" class="rnew" data-new="shop"><b>+</b>新建电商项目</button><button type="button" class="rnew" data-new="drama"><b>+</b>新建短剧项目</button>');
  // 灵感画廊
  const G=$('#gallery');G.innerHTML='';
  const A=[],B=[];
  const plan=[['main','cream','xhs'],['scene','fresh','sq'],['main','guochao','detail'],['white','minimal','sq'],['scene','tech','dy'],['main','gray','sq'],['scene','cream','xhs'],['main','fresh','detail']];
  if(skus.length)plan.forEach(([t,st,sz],i)=>{const k=skus[i%skus.length];A.push({kind:'shop',cv:homeShop(k,t,st,sz,60+i,340),cap:k.name||'商品',sub:`${STYLES[st].name} · ${SIZES[sz].label}`})});
  const looks=['film','real','anime'];
  shots.slice(0,4).forEach((s,i)=>B.push({kind:'drama',cv:homeFrame(s,looks[i%3],true,340,homeSoon),cap:`${dr().title||'短剧'} · 第 ${i+1} 镜`,sub:LOOK_NAME[looks[i%3]]}));
  const order=[];while(A.length||B.length){if(A.length)order.push(A.shift());if(A.length)order.push(A.shift());if(B.length)order.push(B.shift())}
  order.filter(Boolean).forEach(it=>{const f=document.createElement('figure');f.className='gitem';f.dataset.kind=it.kind;f.appendChild(it.cv);f.insertAdjacentHTML('beforeend',`<figcaption><span>${esc(it.cap)}</span><i>${esc(it.sub)}</i></figcaption>`);f.style.cursor='pointer';G.appendChild(f)});
}
$('#recent').onclick=e=>{const n=e.target.closest('[data-new]');if(n){openProject(newProject(n.dataset.new));return}
  const c=e.target.closest('.rcard');if(c)openProject(APP.projects.find(p=>p.id===c.dataset.id))};
$('#gallery').onclick=e=>{const f=e.target.closest('.gitem');if(f)setView(f.dataset.kind)};
document.addEventListener('click',e=>{const l=e.target.closest('[data-view-link]');if(l)setView(l.dataset.viewLink)});

function setView(v){
  APP.view=v;$$('.nav-btn').forEach(x=>x.setAttribute('aria-current',x.dataset.view===v));
  ['home','shop','drama','projects','history','settings'].forEach(k=>$('#view-'+k).hidden=k!==v);scrollTo(0,0);stopPlay();$$('.pop').forEach(p=>p.hidden=true);
  if(v==='projects')renderProjects();if(v==='history')renderHistory();if(v==='home')renderHome();if(v==='settings')renderSettings();
  try{localStorage.setItem('vs-view',v)}catch(e){}
}
$$('.nav-btn').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function ensureCurrent(){
  const pick=k=>{let id=null;try{id=localStorage.getItem('vs-last-'+k)}catch(e){}return APP.projects.find(p=>p.id===id&&p.kind===k)||APP.projects.filter(p=>p.kind===k).sort((a,b)=>b.updatedAt-a.updatedAt)[0]};
  if(!SHOP){SHOP=prep(pick('shop')||newProject('shop',{sample:true,name:'示例 · 美妆三件套'}));CANV.clear();renderShopAll()}
  if(!DRAMA){DRAMA=prep(pick('drama')||newProject('drama',{sample:true,name:'示例 · 重回发布会'}));renderDramaAll()}
}
$('#gateForm').onsubmit=e=>{e.preventDefault();const v=$('#gateIn').value.trim();if(!v)return;LIVE.token=v;try{localStorage.setItem('hy-token',v)}catch(err){}$('#gate').hidden=true;toast('已保存访问口令')};
async function init(){
  await detectLive();
  await Store.init();applyMode();
  const [dot,txt]=STORE_TXT[Store.mode];$('#cloudDot').className='dot '+dot;$('#cloudTxt').textContent=txt;
  ensureCurrent();renderWallet();$('#bootMsg').remove();
  let v='home';try{v=localStorage.getItem('vs-view')||'home'}catch(e){}
  setView(['home','shop','drama','projects','history','settings'].includes(v)?v:'home');
  // 第一次打开、还没填任何密钥：直接带到设置页
  const M=LIVE.models||{};
  if(LIVE.on&&LIVE.settings&&!M.image&&!M.llm&&!M.kling){setView('settings');toast('欢迎使用帧间！先填写模型密钥，就可以开始生成了')}
}
(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(init);
