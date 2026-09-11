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
      '<div class="logo" id="social-titel">NIEUW BINNEN <small>Story maken &amp; delen</small></div>' +
      '<button class="btn-icon" onclick="socialVerversen()" title="Ververs">↻</button>' +
      '</div>' +
      '<main>' +
      '<div id="social-tabs" style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button id="social-tab-nieuw" class="btn btn-or btn-sm" style="flex:1" onclick="socialModus(\'nieuw\')">🆕 Nieuw binnen</button>' +
      '<button id="social-tab-verkocht" class="btn btn-gy btn-sm" style="flex:1" onclick="socialModus(\'verkocht\')">✅ Verkocht</button>' +
      '</div>' +
      '<div id="social-intro" style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:12px 14px;border-radius:10px;font-size:13px;margin-bottom:14px;line-height:1.5">Kies je nieuwste webshop-product en ik maak er een <strong>branded &quot;NIEUW BINNEN&quot;-story</strong> van (foto of video + logo + prijs + QR naar de productpagina). Deel &#39;m daarna met &eacute;&eacute;n tik naar WhatsApp Status, Instagram of je Kanaal.</div>' +
      '<div id="social-grid"></div>' +
      '</main>' +
      '<div id="social-ov" style="display:none;position:fixed;inset:0;z-index:600;background:rgba(15,23,42,.75);align-items:center;justify-content:center;padding:16px">' +
        '<div style="background:#fff;border-radius:16px;max-width:340px;width:100%;max-height:calc(100dvh - 32px);overflow-y:auto;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><strong id="social-ov-titel" style="color:var(--nav);font-size:15px">🆕 Story-voorbeeld</strong><button onclick="socialSluit()" style="background:none;border:none;font-size:24px;line-height:1;cursor:pointer;color:var(--gr)">×</button></div>' +
          '<div id="social-prev" style="display:flex;justify-content:center;min-height:120px"></div>' +
          '<div id="social-cap-wrap" style="display:none;margin-top:12px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px"><span style="font-size:11px;color:var(--gr);font-weight:800;letter-spacing:.03em">📝 BIJSCHRIFT VOOR JE POST</span><button id="social-cap-btn" class="btn btn-or" onclick="socialKopieer()" style="padding:6px 14px;min-height:0;font-size:12px">📋 Kopieer</button></div>' +
            '<textarea id="social-cap-text" readonly onclick="this.select()" style="width:100%;box-sizing:border-box;height:118px;resize:none;border:1px solid var(--bd);border-radius:10px;padding:9px 11px;font-size:12.5px;line-height:1.45;color:var(--nav);background:#f8fafc;font-family:inherit"></textarea>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-or btn-sm" onclick="socialDeel()" style="flex:1 1 auto">📲 Deel</button><button class="btn btn-gy btn-sm" onclick="socialDownload()" style="flex:1 1 auto">📥 Download</button></div>' +
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
    btn.innerHTML = '<span class="kz-ic">🆕</span><span class="kz-t">Nieuw binnen</span><span class="kz-s">Nieuw &amp; verkocht delen</span>';
    box.appendChild(btn);
  }
  function openSocial() { injectScreen(); toonScherm("screen-social"); try { socialEnsure(); } catch (_e) {} }

  /* ============ Story-generator (geport uit het dashboard) ============ */
/* ── NIEUW BINNEN: branded story-generator uit nieuwste webshop-producten ── */
let _social={producten:[],bezig:false,blob:null,canvas:null,laatste:null,mime:'',ext:'',modus:'nieuw',verkocht:[],vbezig:false};
function socialEnsure(){ if(_social.modus==='verkocht'){ if(!_social.verkocht.length&&!_social.vbezig)verkochtLaad(); return; } if(!_social.producten.length && !_social.bezig) socialLaad(false); }
async function socialLaad(force){
  const grid=el('social-grid'); if(!grid)return;
  if(_social.bezig)return; _social.bezig=true;
  grid.innerHTML='<div style="padding:24px;color:var(--gr);text-align:center">⏳ Nieuwste producten ophalen…</div>';
  try{
    const res=await fetch(SUPABASE_URL+'/functions/v1/webshop-nieuwste',{method:'POST',headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+(_getToken()||SUPABASE_ANON),'Content-Type':'application/json'},body:'{}'});
    const j=await res.json().catch(()=>({error:'ongeldig antwoord'}));
    if(!res.ok||j.error)throw new Error(j.error||('HTTP '+res.status));
    _social.producten=Array.isArray(j.products)?j.products:[];
    if(_social.modus==='nieuw')socialRenderGrid(); // intussen naar Verkocht gewisseld? Dan dat overzicht niet overschrijven
  }catch(e){ if(_social.modus==='nieuw')grid.innerHTML='<div style="padding:18px;color:var(--rd);background:#fef2f2;border:1px solid #fecaca;border-radius:10px">Kon producten niet laden: '+esc(String(e.message||e))+'</div>'; }
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
/* ── VERKOCHT: branded story van een verkochte bank (laat zien dat het loopt: weg = weg) ── */
function socialModus(m){
  _social.modus=(m==='verkocht')?'verkocht':'nieuw';
  const v=_social.modus==='verkocht';
  const tn=el('social-tab-nieuw'), tv=el('social-tab-verkocht');
  if(tn)tn.className='btn btn-sm '+(v?'btn-gy':'btn-or');
  if(tv)tv.className='btn btn-sm '+(v?'btn-or':'btn-gy');
  const ti=el('social-titel'); if(ti)ti.innerHTML=(v?'VERKOCHT':'NIEUW BINNEN')+' <small>Story maken &amp; delen</small>';
  const it=el('social-intro'); if(it)it.innerHTML=v
    ?'Kies een verkochte bank en ik maak er een <strong>branded &quot;VERKOCHT&quot;-story</strong> van: de foto met een verkocht-stempel, hoe snel hij weg was en een QR om te appen. Deel &#39;m met &eacute;&eacute;n tik naar WhatsApp Status, Instagram of je Kanaal.'
    :'Kies je nieuwste webshop-product en ik maak er een <strong>branded &quot;NIEUW BINNEN&quot;-story</strong> van (foto of video + logo + prijs + QR naar de productpagina). Deel &#39;m daarna met &eacute;&eacute;n tik naar WhatsApp Status, Instagram of je Kanaal.';
  if(v){ if(_social.verkocht.length)verkochtRenderGrid(); else verkochtLaad(); }
  else { if(_social.producten.length)socialRenderGrid(); else socialLaad(false); }
}
function socialVerversen(){ if(_social.modus==='verkocht')verkochtLaad(); else socialLaad(true); }
async function _vkRest(pad){
  const res=await fetch(SUPABASE_URL+'/rest/v1/'+pad,{headers:{'apikey':SUPABASE_ANON,'Authorization':'Bearer '+(_getToken()||SUPABASE_ANON)}});
  if(!res.ok)throw new Error('HTTP '+res.status);
  return res.json();
}
// Dagen tussen online zetten en verkoop → korte, trotse tekst. Stond hij langer dan 14 dagen,
// dan "Alweer verkocht!", zodat een post nooit laat zien dat iets lang bleef staan.
function _vkDagenTekst(d){ if(d==null||d>14)return 'Alweer verkocht!'; if(d<=0)return 'Dezelfde dag verkocht'; return 'In '+d+(d===1?' dag':' dagen')+' verkocht'; }
async function verkochtLaad(){
  const grid=el('social-grid'); if(!grid)return;
  if(_social.vbezig)return; _social.vbezig=true;
  grid.innerHTML='<div style="padding:24px;color:var(--gr);text-align:center">⏳ Verkochte banken ophalen…</div>';
  try{
    const vk=(await _vkRest('verkopen?select=id,item_id,datum,datum_registratie&order=datum.desc,datum_registratie.desc&limit=40'))||[];
    const ids=[...new Set(vk.map(v=>v.item_id).filter(Boolean))];
    const items=ids.length?((await _vkRest('items?select=id,naam,artikelnummer,foto_url,partij_parent_id&id=in.('+ids.join(',')+')'))||[]):[];
    const ouders=[...new Set(items.map(i=>i.partij_parent_id).filter(Boolean))];
    const alleIds=[...new Set([...ids,...ouders])];
    const advs=alleIds.length?((await _vkRest('advertenties?select=item_id,ai_titel,fotos,gepubliceerd_op,merk&item_id=in.('+alleIds.join(',')+')'))||[]):[];
    const iMap={},aMap={};
    items.forEach(i=>{iMap[i.id]=i;});
    advs.forEach(a=>{if(!aMap[a.item_id])aMap[a.item_id]=a;});
    const fotosVan=a=>(a&&Array.isArray(a.fotos)?a.fotos.map(f=>f&&f.url).filter(Boolean):[]);
    const lijst=[];
    vk.forEach(v=>{
      const it=iMap[v.item_id]; if(!it)return;
      // Foto's: eigen advertentie → advertentie van de set (afgesplitst stuk) → inkoopfoto
      const eigen=aMap[it.id], ouder=it.partij_parent_id?aMap[it.partij_parent_id]:null;
      let imgs=fotosVan(eigen); if(!imgs.length)imgs=fotosVan(ouder); if(!imgs.length&&it.foto_url)imgs=[it.foto_url];
      if(!imgs.length)return; // zonder foto geen story
      const a=eigen||ouder;
      let d=null;
      if(eigen&&eigen.gepubliceerd_op){ d=Math.round((Date.parse(v.datum+'T12:00:00')-Date.parse(String(eigen.gepubliceerd_op).slice(0,10)+'T12:00:00'))/864e5); if(!(d>=0))d=null; }
      lijst.push({verkocht:true,title:(a&&a.ai_titel&&a.ai_titel.trim())||it.naam||'Meubel',images:imgs.slice(0,3),image:imgs[0],
        vendor:(a&&a.merk)||'',tags:[],handle:String(it.artikelnummer||'story').toLowerCase(),datum:v.datum,dagen:d,dagenTekst:_vkDagenTekst(d),
        url:'https://nijhofbrothers.nl/collections/occasions'});
    });
    _social.verkocht=lijst;
    if(_social.modus==='verkocht')verkochtRenderGrid(); // intussen terug naar Nieuw binnen? Dan niet overschrijven
  }catch(e){ if(_social.modus==='verkocht')grid.innerHTML='<div style="padding:18px;color:var(--rd);background:#fef2f2;border:1px solid #fecaca;border-radius:10px">Kon verkochte banken niet laden: '+esc(String(e.message||e))+'</div>'; }
  finally{ _social.vbezig=false; }
}
function verkochtRenderGrid(){
  const grid=el('social-grid'); if(!grid)return;
  if(!_social.verkocht.length){ grid.innerHTML='<div style="padding:24px;color:var(--gr);text-align:center">Nog geen verkochte banken met een foto gevonden.</div>'; return; }
  const fmt=d=>{ try{ return new Date(d+'T12:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'short'}); }catch(_e){ return d; } };
  let h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">';
  _social.verkocht.forEach((p,i)=>{
    h+='<div style="border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:#fff">'
      +'<div style="position:relative;aspect-ratio:1/1;background:#f1f5f9 center/cover no-repeat url(\''+esc(p.image)+'\')"><span style="position:absolute;top:8px;left:8px;background:#E87722;color:#fff;font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 7px;border-radius:6px">VERKOCHT</span></div>'
      +'<div style="padding:9px 10px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--nav);line-height:1.3;height:32px;overflow:hidden">'+esc(p.title)+'</div>'
      +'<div style="font-size:11.5px;color:var(--gr);margin:4px 0 8px">'+esc(fmt(p.datum))+(p.dagen!=null?' · '+(p.dagen<=0?'zelfde dag':'na '+p.dagen+(p.dagen===1?' dag':' dagen')):'')+'</div>'
      +'<div style="display:flex;gap:6px"><button class="btn btn-gy btn-sm" style="flex:1;padding-left:4px;padding-right:4px" onclick="socialMaak('+i+',\'foto\')">📷 Foto</button><button class="btn btn-or btn-sm" style="flex:1;padding-left:4px;padding-right:4px" onclick="socialMaak('+i+',\'video\')">🎬 Video</button></div>'
      +'</div></div>';
  });
  h+='</div>';
  grid.innerHTML=h;
}
function _socialImg(src,cross){ return new Promise((resolve,reject)=>{ const img=new Image(); if(cross)img.crossOrigin='anonymous'; img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('afbeelding laden mislukt')); img.src=src; }); }
function _socialRR(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function _socialCover(ctx,img,x,y,w,h){ const ir=img.width/img.height,r=w/h; let sw,sh,sx,sy; if(ir>r){ sh=img.height; sw=sh*r; sx=(img.width-sw)/2; sy=0; } else { sw=img.width; sh=sw/r; sx=0; sy=(img.height-sh)/2; } ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h); }
function _socialCoverZoom(ctx,img,x,y,w,h,zoom){ zoom=zoom||1; const ir=img.width/img.height,r=w/h; let sw,sh; if(ir>r){ sh=img.height; sw=sh*r; } else { sw=img.width; sh=sw/r; } sw/=zoom; sh/=zoom; const sx=(img.width-sw)/2, sy=(img.height-sh)/2; ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h); }
function _socialContain(ctx,img,x,y,w,h){ const ir=img.width/img.height, r=w/h; let dw,dh; if(ir>r){ dw=w; dh=w/ir; } else { dh=h; dw=h*ir; } ctx.drawImage(img,0,0,img.width,img.height,x+(w-dw)/2,y+(h-dh)/2,dw,dh); }
// Bouwt het foto-vlak: de HELE productfoto blijft altijd zichtbaar (contain), met een zachte,
// uitvergrote blur van dezelfde foto als vulling. Nooit meer een afgesneden hoek van de bank.
function _socialPhotoPanel(img,w,h){
  const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d');
  x.fillStyle='#ffffff'; x.fillRect(0,0,w,h);
  try{ x.save(); x.beginPath(); x.rect(0,0,w,h); x.clip(); x.filter='blur(34px)'; _socialCoverZoom(x,img,0,0,w,h,1.16); x.filter='none'; x.fillStyle='rgba(255,255,255,0.20)'; x.fillRect(0,0,w,h); x.restore(); }
  catch(_e){ /* canvas-blur niet ondersteund → witte achtergrond blijft staan */ }
  _socialContain(x,img,0,0,w,h);
  return c;
}
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
      new QRCode(holder,{text:text,width:size,height:size,correctLevel:QRCode.CorrectLevel.H});
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
// Merk/designer uit de tags (conventie 'merk-<naam>') of het vendor-veld; leeg = niets tonen.
function _socialBrand(p){
  const tags=Array.isArray(p.tags)?p.tags:(typeof p.tags==='string'?p.tags.split(','):[]);
  const merk=tags.map(s=>String(s).trim()).find(t=>/^merk-/i.test(t));
  let b='';
  if(merk) b=merk.replace(/^merk-/i,'').replace(/[-_]+/g,' ').trim();
  else if(p.vendor && !/nijhof/i.test(String(p.vendor))) b=String(p.vendor).trim();
  return b ? b.replace(/\b\w/g,c=>c.toUpperCase()) : '';
}
// Langzame in-zoom + zachte pan (Ken Burns) van een voorgerenderd fotopaneel binnen het fotovlak.
function _socialKB(ctx,panel,prog,idx,W,fotoH){
  const p=Math.max(0,Math.min(1,prog));
  const sc=1.03+0.10*p, dw=W*sc, dh=fotoH*sc, mx=(dw-W)/2, my=(dh-fotoH)/2;
  const dir=(idx%2===0)?1:-1, dx=-mx+dir*mx*(p-0.5);
  ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,fotoH); ctx.clip(); ctx.drawImage(panel,dx,-my,dw,dh); ctx.restore();
}
// Tekst met extra letterafstand (voor het merk-label). Verwacht textAlign left + baseline top.
function _socialSpaced(ctx,text,x,y,ls){ let cx=x; for(const ch of String(text)){ ctx.fillText(ch,cx,y); cx+=ctx.measureText(ch).width+ls; } }
// WhatsApp click-to-chat link (scan → direct appen) met productcontext als voorvuld bericht.
function _socialWaLink(p){
  const txt=(p&&p.verkocht)?'Hoi Nijhof Brothers! Ik zoek een bank zoals: '+((p&&p.title)||'jullie verkochte bank'):'Hoi Nijhof Brothers! Ik heb interesse in: '+((p&&p.title)||'jullie meubel');
  return 'https://wa.me/31555690039?text='+encodeURIComponent(txt);
}
// Laadt tot 3 foto's (voor het filmpje), logo, merk-mark en QR één keer — hergebruikt voor foto én video.
async function _socialAssets(p){
  const a={img:null,logo:null,qr:null,panel:null,panels:[],mark:null,brand:'',imgs:[]};
  const srcs=(Array.isArray(p.images)&&p.images.length?p.images:[p.image]).filter(Boolean).slice(0,3);
  const loaded=await Promise.all(srcs.map(s=>{ const src=s+(String(s).indexOf('?')>=0?'&':'?')+'_cb=cors'; return _socialImg(src,true).catch(()=>null); }));
  a.imgs=loaded.filter(Boolean);
  if(a.imgs.length){ a.img=a.imgs[0]; a.panels=a.imgs.map(im=>{ try{ return _socialPhotoPanel(im,1080,Math.round(1920*0.62)); }catch(_e){ return null; } }).filter(Boolean); a.panel=a.panels[0]||null; }
  try{ a.logo=_socialLogoTransparant(await _socialImg('logo.png',false)); }catch(_e){}
  try{ a.mark=_socialLogoTransparant(await _socialImg('logo-mark.png',false)); }catch(_e){}
  try{ a.qr=await _socialQR(_socialWaLink(p),300); }catch(_e){}
  a.brand=_socialBrand(p);
  return a;
}
// Tekent één frame op tijdstip t (seconden). t groot (bv. 999) = eindbeeld (statische foto).
// Wit rondje met het NB-merk midden op de QR. QR staat op correctie-H en de afdekking is
// ~9% van het oppervlak (ruim binnen de 30% die H aankan) → blijft gewoon scanbaar.
var _WA_PATH='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.946c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a11.96 11.96 0 005.71 1.454h.006c6.585 0 11.946-5.359 11.949-11.945a11.86 11.86 0 00-3.495-8.404';
var _waP;
function _socialWaGlyph(){ if(_waP===undefined){ try{ _waP=new Path2D(_WA_PATH); }catch(_e){ _waP=null; } } return _waP; }
// Wit rondje met het GROENE WhatsApp-logo midden op de QR (QR wijst naar WhatsApp).
// QR staat op correctie-H, afdekking ~9% → blijft scanbaar.
function _socialQRMerk(ctx,a,cx,cy,qs){
  const R=Math.round(qs*0.17), gr=R-5;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx,cy,R,0,2*Math.PI); ctx.fillStyle='#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,gr,0,2*Math.PI); ctx.fillStyle='#25D366'; ctx.fill();
  const g=_socialWaGlyph();
  if(g){ ctx.translate(cx,cy); const s=(2*gr*0.62)/24; ctx.scale(s,s); ctx.translate(-12,-12); ctx.fillStyle='#ffffff'; ctx.fill(g); }
  ctx.restore();
}
function _socialDrawFrame(ctx,a,p,t,DUR){
  const W=1080,H=1920,OR='#E87722',INK='#242424',GREY='#94a3b8';
  const fotoH=Math.round(H*0.62);
  DUR=DUR||7.5;
  const isStatic=t>=900;
  const ease=x=>{x=Math.max(0,Math.min(1,x));return 1-Math.pow(1-x,3);};
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  // --- fotovlak: statisch 1 foto, of tot 3 foto's met Ken Burns + crossfade ---
  const CTA_DUR=3.5, PHOTO_DUR=Math.max(1,DUR-CTA_DUR);
  const panels=(a.panels&&a.panels.length)?a.panels:(a.panel?[a.panel]:[]);
  if(isStatic){ if(panels[0])ctx.drawImage(panels[0],0,0); else if(a.img)_socialCover(ctx,a.img,0,0,W,fotoH); }
  else if(panels.length){
    const N=panels.length, slot=PHOTO_DUR/N, XF=Math.min(0.55,slot*0.32);
    let idx=Math.floor(t/slot); if(idx>N-1)idx=N-1; if(idx<0)idx=0;
    _socialKB(ctx,panels[idx],Math.min(1,(t-idx*slot)/slot),idx,W,fotoH);
    const lsec=t-idx*slot;
    if(idx<N-1 && lsec>slot-XF){ const fa=(lsec-(slot-XF))/XF; ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,fa)); _socialKB(ctx,panels[idx+1],0,idx+1,W,fotoH); ctx.restore(); }
  } else if(a.img){ _socialCover(ctx,a.img,0,0,W,fotoH); }
  // pulserende oranje gloed rond de foto + merk-band
  const gl=0.30+0.65*(0.5-0.5*Math.cos(2*Math.PI*(isStatic?0.9:t)/1.8));
  ctx.save(); ctx.globalAlpha=gl; ctx.strokeStyle=OR; ctx.lineWidth=26; ctx.shadowColor=OR; ctx.shadowBlur=44; ctx.strokeRect(15,15,W-30,fotoH-30); ctx.restore();
  ctx.fillStyle=OR; ctx.fillRect(0,fotoH,W,10);
  // VERKOCHT-stempel schuin over de foto; in de video 'slaat' hij erop na ±1 seconde
  if(p.verkocht){
    const sp=isStatic?1:ease((t-0.9)/0.35);
    if(sp>0){
      ctx.save(); ctx.globalAlpha=Math.min(1,sp*1.2); ctx.translate(W/2,fotoH*0.5); ctx.rotate(-0.17); const ssc=1+0.6*(1-sp); ctx.scale(ssc,ssc);
      ctx.font='800 124px Sora, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const stt='VERKOCHT', stw=ctx.measureText(stt).width+120, sth=200;
      _socialRR(ctx,-stw/2,-sth/2,stw,sth,26); ctx.fillStyle='rgba(255,255,255,0.93)'; ctx.fill();
      ctx.lineWidth=12; ctx.strokeStyle=OR; _socialRR(ctx,-stw/2,-sth/2,stw,sth,26); ctx.stroke();
      ctx.fillStyle=OR; ctx.fillText(stt,0,6);
      ctx.restore(); ctx.textAlign='left'; ctx.textBaseline='top';
    }
  }
  // --- info-vlak ---
  ctx.textAlign='left'; ctx.textBaseline='top';
  let y=fotoH+42;
  if(a.brand){ ctx.font='800 32px Sora, sans-serif'; ctx.fillStyle=OR; _socialSpaced(ctx,a.brand.toUpperCase(),70,y,4); y+=48; }
  else { y=fotoH+58; }
  ctx.font='800 52px Sora, sans-serif'; ctx.fillStyle=INK;
  const lines=_socialWrap(ctx,p.title,600,2); lines.forEach((ln,i)=>ctx.fillText(ln,70,y+i*62));
  const prijsY=y+lines.length*62+20;
  // QR rechtsonder + "SCAN MIJ" + webshop-adres
  if(a.qr){ const qs=286,qx=W-qs-78,qy=fotoH+128;
    ctx.fillStyle=OR; ctx.font='800 30px Sora, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText('SCAN & APP',qx+qs/2,qy-22); ctx.textBaseline='top';
    _socialRR(ctx,qx-16,qy-16,qs+32,qs+32,16); ctx.fillStyle='#fff'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#e5e7eb'; _socialRR(ctx,qx-16,qy-16,qs+32,qs+32,16); ctx.stroke();
    ctx.drawImage(a.qr,qx,qy,qs,qs); _socialQRMerk(ctx,a,qx+qs/2,qy+qs/2,qs);
    ctx.fillStyle=GREY; ctx.font='600 30px Inter, sans-serif'; ctx.textAlign='center'; ctx.fillText('nijhofbrothers.nl',qx+qs/2,qy+qs+18); ctx.textAlign='left'; }
  // prijs — schuift van links in (groot, oranje)
  const pin=isStatic?1:ease((t-1.4)/0.45);
  // Bij VERKOCHT staat hier "In X dagen verkocht" (max. 2 regels) in plaats van de prijs
  let vLines=null; if(p.verkocht){ ctx.font='800 72px Sora, sans-serif'; vLines=_socialWrap(ctx,p.dagenTekst||'Alweer verkocht!',600,2); }
  if(pin>0){
    ctx.save(); ctx.globalAlpha=pin; ctx.textAlign='left'; ctx.textBaseline='top';
    if(vLines){
      ctx.font='800 72px Sora, sans-serif';
      const vw=Math.max(...vLines.map(l=>ctx.measureText(l).width)), startX=-vw-120, x=startX+(70-startX)*pin;
      ctx.fillStyle=OR; vLines.forEach((l,i)=>ctx.fillText(l,x,prijsY+i*82));
    } else {
      ctx.font='800 96px Sora, sans-serif';
      const ptxt=eur(p.price), startX=-ctx.measureText(ptxt).width-120, x=startX+(70-startX)*pin;
      ctx.fillStyle=OR; ctx.fillText(ptxt,x,prijsY);
    }
    ctx.restore();
  }
  // volledig Nijhof Brothers-logo linksonder
  if(a.logo){ const lw=190, sc=lw/a.logo.width, lh=a.logo.height*sc, ly=prijsY+(vLines?vLines.length*82+46:128); ctx.drawImage(a.logo,70,ly,lw,lh); }
  // badge NIEUW BINNEN
  if(!p.verkocht&&(isStatic||t>=0.5)){ const bp=isStatic?1:ease((t-0.5)/0.35); ctx.save(); ctx.globalAlpha=bp; ctx.font='800 46px Sora, sans-serif'; ctx.textBaseline='middle'; const btxt='NIEUW BINNEN',bpad=34,bw=ctx.measureText(btxt).width+bpad*2,bh=94,bx=54,by=200,sc=0.9+0.1*bp; ctx.translate(bx,by+bh/2-10*(1-bp)); ctx.scale(sc,sc); _socialRR(ctx,0,-bh/2,bw,bh,18); ctx.fillStyle=OR; ctx.fill(); ctx.fillStyle='#fff'; ctx.fillText(btxt,bpad,2); ctx.restore(); }
  // CTA-eindkaart (alleen video, laatste ~3,5s): oranje sluier over de foto + witte CTA
  if(!isStatic && t>=PHOTO_DUR-0.3){
    const cp=ease((t-(PHOTO_DUR-0.3))/0.5);
    ctx.save(); ctx.globalAlpha=cp*0.92; ctx.fillStyle=OR; ctx.fillRect(0,0,W,fotoH); ctx.restore();
    ctx.save(); ctx.globalAlpha=cp; ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='800 82px Sora, sans-serif'; ctx.fillText(p.verkocht?'Ook zo’n bank?':'Interesse?',W/2,fotoH*0.34);
    ctx.font='800 48px Sora, sans-serif'; ctx.fillText(p.verkocht?'Kijk op nijhofbrothers.nl':'App of ga naar nijhofbrothers.nl',W/2,fotoH*0.34+112);
    ctx.font='700 42px Inter, sans-serif'; ctx.fillText(p.verkocht?'of stuur ons een appje':'🚚 Bezorging door heel Nederland',W/2,fotoH*0.34+190);
    ctx.textAlign='left'; ctx.textBaseline='top'; ctx.restore();
  }
}
async function _socialCanvas(p){
  const W=1080,H=1920; const a=await _socialAssets(p);
  const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
  try{ await document.fonts.ready; }catch(_e){}
  _socialDrawFrame(canvas.getContext('2d'),a,p,999,9.5);
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
// Bouwt een MP4 (~9,5s) van de geanimeerde story via WebCodecs.
async function _socialVideo(p,onProgress){
  if(typeof VideoEncoder==='undefined')throw new Error('Dit toestel kan geen video in de browser maken — gebruik de foto-optie.');
  const M=await _ensureMuxer();
  const W=1080,H=1920,FPS=30,DUR=9.5,TOTAL=Math.round(FPS*DUR);
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
    _socialDrawFrame(ctx,a,p,t,DUR);
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
  const p=(_social.modus==='verkocht'?_social.verkocht:_social.producten)[i]; if(!p)return; type=type||'foto';
  _social.laatste=p; _social.blob=null; _social.canvas=null; _social.mime=''; _social.ext='';
  { const ct=el('social-cap-text'), cw=el('social-cap-wrap'), cb=el('social-cap-btn'); if(ct)ct.value=_socialCaption(); if(cb)cb.textContent='📋 Kopieer'; if(cw)cw.style.display='block'; }
  const ov=el('social-ov'); if(ov)ov.style.display='flex';
  { const ot=el('social-ov-titel'); if(ot)ot.textContent=p.verkocht?'✅ Verkocht-story':'🆕 Story-voorbeeld'; }
  const prev=el('social-prev'), hint=el('social-hint');
  if(hint)hint.textContent='Kopieer het bijschrift hieronder met 📋, tik dan 📲 Deel (of 📥 Download) en plak het in je post.';
  if(type==='video'){
    if(prev)prev.innerHTML='<div style="padding:40px 20px;color:var(--gr);text-align:center">🎬 Video maken…<div id="social-prog" style="margin-top:10px;font-weight:800;font-size:20px;color:var(--or)">0%</div><div style="font-size:11px;margin-top:6px">een paar seconden</div></div>';
    try{
      const blob=await _socialVideo(p,fr=>{const pr=el('social-prog'); if(pr)pr.textContent=Math.round(fr*100)+'%';});
      _social.blob=blob; _social.mime='video/mp4'; _social.ext='mp4';
      if(prev){ prev.innerHTML=''; const v=document.createElement('video'); v.src=URL.createObjectURL(blob); v.controls=true; v.autoplay=true; v.loop=true; v.muted=true; v.setAttribute('playsinline',''); v.style.width='250px'; v.style.borderRadius='12px'; v.style.boxShadow='0 6px 20px rgba(0,0,0,.25)'; prev.appendChild(v); }
      if(hint)hint.textContent='1) 📋 Kopieer het bijschrift. 2) 📥 Download — de video komt in je galerij. 3) Deel ’m van daaruit naar Instagram en plak het bijschrift. (📲 Deel werkt ook direct naar Stories/WhatsApp.)';
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
function _socialBestandsnaam(){ const p=_social.laatste||{}; return (p.verkocht?'verkocht-':'nieuw-binnen-')+(p.handle||'story')+'.'+(_social.ext||'png'); }
function _socialCaption(){ const p=_social.laatste; if(!p)return ''; if(p.verkocht)return 'Alweer verkocht! ✅\n'+p.title+(p.dagenTekst&&p.dagenTekst!=='Alweer verkocht!'?' — '+p.dagenTekst.charAt(0).toLowerCase()+p.dagenTekst.slice(1)+'.':'')+'\n\nOok op zoek naar een kwaliteitsbank? Bekijk ons actuele aanbod of stuur ons een appje.\n'+p.url; return 'Nieuw binnen bij Nijhof Brothers 🛋️\n'+p.title+' — '+eur(p.price)+'\n\nBekijk hem op onze website. Wees er snel bij, weg = weg\n'+p.url; }
function _socialBlob(cb){ if(_social.blob){cb(_social.blob);return;} if(_social.canvas){_social.canvas.toBlob(b=>{_social.blob=b;_social.mime='image/png';_social.ext='png';cb(b);},'image/png');return;} cb(null); }
async function socialDeel(){
  if(!_social.blob && _social.canvas){ try{ _social.blob=await new Promise(r=>_social.canvas.toBlob(b=>r(b),'image/png')); _social.mime=_social.mime||'image/png'; _social.ext=_social.ext||'png'; }catch(_e){} }
  if(!_social.blob){ toast('Nog even geduld — de foto/video wordt nog gemaakt','#b45309'); return; }
  const isVideo=(_social.mime||'').indexOf('video')===0;
  const cap=_socialCaption();
  const naam=_socialBestandsnaam();
  const file=new File([_social.blob],naam,{type:_social.mime||'image/png'});
  // Bijschrift alvast naar het klembord (NIET awaiten → de tik blijft geldig voor 'share').
  try{ if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(cap).catch(function(){}); }catch(_e){}
  // Deel ALLEEN het bestand, zonder tekst (foto → Instagram Feed/Stories; video → Stories/WhatsApp).
  // LET OP: Instagram neemt video's NIET naar Feed/Reels via het deelmenu — dat kan enkel in de app.
  const kanBestand = !!(navigator.canShare && navigator.canShare({files:[file]}));
  if(navigator.share && kanBestand){
    try{ await navigator.share({files:[file]}); toast('Gedeeld ✓ — bijschrift staat op je klembord','#0f766e'); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  // Bestand-delen kan niet (of mislukte) → BESTAND OPSLAAN i.p.v. alleen-tekst, zodat je 'm alsnog
  // vanuit Instagram/WhatsApp uit je galerij kunt plaatsen. (Nooit stilletjes alleen de tekst delen.)
  socialDownload();
  if(isVideo) toast('Video staat in je galerij 📥 — deel ’m van daaruit naar Instagram. Bijschrift staat op je klembord.','#b45309');
  else toast('Foto opgeslagen op je telefoon 📥 — plaats ’m vanuit Instagram/WhatsApp uit je galerij. Bijschrift staat op je klembord.','#b45309');
}
function socialDownload(){ _socialBlob(blob=>{ if(!blob){toast('Kon het bestand niet maken','#b91c1c');return;} const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=_socialBestandsnaam(); document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500); }); }
function socialKopieer(){
  const t=_socialCaption();
  const ok=()=>{ toast('Bericht gekopieerd ✓'); const b=el('social-cap-btn'); if(b){ b.textContent='✓ Gekopieerd'; setTimeout(function(){ b.textContent='📋 Kopieer'; },1600); } };
  const viaTa=()=>{ const ta=el('social-cap-text'); if(!ta)return false; try{ ta.focus(); ta.select(); if(ta.setSelectionRange)ta.setSelectionRange(0,(ta.value||'').length); return !!(document.execCommand&&document.execCommand('copy')); }catch(_e){ return false; } };
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok).catch(function(){ if(viaTa())ok(); else prompt('Kopieer de tekst:',t); }); }
  else { if(viaTa())ok(); else prompt('Kopieer de tekst:',t); }
}
function socialSluit(){ const ov=el('social-ov'); if(ov)ov.style.display='none'; const cw=el('social-cap-wrap'); if(cw)cw.style.display='none'; _social.blob=null; _social.canvas=null; }

  /* ---- Publieke handlers voor inline onclick ---- */
  window.socialModus = socialModus;
  window.socialVerversen = socialVerversen;
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
