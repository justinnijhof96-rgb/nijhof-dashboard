/* ============================================================================
   Nijhof Brothers - "Nieuw binnen delen" in de VERKOOPAPP (NB Verkoop)
   ----------------------------------------------------------------------------
   Zelf-injecterende module (verhuisd uit het dashboard). Voegt een compacte
   keuze-tegel "Nieuw binnen" toe aan het keuzescherm en een volledig scherm
   (screen-social) dat uit de nieuwste webshop-producten een branded
   "NIEUW BINNEN"-story maakt (foto of geanimeerde MP4) + delen met 1 tik.

   Hangt op globals uit verkoop.html: esc, eur, toast, toonScherm,
   _getStoredAuth, SUPABASE_URL, SUPABASE_ANON en QRCode (qrcodejs, al geladen).
   Backend: Edge Function 'webshop-nieuwste' (zelfde Supabase-project).
   ============================================================================ */
(function () {
  function el(id) { return document.getElementById(id); }
  function _getToken() { try { return _getStoredAuth() && _getStoredAuth().access_token; } catch (e) { return null; } }

  /* ---- CSS + scherm injecteren ---- */
  function injectStyle() {
    if (el("nb-social-style")) return;
    var st = document.createElement("style"); st.id = "nb-social-style";
    st.textContent =
      "#screen-social.view.show{display:flex;flex-direction:column;height:100vh;height:100dvh}" +
      "#screen-social > main{flex:1;min-height:0;overflow-y:auto}" +
      "#screen-social .btn-sm{min-height:42px;padding:10px 12px;font-size:13px}";
    document.head.appendChild(st);
  }
  function injectScreen() {
    if (el("screen-social")) return;
    injectStyle();
    var sc = document.createElement("div"); sc.id = "screen-social"; sc.className = "view";
    sc.innerHTML =
      '<div class="top">' +
      '<button class="btn-icon" onclick="toonScherm(\'screen-keuze\')" title="Terug">←</button>' +
      '<div class="logo">NIEUW BINNEN <small>Story maken &amp; delen</small></div>' +
      '<button class="btn-icon" onclick="socialLaad(true)" title="Ververs">↻</button>' +
      '</div>' +
      '<main>' +
      '<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:12px 14px;border-radius:10px;font-size:13px;margin-bottom:14px;line-height:1.5">Kies je nieuwste webshop-product en ik maak er een <strong>branded &quot;NIEUW BINNEN&quot;-story</strong> van (foto of video + logo + prijs + QR naar de productpagina). Deel &#39;m daarna met &eacute;&eacute;n tik naar WhatsApp Status, Instagram of je Kanaal.</div>' +
      '<div id="social-grid"></div>' +
      '</main>' +
      '<div id="social-ov" style="display:none;position:fixed;inset:0;z-index:600;background:rgba(15,23,42,.75);align-items:center;justify-content:center;padding:16px">' +
        '<div style="background:#fff;border-radius:16px;max-width:340px;width:100%;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><strong style="color:var(--nav);font-size:15px">🆕 Story-voorbeeld</strong><button onclick="socialSluit()" style="background:none;border:none;font-size:24px;line-height:1;cursor:pointer;color:var(--gr)">×</button></div>' +
          '<div id="social-prev" style="display:flex;justify-content:center;min-height:120px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-or btn-sm" onclick="socialDeel()" style="flex:1 1 auto">📲 Deel</button><button class="btn btn-gy btn-sm" onclick="socialDownload()" style="flex:1 1 auto">📥 Download</button><button class="btn btn-gy btn-sm" onclick="socialKopieer()" style="flex:1 1 auto">🔗 Tekst</button></div>' +
          '<div style="font-size:11px;color:var(--gr);margin-top:10px" id="social-hint"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sc);
  }
  function injectKeuzeKnop() {
    if (el("keuze-social")) return;
    var scherm = el("screen-keuze"); if (!scherm) return;
    var box = scherm.querySelector(".kz-grid") || scherm.querySelector("main > div"); if (!box) return;
    var btn = document.createElement("button");
    btn.id = "keuze-social"; btn.className = "kz-tegel"; btn.setAttribute("style", "--kz:#db2777");
    btn.onclick = openSocial;
    btn.innerHTML = '<span class="kz-ic">🆕</span><span class="kz-t">Nieuw binnen</span><span class="kz-s">Story maken &amp; delen</span>';
    box.appendChild(btn);
  }
  function openSocial() { injectScreen(); toonScherm("screen-social"); try { socialEnsure(); } catch (_e) {} }

  /* ============ Story-generator (geport uit het dashboard) ============ */
/* ── NIEUW BINNEN: branded story-generator uit nieuwste webshop-producten ── */
let _social={producten:[],bezig:false,blob:null,canvas:null,laatste:null,mime:'',ext:''};
function socialEnsure(){ if(!_social.producten.length && !_social.bezig) socialLaad(false); }
async function socialLaad(force){
  const grid=el('social-grid'); if(!grid)return;
  if(_social.bezig)return; _social.bezig=true;
  grid.innerHTML='<div style="padding:24px;color:var(--gr);text-align:center">⏳ Nieuwste producten ophalen…</div>';
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/webshop-nieuwste',{method:'POST',headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+(_getToken()||SUPABASE_ANON),'Content-Type':'application/json'},body:'{}'});
    const j=await res.json().catch(()=>({error:'ongeldig antwoord'}));
    if(!res.ok||j.error)throw new Error(j.error||('HTTP '+res.status));
    _social.producten=Array.isArray(j.products)?j.products:[];
    socialRenderGrid();
  }catch(e){ grid.innerHTML='<div style="padding:18px;color:var(--rd);background:#fef2f2;border:1px solid #fecaca;border-radius:10px">Kon producten niet laden: '+esc(String(e.message||e))+'</div>'; }
  finally{ _social.bezig=false; }
}
function socialRenderGrid(){
  const grid=el('social-grid'); if(!grid)return;
  if(!_social.producten.length){ grid.innerHTML='<div style="padding:24px;color:var(--gr);text-align:center">Geen webshop-producten gevonden.</div>'; return; }
  let h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">';
  _social.producten.forEach((p,i)=>{
    h+='<div style="border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:#fff">'
      +'<div style="aspect-ratio:1/1;background:#f1f5f9 center/cover no-repeat url(\''+esc(p.image)+'\')"></div>'
      +'<div style="padding:9px 10px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--nav);line-height:1.3;height:32px;overflow:hidden">'+esc(p.title)+'</div>'
      +'<div style="font-size:12.5px;color:var(--or);font-weight:800;margin:4px 0 8px">'+eur(p.price)+'</div>'
      +'<div style="display:flex;gap:6px"><button class="btn btn-gy btn-sm" style="flex:1;padding-left:4px;padding-right:4px" onclick="socialMaak('+i+',\'foto\')">📷 Foto</button><button class="btn btn-or btn-sm" style="flex:1;padding-left:4px;padding-right:4px" onclick="socialMaak('+i+',\'video\')">🎬 Video</button></div>'
      +'</div></div>';
  });
  h+='</div>';
  grid.innerHTML=h;
}
function _socialImg(src,cross){ return new Promise((resolve,reject)=>{ const img=new Image(); if(cross)img.crossOrigin='anonymous'; img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('afbeelding laden mislukt')); img.src=src; }); }
function _socialRR(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function _socialCover(ctx,img,x,y,w,h){ const ir=img.width/img.height,r=w/h; let sw,sh,sx,sy; if(ir>r){ sh=img.height; sw=sh*r; sx=(img.width-sw)/2; sy=0; } else { sw=img.width; sh=sw/r; sx=0; sy=(img.height-sh)/2; } ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h); }
function _socialWrap(ctx,text,maxW,maxLines){
  const words=String(text||'').split(/\s+/).filter(Boolean);
  const lines=[]; let cur=''; let i=0;
  for(;i<words.length;i++){
    const t=cur?cur+' '+words[i]:words[i];
    if(ctx.measureText(t).width<=maxW){ cur=t; }
    else { if(cur){ lines.push(cur); cur=words[i]; } else { cur=words[i]; } if(lines.length>=maxLines){ break; } }
  }
  if(lines.length<maxLines && cur){ lines.push(cur); cur=''; i=words.length; }
  const overflow=i<words.length;
  if(overflow && lines.length){ let last=lines[lines.length-1]; while(last.length && ctx.measureText(last+'…').width>maxW) last=last.slice(0,-1); lines[lines.length-1]=last+'…'; }
  return lines;
}
function _socialQR(text,size){
  return new Promise((resolve,reject)=>{
    try{
      if(typeof QRCode==='undefined'){reject(new Error('QR-lib niet geladen'));return;}
      const holder=document.createElement('div'); holder.style.position='fixed'; holder.style.left='-9999px'; holder.style.top='0'; document.body.appendChild(holder);
      new QRCode(holder,{text:text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
      setTimeout(()=>{
        const c=holder.querySelector('canvas'), im=holder.querySelector('img');
        if(c){ resolve(c); setTimeout(()=>holder.remove(),60); }
        else if(im){ const done=()=>{ const cv=document.createElement('canvas'); cv.width=size; cv.height=size; cv.getContext('2d').drawImage(im,0,0,size,size); resolve(cv); setTimeout(()=>holder.remove(),60); }; if(im.complete&&im.naturalWidth)done(); else im.onload=done; }
        else { holder.remove(); reject(new Error('QR mislukt')); }
      },70);
    }catch(e){ reject(e); }
  });
}
// Maakt het (oranje-op-witte) logo vrijstaand: verwijdert de witte achtergrond.
// Het logo is één kleur oranje op wit, dus alpha = hoe ver van wit (blauwkanaal), kleur vast op huisstijl-oranje → schone anti-aliasing, geen witte rand.
function _socialLogoTransparant(img){
  const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d'); x.drawImage(img,0,0);
  try{
    const id=x.getImageData(0,0,w,h), d=id.data;
    for(let i=0;i<d.length;i+=4){
      const a=Math.max(0,Math.min(255,Math.round((255-d[i+2])*255/221)));
      d[i]=232; d[i+1]=119; d[i+2]=34; d[i+3]=a;
    }
    x.putImageData(id,0,0);
  }catch(_e){ /* getImageData kan falen bij taint — logo blijft dan met witte achtergrond */ }
  return c;
}
// Laadt foto (met CORS-cachebuster), logo (vrijstaand gemaakt) en QR één keer — hergebruikt voor foto én video-frames
async function _socialAssets(p){
  const a={img:null,logo:null,qr:null};
  try{ const src=p.image+(p.image.indexOf('?')>=0?'&':'?')+'_cb=cors'; a.img=await _socialImg(src,true); }catch(_e){}
  try{ a.logo=_socialLogoTransparant(await _socialImg('logo.png',false)); }catch(_e){}
  try{ a.qr=await _socialQR(p.url,300); }catch(_e){}
  return a;
}
// Tekent één frame op tijdstip t (seconden). t groot (bv. 999) = eindbeeld (statische foto).
function _socialDrawFrame(ctx,a,p,t){
  const W=1080,H=1920,OR='#E87722',INK='#242424',GREY='#94a3b8';
  const fotoH=Math.round(H*0.62);
  const ease=x=>{x=Math.max(0,Math.min(1,x));return 1-Math.pow(1-x,3);};
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  if(a.img)_socialCover(ctx,a.img,0,0,W,fotoH);
  // pulserende doorschijnende oranje gloed rond de foto
  const gl=0.30+0.65*(0.5-0.5*Math.cos(2*Math.PI*t/1.8));
  ctx.save(); ctx.globalAlpha=gl; ctx.strokeStyle=OR; ctx.lineWidth=26; ctx.shadowColor=OR; ctx.shadowBlur=44; ctx.strokeRect(15,15,W-30,fotoH-30); ctx.restore();
  // oranje merk-band
  ctx.fillStyle=OR; ctx.fillRect(0,fotoH,W,10);
  // wit info-vlak: titel (statisch)
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.font='800 58px Sora, sans-serif';
  const lines=_socialWrap(ctx,p.title,600,2); const tY=fotoH+64;
  ctx.fillStyle=INK; lines.forEach((ln,i)=>ctx.fillText(ln,70,tY+i*70));
  const prijsY=tY+lines.length*70+26;
  // QR rechtsonder + webshop-adres
  if(a.qr){ const qs=286,qx=W-qs-78,qy=fotoH+104; _socialRR(ctx,qx-16,qy-16,qs+32,qs+32,16); ctx.fillStyle='#fff'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#e5e7eb'; _socialRR(ctx,qx-16,qy-16,qs+32,qs+32,16); ctx.stroke(); ctx.drawImage(a.qr,qx,qy,qs,qs); ctx.fillStyle=GREY; ctx.font='600 30px Inter, sans-serif'; ctx.textAlign='center'; ctx.fillText('nijhofbrothers.nl',qx+qs/2,qy+qs+16); ctx.textAlign='left'; }
  // volledig Nijhof Brothers-logo linksonder op het witte vlak
  if(a.logo){ const lw=234, sc=lw/a.logo.width, lh=a.logo.height*sc, ly=H-lh-60; ctx.drawImage(a.logo,70,ly,lw,lh); }
  // badge NIEUW BINNEN — komt binnen vanaf 0,5s
  if(t>=0.5){
    const bp=ease((t-0.5)/0.35);
    ctx.save(); ctx.globalAlpha=bp; ctx.font='800 46px Sora, sans-serif'; ctx.textBaseline='middle';
    const btxt='NIEUW BINNEN',bpad=34,bw=ctx.measureText(btxt).width+bpad*2,bh=94,bx=54,by=54,sc=0.9+0.1*bp;
    ctx.translate(bx,by+bh/2-10*(1-bp)); ctx.scale(sc,sc);
    _socialRR(ctx,0,-bh/2,bw,bh,18); ctx.fillStyle=OR; ctx.fill();
    ctx.fillStyle='#fff'; ctx.fillText(btxt,bpad,2);
    ctx.restore();
  }
  // prijs — schuift van links in vanaf 2s
  if(t>=2.0){
    const pp=ease((t-2.0)/0.4);
    ctx.save(); ctx.globalAlpha=pp; ctx.textBaseline='top'; ctx.font='800 100px Sora, sans-serif';
    const startX=-ctx.measureText(eur(p.price)).width-120, x=startX+(70-startX)*pp;
    ctx.fillStyle=OR; ctx.fillText(eur(p.price),x,prijsY);
    ctx.restore();
  }
}
async function _socialCanvas(p){
  const W=1080,H=1920; const a=await _socialAssets(p);
  const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
  try{ await document.fonts.ready; }catch(_e){}
  _socialDrawFrame(canvas.getContext('2d'),a,p,999);
  return canvas;
}
// Laadt de mp4-muxer lib pas wanneer nodig (video maken)
function _ensureMuxer(){
  return new Promise((resolve,reject)=>{
    if(window.Mp4Muxer)return resolve(window.Mp4Muxer);
    const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.min.js';
    s.onload=()=>window.Mp4Muxer?resolve(window.Mp4Muxer):reject(new Error('video-lib niet geladen'));
    s.onerror=()=>reject(new Error('kon video-lib niet laden (internetverbinding?)'));
    document.head.appendChild(s);
  });
}
async function _pickAvcConfig(W,H,FPS){
  const base={width:W,height:H,bitrate:8000000,framerate:FPS};
  const codecs=['avc1.640028','avc1.64002A','avc1.4D0028','avc1.42002A','avc1.42E028','avc1.42001f'];
  for(const codec of codecs){ try{ const s=await VideoEncoder.isConfigSupported({...base,codec}); if(s&&s.supported)return {...base,codec}; }catch(_e){} }
  return {...base,codec:'avc1.42001f'};
}
// Bouwt een MP4 (~5,5s) van de geanimeerde story via WebCodecs.
async function _socialVideo(p,onProgress){
  if(typeof VideoEncoder==='undefined')throw new Error('Dit toestel kan geen video in de browser maken — gebruik de foto-optie.');
  const M=await _ensureMuxer();
  const W=1080,H=1920,FPS=30,DUR=5.5,TOTAL=Math.round(FPS*DUR);
  const a=await _socialAssets(p);
  try{ await document.fonts.ready; }catch(_e){}
  const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H; const ctx=canvas.getContext('2d');
  const target=new M.ArrayBufferTarget();
  const muxer=new M.Muxer({target,video:{codec:'avc',width:W,height:H},fastStart:'in-memory'});
  let encErr=null;
  const enc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m),error:e=>{encErr=e;}});
  enc.configure(await _pickAvcConfig(W,H,FPS));
  for(let f=0;f<TOTAL;f++){
    if(encErr)throw encErr;
    const t=f/FPS;
    _socialDrawFrame(ctx,a,p,t);
    const frame=new VideoFrame(canvas,{timestamp:Math.round(t*1e6),duration:Math.round(1e6/FPS)});
    enc.encode(frame,{keyFrame:f%30===0}); frame.close();
    if(onProgress&&f%5===0)onProgress(f/TOTAL);
    if(enc.encodeQueueSize>8)await new Promise(r=>setTimeout(r,0));
  }
  await enc.flush(); muxer.finalize();
  if(encErr)throw encErr;
  return new Blob([target.buffer],{type:'video/mp4'});
}
async function socialMaak(i,type){
  const p=_social.producten[i]; if(!p)return; type=type||'foto';
  _social.laatste=p; _social.blob=null; _social.canvas=null; _social.mime=''; _social.ext='';
  const ov=el('social-ov'); if(ov)ov.style.display='flex';
  const prev=el('social-prev'), hint=el('social-hint');
  if(hint)hint.textContent='Tip: tik "Deel" → kies WhatsApp (Status) of Instagram. Op de laptop kun je \'m downloaden.';
  if(type==='video'){
    if(prev)prev.innerHTML='<div style="padding:40px 20px;color:var(--gr);text-align:center">🎬 Video maken…<div id="social-prog" style="margin-top:10px;font-weight:800;font-size:20px;color:var(--or)">0%</div><div style="font-size:11px;margin-top:6px">een paar seconden</div></div>';
    try{
      const blob=await _socialVideo(p,fr=>{const pr=el('social-prog'); if(pr)pr.textContent=Math.round(fr*100)+'%';});
      _social.blob=blob; _social.mime='video/mp4'; _social.ext='mp4';
      if(prev){ prev.innerHTML=''; const v=document.createElement('video'); v.src=URL.createObjectURL(blob); v.controls=true; v.autoplay=true; v.loop=true; v.muted=true; v.setAttribute('playsinline',''); v.style.width='250px'; v.style.borderRadius='12px'; v.style.boxShadow='0 6px 20px rgba(0,0,0,.25)'; prev.appendChild(v); }
    }catch(e){ if(prev)prev.innerHTML='<div style="padding:22px;color:var(--rd)">Kon de video niet maken: '+esc(String(e.message||e))+'<br><br>Gebruik anders de 📷 Foto-knop.</div>'; }
    return;
  }
  if(prev)prev.innerHTML='<div style="padding:34px;color:var(--gr)">⏳ Story genereren…</div>';
  try{
    const canvas=await _socialCanvas(p); _social.canvas=canvas;
    if(prev){ prev.innerHTML=''; canvas.style.width='250px'; canvas.style.height='auto'; canvas.style.borderRadius='12px'; canvas.style.boxShadow='0 6px 20px rgba(0,0,0,.25)'; prev.appendChild(canvas); }
    canvas.toBlob(b=>{ _social.blob=b; _social.mime='image/png'; _social.ext='png'; if(!b&&hint)hint.textContent='⚠️ Deze foto kon niet geëxporteerd worden (bron blokkeert export). Probeer een ander product.'; },'image/png');
  }catch(e){ if(prev)prev.innerHTML='<div style="padding:22px;color:var(--rd)">Kon de story niet maken: '+esc(String(e.message||e))+'</div>'; }
}
function _socialCaption(){ const p=_social.laatste; if(!p)return ''; return 'Nieuw binnen bij Nijhof Brothers 🛋️\n'+p.title+' — '+eur(p.price)+'\n\nBekijk hem op onze website. Wees er snel bij, weg = weg\n'+p.url; }
function _socialBlob(cb){ if(_social.blob){cb(_social.blob);return;} if(_social.canvas){_social.canvas.toBlob(b=>{_social.blob=b;_social.mime='image/png';_social.ext='png';cb(b);},'image/png');return;} cb(null); }
async function socialDeel(){
  if(!_social.blob){ toast('Nog even geduld — de foto/video wordt nog gemaakt','#b45309'); return; }
  const cap=_socialCaption();
  const naam='nieuw-binnen-'+((_social.laatste&&_social.laatste.handle)||'story')+'.'+(_social.ext||'png');
  const file=new File([_social.blob],naam,{type:_social.mime||'image/png'});
  // 1) Deel het bestand (foto/video) direct via het deelmenu
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],text:cap}); return; }
    catch(e){ if(e&&e.name==='AbortError') return;
      try{ await navigator.share({files:[file]}); return; }catch(e2){ if(e2&&e2.name==='AbortError') return; } }
  }
  // 2) Bestand-delen niet ondersteund → deel tenminste tekst+link via het deelmenu (géén download)
  if(navigator.share){
    try{ await navigator.share({title:'Nieuw binnen bij Nijhof Brothers',text:cap}); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  // 3) Geen deel-API in deze browser → tekst kopiëren (nog steeds geen automatische download)
  socialKopieer();
  toast('Direct delen lukt niet in deze browser — tekst gekopieerd. Open de verkoopapp in Chrome op je telefoon, of gebruik de 📥 Download-knop.','#b45309');
}
function socialDownload(){ _socialBlob(blob=>{ if(!blob){toast('Kon het bestand niet maken','#b91c1c');return;} const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nieuw-binnen-'+((_social.laatste&&_social.laatste.handle)||'story')+'.'+(_social.ext||'png'); document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500); }); }
function socialKopieer(){ const t=_socialCaption(); if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(()=>toast('Tekst gekopieerd ✓')).catch(()=>prompt('Kopieer de tekst:',t)); } else prompt('Kopieer de tekst:',t); }
function socialSluit(){ const ov=el('social-ov'); if(ov)ov.style.display='none'; _social.blob=null; _social.canvas=null; }

  /* ---- Publieke handlers voor inline onclick ---- */
  window.socialLaad = socialLaad;
  window.socialMaak = socialMaak;
  window.socialDeel = socialDeel;
  window.socialDownload = socialDownload;
  window.socialKopieer = socialKopieer;
  window.socialSluit = socialSluit;

  /* ---- Opstarten ---- */
  function boot() { try { injectKeuzeKnop(); injectScreen(); } catch (e) { console.warn("Nieuw binnen init:", e); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
