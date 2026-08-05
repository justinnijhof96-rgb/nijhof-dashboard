/* ============================================================================
   Nijhof Brothers - Advertentie-module (Marktplaats via Shopify)
   ----------------------------------------------------------------------------
   Geïsoleerde uitbreiding op het bestaande dashboard. Injecteert zelf een
   menu-item "Adverteren", een overzichtsscherm en een invoerscherm.
   Hangt aan bestaande globals: el, val, toast, DB, _sb, dbSelect, dbUpsert,
   _getOrgId, _getUserId, compressFoto, FOTO_BUCKET, showView, VIEW_TITELS.
   ============================================================================ */
(function () {
  "use strict";

  var ADV = { lijst: [], huidig: null, fotos: [] };
  window._ADV = ADV;

  function E(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function toastX(m, k) { try { toast(m, k); } catch (e) { console.log(m); } }

  /* ---- Marktplaats-rubrieken (Huis en Inrichting) + maat-profielen ---- */
  var RUBRIEKEN = {
    "Banken en Stoelen": ["Bankstellen", "Barkrukken", "Bureaustoelen", "Complete zithoeken", "Fauteuils", "Krukjes", "Sofa's en Chaises Longues", "Stoelen", "Voetenbanken en Poefen", "Zitzakken"],
    "Kasten": ["Boekenkasten", "Buffetkasten", "Computermeubels", "Dressoirs", "Kledingkasten", "Ladekasten", "Roldeurkasten en Archiefkasten", "Schoenenkasten", "Schoenenrekken", "Secretaires", "Stellingkasten", "Televisiemeubels", "Vitrinekasten", "Wandmeubels", "Kasten - Overige"],
    "Tafels": ["Barren", "Bijzettafels", "Bureaus", "Eettafels", "Kaptafels", "Salontafels", "Sidetables", "Statafels"],
    "Slaapkamer": ["Bedden", "Boxsprings", "Matrassen en Bedbodems", "Nachtkastjes", "Slaapbanken", "Stapelbedden en Hoogslapers", "Waterbedden", "Complete slaapkamers"],
    "Lampen": ["Hanglampen", "Kroonluchters", "Lampenkappen", "Losse lampen", "Plafondlampen", "Spots", "Tafellampen", "Vloerlampen", "Wandlampen"],
    "Stoffering": ["Behang", "Gordijnen en Lamellen", "Tapijten en Kleden", "Vloerbedekking"],
    "Woonaccessoires": ["Bloempotten", "Dienbladen", "Etageres", "Kandelaars en Kaarsen", "Kapstokken", "Kisten", "Klokken", "Kussens", "Lijsten", "Manden en Schalen", "Plaids en Woondekens", "Prullenbakken", "Spiegels", "Vazen", "Wanddecoraties", "Wandplanken en Boekenplanken", "Wijnrekken", "Woonaccessoires - Overige"],
    "Keuken": ["Keukenbenodigdheden", "Servies", "Potten en Pannen", "Complete keukens"],
    "Overige": ["Complete inboedels", "Overige Huis en Inrichting"]
  };
  var GROEP_PROFIEL = {
    "Banken en Stoelen": "zitmeubel", "Kasten": "kast", "Tafels": "tafel",
    "Slaapkamer": "bed", "Lampen": "verlichting"
  };
  function profielVoorGroep(g) { return GROEP_PROFIEL[g] || "accessoire"; }

  var RUBRIEK_GROEP = {};
  Object.keys(RUBRIEKEN).forEach(function (g) {
    RUBRIEKEN[g].forEach(function (r) { RUBRIEK_GROEP[r] = g; });
  });
  function profielVoorRubriek(r) { return profielVoorGroep(RUBRIEK_GROEP[r] || ""); }

  var PROFIEL_MATEN = {
    zitmeubel: [["breedte", "Breedte (cm)"], ["diepte_lounge", "Diepte lounge (cm)"], ["zitdiepte_lounge", "Zitdiepte lounge (cm)"], ["zithoogte", "Zithoogte (cm)"], ["zitdiepte", "Zitdiepte (cm)"]],
    kast: [["breedte", "Breedte (cm)"], ["diepte", "Diepte (cm)"], ["hoogte", "Hoogte (cm)"], ["deuren", "Aantal deuren"], ["planken", "Aantal planken/lades"]],
    tafel: [["vorm", "Vorm (rond / rechthoek / ovaal)"], ["lengte", "Lengte / diameter (cm)"], ["breedte", "Breedte (cm)"], ["hoogte", "Hoogte (cm)"]],
    bed: [["lengte", "Lengte (cm)"], ["breedte", "Breedte (cm)"], ["hoogte", "Hoogte (cm)"], ["matrasmaat", "Matrasmaat (bv. 140x200)"]],
    verlichting: [["hoogte", "Hoogte (cm)"], ["diameter", "Diameter / breedte (cm)"]],
    accessoire: [["breedte", "Breedte (cm)"], ["hoogte", "Hoogte (cm)"], ["diepte", "Diepte (cm)"]]
  };
  var STATEN = ["Nieuw", "Zo goed als nieuw", "Gebruikt", "Gebruikt met gebreken"];

  var STATUS_LABEL = {
    concept: ["Concept", "#6b7280"], gegenereerd: ["Tekst klaar", "#2563eb"],
    live: ["Live", "#15803d"], gereserveerd: ["Gereserveerd", "#b45309"],
    verkocht: ["Verkocht", "#7c3aed"], verwijderd: ["Verwijderd", "#6b7280"],
    fout: ["Fout", "#dc2626"]
  };

  /* ---- CSS ---- */
  function injectCss() {
    if (E("adv-css")) return;
    var s = document.createElement("style");
    s.id = "adv-css";
    s.textContent =
      "#s-adverteren .adv-item{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--bd,#e5e7eb);border-radius:10px;margin-bottom:8px;background:var(--wd,#fff)}" +
      "#s-adverteren .adv-thumb{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#f1f5f9;flex:none}" +
      "#s-adverteren .adv-meta{flex:1;min-width:0}" +
      "#s-adverteren .adv-naam{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#s-adverteren .adv-sub{font-size:12px;color:var(--gr,#6b7280)}" +
      ".adv-badge{display:inline-block;font-size:11px;font-weight:600;color:#fff;border-radius:999px;padding:2px 8px}" +
      "#m-adv .adv-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "#m-adv .adv-form .full{grid-column:1/-1}" +
      "#m-adv label{font-size:12px;font-weight:600;color:var(--gr,#6b7280);display:block;margin-bottom:3px}" +
      "#m-adv input,#m-adv select,#m-adv textarea{width:100%;border:1.5px solid var(--bd,#e5e7eb);border-radius:8px;padding:7px 9px;font-size:13px;background:var(--wd,#fff);color:var(--dk,#111);outline:none;box-sizing:border-box}" +
      "#m-adv textarea{min-height:70px;resize:vertical}" +
      ".adv-fotos{display:flex;flex-wrap:wrap;gap:8px}" +
      ".adv-foto{position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--bd,#e5e7eb)}" +
      ".adv-foto img{width:100%;height:100%;object-fit:cover}" +
      ".adv-foto .x{position:absolute;top:2px;right:2px;background:#dc2626;color:#fff;border:none;border-radius:6px;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:1}" +
      ".adv-foto .mv{position:absolute;bottom:2px;left:2px;display:flex;gap:2px}" +
      ".adv-foto .mv button{background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:5px;width:20px;height:18px;font-size:11px;cursor:pointer;line-height:1}" +
      ".adv-foto.eerste::after{content:'1e';position:absolute;top:2px;left:2px;background:#15803d;color:#fff;font-size:10px;font-weight:700;border-radius:5px;padding:1px 4px}" +
      ".adv-foto.laden{display:flex;align-items:center;justify-content:center;background:#eef2f7}" +
      ".adv-foto .spin{width:24px;height:24px;border:3px solid #cbd5e1;border-top-color:var(--or,#e87722);border-radius:50%;animation:advspin .7s linear infinite}" +
      "@keyframes advspin{to{transform:rotate(360deg)}}" +
      ".adv-foto.fout{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:#fef2f2;border-color:#fecaca}" +
      ".adv-add{width:80px;height:80px;border:2px dashed var(--bd,#cbd5e1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;color:#9ca3af;cursor:pointer;background:transparent}" +
      "#m-adv .adv-preview{border:1.5px solid var(--bd,#e5e7eb);border-radius:8px;padding:10px;background:#f8fafc;white-space:pre-wrap;font-size:12.5px;max-height:220px;overflow:auto}";
    document.head.appendChild(s);
  }

  /* ---- DOM injecteren: menu-item, sectie, modal ---- */
  function injectDom() {
    if (E("s-adverteren")) return;

    // menu-item vlak boven Instellingen (fallback: einde nav)
    var side = document.querySelector('.side-link[data-view="s-instellingen"]');
    if (side && side.parentNode) {
      var link = document.createElement("div");
      link.className = "side-link";
      link.setAttribute("data-view", "s-adverteren");
      link.innerHTML = '<span class="ic">📣</span>Adverteren';
      link.onclick = function () { openAdverteren(); };
      side.parentNode.insertBefore(link, side);
    }

    // sectie
    var main = document.querySelector("#app-container main") || document.querySelector("main");
    if (main) {
      var sec = document.createElement("div");
      sec.className = "sec";
      sec.id = "s-adverteren";
      sec.innerHTML =
        '<div class="sec-hdr"><h2>📣 Adverteren op Marktplaats</h2></div>' +
        '<div class="sec-body">' +
        '<p style="font-size:13px;color:var(--gr,#6b7280);margin:0 0 12px">Maak per meubelstuk een advertentie: foto\'s en maten invoeren, tekst laten genereren, en met één klik op Shopify + Marktplaats plaatsen.</p>' +
        '<div id="adv-lijst"></div>' +
        "</div>";
      main.appendChild(sec);
    }

    // modal
    var modal = document.createElement("div");
    modal.className = "modal-bg";
    modal.id = "m-adv";
    modal.innerHTML =
      '<div class="modal" style="max-width:640px">' +
      '<button class="modal-close" onclick="advSluit()">✕</button>' +
      '<h3 id="adv-titel">Advertentie</h3>' +
      '<div id="adv-body"></div>' +
      "</div>";
    document.body.appendChild(modal);

    if (typeof VIEW_TITELS === "object" && VIEW_TITELS) VIEW_TITELS["s-adverteren"] = "Adverteren";
  }

  /* ---- Data ---- */
  function laadAdvertenties() {
    if (typeof dbSelect !== "function") return Promise.resolve([]);
    return dbSelect("advertenties").then(function (rows) {
      ADV.lijst = rows || [];
      return ADV.lijst;
    }).catch(function (e) { console.warn("Advertenties laden mislukt", e); ADV.lijst = []; return []; });
  }
  function advVoorItem(itemId) {
    for (var i = 0; i < ADV.lijst.length; i++) if (ADV.lijst[i].item_id === itemId) return ADV.lijst[i];
    return null;
  }

  function openAdverteren() {
    injectCss(); injectDom();
    try { showView("s-adverteren"); } catch (e) {}
    E("adv-lijst").innerHTML = '<p style="color:var(--gr,#6b7280)">Laden…</p>';
    laadAdvertenties().then(renderLijst);
  }

  function renderLijst() {
    var wrap = E("adv-lijst"); if (!wrap) return;
    var items = (typeof DB === "object" && DB.items) ? DB.items : [];
    // Alleen adverteerbare losse voorraad: geen verkochte/afgestorte items en geen
    // hele partijen (partij_rest>0) of gesplitste parents — die horen in de peel-flow,
    // anders adverteer je per ongeluk een verkocht item of een complete partij als één stuk.
    items = items.filter(function (i) {
      return i.status !== "afgestort" && i.status !== "verkocht" && i.status !== "gesplitst" && !(Number(i.partij_rest) > 0);
    });
    if (!items.length) { wrap.innerHTML = '<p style="color:var(--gr,#6b7280)">Nog geen voorraad om te adverteren.</p>'; return; }
    var html = items.map(function (it) {
      var a = advVoorItem(it.id);
      var st = a ? (STATUS_LABEL[a.status] || ["?", "#6b7280"]) : ["Geen advertentie", "#94a3b8"];
      var foto = (a && Array.isArray(a.fotos) && a.fotos[0] && a.fotos[0].url) || it.foto_url || "";
      var thumb = foto ? '<img class="adv-thumb" src="' + esc(foto) + '">' : '<div class="adv-thumb"></div>';
      return '<div class="adv-item">' + thumb +
        '<div class="adv-meta"><div class="adv-naam">' + esc(it.naam) + '</div>' +
        '<div class="adv-sub">' + esc(it.artikelnummer || "") + " · " + esc(it.categorie || "") + '</div></div>' +
        '<span class="adv-badge" style="background:' + st[1] + '">' + esc(st[0]) + "</span>" +
        '<button class="btn btn-or btn-xs" style="margin-left:8px" onclick="advBewerk(\'' + esc(it.id) + '\')">' + (a ? "Bewerken" : "Aanmaken") + "</button>" +
        "</div>";
    }).join("");
    wrap.innerHTML = html;
  }

  /* ---- Formulier ---- */
  function rubriekSelectHtml(gekozen) {
    var h = '<select id="adv-rubriek" onchange="advRubriekWijzig()"><option value="">— kies rubriek —</option>';
    Object.keys(RUBRIEKEN).forEach(function (g) {
      h += '<optgroup label="' + esc(g) + '">';
      RUBRIEKEN[g].forEach(function (r) {
        h += '<option value="' + esc(r) + '"' + (r === gekozen ? " selected" : "") + ">" + esc(r) + "</option>";
      });
      h += "</optgroup>";
    });
    return h + "</select>";
  }
  function matenHtml(profiel, maten) {
    var velden = PROFIEL_MATEN[profiel] || PROFIEL_MATEN.accessoire;
    maten = maten || {};
    return velden.map(function (v) {
      return '<div><label>' + esc(v[1]) + '</label><input data-maat="' + esc(v[0]) + '" value="' + esc(maten[v[0]] || "") + '"></div>';
    }).join("");
  }

  function advBewerk(itemId) {
    injectCss(); injectDom();
    var it = (DB.items || []).find(function (x) { return x.id === itemId; });
    if (!it) { toastX("Item niet gevonden", "#dc2626"); return; }
    var a = advVoorItem(itemId) || {};
    ADV.huidig = { itemId: itemId, id: a.id || null, item: it };
    ADV.slim = []; // hulpfoto('s) reset per item (max 2)
    // Bestaande advertentie: opgeslagen foto's. Nieuwe advertentie: begin met de vaste foto.
    if (Array.isArray(a.fotos)) {
      ADV.fotos = a.fotos.slice();
    } else {
      var _sf = standaardFoto();
      ADV.fotos = _sf ? [_sf] : [];
    }

    var profiel = a.maat_profiel || profielVoorRubriek(a.rubriek || "") || "accessoire";
    var bez = a.bezorging || {};
    // Contextlabel: bestaande live advertentie WORDT BIJGEWERKT, niet gedupliceerd.
    var _online = a.status === "live" || a.status === "gereserveerd";
    var _isLive = a.status && a.status !== "concept" && a.status !== "gegenereerd";
    var _plaatsLabel = _online ? "✏️ Wijzig advertentie" : (_isLive ? "↩︎ Weer online zetten" : "🚀 Plaats op Shopify + Marktplaats");
    var _plaatsHint = _online ? '<div style="font-size:12px;color:var(--gr,#6b7280);margin-top:6px">Werkt je bestaande advertentie bij op Shopify + Marktplaats — maakt geen dubbele.</div>' : "";

    E("adv-titel").textContent = "Advertentie · " + (it.naam || "");
    E("adv-body").innerHTML =
      '<div class="adv-form">' +
      '<div class="full" style="border:1.5px dashed #a5b4fc;background:#f5f3ff;border-radius:10px;padding:10px">' +
      '<label style="color:#4338ca">🪄 Slimme foto <span style="font-weight:400;color:var(--gr,#6b7280)">— hulpfoto met de maten erop; vult rubriek, maten, materiaal en kleur vanzelf in</span></label>' +
      '<div id="adv-slim"></div>' +
      '<div id="adv-slim-status" style="margin-top:8px;font-size:13px;color:var(--gr,#6b7280)"></div>' +
      "</div>" +
      '<div class="full"><label>Marktplaats-rubriek</label>' + rubriekSelectHtml(a.rubriek || "") + "</div>" +
      '<div class="full"><label>Foto\'s (eerste = hoofdfoto, sleep-volgorde via pijltjes · klik een foto om bij te snijden)</label><div class="adv-fotos" id="adv-fotos"></div></div>' +
      '<div class="full"><label>Afmetingen</label><div class="adv-form" id="adv-maten" style="margin:0">' + matenHtml(profiel, a.maten) + "</div></div>" +
      '<div><label>Merk</label><input id="adv-merk" value="' + esc(a.merk || "") + '"></div>' +
      '<div><label>Materiaal</label><input id="adv-materiaal" value="' + esc(a.materiaal || "") + '"></div>' +
      '<div><label>Kleur</label><input id="adv-kleur" value="' + esc(a.kleur || "") + '"></div>' +
      '<div><label>Vraagprijs (€)</label><input id="adv-prijs" type="number" min="0" step="0.01" value="' + esc(a.vraagprijs != null ? a.vraagprijs : (it.verwacht_vp || "")) + '"></div>' +
      '<div><label>Bezorgen mogelijk?</label><select id="adv-bezorgen"><option value="ja"' + (bez.bezorgen !== false ? " selected" : "") + ">Ja</option><option value=\"nee\"" + (bez.bezorgen === false ? " selected" : "") + ">Nee</option></select></div>" +
      '<div class="full"><label>Notitie (AI benoemt dit — bv. hoes afritsbaar, kleine kras)</label><textarea id="adv-notitie">' + esc(a.notitie || "") + "</textarea></div>" +
      '<div class="full"><label>Niet vermelden</label><input id="adv-niet" value="' + esc(a.niet_vermelden || "") + '"></div>' +
      "</div>" +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-gy" onclick="advOpslaan(false)">💾 Opslaan</button>' +
      '<button class="btn btn-or" id="adv-genbtn" onclick="advGenereer()">✨ Genereer advertentietekst</button>' +
      "</div>" +
      '<div style="margin-top:12px"><label style="font-size:12px;font-weight:600;color:var(--gr,#6b7280)">Gegenereerde titel</label>' +
      '<input id="adv-aititel" value="' + esc(a.ai_titel || "") + '" style="width:100%;border:1.5px solid var(--bd,#e5e7eb);border-radius:8px;padding:7px 9px;font-size:13px;box-sizing:border-box"></div>' +
      '<div style="margin-top:8px"><label style="font-size:12px;font-weight:600;color:var(--gr,#6b7280)">Volledige advertentietekst (aanpasbaar)</label>' +
      '<textarea id="adv-volledig" style="width:100%;min-height:150px;border:1.5px solid var(--bd,#e5e7eb);border-radius:8px;padding:9px;font-size:12.5px;box-sizing:border-box;resize:vertical">' + esc(a.volledige_tekst || "") + "</textarea></div>" +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-gn" onclick="advPlaats(\'plaatsen\')">' + _plaatsLabel + "</button>" +
      "</div>" + _plaatsHint +
      '<div id="adv-status" style="margin-top:10px;font-size:12px;color:var(--gr,#6b7280)"></div>';

    renderFotos();
    renderSlim();
    if (a.laatste_fout) E("adv-status").innerHTML = '<span style="color:#dc2626">Laatste fout: ' + esc(a.laatste_fout) + "</span>";
    try { openModal("m-adv"); } catch (e) { E("m-adv").classList.add("open"); }
  }

  function advRubriekWijzig() {
    var r = val("adv-rubriek");
    var profiel = profielVoorRubriek(r);
    var huidigeMaten = leesMaten();
    E("adv-maten").innerHTML = matenHtml(profiel, huidigeMaten);
  }

  function leesMaten() {
    var out = {};
    var inputs = document.querySelectorAll("#adv-maten [data-maat]");
    for (var i = 0; i < inputs.length; i++) {
      var k = inputs[i].getAttribute("data-maat");
      if (inputs[i].value !== "") out[k] = inputs[i].value;
    }
    return out;
  }

  /* ---- Foto's ---- */
  // Vaste "laatste foto" die standaard in elke nieuwe advertentie staat. Ligt op een
  // eigen pad (los van losse advertenties) zodat hij nooit meeverdwijnt. De vlag
  // standaard:true houdt hem herkenbaar zodat nieuwe uploads er vóór geschoven worden.
  function standaardFoto() {
    var org = _getOrgId();
    if (!org) return null;
    var pad = org + "/_standaard/laatste-foto.jpg";
    var pub = _sb.storage.from(FOTO_BUCKET).getPublicUrl(pad);
    return { url: pub.data.publicUrl, pad: pad, standaard: true };
  }
  // Voegt een foto toe, maar houdt een vaste laatste foto onderaan.
  function _voegFotoToe(foto) {
    var n = ADV.fotos.length;
    if (n && ADV.fotos[n - 1] && ADV.fotos[n - 1].standaard) ADV.fotos.splice(n - 1, 0, foto);
    else ADV.fotos.push(foto);
  }
  function renderFotos() {
    var wrap = E("adv-fotos"); if (!wrap) return;
    // Hoofdfoto = eerste ECHTE, klaargeladen foto (niet de vaste kaart, niet aan het laden).
    var coverIdx = ADV.fotos.findIndex(function (f) { return f.url && !f.standaard && !f.loading; });
    var html = ADV.fotos.map(function (f, i) {
      if (f.loading) {
        return '<div class="adv-foto laden"><div class="spin"></div>' +
          '<button class="x" onclick="advFotoWis(' + i + ')">✕</button></div>';
      }
      if (f.error) {
        return '<div class="adv-foto fout">' +
          '<span style="font-size:18px">⚠️</span>' +
          '<button onclick="advFotoRetry(\'' + esc(f.tmpId) + '\')" style="background:none;border:none;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer;padding:0">opnieuw</button>' +
          '<button class="x" onclick="advFotoWis(' + i + ')">✕</button></div>';
      }
      return '<div class="adv-foto' + (i === coverIdx ? " eerste" : "") + '"><img src="' + esc(f.url) + '"' + (f.standaard ? '' : ' onclick="advFotoCrop(' + i + ')" style="cursor:pointer" title="Klik om bij te snijden"') + '>' +
        '<button class="x" onclick="advFotoWis(' + i + ')">✕</button>' +
        (f.standaard ? '<div style="position:absolute;bottom:2px;right:2px;background:#334155;color:#fff;font-size:10px;font-weight:700;border-radius:5px;padding:1px 5px">vast</div>' : '') +
        '<div class="mv"><button onclick="advFotoMove(' + i + ',-1)">◀</button><button onclick="advFotoMove(' + i + ',1)">▶</button></div>' +
        "</div>";
    }).join("");
    html += '<div class="adv-add" onclick="advFotoKies()">＋</div>';
    wrap.innerHTML = html;
  }
  function advFotoKies() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = function () {
      var files = Array.prototype.slice.call(inp.files || [])
        .filter(function (f) { return f.type && f.type.indexOf("image/") === 0; })
        .slice(0, 12);
      if (!files.length) return;
      var itemId = ADV.huidig.itemId;
      // Direct een laad-tegel per gekozen foto tonen -> je ziet meteen hoeveel foto's er
      // komen én dat ze bezig zijn. Elke tegel wordt vervangen zodra zijn foto klaar is.
      var phs = files.map(function (file) {
        var ph = { loading: true, tmpId: "ph-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), file: file };
        _voegFotoToe(ph);
        return ph;
      });
      renderFotos();
      _advUploadPool(phs, itemId, 3); // parallel, max 3 tegelijk
    };
    inp.click();
  }
  function _advUploadPool(phs, itemId, conc) {
    var i = 0, actief = 0;
    function volgende() {
      while (actief < conc && i < phs.length) {
        (function (ph) { actief++; _advUpload(ph, itemId).then(function () { actief--; volgende(); }); })(phs[i]);
        i++;
      }
    }
    volgende();
  }
  // Comprimeert + uploadt één foto naar zijn placeholder. Faalt nooit hard (voor de pool).
  function _advUpload(ph, itemId) {
    ph.loading = true; ph.error = false; renderFotos();
    var org = _getOrgId();
    return compressFoto(ph.file).then(function (blob) {
      var pad = org + "/adv/" + itemId + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
      return _sb.storage.from(FOTO_BUCKET).upload(pad, blob, { contentType: "image/jpeg", upsert: false })
        .then(function (res) {
          if (res.error) throw res.error;
          if (ADV.fotos.indexOf(ph) < 0) return; // tegel is tussentijds verwijderd
          var pub = _sb.storage.from(FOTO_BUCKET).getPublicUrl(pad);
          ph.url = pub.data.publicUrl; ph.pad = pad; ph.loading = false; ph.error = false; delete ph.file;
          renderFotos();
        });
    }).catch(function (e) {
      console.warn("Foto-upload mislukt", e);
      if (ADV.fotos.indexOf(ph) < 0) return;
      ph.loading = false; ph.error = true; renderFotos();
    });
  }
  function advFotoRetry(tmpId) {
    var ph = (ADV.fotos || []).find(function (f) { return f.tmpId === tmpId; });
    if (ph && ph.file) _advUpload(ph, ADV.huidig.itemId);
  }

  /* ---- Foto bijsnijden (crop) — Cropper.js, dynamisch geladen ---- */
  function _laadCropper(cb) {
    if (window.Cropper) return cb();
    if (!E("cropper-css")) {
      var l = document.createElement("link");
      l.id = "cropper-css"; l.rel = "stylesheet";
      l.href = "https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css";
      document.head.appendChild(l);
    }
    if (E("cropper-js")) { var w = setInterval(function () { if (window.Cropper) { clearInterval(w); cb(); } }, 100); return; }
    var s = document.createElement("script");
    s.id = "cropper-js";
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js";
    s.onload = cb;
    s.onerror = function () { toastX("Bijsnij-tool laden mislukt (internet?)", "#dc2626"); };
    document.body.appendChild(s);
  }
  function advFotoCrop(i) {
    var foto = ADV.fotos[i];
    if (!foto || !foto.url || foto.standaard || foto.loading || foto.error) return;
    _laadCropper(function () { _openCropModal(i, foto.url); });
  }
  function _openCropModal(i, url) {
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.9);display:flex;flex-direction:column";
    ov.innerHTML =
      '<div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px;overflow:hidden">' +
      '<img id="adv-crop-img" style="max-width:100%;max-height:100%;display:block"></div>' +
      '<div style="padding:12px;display:flex;gap:10px;background:#111">' +
      '<button id="adv-crop-cancel" style="flex:1;padding:14px;border:none;border-radius:10px;background:#374151;color:#fff;font-size:15px;font-weight:700;cursor:pointer">Annuleren</button>' +
      '<button id="adv-crop-ok" style="flex:2;padding:14px;border:none;border-radius:10px;background:#15803d;color:#fff;font-size:15px;font-weight:700;cursor:pointer">✂️ Bijsnijden &amp; opslaan</button>' +
      "</div>";
    document.body.appendChild(ov);
    var imgEl = E("adv-crop-img");
    var cropper = null, objUrl = null;
    function sluit() {
      try { if (cropper) cropper.destroy(); } catch (e) {}
      if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} }
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    E("adv-crop-cancel").onclick = sluit;
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      objUrl = URL.createObjectURL(blob);
      imgEl.onload = function () {
        cropper = new window.Cropper(imgEl, { viewMode: 1, autoCropArea: 1, background: false, movable: true, zoomable: true });
      };
      imgEl.src = objUrl;
    }).catch(function (e) { toastX("Foto laden mislukt: " + (e.message || e), "#dc2626"); sluit(); });
    E("adv-crop-ok").onclick = function () {
      if (!cropper) return;
      var canvas = cropper.getCroppedCanvas({ maxWidth: 2000, maxHeight: 2000 });
      if (!canvas) { sluit(); return; }
      var okBtn = E("adv-crop-ok"); okBtn.disabled = true; okBtn.textContent = "Opslaan…";
      canvas.toBlob(function (blob) {
        if (!blob) { sluit(); return; }
        var org = _getOrgId();
        var pad = org + "/adv/" + ADV.huidig.itemId + "-" + Date.now() + "-crop-" + Math.random().toString(36).slice(2, 7) + ".jpg";
        _sb.storage.from(FOTO_BUCKET).upload(pad, blob, { contentType: "image/jpeg", upsert: false }).then(function (res) {
          if (res.error) throw res.error;
          var pub = _sb.storage.from(FOTO_BUCKET).getPublicUrl(pad);
          if (ADV.fotos[i]) { ADV.fotos[i].url = pub.data.publicUrl; ADV.fotos[i].pad = pad; }
          renderFotos();
          toastX("✂️ Foto bijgesneden");
          sluit();
        }).catch(function (e) {
          toastX("Opslaan mislukt: " + (e.message || e), "#dc2626");
          okBtn.disabled = false; okBtn.textContent = "✂️ Bijsnijden & opslaan";
        });
      }, "image/jpeg", 0.9);
    };
  }
  function advFotoWis(i) { ADV.fotos.splice(i, 1); renderFotos(); }
  function advFotoMove(i, d) {
    var j = i + d; if (j < 0 || j >= ADV.fotos.length) return;
    var t = ADV.fotos[i]; ADV.fotos[i] = ADV.fotos[j]; ADV.fotos[j] = t; renderFotos();
  }

  /* ---- Slimme (hulp)foto: leest velden uit, is GEEN advertentiefoto ---- */
  function _rubriekLijstPlat() {
    var out = [];
    Object.keys(RUBRIEKEN).forEach(function (g) { RUBRIEKEN[g].forEach(function (r) { out.push(r); }); });
    return out;
  }
  function renderSlim() {
    var wrap = E("adv-slim"); if (!wrap) return;
    var arr = ADV.slim || [];
    var tiles = arr.map(function (s, i) {
      return '<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--bd,#e5e7eb)">' +
        '<img src="' + esc(s.dataUrl) + '" style="width:100%;height:100%;object-fit:cover">' +
        '<button onclick="advSlimWis(' + i + ')" style="position:absolute;top:2px;right:2px;background:#dc2626;color:#fff;border:none;border-radius:6px;width:20px;height:20px;font-size:12px;line-height:1;cursor:pointer">✕</button>' +
        "</div>";
    }).join("");
    if (arr.length < 2) {
      tiles += '<div onclick="advSlimKies()" style="width:80px;height:80px;border:2px dashed #a5b4fc;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;color:#6d28d9;cursor:pointer;background:#eef2ff">📐</div>';
    }
    wrap.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px">' + tiles + "</div>" +
      '<div style="font-size:11px;color:var(--gr,#6b7280);margin-top:6px">Max 2 hulpfoto\'s (bv. één met de maten, één die het meubel goed toont).</div>';
  }
  function advSlimKies() {
    if ((ADV.slim || []).length >= 2) return;
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (!file || (file.type || "").indexOf("image/") !== 0) return;
      compressFoto(file).then(function (blob) {
        var fr = new FileReader();
        fr.onload = function () {
          var dataUrl = String(fr.result || "");
          if (!Array.isArray(ADV.slim)) ADV.slim = [];
          ADV.slim.push({ dataUrl: dataUrl, b64: dataUrl.split(",")[1] || "" });
          renderSlim();
          advSlimAnalyseer();
        };
        fr.readAsDataURL(blob);
      }).catch(function (e) { toastX("Kon foto niet lezen: " + (e.message || e), "#dc2626"); });
    };
    inp.click();
  }
  function advSlimWis(i) {
    if (!Array.isArray(ADV.slim)) return;
    ADV.slim.splice(i, 1);
    renderSlim();
    if (ADV.slim.length) advSlimAnalyseer();
    else { var s = E("adv-slim-status"); if (s) s.textContent = ""; }
  }
  function advSlimAnalyseer() {
    var arr = ADV.slim || []; if (!arr.length) return;
    var st = E("adv-slim-status");
    if (st) { st.style.color = "var(--gr,#6b7280)"; st.textContent = "✨ AI leest de foto('s) uit…"; }
    var rubr = _rubriekLijstPlat();
    Promise.all(arr.map(function (s) {
      return _sb.functions.invoke("analyseer-foto", { body: { image_base64: s.b64, media_type: "image/jpeg", rubrieken: rubr } })
        .then(function (res) { return res.error ? { error: res.error.message || "Functie-fout" } : (res.data || {}); });
    })).then(function (results) {
      var merged = { rubriek: "", maten: {}, materiaal: "", kleur: "" };
      var fout = null;
      results.forEach(function (d) {
        if (!d || d.error) { fout = (d && d.error) || "onbekende fout"; return; }
        if (!merged.rubriek && d.rubriek) merged.rubriek = d.rubriek;
        if (!merged.materiaal && d.materiaal) merged.materiaal = d.materiaal;
        if (!merged.kleur && d.kleur) merged.kleur = d.kleur;
        if (d.maten) Object.keys(d.maten).forEach(function (k) { if (!merged.maten[k] && d.maten[k]) merged.maten[k] = d.maten[k]; });
      });
      _slimVul(merged);
      if (st) {
        if (merged.rubriek || merged.materiaal || merged.kleur || Object.keys(merged.maten).length) {
          st.style.color = "#15803d"; st.textContent = "✨ Ingevuld — controleer rubriek/maten/materiaal/kleur, vul zelf merk + prijs aan, en voeg hieronder je echte foto's toe.";
          toastX("✨ Velden ingevuld vanaf de foto('s)");
        } else {
          st.style.color = "#c2410c"; st.textContent = "Kon niets uitlezen" + (fout ? " (" + fout + ")" : "") + " — vul de velden handmatig in.";
        }
      }
    }).catch(function (e) {
      if (st) { st.style.color = "#dc2626"; st.textContent = "Uitlezen mislukt: " + (e.message || e); }
    });
  }
  function _slimVul(d) {
    if (d.rubriek) {
      var sel = E("adv-rubriek");
      if (sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === d.rubriek) { sel.value = d.rubriek; advRubriekWijzig(); break; }
        }
      }
    }
    if (d.maten && typeof d.maten === "object") {
      Object.keys(d.maten).forEach(function (k) {
        var inp = document.querySelector('#adv-maten [data-maat="' + k + '"]');
        if (inp && d.maten[k] != null && String(d.maten[k]) !== "") inp.value = d.maten[k];
      });
    }
    if (d.materiaal && E("adv-materiaal")) E("adv-materiaal").value = d.materiaal;
    if (d.kleur && E("adv-kleur")) E("adv-kleur").value = d.kleur;
  }

  /* ---- Opslaan / genereren / plaatsen ---- */
  function bouwRow() {
    var h = ADV.huidig;
    var bestaand = advVoorItem(h.itemId) || {};
    var id = h.id || bestaand.id || ("adv-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
    h.id = id;
    var rubriek = val("adv-rubriek");
    var row = {
      id: id,
      item_id: h.itemId,
      org_id: _getOrgId(),
      user_id: _getUserId(),
      rubriek: rubriek,
      maat_profiel: profielVoorRubriek(rubriek),
      maten: leesMaten(),
      staat: "",
      merk: val("adv-merk").trim(),
      materiaal: val("adv-materiaal").trim(),
      kleur: val("adv-kleur").trim(),
      vraagprijs: parseFloat(val("adv-prijs")) || 0,
      // prijstype/budget worden via Woosify bepaald, niet vanuit deze app. Velden zijn uit
      // het formulier gehaald; we schrijven vaste defaults zodat bestaande DB-kolommen blijven werken.
      prijstype: "bieden",
      budget: 10,
      bezorging: { bezorgen: val("adv-bezorgen") !== "nee", kosten: 0 },
      notitie: val("adv-notitie").trim(),
      niet_vermelden: val("adv-niet").trim(),
      // Alleen echte, klaargeladen foto's opslaan (laad-/fouttegels hebben geen url).
      // Vaste kaart altijd als laatste, zodat de eerste echte foto de cover wordt.
      fotos: ADV.fotos.filter(function (f) { return f.url; }).sort(function (a, b) { return (a.standaard ? 1 : 0) - (b.standaard ? 1 : 0); }),
      ai_titel: val("adv-aititel"),
      volledige_tekst: E("adv-volledig") ? E("adv-volledig").value : "",
      status: bestaand.status && bestaand.status !== "concept" ? bestaand.status : "concept",
      shopify_product_id: bestaand.shopify_product_id || null,
      shopify_variant_id: bestaand.shopify_variant_id || null,
      shopify_inventory_item_id: bestaand.shopify_inventory_item_id || null,
      shopify_handle: bestaand.shopify_handle || null
    };
    return row;
  }
  function advOpslaan(stil) {
    var row = bouwRow();
    return dbUpsert("advertenties", row).then(function (res) {
      var saved = (res && res[0]) || row;
      // lokale lijst bijwerken
      var idx = ADV.lijst.findIndex(function (x) { return x.id === saved.id; });
      if (idx >= 0) ADV.lijst[idx] = saved; else ADV.lijst.push(saved);
      if (!stil) toastX("💾 Opgeslagen");
      return saved;
    }).catch(function (e) { toastX("Opslaan mislukt: " + (e.message || e), "#dc2626"); throw e; });
  }

  function advGenereer() {
    if ((ADV.fotos || []).some(function (f) { return f.loading; })) { toastX("⏳ Wacht tot de foto's klaar zijn met uploaden", "#c2410c"); return; }
    var btn = E("adv-genbtn"); if (btn) { btn.disabled = true; btn.textContent = "✨ Bezig…"; }
    advOpslaan(true).then(function (saved) {
      return _sb.functions.invoke("genereer-advertentie", { body: { advertentie_id: saved.id } });
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || "Functie-fout");
      var d = res.data || {};
      if (d.error) throw new Error(d.error + (d.detail ? " — " + d.detail : ""));
      if (E("adv-aititel")) E("adv-aititel").value = d.titel || "";
      if (E("adv-volledig")) E("adv-volledig").value = d.volledige_tekst || "";
      toastX("✨ Tekst gegenereerd");
    }).catch(function (e) {
      toastX("Genereren mislukt: " + (e.message || e), "#dc2626");
      var st = E("adv-status"); if (st) st.innerHTML = '<span style="color:#dc2626">' + esc(e.message || e) + " — vaak: ANTHROPIC_API_KEY nog niet ingesteld.</span>";
    }).then(function () { if (btn) { btn.disabled = false; btn.textContent = "✨ Genereer advertentietekst"; } });
  }

  var _advActieBezig = false;
  function advPlaats(actie) {
    if (_advActieBezig) return; // dubbelklik → geen tweede parallelle keten (status-race, dubbel Shopify-product)
    if ((ADV.fotos || []).some(function (f) { return f.loading; })) { toastX("⏳ Wacht tot de foto's klaar zijn met uploaden", "#c2410c"); return; }
    var labels = { plaatsen: "plaatsen op Shopify + Marktplaats", reserveren: "op gereserveerd zetten", terug_online: "terug online zetten", verkocht: "als verkocht markeren", verwijderen: "van Marktplaats halen" };
    if ((actie === "verkocht" || actie === "verwijderen") && !confirm("Weet je zeker dat je dit meubel wilt " + labels[actie] + "?")) return;
    _advActieBezig = true;
    var st = E("adv-status"); if (st) st.textContent = "Bezig met " + (labels[actie] || actie) + "…";
    advOpslaan(true).then(function (saved) {
      return _sb.functions.invoke("plaats-advertentie", { body: { advertentie_id: saved.id, actie: actie } });
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message || "Functie-fout");
      var d = res.data || {};
      if (d.error) throw new Error(d.error + (d.userErrors ? " — " + JSON.stringify(d.userErrors) : ""));
      if (st) st.innerHTML = '<span style="color:#15803d">Gelukt — status: ' + esc(d.status || "") + (d.handle ? " · " + esc(d.handle) : "") + "</span>";
      toastX("🚀 Actie gelukt: " + (d.status || actie));
      return laadAdvertenties();
    }).then(function () { renderLijst(); }).catch(function (e) {
      if (st) st.innerHTML = '<span style="color:#dc2626">' + esc(e.message || e) + " — vaak: Shopify-secrets nog niet ingesteld.</span>";
      toastX("Actie mislukt", "#dc2626");
    }).then(function () { _advActieBezig = false; });
  }

  function advSluit() { try { sluitModal("m-adv"); } catch (e) { var m = E("m-adv"); if (m) m.classList.remove("open"); } }

  /* ---- globals voor inline handlers ---- */
  window.openAdverteren = openAdverteren;
  window.advBewerk = advBewerk;
  window.advRubriekWijzig = advRubriekWijzig;
  window.advOpslaan = advOpslaan;
  window.advGenereer = advGenereer;
  window.advPlaats = advPlaats;
  window.advSluit = advSluit;
  window.advFotoKies = advFotoKies;
  window.advFotoWis = advFotoWis;
  window.advFotoMove = advFotoMove;
  window.advFotoRetry = advFotoRetry;
  window.advFotoCrop = advFotoCrop;
  window.advSlimKies = advSlimKies;
  window.advSlimWis = advSlimWis;

  // init na load (na het hoofdscript)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { injectCss(); injectDom(); }, 300); });
  } else {
    setTimeout(function () { injectCss(); injectDom(); }, 300);
  }
})();
