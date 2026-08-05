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

  var ADV = { lijst: [], huidig: null, fotos: [], verkochtItems: [], verkochtOpen: false, partijen: [], peel: null, centrum: { zoek: "", status: "", sel: {} } };
  var PEEL_CATS = [["bank", "Bank"], ["hoekbank", "Hoekbank"], ["fauteuil", "Fauteuil"], ["loveseat", "Loveseat"], ["kast", "Kast"], ["dressoir", "Dressoir"], ["overig", "Overig"]];
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
      // Laad-tegel: spinnertje terwijl de foto upload; wordt vervangen door de echte foto
      "#screen-adverteren .adv-foto.laden{display:flex;align-items:center;justify-content:center;background:#eef2f7}" +
      "#screen-adverteren .adv-foto .spin{width:26px;height:26px;border:3px solid #cbd5e1;border-top-color:var(--or);border-radius:50%;animation:advspin .7s linear infinite}" +
      "@keyframes advspin{to{transform:rotate(360deg)}}" +
      "#screen-adverteren .adv-foto.fout{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:#fef2f2;border-color:#fecaca}" +
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
      "#screen-adverteren .adv-thumb{width:58px;height:58px;border-radius:10px;object-fit:cover;background:#f1f5f9;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px}" +
      // Advertentiecentrum: header vast + inhoud intern scrollen, en dezelfde component-stijlen
      // (zonder deze regels kregen de foto's/rijen geen breedte -> horizontale overflow op mobiel)
      "#screen-adv-centrum.view.show{display:flex;flex-direction:column;height:100vh;height:100dvh}" +
      "#screen-adv-centrum > main{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden}" +
      "#screen-adv-centrum #advcentrum-body{max-width:100%}" +
      "#screen-adv-centrum .adv-card{background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:12px;max-width:100%;box-sizing:border-box}" +
      "#screen-adv-centrum .adv-item{display:flex;gap:12px;align-items:center;padding:12px;cursor:pointer;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:10px;border:2px solid transparent;max-width:100%;box-sizing:border-box}" +
      "#screen-adv-centrum .adv-item:active{border-color:var(--or)}" +
      "#screen-adv-centrum .adv-thumb{width:58px;height:58px;border-radius:10px;object-fit:cover;background:#f1f5f9;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px}" +
      "#screen-adv-centrum .adv-badge{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:3px 9px}";
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
  var MP_DASHBOARD_URL = "https://admarkt.marktplaats.nl/";

  function advCentrum() {
    injectAll();
    toonScherm("screen-adv-centrum");
    E("advcentrum-body").innerHTML = '<p style="color:var(--gr);padding:8px">Laden…</p>';
    var pre = (STATE.items && STATE.items.length) ? Promise.resolve() : (typeof laadVoorraad === "function" ? laadVoorraad() : Promise.resolve());
    pre.then(laadAdvertenties).then(laadVerkocht).then(renderCentrum).catch(function (e) {
      E("advcentrum-body").innerHTML = '<div class="alert alert-err">⚠️ Laden mislukt: ' + X(e.message || e) + '</div>';
    });
  }

  function renderCentrum() {
    var body = E("advcentrum-body"); if (!body) return;
    // Verkochte advertenties horen niet in de advertentie-app (staan in het dashboard)
    var ads = (ADV.lijst || []).filter(function (a) { return a.status !== "verkocht"; });
    var live = ads.filter(function (a) { return a.status === "live"; });
    var gereserveerd = ads.filter(function (a) { return a.status === "gereserveerd"; });
    var concept = ads.filter(function (a) { return a.status === "concept" || a.status === "gegenereerd"; });
    var offline = ads.filter(function (a) { return a.status === "verwijderd"; });
    var onlineWaarde = live.concat(gereserveerd).reduce(function (s, a) { return s + (Number(a.vraagprijs) || 0); }, 0);

    function tile(label, waarde, kleur, sub) {
      return '<div style="background:#fff;border:1px solid var(--bd);border-radius:12px;padding:12px 14px;box-shadow:inset 3px 0 0 ' + kleur + ';min-width:0">' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--gr);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
        '<div style="font-size:22px;font-weight:700;color:var(--nav);margin-top:3px">' + waarde + '</div>' +
        (sub ? '<div style="font-size:11px;color:var(--gr);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + sub + '</div>' : '') + '</div>';
    }

    var kpis = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' +
      tile("Live", String(live.length), "#15803d", live.length ? eur(onlineWaarde) + " online" : "") +
      tile("Gereserveerd", String(gereserveerd.length), "#b45309", "") +
      tile("Concept", String(concept.length), "#2563eb", "nog niet online") +
      tile("Offline", String(offline.length), "#6b7280", offline.length ? "terug online mogelijk" : "") +
      '</div>';

    // Knop naar het Marktplaats Admarkt-dashboard
    var mpKnop = '<a href="' + MP_DASHBOARD_URL + '" target="_blank" rel="noopener" ' +
      'style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#e87722,#d36b1f);color:#fff;text-decoration:none;border-radius:12px;padding:15px;font-size:16px;font-weight:700;margin-bottom:14px;box-shadow:0 4px 12px rgba(232,119,34,.25)">' +
      '📊 Open Marktplaats-dashboard <span style="font-size:13px;opacity:.9">↗</span></a>';

    // Marktplaats-prestaties (placeholder tot de Admarkt-API-koppeling er is)
    function stat(label, val) {
      return '<div style="min-width:0"><div style="font-size:12px;color:var(--gr);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
        '<div style="font-size:19px;font-weight:700;color:#cbd5e1">' + val + '</div></div>';
    }
    var prestaties = '<div class="adv-card" style="padding:16px;margin-bottom:14px">' +
      '<div style="margin-bottom:12px">' +
      '<div style="font-weight:700;color:var(--nav);margin-bottom:6px">📈 Marktplaats-prestaties</div>' +
      '<span style="font-size:11px;background:#fff7ed;color:#c2410c;padding:3px 9px;border-radius:20px;font-weight:600">Koppeling met Marktplaats vereist</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 10px">' +
      stat("Besteed", "€ –") + stat("Kliks", "–") + stat("Websitekliks", "–") + stat("Gem. CPC", "€ –") + stat("Impressies", "–") + stat("CTR", "– %") +
      '</div>' +
      '<div style="font-size:12px;color:var(--gr);margin-top:12px">Zodra de Admarkt-API is gekoppeld, verschijnen hier automatisch je live cijfers (besteed budget, kliks, websitekliks, gemiddelde CPC, impressies en CTR). Voorlopig zie je ze via de knop hierboven op het Marktplaats-dashboard.</div>' +
      '</div>';

    // Filter- en zoekbalk boven de lijst
    var f = ADV.centrum;
    var statusOpts = [["", "Alle statussen"], ["live", "Live"], ["gereserveerd", "Gereserveerd"], ["gegenereerd", "Tekst klaar"], ["concept", "Concept"], ["verwijderd", "Offline"]]
      .map(function (o) { return '<option value="' + o[0] + '"' + (f.status === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("");
    var filterBar = '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<input id="adv-c-zoek" value="' + X(f.zoek) + '" oninput="advCentrumZoek()" placeholder="🔍 Zoek naam, artikelnr, merk…" ' +
      'style="flex:1;min-width:0;border:1.5px solid var(--bd);border-radius:10px;padding:11px 12px;font-size:15px;background:#fff;outline:none;-webkit-appearance:none">' +
      '<select id="adv-c-status" onchange="advCentrumFilter()" style="border:1.5px solid var(--bd);border-radius:10px;padding:0 8px;font-size:14px;background:#fff;color:var(--nav);outline:none">' + statusOpts + '</select>' +
      '</div>';

    body.innerHTML = kpis + mpKnop + prestaties + filterBar +
      '<div id="advcentrum-kop" style="display:flex;align-items:center;gap:8px;margin:4px 0 8px"></div>' +
      '<div id="advcentrum-lijst"></div>' +
      '<div id="advcentrum-bulk"></div>';
    renderCentrumLijst();
  }

  // Alleen de lijst + selectie hertekenen (houdt focus in het zoekveld vast)
  function renderCentrumLijst() {
    var wrap = E("advcentrum-lijst"); if (!wrap) return;
    var f = ADV.centrum;
    var alle = alleItems();
    var zk = (f.zoek || "").toLowerCase().trim();
    var rang = { live: 0, gereserveerd: 1, gegenereerd: 2, concept: 3, verwijderd: 4 };
    var lijst = (ADV.lijst || []).filter(function (a) {
      if (a.status === "verkocht") return false; // verkocht hoort niet in de advertentie-app
      if (f.status && a.status !== f.status) return false;
      if (!zk) return true;
      var it = alle.find(function (x) { return x.id === a.item_id; }) || {};
      return [it.naam, it.artikelnummer, a.merk, it.categorie].some(function (v) { return (v || "").toLowerCase().indexOf(zk) >= 0; });
    }).sort(function (a, b) { return (rang[a.status] || 9) - (rang[b.status] || 9); });

    // Kop met teller + 'alles selecteren'
    var kop = E("advcentrum-kop");
    if (kop) {
      var zichtbaarSel = lijst.filter(function (a) { return f.sel[a.id]; }).length;
      var allesAan = lijst.length > 0 && zichtbaarSel === lijst.length;
      kop.innerHTML = '<input type="checkbox" onchange="advCentrumSelAlle(this.checked)"' + (allesAan ? " checked" : "") +
        ' style="width:20px;height:20px;accent-color:var(--or)"> ' +
        '<span style="font-weight:700;color:var(--nav)">Advertenties <span style="color:var(--gr);font-weight:500">(' + lijst.length + ')</span></span>';
    }

    if (!lijst.length) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--gr);padding:24px">' +
        ((f.zoek || f.status) ? "Geen advertenties met dit filter." : "Nog geen advertenties. Ga naar Adverteren om te beginnen.") + '</div>';
    } else {
      wrap.innerHTML = lijst.map(function (a) {
        var it = alle.find(function (x) { return x.id === a.item_id; });
        return it ? centrumRow(a, it) : "";
      }).join("");
    }
    renderBulkBar();
  }

  function centrumRow(ad, it) {
    var checked = ADV.centrum.sel[ad.id] ? " checked" : "";
    var foto = (Array.isArray(ad.fotos) && ad.fotos[0] && ad.fotos[0].url) || it.foto_url || "";
    var thumb = foto ? '<img class="adv-thumb" src="' + X(foto) + '">' : '<div class="adv-thumb">📦</div>';
    var st = STATUS_LABEL[ad.status] || ["?", "#6b7280"];
    return '<div class="adv-item" style="align-items:center">' +
      '<input type="checkbox" onclick="event.stopPropagation()" onchange="advCentrumSel(\'' + X(ad.id) + '\',this.checked)"' + checked +
      ' style="width:22px;height:22px;flex:none;accent-color:var(--or)">' +
      '<div onclick="advOpenItem(\'' + X(ad.item_id) + '\')" style="display:flex;gap:12px;align-items:center;flex:1;min-width:0;cursor:pointer">' +
      thumb +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:700;font-size:15px;color:var(--nav);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + X(it.naam || "?") + '</div>' +
      '<div style="font-size:12px;color:var(--gr);margin-top:3px">' + (ad.vraagprijs ? eur(ad.vraagprijs) : "—") + (it.artikelnummer ? " · " + X(it.artikelnummer) : "") + '</div>' +
      '<div style="margin-top:6px"><span class="adv-badge" style="background:' + st[1] + '">' + X(st[0]) + '</span></div>' +
      '</div></div></div>';
  }

  function renderBulkBar() {
    var bar = E("advcentrum-bulk"); if (!bar) return;
    var ids = Object.keys(ADV.centrum.sel).filter(function (id) { return ADV.centrum.sel[id]; });
    if (!ids.length) { bar.innerHTML = ""; return; }
    var knop = function (kleur, tekst, actie) {
      return '<button onclick="advCentrumBulk(\'' + actie + '\')" style="flex:1;min-width:96px;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;color:#fff;background:' + kleur + ';cursor:pointer">' + tekst + '</button>';
    };
    bar.innerHTML = '<div style="position:sticky;bottom:8px;background:#fff;border:1px solid var(--bd);border-radius:12px;padding:10px;margin-top:10px;box-shadow:0 -3px 14px rgba(0,0,0,.1);z-index:5">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<span style="font-weight:700;color:var(--nav)">' + ids.length + ' geselecteerd</span>' +
      '<button onclick="advCentrumSelWis()" style="background:none;border:none;color:var(--gr);font-size:13px;cursor:pointer;text-decoration:underline">wissen</button></div>' +
      '<div id="advcentrum-bulkstatus" style="font-size:12px;color:var(--gr);margin-bottom:8px;display:none"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      knop("#15803d", "🚀 Online", "plaatsen") +
      knop("#b45309", "🔖 Gereserveerd", "reserveren") +
      knop("#7c3aed", "✅ Verkocht", "verkocht") +
      knop("#2563eb", "💶 Prijs", "prijs") +
      knop("#dc2626", "⏸️ Offline", "verwijderen") +
      '</div></div>';
  }

  function advCentrumZoek() { ADV.centrum.zoek = val("adv-c-zoek"); renderCentrumLijst(); }
  function advCentrumFilter() { ADV.centrum.status = val("adv-c-status"); renderCentrumLijst(); }
  function advCentrumSel(id, aan) { if (aan) ADV.centrum.sel[id] = true; else delete ADV.centrum.sel[id]; renderBulkBar(); }
  function advCentrumSelWis() { ADV.centrum.sel = {}; renderCentrumLijst(); }
  function advCentrumSelAlle(aan) {
    var f = ADV.centrum, alle = alleItems(), zk = (f.zoek || "").toLowerCase().trim();
    (ADV.lijst || []).forEach(function (a) {
      if (a.status === "verkocht") return;
      if (f.status && a.status !== f.status) return;
      if (zk) { var it = alle.find(function (x) { return x.id === a.item_id; }) || {}; if (![it.naam, it.artikelnummer, a.merk, it.categorie].some(function (v) { return (v || "").toLowerCase().indexOf(zk) >= 0; })) return; }
      if (aan) f.sel[a.id] = true; else delete f.sel[a.id];
    });
    renderCentrumLijst();
  }

  function advCentrumBulk(actie) {
    var ids = Object.keys(ADV.centrum.sel).filter(function (id) { return ADV.centrum.sel[id]; });
    if (!ids.length) return;
    var ads = ids.map(function (id) { return (ADV.lijst || []).find(function (a) { return a.id === id; }); }).filter(Boolean);

    var pct = 0;
    if (actie === "prijs") {
      var s = prompt("Prijs van " + ads.length + " advertentie(s) verlagen met hoeveel procent?\n(bijv. 10 voor 10% lager)");
      if (s === null) return;
      pct = parseFloat(String(s).replace(",", "."));
      if (!(pct > 0 && pct < 90)) { T("Vul een percentage tussen 1 en 89 in", "#dc2626"); return; }
    } else {
      var watMap = { plaatsen: "online zetten", verwijderen: "offline halen", reserveren: "op gereserveerd zetten", verkocht: "als verkocht markeren" };
      var wat = watMap[actie] || actie;
      if (!confirm(ads.length + " advertentie(s) " + wat + "?")) return;
    }

    var statusEl = E("advcentrum-bulkstatus");
    if (statusEl) { statusEl.style.display = "block"; }
    var klaar = 0, fouten = 0;
    var chain = Promise.resolve();
    ads.forEach(function (ad) {
      chain = chain.then(function () {
        if (statusEl) statusEl.textContent = "Bezig… " + (klaar + fouten + 1) + "/" + ads.length;
        var stap;
        if (actie === "prijs") {
          var basis = Number(ad.vraagprijs);
          // Zonder geldige vraagprijs overslaan: anders wordt de prijs NaN→null (wist
          // de vraagprijs) of €1 (en pusht bij live advertenties direct naar Marktplaats).
          if (!(basis > 0)) { fouten++; console.warn("Bulk-prijs overgeslagen (geen vraagprijs)", ad.id); return; }
          var nieuw = Math.max(1, Math.round(basis * (1 - pct / 100)));
          ad.vraagprijs = nieuw;
          stap = _restPatch("advertenties?id=eq." + encodeURIComponent(ad.id), { vraagprijs: nieuw });
          // Live/gereserveerde advertenties meteen bijwerken op Shopify + Marktplaats
          if (ad.status === "live" || ad.status === "gereserveerd") {
            stap = stap.then(function () { return roepFunctie("plaats-advertentie", { advertentie_id: ad.id, actie: "plaatsen" }); });
          }
        } else {
          stap = roepFunctie("plaats-advertentie", { advertentie_id: ad.id, actie: actie });
        }
        return stap.then(function () { klaar++; }, function (e) { fouten++; console.warn("Bulk-actie mislukt voor", ad.id, e); });
      });
    });
    chain.then(function () {
      T("✅ " + klaar + " gelukt" + (fouten ? " · " + fouten + " mislukt" : ""), fouten ? "#c2410c" : "#15803d");
      ADV.centrum.sel = {};
      return laadAdvertenties();
    }).then(function () {
      // Voorraad-status kan zijn meegewijzigd bij offline/verkocht
      return (typeof laadVoorraad === "function") ? laadVoorraad().then(laadVerkocht, laadVerkocht) : laadVerkocht();
    }).then(function () { renderCentrum(); }, function () { renderCentrum(); });
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
      '<h1>Welk meubel?</h1><h2>Kies voorraad die nog niet online staat</h2>' +
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
  // Partijen (gesplitste inkopen met partij_rest > 0) — hieruit peel je losse stukken.
  function laadPartijen() {
    // status=beschikbaar: een in het dashboard verkochte/afgestorte partij (partij_rest
    // blijft >0) mag niet meer peelbaar zijn — anders maak je stukken uit weg-voorraad.
    return _restGet("items?partij_rest=not.is.null&status=eq.beschikbaar&order=aangemaakt_op.desc").then(function (rows) {
      ADV.partijen = (rows || []).filter(function (p) { return Number(p.partij_rest) > 0; });
      return ADV.partijen;
    }).catch(function (e) { console.warn("Partijen laden mislukt", e); ADV.partijen = []; return []; });
  }
  // Beschikbaar + verkocht samen (voor het openen van een item-formulier)
  function alleItems() { return (STATE.items || []).concat(ADV.verkochtItems || []); }

  function advStart() {
    injectAll();
    toonScherm("screen-adverteren");
    toonPaneel("lijst");
    E("adv-items").innerHTML = '<p style="color:var(--gr);padding:8px">Laden…</p>';
    var pre = (STATE.items && STATE.items.length) ? Promise.resolve() : (typeof laadVoorraad === "function" ? laadVoorraad() : Promise.resolve());
    pre.then(laadAdvertenties).then(laadVerkocht).then(laadPartijen).then(renderAdvLijst).catch(function (e) {
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
  function advPartijRowHtml(p) {
    var thumb = p.foto_url ? '<img class="adv-thumb" src="' + X(p.foto_url) + '">' : '<div class="adv-thumb">📦</div>';
    return '<div class="adv-item" style="border:1px solid #99f6e4;background:#f0fdfa" onclick="advPeelStart(\'' + X(p.id) + '\')">' + thumb +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:700;font-size:15px;color:var(--nav);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + X(p.naam || "?") + '</div>' +
      '<div style="font-size:12px;color:#115e59;margin-top:3px">✂️ Partij · nog ' + X(p.partij_rest) + ' ' + (p.partij_rest == 1 ? "stuk" : "stuks") + ' · rest inkoop ' + X(eur(p.prijs || 0)) + '</div>' +
      '</div><div style="color:#0f766e;font-size:22px">›</div></div>';
  }
  function renderAdvLijst() {
    var wrap = E("adv-items"); if (!wrap) return;
    var zk = (val("adv-zoek") || "").toLowerCase().trim();
    var partijen = (ADV.partijen || []).filter(function (i) { return advMatch(i, zk); });
    // Alleen beschikbare losse voorraad zonder advertentie (partijen zitten in hun eigen sectie).
    var besch = (STATE.items || []).filter(function (i) { return advMatch(i, zk) && !advVoorItem(i.id); });
    var html = "";
    if (partijen.length) {
      html += '<div style="font-size:12px;font-weight:700;color:var(--gr);text-transform:uppercase;letter-spacing:.3px;margin:2px 0 8px">Partijen — kies om een stuk te maken</div>';
      html += partijen.map(advPartijRowHtml).join("");
      html += '<div style="font-size:12px;font-weight:700;color:var(--gr);text-transform:uppercase;letter-spacing:.3px;margin:16px 0 8px">Losse voorraad</div>';
    }
    if (besch.length) {
      html += besch.map(function (it) { return advRowHtml(it, false); }).join("");
    } else if (!partijen.length) {
      html += '<div class="empty" style="text-align:center;color:var(--gr);padding:24px">' +
        (zk ? 'Geen items zonder advertentie voor "' + X(zk) + '"' : "Alle losse voorraad is al geadverteerd — beheer je advertenties in het Advertentiecentrum.") + '</div>';
    }
    wrap.innerHTML = html;
  }
  // Een stuk uit een partij peelen: formulier (naam + categorie + inkoopdeel), daarna
  // opslaan als voorraad OF meteen doorgaan naar het adverteerformulier.
  function advPeelStart(itemId) {
    injectAll();
    var p = (ADV.partijen || []).find(function (x) { return x.id === itemId; });
    if (!p) { T("Partij niet gevonden", "#dc2626"); return; }
    var deel = Math.round((Number(p.prijs) || 0) / Math.max(1, Number(p.partij_rest) || 1) * 100) / 100;
    ADV.peel = { partij: p, deel: deel };
    var catOpts = ['<option value="">— categorie —</option>'].concat(PEEL_CATS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; })).join("");
    E("adv-panel-form").innerHTML =
      '<div style="background:#f0fdfa;border:1px solid #99f6e4;color:#115e59;padding:12px;border-radius:10px;font-size:13px;margin-bottom:14px">Nieuw stuk uit <strong>' + X(p.naam || "partij") + '</strong> (nog ' + X(p.partij_rest) + '). Geef het een naam; het inkoopdeel is automatisch berekend en aanpasbaar.</div>' +
      '<div class="adv-card">' +
      '<div class="fld"><label class="al">Naam van dit stuk</label><input id="peel-naam" class="ai" placeholder="bijv. Eettafel eiken"></div>' +
      '<div class="fld"><label class="al">Categorie</label><select id="peel-cat" class="as">' + catOpts + '</select></div>' +
      '<div class="fld"><label class="al">Inkoopdeel (€)</label><input id="peel-deel" class="ai" type="number" inputmode="decimal" min="0" step="0.01" value="' + deel + '"></div>' +
      '</div>' +
      '<div id="peel-status" style="margin:10px 0"></div>' +
      '<button class="btn btn-or" style="width:100%;margin-bottom:8px" onclick="advPeelDoen(true)">➕ Stuk + advertentie maken</button>' +
      '<button class="btn btn-gy" style="width:100%" onclick="advPeelDoen(false)">📦 Alleen als voorraad opslaan</button>' +
      '<button style="width:100%;margin-top:10px;background:none;border:none;color:var(--gr);cursor:pointer;padding:8px" onclick="advPeelAnnuleer()">Annuleren</button>';
    toonPaneel("form");
  }
  function advPeelAnnuleer() { ADV.peel = null; toonPaneel("lijst"); renderAdvLijst(); }
  function advPeelDoen(maakAd) {
    if (!ADV.peel || ADV.peelBezig) return; // dubbele tik → tweede aanroep negeren
    var p = ADV.peel.partij;
    var naam = (val("peel-naam") || "").trim();
    var cat = val("peel-cat");
    var deel = parseFloat(val("peel-deel")) || 0;
    var st = E("peel-status");
    if (!naam) { if (st) st.innerHTML = '<div class="alert alert-err">Geef het stuk een naam.</div>'; return; }
    // Inkoopdeel valideren: 0 ≤ deel ≤ resterende partijprijs, anders klopt de
    // som van de inkoopdelen niet meer (negatief deel verhoogt de partijprijs).
    var maxDeel = Math.round((Number(p.prijs) || 0) * 100) / 100;
    if (deel < 0 || deel > maxDeel) { if (st) st.innerHTML = '<div class="alert alert-err">Inkoopdeel moet tussen € 0 en € ' + maxDeel + ' liggen (resterende partij).</div>'; return; }
    ADV.peelBezig = true;
    document.querySelectorAll("#adv-panel-form button").forEach(function (b) { b.disabled = true; });
    var restNa = (Number(p.partij_rest) || 0) - 1;
    var prijsNa = Math.max(0, Math.round(((Number(p.prijs) || 0) - deel) * 100) / 100);
    var newId = _genId();
    var kind = {
      id: newId, user_id: (STATE.user && STATE.user.id), org_id: STATE.org_id,
      naam: naam, categorie: cat, stof: p.stof || "", locatie: p.locatie || "",
      prijs: deel, verwacht_vp: 0, datum: p.datum || null,
      notitie: "Uit partij: " + (p.naam || "") + (p.artikelnummer ? (" (" + p.artikelnummer + ")") : ""),
      status: "beschikbaar", stortkosten: 0, inkoopbon_nr: p.inkoopbon_nr || null,
      foto_url: null, bewerkt: [], aangemaakt_op: new Date().toISOString(), partij_rest: null,
      partij_parent_id: p.id // markeer als gepeeld stuk → telt niet als nieuwe inkoop
    };
    if (st) st.innerHTML = '<div style="color:var(--gr);font-size:13px">⏳ Stuk aanmaken…</div>';
    _restPost("items", kind).then(function () {
      var patch = restNa <= 0 ? { partij_rest: 0, prijs: 0, status: "gesplitst" } : { partij_rest: restNa, prijs: prijsNa };
      return _restPatch("items?id=eq." + encodeURIComponent(p.id), patch).catch(function (e) {
        // Compensatie: partij niet verlaagd → het zojuist aangemaakte stuk weer
        // verwijderen, anders geeft een retry een duplicaat én dubbel inkoopdeel
        return fetch(SUPABASE_URL + "/rest/v1/items?id=eq." + encodeURIComponent(newId), {
          method: "DELETE",
          headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + tok() }
        }).catch(function () {}).then(function () { throw e; });
      });
    }).then(function () {
      ADV.partijen = (ADV.partijen || []).map(function (x) { return x.id === p.id ? Object.assign({}, x, { partij_rest: restNa, prijs: prijsNa }) : x; }).filter(function (x) { return Number(x.partij_rest) > 0; });
      ADV.peel = null;
      // Stuk meteen in de voorraadlijst tonen (beide takken), anders lijkt het mislukt
      // en maakt de gebruiker het nogmaals → duplicaat + dubbele partij-verlaging.
      if (STATE.items) STATE.items.unshift(kind); else STATE.items = [kind];
      if (maakAd) {
        T("✓ Stuk aangemaakt", "#15803d");
        advOpenItem(newId);
      } else {
        T("✓ Stuk als voorraad opgeslagen", "#15803d");
        toonPaneel("lijst");
        renderAdvLijst();
      }
    }).catch(function (e) {
      if (st) st.innerHTML = '<div class="alert alert-err">⚠️ Mislukt: ' + X(e.message || e) + '</div>';
    }).then(function () {
      ADV.peelBezig = false;
      document.querySelectorAll("#adv-panel-form button").forEach(function (b) { b.disabled = false; });
    });
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
    ADV.slim = []; // hulpfoto('s) reset per item (max 2)
    // Bestaande advertentie: gebruik de opgeslagen foto's. Nieuwe advertentie: begin met
    // de vaste standaard-laatste-foto er alvast in.
    if (Array.isArray(a.fotos)) {
      ADV.fotos = a.fotos.slice();
    } else {
      var _sf = standaardFoto();
      ADV.fotos = _sf ? [_sf] : [];
    }

    var profiel = a.maat_profiel || profielVoorRubriek(a.rubriek || "") || "accessoire";
    var bez = a.bezorging || {};
    var isLive = a.status && a.status !== "concept" && a.status !== "gegenereerd";
    // Knop-labels contextafhankelijk: een bestaande live advertentie WORDT BIJGEWERKT
    // (productSet met het opgeslagen id), niet gedupliceerd — dus "Wijzig" i.p.v. "Plaats".
    var _online = a.status === "live" || a.status === "gereserveerd";
    var _plaatsLabel = _online ? "✏️ Wijzig advertentie" : (isLive ? "↩︎ Weer online zetten" : "🚀 Plaats op Shopify + Marktplaats");
    var _saveLabel = isLive ? "💾 Opslaan (nog niet doorvoeren)" : "💾 Alleen opslaan (concept)";
    var _plaatsHint = _online ? '<div style="font-size:12px;color:var(--gr);margin-top:8px;text-align:center">Werkt je bestáánde advertentie bij op Shopify + Marktplaats — maakt géén dubbele.</div>' : "";

    E("adv-panel-form").innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
      (it.foto_url ? '<img src="' + X(it.foto_url) + '" style="width:48px;height:48px;border-radius:10px;object-fit:cover">' : '<div style="width:48px;height:48px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>') +
      '<div style="min-width:0"><h1 style="margin:0;font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + X(it.naam || "") + '</h1>' +
      '<div style="font-size:12px;color:var(--gr)">' + X(it.artikelnummer || "") + '</div></div></div>' +

      // Slimme (hulp)foto bovenin: leest rubriek/maten/materiaal/kleur uit een foto met
      // de maten erop. Geen advertentiefoto — komt niet in de advertentie/Marktplaats.
      '<div class="adv-card" style="border:1.5px dashed #a5b4fc;background:#f5f3ff">' +
      '<label class="al" style="color:#4338ca">🪄 Slimme foto <span style="font-weight:400;color:var(--gr)">— hulpfoto met de maten erop; vult rubriek, maten, materiaal en kleur vanzelf in</span></label>' +
      '<div id="adv-slim"></div>' +
      '<div id="adv-slim-status" style="margin-top:8px;font-size:13px;color:var(--gr)"></div>' +
      '</div>' +

      '<div class="adv-card">' +
      '<div class="fld"><label class="al">Marktplaats-rubriek</label>' + rubriekSelectHtml(a.rubriek || "") + '</div>' +
      '<div class="fld"><label class="al">Foto\'s <span style="font-weight:400;color:var(--gr)">(eerste = hoofdfoto)</span></label><div class="adv-fotos" id="adv-fotos"></div></div>' +
      '<div class="fld"><label class="al">Afmetingen</label><div class="grid2" id="adv-maten">' + matenHtml(profiel, a.maten) + '</div></div>' +
      '</div>' +

      '<div class="adv-card">' +
      '<div class="grid2">' +
      '<div class="fld"><label class="al">Merk</label><input id="adv-merk" class="ai" value="' + X(a.merk || "") + '"></div>' +
      '<div class="fld"><label class="al">Materiaal</label><input id="adv-materiaal" class="ai" value="' + X(a.materiaal || "") + '"></div>' +
      '<div class="fld"><label class="al">Kleur</label><input id="adv-kleur" class="ai" value="' + X(a.kleur || "") + '"></div>' +
      '<div class="fld"><label class="al">Vraagprijs (€)</label><input id="adv-prijs" class="ai" type="number" inputmode="decimal" min="0" step="0.01" value="' + X(a.vraagprijs != null ? a.vraagprijs : (it.verwacht_vp || it.vvp || "")) + '"></div>' +
      '<div class="fld"><label class="al">Bezorgen mogelijk?</label><select id="adv-bezorgen" class="as"><option value="ja"' + (bez.bezorgen !== false ? " selected" : "") + ">Ja</option><option value=\"nee\"" + (bez.bezorgen === false ? " selected" : "") + ">Nee</option></select></div>" +
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
      '<button class="abtn abtn-gy abtn-sm" style="margin-bottom:10px" onclick="advOpslaan(false)">' + _saveLabel + '</button>' +
      '<button class="abtn abtn-gn" onclick="advPlaats(\'plaatsen\')">' + _plaatsLabel + '</button>' +
      _plaatsHint +
      '<div id="adv-status" style="margin-top:12px;font-size:13px;color:var(--gr)"></div>' +
      '</div>';

    renderFotos();
    renderSlim();
    if (a.laatste_fout) E("adv-status").innerHTML = '<span style="color:#dc2626">Laatste fout: ' + X(a.laatste_fout) + '</span>';
    if (!isLive) { /* concept: laat alle knoppen staan, geen extra melding */ }
    toonScherm("screen-adverteren"); // ook vanuit het advertentiecentrum naar het formulier
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
  // Vaste "laatste foto" die standaard in elke nieuwe advertentie staat. Ligt op een
  // eigen pad (los van losse advertenties) zodat hij nooit meeverdwijnt. De vlag
  // standaard:true houdt hem herkenbaar zodat nieuwe uploads er vóór geschoven worden.
  function standaardFoto() {
    if (!STATE.org_id) return null;
    var pad = STATE.org_id + "/_standaard/laatste-foto.jpg";
    return { url: SUPABASE_URL + "/storage/v1/object/public/item-fotos/" + pad, pad: pad, standaard: true };
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
      // Nog aan het uploaden → tegel met spinnertje (zodat je meteen ziet dat 'ie bezig is)
      if (f.loading) {
        return '<div class="adv-foto laden"><div class="spin"></div>' +
          '<button class="x" onclick="advFotoWis(' + i + ')">✕</button></div>';
      }
      // Upload mislukt → tegel met waarschuwing + opnieuw-proberen
      if (f.error) {
        return '<div class="adv-foto fout">' +
          '<span style="font-size:20px">⚠️</span>' +
          '<button onclick="advFotoRetry(\'' + X(f.tmpId) + '\')" style="background:none;border:none;color:#dc2626;font-size:11px;font-weight:700;cursor:pointer;padding:0">opnieuw</button>' +
          '<button class="x" onclick="advFotoWis(' + i + ')">✕</button></div>';
      }
      return '<div class="adv-foto' + (i === coverIdx ? " eerste" : "") + '"><img src="' + X(f.url) + '">' +
        '<button class="x" onclick="advFotoWis(' + i + ')">✕</button>' +
        (f.standaard ? '<div style="position:absolute;bottom:2px;right:2px;background:#334155;color:#fff;font-size:10px;font-weight:700;border-radius:5px;padding:1px 5px">vast</div>' : '') +
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
      var files = Array.prototype.slice.call(inp.files || [])
        .filter(function (f) { return f.type && f.type.indexOf("image/") === 0; })
        .slice(0, 12);
      if (!files.length) return;
      var itemId = ADV.huidig.itemId;
      // Direct een laad-tegel per gekozen foto tonen -> je ziet meteen hoeveel foto's er
      // komen én dat ze bezig zijn. Elke tegel wordt vervangen zodra zijn foto klaar is.
      var phs = files.map(function (file) {
        var ph = { loading: true, tmpId: _genId(), file: file };
        _voegFotoToe(ph);
        return ph;
      });
      renderFotos();
      // Parallel uploaden, max 3 tegelijk (snel, maar niet te zwaar voor de telefoon).
      _advUploadPool(phs, itemId, 3);
    };
    inp.click();
  }
  // Uploadt de placeholders met een concurrency-limiet; werkt elke tegel los bij.
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
  // Comprimeert + uploadt één foto naar zijn placeholder. Faalt nooit hard (voor de pool):
  // bij fout krijgt de tegel een 'opnieuw'-knop.
  function _advUpload(ph, itemId) {
    ph.loading = true; ph.error = false; renderFotos();
    return _compressInkFoto(ph.file).then(function (blob) {
      var pad = STATE.org_id + "/adv/" + itemId + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
      return fetch(SUPABASE_URL + "/storage/v1/object/item-fotos/" + pad, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + tok(), "Content-Type": "image/jpeg" },
        body: blob
      }).then(function (r) {
        if (!r.ok && r.status !== 200) return r.text().then(function (t) { throw new Error(t || ("upload " + r.status)); });
        if (ADV.fotos.indexOf(ph) < 0) return; // tegel is tussentijds verwijderd
        ph.url = SUPABASE_URL + "/storage/v1/object/public/item-fotos/" + pad;
        ph.pad = pad; ph.loading = false; ph.error = false; delete ph.file;
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
      return '<div style="position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;border:1px solid var(--bd)">' +
        '<img src="' + X(s.dataUrl) + '" style="width:100%;height:100%;object-fit:cover">' +
        '<button onclick="advSlimWis(' + i + ')" style="position:absolute;top:2px;right:2px;background:#dc2626;color:#fff;border:none;border-radius:6px;width:22px;height:22px;font-size:13px;line-height:1;cursor:pointer">✕</button>' +
        '</div>';
    }).join("");
    if (arr.length < 2) {
      tiles += '<div onclick="advSlimKies()" style="width:84px;height:84px;border:2px dashed #a5b4fc;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:26px;color:#6d28d9;cursor:pointer;background:#eef2ff">📐</div>';
    }
    wrap.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px">' + tiles + '</div>' +
      '<div style="font-size:11px;color:var(--gr);margin-top:6px">Max 2 hulpfoto\'s (bv. één met de maten, één die het meubel goed toont).</div>';
  }
  function advSlimKies() {
    if ((ADV.slim || []).length >= 2) return;
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (!file || (file.type || "").indexOf("image/") !== 0) return;
      _compressInkFoto(file).then(function (blob) {
        var fr = new FileReader();
        fr.onload = function () {
          var dataUrl = String(fr.result || "");
          if (!Array.isArray(ADV.slim)) ADV.slim = [];
          ADV.slim.push({ dataUrl: dataUrl, b64: dataUrl.split(",")[1] || "" });
          renderSlim();
          advSlimAnalyseer();
        };
        fr.readAsDataURL(blob);
      }).catch(function (e) { T("Kon foto niet lezen: " + (e.message || e), "#dc2626"); });
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
    if (st) { st.style.color = "var(--gr)"; st.textContent = "✨ AI leest de foto('s) uit…"; }
    var rubr = _rubriekLijstPlat();
    Promise.all(arr.map(function (s) {
      return fetch(SUPABASE_URL + "/functions/v1/analyseer-foto", {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + tok(), "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: s.b64, media_type: "image/jpeg", rubrieken: rubr })
      }).then(function (r) { return r.json().catch(function () { return {}; }); });
    })).then(function (results) {
      // Samenvoegen over 1-2 foto's: eerste niet-lege waarde wint; maten verzamelen we.
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
          T("✨ Velden ingevuld vanaf de foto('s)");
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
      staat: "",
      merk: (val("adv-merk") || "").trim(),
      materiaal: (val("adv-materiaal") || "").trim(),
      kleur: (val("adv-kleur") || "").trim(),
      vraagprijs: parseFloat(val("adv-prijs")) || 0,
      // prijstype/budget worden via Woosify bepaald, niet vanuit deze app. Velden zijn uit
      // het formulier gehaald; we schrijven vaste defaults zodat bestaande DB-kolommen blijven werken.
      prijstype: "bieden",
      budget: 10,
      bezorging: { bezorgen: val("adv-bezorgen") !== "nee", kosten: 0 },
      notitie: (val("adv-notitie") || "").trim(),
      niet_vermelden: (val("adv-niet") || "").trim(),
      // Alleen echte, klaargeladen foto's opslaan (laad-/fouttegels hebben geen url).
      // Vaste kaart altijd als laatste wegschrijven, zodat de eerste echte foto de
      // hoofdfoto (cover) op Marktplaats wordt — ongeacht de weergavevolgorde.
      fotos: ADV.fotos.filter(function (f) { return f.url; }).sort(function (a, b) { return (a.standaard ? 1 : 0) - (b.standaard ? 1 : 0); }),
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
    if ((ADV.fotos || []).some(function (f) { return f.loading; })) { T("⏳ Wacht tot de foto's klaar zijn met uploaden", "#c2410c"); return; }
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

  var _advActieBezig = false;
  function advPlaats(actie) {
    if (_advActieBezig) return; // dubbelklik → geen tweede parallelle keten (status-race, dubbel Shopify-product)
    if ((ADV.fotos || []).some(function (f) { return f.loading; })) { T("⏳ Wacht tot de foto's klaar zijn met uploaden", "#c2410c"); return; }
    var labels = { plaatsen: "plaatsen op Shopify + Marktplaats", reserveren: "op gereserveerd zetten", terug_online: "terug online zetten", verkocht: "als verkocht markeren", verwijderen: "offline halen" };
    if ((actie === "verkocht" || actie === "verwijderen") && !confirm("Weet je zeker dat je dit meubel wilt " + labels[actie] + "?")) return;
    _advActieBezig = true;
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
    }).then(function () { _advActieBezig = false; });
  }

  /* ---- globals voor inline handlers ---- */
  window.advMenu = advMenu;
  window.advCentrum = advCentrum;
  window.advCentrumZoek = advCentrumZoek;
  window.advCentrumFilter = advCentrumFilter;
  window.advCentrumSel = advCentrumSel;
  window.advCentrumSelWis = advCentrumSelWis;
  window.advCentrumSelAlle = advCentrumSelAlle;
  window.advCentrumBulk = advCentrumBulk;
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
  window.advFotoRetry = advFotoRetry;
  window.advSlimKies = advSlimKies;
  window.advSlimWis = advSlimWis;
  window.advPeelStart = advPeelStart;
  window.advPeelDoen = advPeelDoen;
  window.advPeelAnnuleer = advPeelAnnuleer;

  /* ---- init: knop + scherm injecteren zodra de app-DOM er is ---- */
  function boot() { try { injectAll(); } catch (e) { console.warn("Adverteren init:", e); } }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 200); });
  } else {
    setTimeout(boot, 200);
  }
})();
