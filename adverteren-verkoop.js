/* ============================================================================
   Nijhof Brothers - Adverteren in de VERKOOPAPP (NB Verkoop)
   ----------------------------------------------------------------------------
   Zelf-injecterende uitbreiding op verkoop.html. Voegt een derde knop
   "Adverteren" toe aan het keuzescherm en een volledig scherm (screen-adverteren)
   met: item kiezen -> foto's + maten + gegevens -> tekst laten genereren ->
   met een klik op Shopify + Marktplaats plaatsen.

   Hangt aan bestaande globals uit verkoop.html:
     $, esc, eur, toast, toonScherm, STATE, _authHeaders, _restGet, _restPost,
     _restPatch, _compressInkFoto, _genId, _getStoredAuth, laadVoorraad,
     SUPABASE_URL, SUPABASE_ANON
   Backend (al aanwezig): tabel 'advertenties' + Edge Functions
     'genereer-advertentie' en 'plaats-advertentie'.
   ============================================================================ */
(function () {
  "use strict";

  var ADV = { lijst: [], huidig: null, fotos: [], verkochtItems: [], verkochtOpen: false };
  window._ADV = ADV;

  function E(id) { return document.getElementById(id); }
  function X(s) { try { return esc(s); } catch (e) { return String(s == null ? "" : s); } }
  function T(m, k) { try { toast(m, k); } catch (e) { console.log(m); } }
  function val(id) { var e = E(id); return e ? e.value : ""; }
  function tok() { try { return _getStoredAuth() && _getStoredAuth().access_token; } catch (e) { return null; } }

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
  var RUBRIEK_GROEP = {};
  Object.keys(RUBRIEKEN).forEach(function (g) {
    RUBRIEKEN[g].forEach(function (r) { RUBRIEK_GROEP[r] = g; });
  });
  function profielVoorGroep(g) { return GROEP_PROFIEL[g] || "accessoire"; }
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
      // scherm = flex-kolom op viewporthoogte zodat de header vast staat en de
      // inhoud (main) intern scrollt -> op mobiel blijven alle knoppen bereikbaar
      "#screen-adverteren.view.show{display:flex;flex-direction:column;height:100vh;height:100dvh}" +
      "#screen-adverteren > main{flex:1 1 auto;min-height:0;overflow-y:auto}" +
      "#screen-adverteren .adv-card{background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:12px}" +
      "#screen-adverteren label.al{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--nav)}" +
      "#screen-adverteren .ai,#screen-adverteren .as,#screen-adverteren .at{width:100%;border:1.5px solid var(--bd);border-radius:10px;padding:12px;font-size:15px;background:#fff;color:var(--dk);outline:none;box-sizing:border-box;-webkit-appearance:none}" +
      "#screen-adverteren .at{min-height:90px;resize:vertical;font-family:inherit}" +
      "#screen-adverteren .ai:focus,#screen-adverteren .as:focus,#screen-adverteren .at:focus{border-color:var(--or);box-shadow:0 0 0 3px rgba(232,119,34,.15)}" +
      "#screen-adverteren .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "#screen-adverteren .fld{margin-bottom:12px}" +
      "#screen-adverteren .adv-fotos{display:flex;flex-wrap:wrap;gap:8px}" +
      "#screen-adverteren .adv-foto{position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;border:1px solid var(--bd)}" +
      "#screen-adverteren .adv-foto img{width:100%;height:100%;object-fit:cover}" +
      "#screen-adverteren .adv-foto .x{position:absolute;top:2px;right:2px;background:#dc2626;color:#fff;border:none;border-radius:6px;width:22px;height:22px;font-size:13px;cursor:pointer;line-height:1}" +
      "#screen-adverteren .adv-foto .mv{position:absolute;bottom:2px;left:2px;display:flex;gap:3px}" +
      "#screen-adverteren .adv-foto .mv button{background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:5px;width:22px;height:20px;font-size:12px;cursor:pointer;line-height:1}" +
      "#screen-adverteren .adv-foto.eerste::after{content:'1e';position:absolute;top:2px;left:2px;background:#15803d;color:#fff;font-size:10px;font-weight:700;border-radius:5px;padding:1px 5px}" +
      "#screen-adverteren .adv-add{width:84px;height:84px;border:2px dashed #cbd5e1;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:30px;color:#9ca3af;cursor:pointer;background:transparent}" +
      "#screen-adverteren .abtn{border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;min-height:50px;width:100%}" +
      "#screen-adverteren .abtn-or{background:var(--or);color:#fff}" +
      "#screen-adverteren .abtn-nav{background:var(--nav);color:#fff}" +
      "#screen-adverteren .abtn-gy{background:#f3f4f6;color:var(--nav)}" +
      "#screen-adverteren .abtn-gn{background:#15803d;color:#fff}" +
      "#screen-adverteren .abtn-rd{background:#dc2626;color:#fff}" +
      "#screen-adverteren .abtn:disabled{opacity:.45}" +
      "#screen-adverteren .abtn-sm{min-height:44px;font-size:14px;padding:11px}" +
      "#screen-adverteren .adv-badge{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:3px 9px}" +
      "#screen-adverteren .adv-item{display:flex;gap:12px;align-items:center;padding:12px;cursor:pointer;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:10px;border:2px solid transparent}" +
      "#screen-adverteren .adv-item:active{border-color:var(--or)}" +
      "#screen-adverteren .adv-thumb{width:58px;height:58px;border-radius:10px;object-fit:cover;background:#f1f5f9;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px}";
    document.head.appendChild(s);
  }

  /* ---- DOM: derde keuzeknop + scherm ---- */
  function injectKeuzeKnop() {
    if (E("keuze-adverteren")) return;
    var scherm = E("screen-keuze");
    if (!scherm) return;
    var box = scherm.querySelector("main > div");
    if (!box) return;
    var btn = document.createElement("button");
    btn.id = "keuze-adverteren";
    btn.onclick = advMenu;
    btn.setAttribute("style", "background:linear-gradient(135deg,#0ea5a3,#0b7d7b);color:#fff;border:none;border-radius:16px;padding:36px 24px;font-size:22px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px rgba(14,165,163,.25);min-height:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px");
    btn.innerHTML = '<span style="font-size:54px;line-height:1">📣</span><span>Adverteren</span><span style="font-size:12px;font-weight:400;opacity:.9">Adverteren of advertentiecentrum</span>';
    box.appendChild(btn);
  }

  // Tussenmenu: kies tussen een advertentie plaatsen of het advertentiecentrum
  function injectMenu() {
    if (E("screen-adv-menu")) return;
    var sc = document.createElement("div");
    sc.id = "screen-adv-menu";
    sc.className = "view";
    sc.innerHTML =
      '<div class="top">' +
      '<button class="btn-icon" id="advmenu-terug" title="Terug">←</button>' +
      '<div class="logo">ADVERTEREN <small>NIJHOF BROTHERS</small></div>' +
      '<span style="width:36px"></span>' +
      '</div>' +
      '<main style="padding-top:30px"><div style="display:flex;flex-direction:column;gap:16px;max-width:480px;margin:0 auto">' +
      '<button id="advmenu-nieuw" style="background:linear-gradient(135deg,#0ea5a3,#0b7d7b);color:#fff;border:none;border-radius:16px;padding:34px 24px;font-size:22px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px rgba(14,165,163,.25);min-height:132px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">' +
      '<span style="font-size:50px;line-height:1">📣</span><span>Adverteren</span><span style="font-size:12px;font-weight:400;opacity:.9">Zet een meubel op Marktplaats</span></button>' +
      '<button id="advmenu-centrum" style="background:linear-gradient(135deg,#1e2f3a,#16242c);color:#fff;border:none;border-radius:16px;padding:34px 24px;font-size:22px;font-weight:700;cursor:pointer;box-shadow:0 6px 16px rgba(30,47,58,.25);min-height:132px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">' +
      '<span style="font-size:50px;line-height:1">📊</span><span>Advertentiecentrum</span><span style="font-size:12px;font-weight:400;opacity:.85">Beheer al je advertenties</span></button>' +
      '</div></main>';
    document.body.appendChild(sc);
    E("advmenu-terug").onclick = function () { toonScherm("screen-keuze"); };
    E("advmenu-nieuw").onclick = advStart;
    E("advmenu-centrum").onclick = advCentrum;
  }

  // Advertentiecentrum — placeholder, wordt hierna uitgewerkt
  function injectCentrum() {
    if (E("screen-adv-centrum")) return;
    var sc = document.createElement("div");
    sc.id = "screen-adv-centrum";
    sc.className = "view";
    sc.innerHTML =
      '<div class="top">' +
      '<button class="btn-icon" id="advcentrum-terug" title="Terug">←</button>' +
      '<div class="logo">ADVERTENTIECENTRUM <small>NIJHOF BROTHERS</small></div>' +
      '<span style="width:36px"></span>' +
      '</div>' +
      '<main><div id="advcentrum-body"></div></main>';
    document.body.appendChild(sc);
    E("advcentrum-terug").onclick = advMenu;
  }

  function advMenu() {
    injectAll();
    toonScherm("screen-adv-menu");
  }
  function advCentrum() {
    injectAll();
    toonScherm("screen-adv-centrum");
    E("advcentrum-body").innerHTML =
      '<div style="text-align:center;padding:48px 20px;color:var(--gr)">' +
      '<div style="font-size:52px;margin-bottom:14px">📊</div>' +
      '<h1 style="margin-bottom:6px">Advertentiecentrum</h1>' +
      '<h2 style="font-weight:500">Beheer van al je advertenties komt hier</h2>' +
      '<p style="max-width:360px;margin:14px auto 0;font-size:14px">Overzicht van live, gereserveerde en verkochte advertenties, met status, statistieken en snelle acties. Wordt binnenkort toegevoegd.</p>' +
      '</div>';
  }

  function injectScherm() {
    if (E("screen-adverteren")) return;
    var sc = document.createElement("div");
    sc.id = "screen-adverteren";
    sc.className = "view";
    sc.innerHTML =
      '<div class="top">' +
      '<button class="btn-icon" onclick="advTerug()" title="Terug">←</button>' +
      '<div class="logo">ADVERTEREN <small>NIJHOF BROTHERS</small></div>' +
      '<span style="width:36px"></span>' +
      '</div>' +
      '<main>' +
      // Paneel 1: item kiezen
      '<div id="adv-panel-lijst">' +
      '<h1>Welk meubel?</h1><h2>Kies een item uit de voorraad om te adverteren</h2>' +
      '<div class="adv-card" style="padding:0">' +
      '<input type="search" id="adv-zoek" placeholder="🔍 Zoek op naam of artikelnummer..." style="width:100%;border:none;padding:16px;font-size:15px;background:transparent;outline:none" oninput="advZoek()">' +
      '</div>' +
      '<div id="adv-items"></div>' +
      '</div>' +
      // Paneel 2: formulier
      '<div id="adv-panel-form" style="display:none"></div>' +
      '</main>';
    document.body.appendChild(sc);
  }

  function injectAll() { injectCss(); injectKeuzeKnop(); injectMenu(); injectCentrum(); injectScherm(); }

  /* ---- Data ---- */
  function laadAdvertenties() {
    return _restGet("advertenties?select=*").then(function (rows) {
      ADV.lijst = rows || [];
      return ADV.lijst;
    }).catch(function (e) { console.warn("Advertenties laden mislukt", e); ADV.lijst = []; return []; });
  }
  function advVoorItem(itemId) {
    for (var i = 0; i < ADV.lijst.length; i++) if (ADV.lijst[i].item_id === itemId) return ADV.lijst[i];
    return null;
  }
  // Verkochte items apart laden (staan niet in STATE.items, die alleen 'beschikbaar' bevat)
  function laadVerkocht() {
    return _restGet("items?select=*&status=eq.verkocht&order=aangemaakt_op.desc&limit=300").then(function (rows) {
      ADV.verkochtItems = rows || [];
      return ADV.verkochtItems;
    }).catch(function (e) { console.warn("Verkochte items laden mislukt", e); ADV.verkochtItems = []; return []; });
  }
  // Beschikbaar + verkocht samen (voor het openen van een item-formulier)
  function alleItems() { return (STATE.items || []).concat(ADV.verkochtItems || []); }

  function advStart() {
    injectAll();
    toonScherm("screen-adverteren");
    toonPaneel("lijst");
    E("adv-items").innerHTML = '<p style="color:var(--gr);padding:8px">Laden…</p>';
    var pre = (STATE.items && STATE.items.length) ? Promise.resolve() : (typeof laadVoorraad === "function" ? laadVoorraad() : Promise.resolve());
    pre.then(laadAdvertenties).then(laadVerkocht).then(renderAdvLijst).catch(function (e) {
      E("adv-items").innerHTML = '<div class="alert alert-err">⚠️ Laden mislukt: ' + X(e.message || e) + '</div>';
    });
  }

  function advTerug() {
    if (E("adv-panel-form") && E("adv-panel-form").style.display !== "none" && ADV.huidig) {
      toonPaneel("lijst");
      renderAdvLijst();
    } else {
      toonScherm("screen-adv-menu");
    }
  }

  function toonPaneel(welke) {
    E("adv-panel-lijst").style.display = welke === "lijst" ? "block" : "none";
    E("adv-panel-form").style.display = welke === "form" ? "block" : "none";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function advZoek() { renderAdvLijst(); }

  function advMatch(it, zk) {
    if (!zk) return true;
    return (it.naam || "").toLowerCase().indexOf(zk) >= 0 ||
      (it.artikelnummer || "").toLowerCase().indexOf(zk) >= 0 ||
      (it.categorie || "").toLowerCase().indexOf(zk) >= 0;
  }
  function advRowHtml(it, verkocht) {
    var a = advVoorItem(it.id);
    var st = verkocht ? ["Verkocht", "#7c3aed"]
      : (a ? (STATUS_LABEL[a.status] || ["?", "#6b7280"]) : ["Nog geen advertentie", "#94a3b8"]);
    var foto = (a && Array.isArray(a.fotos) && a.fotos[0] && a.fotos[0].url) || it.foto_url || "";
    var thumb = foto ? '<img class="adv-thumb" src="' + X(foto) + '">' : '<div class="adv-thumb">📦</div>';
    return '<div class="adv-item"' + (verkocht ? ' style="opacity:.72"' : '') + ' onclick="advOpenItem(\'' + X(it.id) + '\')">' + thumb +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:700;font-size:15px;color:var(--nav);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + X(it.naam || "?") + '</div>' +
      '<div style="font-size:12px;color:var(--gr);margin-top:3px">' +
      (it.artikelnummer ? '<span style="background:var(--orl);color:var(--or);padding:2px 8px;border-radius:10px;font-weight:600;font-family:ui-monospace,monospace">' + X(it.artikelnummer) + '</span>' : "") +
      (it.categorie ? ' · ' + X(it.categorie) : "") + '</div>' +
      '<div style="margin-top:6px"><span class="adv-badge" style="background:' + st[1] + '">' + X(st[0]) + '</span></div>' +
      '</div>' +
      '<div style="color:var(--gr);font-size:22px">›</div>' +
      '</div>';
  }
  function renderAdvLijst() {
    var wrap = E("adv-items"); if (!wrap) return;
    var zk = (val("adv-zoek") || "").toLowerCase().trim();
    var besch = (STATE.items || []).filter(function (i) { return advMatch(i, zk); });
    var verk = (ADV.verkochtItems || []).filter(function (i) { return advMatch(i, zk); });
    var html = "";
    if (besch.length) {
      html += besch.map(function (it) { return advRowHtml(it, false); }).join("");
    } else {
      html += '<div class="empty" style="text-align:center;color:var(--gr);padding:24px">' +
        (zk ? 'Geen beschikbare items voor "' + X(zk) + '"' : "Geen voorraad om te adverteren") + '</div>';
    }
    // Uitklapbaar 'Verkocht'-kopje — verkochte items blijven zo bewaard/zichtbaar.
    if (verk.length) {
      html += '<div style="margin-top:16px;border-top:1px solid var(--bd);padding-top:4px">' +
        '<div onclick="advToggleVerkocht()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 4px;font-weight:700;color:var(--nav)">' +
        '<span id="adv-verkocht-caret" style="display:inline-block;transition:.15s' + (ADV.verkochtOpen ? ";transform:rotate(90deg)" : "") + '">▸</span>' +
        '✓ Verkocht <span style="color:var(--gr);font-weight:500">(' + verk.length + ')</span></div>' +
        '<div id="adv-verkocht-lijst" style="display:' + (ADV.verkochtOpen ? "block" : "none") + '">' +
        verk.map(function (it) { return advRowHtml(it, true); }).join("") +
        '</div></div>';
    }
    wrap.innerHTML = html;
  }
  function advToggleVerkocht() {
    ADV.verkochtOpen = !ADV.verkochtOpen;
    var l = E("adv-verkocht-lijst"), c = E("adv-verkocht-caret");
    if (l) l.style.display = ADV.verkochtOpen ? "block" : "none";
    if (c) c.style.transform = ADV.verkochtOpen ? "rotate(90deg)" : "";
  }

  /* ---- Formulier ---- */
  function rubriekSelectHtml(gekozen) {
    var h = '<select id="adv-rubriek" class="as" onchange="advRubriekWijzig()"><option value="">— kies rubriek —</option>';
    Object.keys(RUBRIEKEN).forEach(function (g) {
      h += '<optgroup label="' + X(g) + '">';
      RUBRIEKEN[g].forEach(function (r) {
        h += '<option value="' + X(r) + '"' + (r === gekozen ? " selected" : "") + ">" + X(r) + "</option>";
      });
      h += "</optgroup>";
    });
    return h + "</select>";
  }
  function matenHtml(profiel, maten) {
    var velden = PROFIEL_MATEN[profiel] || PROFIEL_MATEN.accessoire;
    maten = maten || {};
    return velden.map(function (v) {
      return '<div><label class="al" style="font-size:12px">' + X(v[1]) + '</label><input class="ai" data-maat="' + X(v[0]) + '" value="' + X(maten[v[0]] || "") + '"></div>';
    }).join("");
  }

  function advOpenItem(itemId) {
    injectAll();
    var it = alleItems().find(function (x) { return x.id === itemId; });
    if (!it) { T("Item niet gevonden", "#dc2626"); return; }
    var a = advVoorItem(itemId) || {};
    ADV.huidig = { itemId: itemId, id: a.id || null, item: it, bestaatInDb: !!a.id };
    ADV.fotos = Array.isArray(a.fotos) ? a.fotos.slice() : [];

    var profiel = a.maat_profiel || profielVoorRubriek(a.rubriek || "") || "accessoire";
    var pt = a.prijstype || "vaste_prijs";
    var bez = a.bezorging || {};
    var isLive = a.status && a.status !== "concept" && a.status !== "gegenereerd";

    E("adv-panel-form").innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
      (it.foto_url ? '<img src="' + X(it.foto_url) + '" style="width:48px;height:48px;border-radius:10px;object-fit:cover">' : '<div style="width:48px;height:48px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>') +
      '<div style="min-width:0"><h1 style="margin:0;font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + X(it.naam || "") + '</h1>' +
      '<div style="font-size:12px;color:var(--gr)">' + X(it.artikelnummer || "") + '</div></div></div>' +

      '<div class="adv-card">' +
      '<div class="fld"><label class="al">Marktplaats-rubriek</label>' + rubriekSelectHtml(a.rubriek || "") + '</div>' +
      '<div class="fld"><label class="al">Foto\'s <span style="font-weight:400;color:var(--gr)">(eerste = hoofdfoto)</span></label><div class="adv-fotos" id="adv-fotos"></div></div>' +
      '<div class="fld"><label class="al">Afmetingen</label><div class="grid2" id="adv-maten">' + matenHtml(profiel, a.maten) + '</div></div>' +
      '</div>' +

      '<div class="adv-card">' +
      '<div class="grid2">' +
      '<div class="fld"><label class="al">Staat</label><select id="adv-staat" class="as">' + STATEN.map(function (s) { return '<option' + (s === a.staat ? " selected" : "") + ">" + X(s) + "</option>"; }).join("") + '</select></div>' +
      '<div class="fld"><label class="al">Merk</label><input id="adv-merk" class="ai" value="' + X(a.merk || "") + '"></div>' +
      '<div class="fld"><label class="al">Materiaal</label><input id="adv-materiaal" class="ai" value="' + X(a.materiaal || "") + '"></div>' +
      '<div class="fld"><label class="al">Kleur</label><input id="adv-kleur" class="ai" value="' + X(a.kleur || "") + '"></div>' +
      '<div class="fld"><label class="al">Vraagprijs (€)</label><input id="adv-prijs" class="ai" type="number" inputmode="decimal" min="0" step="0.01" value="' + X(a.vraagprijs != null ? a.vraagprijs : (it.verwacht_vp || it.vvp || "")) + '"></div>' +
      '<div class="fld"><label class="al">Prijstype</label><select id="adv-prijstype" class="as">' +
      '<option value="vaste_prijs"' + (pt === "vaste_prijs" ? " selected" : "") + ">Vaste prijs</option>" +
      '<option value="bieden"' + (pt === "bieden" ? " selected" : "") + ">Bieden</option>" +
      '<option value="notk"' + (pt === "notk" ? " selected" : "") + ">N.o.t.k.</option></select></div>" +
      '<div class="fld"><label class="al">Klikprijs CPC (€)</label><input id="adv-cpc" class="ai" type="number" inputmode="decimal" min="0.01" step="0.01" value="' + X(a.klikprijs != null ? a.klikprijs : 0.05) + '"></div>' +
      '<div class="fld"><label class="al">Budget (€)</label><input id="adv-budget" class="ai" type="number" inputmode="decimal" min="0" step="1" value="' + X(a.budget != null ? a.budget : 10) + '"></div>' +
      '<div class="fld"><label class="al">Bezorgen mogelijk?</label><select id="adv-bezorgen" class="as"><option value="ja"' + (bez.bezorgen !== false ? " selected" : "") + ">Ja</option><option value=\"nee\"" + (bez.bezorgen === false ? " selected" : "") + ">Nee</option></select></div>" +
      '<div class="fld"><label class="al">Bezorgkosten (€, 0 = gratis)</label><input id="adv-bezorgkosten" class="ai" type="number" inputmode="decimal" min="0" step="1" value="' + X(bez.kosten != null ? bez.kosten : "") + '"></div>' +
      '</div>' +
      '<div class="fld"><label class="al">Notitie <span style="font-weight:400;color:var(--gr)">(AI benoemt dit — bv. hoes afritsbaar, kleine kras)</span></label><textarea id="adv-notitie" class="at">' + X(a.notitie || "") + '</textarea></div>' +
      '<div class="fld" style="margin-bottom:0"><label class="al">Niet vermelden</label><input id="adv-niet" class="ai" value="' + X(a.niet_vermelden || "") + '"></div>' +
      '</div>' +

      '<div class="adv-card">' +
      '<button class="abtn abtn-or" id="adv-genbtn" onclick="advGenereer()">✨ Genereer advertentietekst</button>' +
      '<div class="fld" style="margin-top:14px;margin-bottom:10px"><label class="al">Gegenereerde titel</label><input id="adv-aititel" class="ai" value="' + X(a.ai_titel || "") + '"></div>' +
      '<div class="fld" style="margin-bottom:0"><label class="al">Volledige advertentietekst <span style="font-weight:400;color:var(--gr)">(aanpasbaar)</span></label><textarea id="adv-volledig" class="at" style="min-height:170px">' + X(a.volledige_tekst || "") + '</textarea></div>' +
      '</div>' +

      '<div class="adv-card">' +
      '<button class="abtn abtn-gy abtn-sm" style="margin-bottom:10px" onclick="advOpslaan(false)">💾 Alleen opslaan (concept)</button>' +
      '<button class="abtn abtn-gn" onclick="advPlaats(\'plaatsen\')">🚀 Plaats op Shopify + Marktplaats</button>' +
      '<div class="grid2" style="margin-top:10px">' +
      '<button class="abtn abtn-gy abtn-sm" onclick="advPlaats(\'reserveren\')">🔖 Gereserveerd</button>' +
      '<button class="abtn abtn-gy abtn-sm" onclick="advPlaats(\'terug_online\')">↩︎ Terug online</button>' +
      '<button class="abtn abtn-gy abtn-sm" onclick="advPlaats(\'verkocht\')">✅ Verkocht</button>' +
      '<button class="abtn abtn-rd abtn-sm" onclick="advPlaats(\'verwijderen\')">⛔ Offline halen</button>' +
      '</div>' +
      '<div id="adv-status" style="margin-top:12px;font-size:13px;color:var(--gr)"></div>' +
      '</div>';

    renderFotos();
    if (a.laatste_fout) E("adv-status").innerHTML = '<span style="color:#dc2626">Laatste fout: ' + X(a.laatste_fout) + '</span>';
    if (!isLive) { /* concept: laat alle knoppen staan, geen extra melding */ }
    toonPaneel("form");
  }

  function advRubriekWijzig() {
    var r = val("adv-rubriek");
    var profiel = profielVoorRubriek(r);
    var huidige = leesMaten();
    E("adv-maten").innerHTML = matenHtml(profiel, huidige);
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
  function renderFotos() {
    var wrap = E("adv-fotos"); if (!wrap) return;
    var html = ADV.fotos.map(function (f, i) {
      return '<div class="adv-foto' + (i === 0 ? " eerste" : "") + '"><img src="' + X(f.url) + '">' +
        '<button class="x" onclick="advFotoWis(' + i + ')">✕</button>' +
        '<div class="mv"><button onclick="advFotoMove(' + i + ',-1)">◀</button><button onclick="advFotoMove(' + i + ',1)">▶</button></div>' +
        '</div>';
    }).join("");
    html += '<div class="adv-add" onclick="advFotoKies()">＋</div>';
    wrap.innerHTML = html;
  }
  function advFotoKies() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = function () {
      var files = Array.prototype.slice.call(inp.files || []);
      if (!files.length) return;
      var itemId = ADV.huidig.itemId;
      T("📤 Foto's uploaden…", "#2563eb");
      var chain = Promise.resolve();
      files.slice(0, 12).forEach(function (file, idx) {
        chain = chain.then(function () { return uploadEenFoto(file, itemId, idx); });
      });
      chain.then(function () { renderFotos(); T("📷 Foto's toegevoegd"); })
        .catch(function (e) { T("Upload mislukt: " + (e.message || e), "#dc2626"); });
    };
    inp.click();
  }
  function uploadEenFoto(file, itemId, idx) {
    if (!file.type || file.type.indexOf("image/") !== 0) return Promise.resolve();
    return _compressInkFoto(file).then(function (blob) {
      var pad = STATE.org_id + "/adv/" + itemId + "-" + Date.now() + "-" + idx + ".jpg";
      return fetch(SUPABASE_URL + "/storage/v1/object/item-fotos/" + pad, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + tok(), "Content-Type": "image/jpeg" },
        body: blob
      }).then(function (r) {
        if (!r.ok && r.status !== 200) return r.text().then(function (t) { throw new Error(t || ("upload " + r.status)); });
        var pub = SUPABASE_URL + "/storage/v1/object/public/item-fotos/" + pad;
        ADV.fotos.push({ url: pub, pad: pad });
      });
    });
  }
  function advFotoWis(i) { ADV.fotos.splice(i, 1); renderFotos(); }
  function advFotoMove(i, d) {
    var j = i + d; if (j < 0 || j >= ADV.fotos.length) return;
    var t = ADV.fotos[i]; ADV.fotos[i] = ADV.fotos[j]; ADV.fotos[j] = t; renderFotos();
  }

  /* ---- Opslaan / genereren / plaatsen ---- */
  function bouwRow() {
    var h = ADV.huidig;
    var bestaand = advVoorItem(h.itemId) || {};
    var id = h.id || bestaand.id || _genId();
    h.id = id;
    var rubriek = val("adv-rubriek");
    return {
      id: id,
      item_id: h.itemId,
      org_id: STATE.org_id,
      user_id: STATE.user && STATE.user.id,
      rubriek: rubriek,
      maat_profiel: profielVoorRubriek(rubriek),
      maten: leesMaten(),
      staat: val("adv-staat"),
      merk: (val("adv-merk") || "").trim(),
      materiaal: (val("adv-materiaal") || "").trim(),
      kleur: (val("adv-kleur") || "").trim(),
      vraagprijs: parseFloat(val("adv-prijs")) || 0,
      prijstype: val("adv-prijstype"),
      klikprijs: parseFloat(val("adv-cpc")) || 0.05,
      budget: parseFloat(val("adv-budget")) || 10,
      bezorging: { bezorgen: val("adv-bezorgen") !== "nee", kosten: parseFloat(val("adv-bezorgkosten")) || 0 },
      notitie: (val("adv-notitie") || "").trim(),
      niet_vermelden: (val("adv-niet") || "").trim(),
      fotos: ADV.fotos,
      ai_titel: val("adv-aititel"),
      volledige_tekst: E("adv-volledig") ? E("adv-volledig").value : "",
      status: bestaand.status && bestaand.status !== "concept" ? bestaand.status : "concept",
      shopify_product_id: bestaand.shopify_product_id || null,
      shopify_variant_id: bestaand.shopify_variant_id || null,
      shopify_inventory_item_id: bestaand.shopify_inventory_item_id || null,
      shopify_handle: bestaand.shopify_handle || null
    };
  }

  function advUpsert(row) {
    return fetch(SUPABASE_URL + "/rest/v1/advertenties", {
      method: "POST",
      headers: Object.assign({}, _authHeaders(), { "Prefer": "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(row)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("Opslaan " + r.status + ": " + t); });
      return r.json();
    }).then(function (j) { return (j && j[0]) || row; });
  }

  function advOpslaan(stil) {
    var row = bouwRow();
    return advUpsert(row).then(function (saved) {
      ADV.huidig.bestaatInDb = true;
      var idx = ADV.lijst.findIndex(function (x) { return x.id === saved.id; });
      if (idx >= 0) ADV.lijst[idx] = saved; else ADV.lijst.push(saved);
      if (!stil) T("💾 Opgeslagen");
      return saved;
    }).catch(function (e) { T("Opslaan mislukt: " + (e.message || e), "#dc2626"); throw e; });
  }

  function roepFunctie(naam, body) {
    return fetch(SUPABASE_URL + "/functions/v1/" + naam, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + tok(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) throw new Error((j.error || ("HTTP " + r.status)) + (j.detail ? " — " + j.detail : "") + (j.userErrors ? " — " + JSON.stringify(j.userErrors) : ""));
        return j;
      });
    });
  }

  function advGenereer() {
    var btn = E("adv-genbtn"); if (btn) { btn.disabled = true; btn.textContent = "✨ Bezig…"; }
    var st = E("adv-status"); if (st) { st.style.color = "var(--gr)"; st.textContent = "AI schrijft de advertentietekst…"; }
    advOpslaan(true).then(function (saved) {
      return roepFunctie("genereer-advertentie", { advertentie_id: saved.id });
    }).then(function (d) {
      if (E("adv-aititel")) E("adv-aititel").value = d.titel || "";
      if (E("adv-volledig")) E("adv-volledig").value = d.volledige_tekst || "";
      if (st) { st.style.color = "#15803d"; st.textContent = "✨ Tekst gegenereerd — controleer en pas eventueel aan."; }
      T("✨ Tekst gegenereerd");
    }).catch(function (e) {
      if (st) { st.style.color = "#dc2626"; st.textContent = "Genereren mislukt: " + (e.message || e); }
      T("Genereren mislukt", "#dc2626");
    }).then(function () { if (btn) { btn.disabled = false; btn.textContent = "✨ Genereer advertentietekst"; } });
  }

  function advPlaats(actie) {
    var labels = { plaatsen: "plaatsen op Shopify + Marktplaats", reserveren: "op gereserveerd zetten", terug_online: "terug online zetten", verkocht: "als verkocht markeren", verwijderen: "offline halen" };
    if ((actie === "verkocht" || actie === "verwijderen") && !confirm("Weet je zeker dat je dit meubel wilt " + labels[actie] + "?")) return;
    var st = E("adv-status"); if (st) { st.style.color = "var(--gr)"; st.textContent = "Bezig met " + (labels[actie] || actie) + "…"; }
    advOpslaan(true).then(function (saved) {
      return roepFunctie("plaats-advertentie", { advertentie_id: saved.id, actie: actie });
    }).then(function (d) {
      if (st) {
        st.style.color = "#15803d";
        st.innerHTML = "Gelukt — status: <strong>" + X(d.status || "") + "</strong>" + (d.handle ? " · " + X(d.handle) : "") +
          (d.item_status ? '<br><span style="color:var(--gr)">Voorraad: item op <strong>' + X(d.item_status) + "</strong> gezet</span>" : "");
      }
      T("🚀 " + (d.status || actie));
      var na = laadAdvertenties();
      // Voorraad + verkocht-lijst herladen als de item-status is meegewijzigd, zodat
      // het item netjes tussen 'beschikbaar' en het 'Verkocht'-kopje verschuift.
      if (actie === "verkocht" || actie === "terug_online") {
        na = na
          .then(function () { return (typeof laadVoorraad === "function") ? laadVoorraad() : null; })
          .then(laadVerkocht)
          .then(renderAdvLijst, renderAdvLijst);
      }
      return na;
    }).catch(function (e) {
      if (st) { st.style.color = "#dc2626"; st.textContent = (e.message || e) + " — vaak: Shopify-secrets nog niet ingesteld."; }
      T("Actie mislukt", "#dc2626");
    });
  }

  /* ---- globals voor inline handlers ---- */
  window.advMenu = advMenu;
  window.advCentrum = advCentrum;
  window.advStart = advStart;
  window.advTerug = advTerug;
  window.advZoek = advZoek;
  window.advToggleVerkocht = advToggleVerkocht;
  window.advOpenItem = advOpenItem;
  window.advRubriekWijzig = advRubriekWijzig;
  window.advOpslaan = advOpslaan;
  window.advGenereer = advGenereer;
  window.advPlaats = advPlaats;
  window.advFotoKies = advFotoKies;
  window.advFotoWis = advFotoWis;
  window.advFotoMove = advFotoMove;

  /* ---- init: knop + scherm injecteren zodra de app-DOM er is ---- */
  function boot() { try { injectAll(); } catch (e) { console.warn("Adverteren init:", e); } }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 200); });
  } else {
    setTimeout(boot, 200);
  }
})();
