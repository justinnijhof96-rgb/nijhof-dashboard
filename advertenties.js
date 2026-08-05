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
    // Bestaande advertentie: opgeslagen foto's. Nieuwe advertentie: begin met de vaste foto.
    if (Array.isArray(a.fotos)) {
      ADV.fotos = a.fotos.slice();
    } else {
      var _sf = standaardFoto();
      ADV.fotos = _sf ? [_sf] : [];
    }

    var profiel = a.maat_profiel || profielVoorRubriek(a.rubriek || "") || "accessoire";
    var bez = a.bezorging || {};

    E("adv-titel").textContent = "Advertentie · " + (it.naam || "");
    E("adv-body").innerHTML =
      '<div class="adv-form">' +
      '<div class="full"><label>Marktplaats-rubriek</label>' + rubriekSelectHtml(a.rubriek || "") + "</div>" +
      '<div class="full"><label>Foto\'s (eerste = hoofdfoto, sleep-volgorde via pijltjes)</label><div class="adv-fotos" id="adv-fotos"></div></div>' +
      '<div class="full"><label>Afmetingen</label><div class="adv-form" id="adv-maten" style="margin:0">' + matenHtml(profiel, a.maten) + "</div></div>" +
      '<div><label>Staat</label><select id="adv-staat">' + STATEN.map(function (s) { return '<option' + (s === a.staat ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select></div>" +
      '<div><label>Merk</label><input id="adv-merk" value="' + esc(a.merk || "") + '"></div>' +
      '<div><label>Materiaal</label><input id="adv-materiaal" value="' + esc(a.materiaal || "") + '"></div>' +
      '<div><label>Kleur</label><input id="adv-kleur" value="' + esc(a.kleur || "") + '"></div>' +
      '<div><label>Vraagprijs (€)</label><input id="adv-prijs" type="number" min="0" step="0.01" value="' + esc(a.vraagprijs != null ? a.vraagprijs : (it.verwacht_vp || "")) + '"></div>' +
      '<div><label>Bezorgen mogelijk?</label><select id="adv-bezorgen"><option value="ja"' + (bez.bezorgen !== false ? " selected" : "") + ">Ja</option><option value=\"nee\"" + (bez.bezorgen === false ? " selected" : "") + ">Nee</option></select></div>" +
      '<div><label>Bezorgkosten (€, 0 = gratis/n.v.t.)</label><input id="adv-bezorgkosten" type="number" min="0" step="1" value="' + esc(bez.kosten != null ? bez.kosten : "") + '"></div>' +
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
      '<button class="btn btn-gn" onclick="advPlaats(\'plaatsen\')">🚀 Plaats op Shopify + Marktplaats</button>' +
      '<button class="btn btn-gy" onclick="advPlaats(\'reserveren\')">🔖 Zet op gereserveerd</button>' +
      '<button class="btn btn-gy" onclick="advPlaats(\'terug_online\')">↩︎ Terug online</button>' +
      '<button class="btn btn-gy" onclick="advPlaats(\'verkocht\')">✅ Markeer verkocht</button>' +
      '<button class="btn btn-rd" onclick="advPlaats(\'verwijderen\')">⛔ Haal van Marktplaats</button>' +
      "</div>" +
      '<div id="adv-status" style="margin-top:10px;font-size:12px;color:var(--gr,#6b7280)"></div>';

    renderFotos();
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
    var html = ADV.fotos.map(function (f, i) {
      return '<div class="adv-foto' + (i === 0 ? " eerste" : "") + '"><img src="' + esc(f.url) + '">' +
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
      var files = Array.prototype.slice.call(inp.files || []);
      if (!files.length) return;
      var itemId = ADV.huidig.itemId;
      toastX("📤 Foto's uploaden…", "#2563eb");
      var chain = Promise.resolve();
      files.slice(0, 12).forEach(function (file, idx) {
        chain = chain.then(function () { return uploadEenFoto(file, itemId, idx); });
      });
      chain.then(function () { renderFotos(); toastX("📷 Foto's toegevoegd"); })
        .catch(function (e) { toastX("Upload mislukt: " + (e.message || e), "#dc2626"); });
    };
    inp.click();
  }
  function uploadEenFoto(file, itemId, idx) {
    if (!file.type || file.type.indexOf("image/") !== 0) return Promise.resolve();
    var org = _getOrgId();
    return compressFoto(file).then(function (blob) {
      var pad = org + "/adv/" + itemId + "-" + Date.now() + "-" + idx + ".jpg";
      return _sb.storage.from(FOTO_BUCKET).upload(pad, blob, { contentType: "image/jpeg", upsert: false })
        .then(function (res) {
          if (res.error) throw res.error;
          var pub = _sb.storage.from(FOTO_BUCKET).getPublicUrl(pad);
          _voegFotoToe({ url: pub.data.publicUrl, pad: pad }); // blijft vóór de vaste laatste foto
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
      staat: val("adv-staat"),
      merk: val("adv-merk").trim(),
      materiaal: val("adv-materiaal").trim(),
      kleur: val("adv-kleur").trim(),
      vraagprijs: parseFloat(val("adv-prijs")) || 0,
      // prijstype/budget worden via Woosify bepaald, niet vanuit deze app. Velden zijn uit
      // het formulier gehaald; we schrijven vaste defaults zodat bestaande DB-kolommen blijven werken.
      prijstype: "bieden",
      budget: 10,
      bezorging: { bezorgen: val("adv-bezorgen") !== "nee", kosten: parseFloat(val("adv-bezorgkosten")) || 0 },
      notitie: val("adv-notitie").trim(),
      niet_vermelden: val("adv-niet").trim(),
      fotos: ADV.fotos,
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

  // init na load (na het hoofdscript)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { injectCss(); injectDom(); }, 300); });
  } else {
    setTimeout(function () { injectCss(); injectDom(); }, 300);
  }
})();
