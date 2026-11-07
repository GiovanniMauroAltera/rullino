// =====================================================================
// Rullino: la pagina dell'organizzatore
// Crea la festa, mostra il QR code, tiene d'occhio gli scatti,
// decide quando sviluppare e può cancellare le foto venute male.
// =====================================================================

const COLORE_LED_ORGANIZZATORE = "#ff8a1f";

let organizzatore = null;    // { festa, codice } ricordato da questo dispositivo
let dati = null;             // l'ultimo pannello arrivato dal database
let differenzaOrologio = 0;
let timerPannello = null;
let timerConto = null;
let fotoMostrate = false;


// ---------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------

async function avvia() {
  collegaPulsanti();
  preparaModuloCrea();

  if (!configurazionePronta()) {
    mostraSchermata("crea");
    mostraErrore("errore-crea", "Manca la configurazione di Supabase nel file impostazioni.js: senza, la festa non si può creare.");
    return;
  }

  organizzatore = leggiMemoria("rullino_organizzatore");

  // si arriva dalla pagina degli invitati con il codice della festa (?f=...)
  const parametri = new URLSearchParams(location.search);
  let festaRichiesta = parametri.get("f");
  if (festaRichiesta) {
    festaRichiesta = festaRichiesta.trim().toLowerCase();
  }

  if (organizzatore && (!festaRichiesta || festaRichiesta === organizzatore.festa)) {
    // questo dispositivo conosce già la festa: si apre subito il pannello
    await apriPannello();
  } else if (festaRichiesta) {
    // altrimenti si chiede solo il codice segreto, con il codice della festa già scritto
    prendi("apri-festa").value = festaRichiesta;
    mostraSchermata("apri");
    prendi("apri-codice").focus();
  } else {
    mostraSchermata("crea");
  }
}

function mostraErrore(id, testo) {
  const riquadro = prendi(id);
  riquadro.textContent = testo;
  riquadro.hidden = false;
}

function valoreScelto(nomeGruppo) {
  const scelte = document.querySelectorAll('input[name="' + nomeGruppo + '"]');
  for (let i = 0; i < scelte.length; i++) {
    if (scelte[i].checked) {
      return scelte[i].value;
    }
  }
  return null;
}

function indirizzoPerInvitati(idFesta) {
  const indirizzo = new URL("./", location.href);
  return indirizzo.href + "?f=" + idFesta;
}


// ---------------------------------------------------------------------
// Creare la festa
// ---------------------------------------------------------------------

function preparaModuloCrea() {
  const domani = new Date();
  domani.setDate(domani.getDate() + 1);
  const giorno = GIORNI[domani.getDay()];
  prendi("etichetta-domani10").textContent = "Domani (" + giorno + ") alle 10:00";
  prendi("etichetta-domani13").textContent = "Domani alle 13:00";

  // il campo "Scelgo io" parte da domani alle 12
  domani.setHours(12, 0, 0, 0);
  prendi("crea-data").value = perCampoDataOra(domani);

  scriviSuCanvasDisplay(prendi("anteprima-data"), testoData(new Date()), 18, COLORE_LED_ORGANIZZATORE);
}

function quandoCambiaSviluppo() {
  prendi("crea-data").hidden = valoreScelto("sviluppo") !== "scelgo";
}

// Con "Subito" l'orario non serve, ma il database ne vuole uno: si mette
// domani alle 10, così se poi si passa allo sviluppo a orario è già pronto
function orarioSviluppoScelto() {
  const scelta = valoreScelto("sviluppo");
  if (scelta === "scelgo") {
    const valore = prendi("crea-data").value;
    if (!valore) {
      return null;
    }
    return new Date(valore);
  }
  const data = new Date();
  data.setDate(data.getDate() + 1);
  if (scelta === "domani13") {
    data.setHours(13, 0, 0, 0);
  } else {
    data.setHours(10, 0, 0, 0);
  }
  return data;
}

async function creaFesta(evento) {
  evento.preventDefault();
  prendi("errore-crea").hidden = true;

  const nome = prendi("crea-nome").value.trim();
  const codice = prendi("crea-codice").value.trim();
  const scatti = Number(valoreScelto("scatti"));
  const sviluppo = orarioSviluppoScelto();

  if (nome === "") {
    mostraErrore("errore-crea", "Scrivi il nome della festa.");
    return;
  }
  if (sviluppo === null) {
    mostraErrore("errore-crea", "Scegli il giorno e l'ora dello sviluppo.");
    return;
  }
  if (sviluppo.getTime() <= Date.now()) {
    mostraErrore("errore-crea", "L'orario dello sviluppo è già passato: scegline uno più avanti.");
    return;
  }
  if (codice.length < 4) {
    mostraErrore("errore-crea", "Il codice segreto deve avere almeno 4 caratteri.");
    return;
  }

  const pulsante = prendi("pulsante-crea");
  pulsante.disabled = true;
  pulsante.textContent = "Creo la festa…";
  try {
    const risposta = await chiamaDatabase("crea_festa", {
      p_nome: nome,
      p_scatti: scatti,
      p_rivela_alle: sviluppo.toISOString(),
      p_galleria_per_tutti: valoreScelto("galleria") === "tutti",
      p_data_sulle_foto: prendi("crea-data-foto").checked,
      p_codice: codice,
      p_foto_subito: valoreScelto("sviluppo") === "subito"
    });
    organizzatore = { festa: risposta.festa, codice: codice };
    scriviMemoria("rullino_organizzatore", organizzatore);
    prendi("modulo-crea").reset();
    preparaModuloCrea();
    quandoCambiaSviluppo();
    await apriPannello();
    mostraAvviso("Festa creata! Ora mostra il QR code agli invitati.");
  } catch (errore) {
    mostraErrore("errore-crea", errore.message);
  }
  pulsante.disabled = false;
  pulsante.textContent = "Crea la festa";
}


// ---------------------------------------------------------------------
// Riaprire una festa con i suoi codici
// ---------------------------------------------------------------------

async function apriFestaEsistente(evento) {
  evento.preventDefault();
  prendi("errore-apri").hidden = true;

  // si accetta anche il link intero incollato
  let festa = prendi("apri-festa").value.trim();
  const posizione = festa.indexOf("?f=");
  if (posizione !== -1) {
    festa = festa.substring(posizione + 3);
  }
  festa = festa.toLowerCase();
  const codice = prendi("apri-codice").value.trim();

  const pulsante = prendi("pulsante-apri");
  pulsante.disabled = true;
  try {
    await chiamaDatabase("pannello_organizzatore", { p_festa: festa, p_codice: codice });
    organizzatore = { festa: festa, codice: codice };
    scriviMemoria("rullino_organizzatore", organizzatore);
    await apriPannello();
  } catch (errore) {
    mostraErrore("errore-apri", errore.message);
  }
  pulsante.disabled = false;
}


// ---------------------------------------------------------------------
// Il pannello
// ---------------------------------------------------------------------

async function apriPannello() {
  mostraSchermata("caricamento");
  fotoMostrate = false;
  prendi("griglia-organizzatore").innerHTML = "";
  prendi("mostra-foto").textContent = "Mostra le foto";

  const riuscito = await aggiornaPannello();
  if (!riuscito) {
    return;
  }
  mostraSchermata("pannello");

  const link = indirizzoPerInvitati(dati.festa);
  prendi("link-festa").textContent = link;
  prendi("apri-come-invitato").href = link;
  disegnaQr(prendi("qr"), link);
  prendi("condividi-link").hidden = !navigator.share;

  prendi("nuova-data").value = perCampoDataOra(new Date(dati.rivela_alle));
  prendi("nuovi-scatti").value = dati.scatti_per_ospite;

  clearInterval(timerPannello);
  timerPannello = setInterval(aggiornaPannello, 30000);
  clearInterval(timerConto);
  timerConto = setInterval(aggiornaConto, 1000);
}

// Chiede i dati aggiornati al database e li mette nella pagina
async function aggiornaPannello() {
  try {
    dati = await chiamaDatabase("pannello_organizzatore", {
      p_festa: organizzatore.festa,
      p_codice: organizzatore.codice
    });
  } catch (errore) {
    if (errore.senzaRete && !prendi("pannello").hidden) {
      return false; // si riproverà al prossimo giro
    }
    // codici non più validi: si torna al modulo per aprire la festa
    clearInterval(timerPannello);
    clearInterval(timerConto);
    mostraSchermata("apri");
    prendi("apri-festa").value = organizzatore.festa;
    mostraErrore("errore-apri", errore.message);
    return false;
  }
  differenzaOrologio = new Date(dati.adesso).getTime() - Date.now();
  document.title = dati.nome + " – Organizza – Rullino";

  prendi("pannello-nome").textContent = dati.nome;
  const quando = quandoInParole(dati.rivela_alle);
  if (dati.foto_subito) {
    prendi("pannello-stato").textContent = "Rullino aperto, " + dati.scatti_per_ospite + " scatti a testa. Le foto si vedono subito, appena scattate.";
    segnaScelta("modo-pannello", "subito");
  } else if (dati.rivelata) {
    prendi("pannello-stato").textContent = "Le foto sono sviluppate: gli invitati le vedono riaprendo il link o il QR code.";
    prendi("sviluppo-testo").textContent = "Sviluppate " + quando + ".";
    prendi("sviluppa-adesso").hidden = true;
    segnaScelta("modo-pannello", "orario");
  } else {
    prendi("pannello-stato").textContent = "Rullino aperto, " + dati.scatti_per_ospite + " scatti a testa. Le foto si sviluppano " + quando + ".";
    prendi("sviluppo-testo").textContent = "Mancano allo sviluppo (" + quando + "):";
    prendi("sviluppa-adesso").hidden = false;
    segnaScelta("modo-pannello", "orario");
  }
  // il conto alla rovescia e l'orario servono solo senza "foto subito"
  prendi("parte-orario").hidden = dati.foto_subito;
  prendi("testo-subito").hidden = !dati.foto_subito;
  if (dati.galleria_per_tutti) {
    segnaScelta("galleria-pannello", "tutti");
  } else {
    segnaScelta("galleria-pannello", "solo-io");
  }

  // i numeri
  prendi("numero-ospiti").textContent = dati.ospiti.length;
  prendi("numero-foto").textContent = dati.numero_foto;
  prendi("numero-spazio").textContent = (dati.spazio_usato / 1000000).toFixed(1).replace(".", ",");

  // chi c'è, quanti scatti ha fatto, e i pulsanti per regalargliene altri
  const elenco = prendi("elenco-ospiti");
  elenco.innerHTML = "";
  for (let i = 0; i < dati.ospiti.length; i++) {
    const ospite = dati.ospiti[i];
    const riga = document.createElement("li");

    const nome = document.createElement("span");
    nome.className = "nome";
    nome.textContent = ospite.nome;
    riga.appendChild(nome);

    const conto = document.createElement("span");
    conto.className = "conto";
    let testoConto = ospite.scatti + " di " + (dati.scatti_per_ospite + ospite.extra);
    if (ospite.extra > 0) {
      testoConto = testoConto + " (+" + ospite.extra + ")";
    }
    conto.textContent = testoConto;
    riga.appendChild(conto);

    const pulsanti = document.createElement("span");
    pulsanti.className = "regala";
    aggiungiPulsanteScatti(pulsanti, ospite, -1, "−1", ospite.extra <= 0);
    aggiungiPulsanteScatti(pulsanti, ospite, 1, "+1", false);
    aggiungiPulsanteScatti(pulsanti, ospite, 5, "+5", false);
    riga.appendChild(pulsanti);

    elenco.appendChild(riga);
  }
  prendi("nessun-ospite").hidden = dati.ospiti.length > 0;
  prendi("aiuto-scatti").hidden = dati.ospiti.length === 0;

  aggiornaConto();
  return true;
}

// Un pulsantino "+1", "+5" o "−1" accanto al nome di un invitato
function aggiungiPulsanteScatti(contenitore, ospite, quanti, etichetta, disattivato) {
  const pulsante = document.createElement("button");
  pulsante.type = "button";
  pulsante.className = "pulsante-scatti";
  pulsante.textContent = etichetta;
  pulsante.disabled = disattivato;
  if (quanti === 1) {
    pulsante.setAttribute("aria-label", "Regala uno scatto a " + ospite.nome);
  } else if (quanti > 1) {
    pulsante.setAttribute("aria-label", "Regala " + quanti + " scatti a " + ospite.nome);
  } else {
    pulsante.setAttribute("aria-label", "Togli uno scatto regalato a " + ospite.nome);
  }
  pulsante.addEventListener("click", function () {
    regalaScatti(ospite, quanti, pulsante);
  });
  contenitore.appendChild(pulsante);
}

async function regalaScatti(ospite, quanti, pulsante) {
  pulsante.disabled = true;
  try {
    await chiamaDatabase("regala_scatti", {
      p_festa: organizzatore.festa,
      p_codice: organizzatore.codice,
      p_ospite: ospite.id,
      p_quanti: quanti
    });
    if (quanti === 1) {
      mostraAvviso(ospite.nome + " ha uno scatto in più");
    } else if (quanti > 1) {
      mostraAvviso(ospite.nome + " ha " + quanti + " scatti in più");
    } else {
      mostraAvviso("Tolto uno scatto regalato a " + ospite.nome);
    }
    await aggiornaPannello();
  } catch (errore) {
    mostraAvviso(errore.message);
    pulsante.disabled = false;
  }
}

function segnaScelta(nomeGruppo, valore) {
  const scelte = document.querySelectorAll('input[name="' + nomeGruppo + '"]');
  for (let i = 0; i < scelte.length; i++) {
    scelte[i].checked = scelte[i].value === valore;
  }
}

function aggiornaConto() {
  // con "foto subito" non c'è nessun conto alla rovescia
  if (!dati || dati.foto_subito) {
    return;
  }
  const mancano = new Date(dati.rivela_alle).getTime() - (Date.now() + differenzaOrologio);
  scriviSuCanvasDisplay(prendi("display-sviluppo"), tempoSulDisplay(mancano), 40, COLORE_LED_ORGANIZZATORE);
  // allo scadere si aggiorna subito il pannello
  if (mancano <= 0 && !dati.rivelata) {
    dati.rivelata = true;
    aggiornaPannello();
  }
}

function disegnaQr(contenitore, testo) {
  const qr = qrcode(0, "M");
  qr.addData(testo);
  qr.make();
  contenitore.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, title: "QR code della festa" });
}


// ---------------------------------------------------------------------
// Le modifiche durante la festa
// ---------------------------------------------------------------------

async function modifica(parametri, messaggioRiuscito) {
  prendi("errore-modifiche").hidden = true;
  parametri.p_festa = organizzatore.festa;
  parametri.p_codice = organizzatore.codice;
  try {
    await chiamaDatabase("modifica_festa", parametri);
    await aggiornaPannello();
    mostraAvviso(messaggioRiuscito);
    return true;
  } catch (errore) {
    mostraErrore("errore-modifiche", errore.message);
    return false;
  }
}

async function sviluppaAdesso() {
  const confermato = confermaConDoppioTocco(prendi("sviluppa-adesso"), "Tocca ancora: si sviluppa per tutti",
    "Il rullino si chiude per tutti e gli invitati vedranno subito le foto.");
  if (!confermato) {
    return;
  }
  const fatto = await modifica({ p_rivela_adesso: true }, "Foto sviluppate!");
  if (fatto) {
    prendi("nuova-data").value = perCampoDataOra(new Date(dati.rivela_alle));
  }
}

async function salvaData() {
  const valore = prendi("nuova-data").value;
  if (!valore) {
    mostraErrore("errore-modifiche", "Scegli il giorno e l'ora.");
    return;
  }
  const data = new Date(valore);
  if (data.getTime() <= Date.now()) {
    const confermato = confermaConDoppioTocco(prendi("salva-data"), "Tocca ancora: si sviluppa subito",
      "Quell'orario è già passato: le foto si sviluppano subito.");
    if (!confermato) {
      return;
    }
  }
  await modifica({ p_rivela_alle: data.toISOString() }, "Orario dello sviluppo cambiato");
}

async function salvaScatti() {
  const scatti = Number(prendi("nuovi-scatti").value);
  if (!scatti || scatti < 1 || scatti > 100) {
    mostraErrore("errore-modifiche", "Gli scatti a testa devono essere tra 1 e 100.");
    return;
  }
  await modifica({ p_scatti: scatti }, "Ora sono " + scatti + " scatti a testa");
}

async function cambiaChiVede() {
  const perTutti = valoreScelto("galleria-pannello") === "tutti";
  let messaggio = "Dopo lo sviluppo le foto le vedi solo tu";
  if (perTutti) {
    messaggio = "Dopo lo sviluppo le foto le vedono tutti";
  }
  await modifica({ p_galleria_per_tutti: perTutti }, messaggio);
}

// "Subito, appena scattate" oppure "All'orario dello sviluppo"
async function cambiaModo() {
  const subito = valoreScelto("modo-pannello") === "subito";
  if (subito) {
    await modifica({ p_foto_subito: true }, "Ora ogni foto si vede subito, appena scattata");
    return;
  }
  // Tornando allo sviluppo a orario: se l'orario salvato è già passato il
  // rullino si chiuderebbe subito, quindi si sposta a domani alle 10
  const parametri = { p_foto_subito: false };
  let messaggio = "Le foto ora si vedono allo sviluppo, " + quandoInParole(dati.rivela_alle);
  if (new Date(dati.rivela_alle).getTime() <= Date.now() + differenzaOrologio) {
    const domani = new Date();
    domani.setDate(domani.getDate() + 1);
    domani.setHours(10, 0, 0, 0);
    parametri.p_rivela_alle = domani.toISOString();
    messaggio = "Le foto ora si vedono allo sviluppo, domani alle 10:00 (puoi cambiarlo qui sotto)";
  }
  const fatto = await modifica(parametri, messaggio);
  if (fatto) {
    prendi("nuova-data").value = perCampoDataOra(new Date(dati.rivela_alle));
  }
}


// ---------------------------------------------------------------------
// Le foto (per controllarle e cancellare quelle venute male)
// ---------------------------------------------------------------------

async function mostraFoto() {
  const pulsante = prendi("mostra-foto");
  const griglia = prendi("griglia-organizzatore");

  if (fotoMostrate) {
    griglia.innerHTML = "";
    fotoMostrate = false;
    pulsante.textContent = "Mostra le foto";
    return;
  }

  pulsante.disabled = true;
  pulsante.textContent = "Carico le foto…";
  let elenco;
  try {
    elenco = await chiamaDatabase("elenco_foto", { p_festa: organizzatore.festa, p_codice: organizzatore.codice });
  } catch (errore) {
    mostraAvviso(errore.message);
    pulsante.disabled = false;
    pulsante.textContent = "Mostra le foto";
    return;
  }

  griglia.innerHTML = "";
  if (elenco.length === 0) {
    const vuoto = document.createElement("p");
    vuoto.className = "testo-tenue";
    vuoto.textContent = "Ancora nessuna foto.";
    griglia.appendChild(vuoto);
  }

  // prima i riquadri, poi le miniature a gruppi di 30
  const immagini = {};
  for (let i = elenco.length - 1; i >= 0; i--) {
    immagini[elenco[i].id] = creaRiquadroFoto(griglia, elenco[i]);
  }
  fotoMostrate = true;
  pulsante.disabled = false;
  pulsante.textContent = "Nascondi le foto";

  for (let inizio = 0; inizio < elenco.length; inizio = inizio + 30) {
    const ids = [];
    for (let i = inizio; i < inizio + 30 && i < elenco.length; i++) {
      ids.push(elenco[i].id);
    }
    try {
      const risposta = await chiamaDatabase("miniature", { p_festa: organizzatore.festa, p_ids: ids, p_codice: organizzatore.codice });
      for (let j = 0; j < risposta.length; j++) {
        if (immagini[risposta[j].id]) {
          immagini[risposta[j].id].src = indirizzoImmagine(risposta[j].miniatura);
        }
      }
    } catch (errore) {
      mostraAvviso(errore.message);
    }
    if (!fotoMostrate) {
      return; // nel frattempo le ha nascoste
    }
  }
}

// Un riquadro con la miniatura, chi l'ha scattata e il pulsante per cancellarla
function creaRiquadroFoto(griglia, foto) {
  const riquadro = document.createElement("div");
  riquadro.className = "miniatura-organizzatore";

  const immagine = document.createElement("img");
  immagine.alt = "Foto di " + foto.nome;
  riquadro.appendChild(immagine);

  const didascalia = document.createElement("small");
  didascalia.textContent = foto.nome + ", " + orario(new Date(foto.scattata_il));
  riquadro.appendChild(didascalia);

  const elimina = document.createElement("button");
  elimina.type = "button";
  elimina.className = "elimina";
  elimina.textContent = "✕";
  elimina.setAttribute("aria-label", "Cancella la foto di " + foto.nome);
  elimina.addEventListener("click", function () {
    eliminaFoto(foto, riquadro, elimina);
  });
  riquadro.appendChild(elimina);

  griglia.appendChild(riquadro);
  return immagine;
}

async function eliminaFoto(foto, riquadro, pulsante) {
  const confermato = confermaConDoppioTocco(pulsante, "Elimina?",
    "Tocca ancora per cancellare la foto di " + foto.nome + ". Non si può annullare.");
  if (!confermato) {
    return;
  }
  try {
    await chiamaDatabase("elimina_foto", { p_festa: organizzatore.festa, p_codice: organizzatore.codice, p_id: foto.id });
    riquadro.remove();
    mostraAvviso("Foto cancellata");
    aggiornaPannello();
  } catch (errore) {
    mostraAvviso(errore.message);
  }
}

async function scaricaZip() {
  const pulsante = prendi("scarica-zip");
  pulsante.disabled = true;
  try {
    const elenco = await chiamaDatabase("elenco_foto", { p_festa: organizzatore.festa, p_codice: organizzatore.codice });
    if (elenco.length === 0) {
      mostraAvviso("Non c'è ancora nessuna foto da scaricare");
    } else {
      await scaricaTutteZip(organizzatore.festa, dati.nome, elenco, organizzatore.codice, function (testo) {
        pulsante.textContent = testo;
      });
    }
  } catch (errore) {
    mostraAvviso(errore.message);
  }
  pulsante.disabled = false;
  pulsante.textContent = "Scarica tutte (zip)";
}


// ---------------------------------------------------------------------
// Link, cartello e stampa
// ---------------------------------------------------------------------

async function copiaLink() {
  const link = indirizzoPerInvitati(dati.festa);
  try {
    await navigator.clipboard.writeText(link);
    mostraAvviso("Link copiato");
  } catch (errore) {
    // se il browser non lascia copiare, si seleziona il testo
    const intervallo = document.createRange();
    intervallo.selectNodeContents(prendi("link-festa"));
    const selezione = window.getSelection();
    selezione.removeAllRanges();
    selezione.addRange(intervallo);
    mostraAvviso("Link selezionato: copialo con Ctrl+C");
  }
}

async function condividiLink() {
  try {
    await navigator.share({
      title: dati.nome,
      text: "Entra nel rullino della festa: hai " + dati.scatti_per_ospite + " scatti!",
      url: indirizzoPerInvitati(dati.festa)
    });
  } catch (errore) {
    // ha chiuso il menu
  }
}

function preparaCartello() {
  prendi("cartello-nome").textContent = dati.nome;
  disegnaQr(prendi("cartello-qr"), indirizzoPerInvitati(dati.festa));
  let regole = "Hai " + dati.scatti_per_ospite + " scatti a testa, senza app da scaricare. ";
  if (dati.foto_subito) {
    regole = regole + "Ogni foto compare subito nella galleria di tutti.";
  } else {
    regole = regole + "Le foto si sviluppano " + quandoInParole(dati.rivela_alle) + ".";
  }
  prendi("cartello-regole").textContent = regole;
  prendi("cartello").hidden = false;
}

function mostraCartello() {
  preparaCartello();
  prendi("chiudi-cartello").focus();
  // a schermo intero, se il browser lo permette (per un PC o una TV alla festa)
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {
      // va bene anche senza schermo intero
    });
  }
}

function chiudiCartello() {
  prendi("cartello").hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen();
  }
}

function stampaCartello() {
  preparaCartello();
  window.print();
}

function dopoLaStampa() {
  if (!document.fullscreenElement) {
    prendi("cartello").hidden = true;
  }
}


// ---------------------------------------------------------------------
// Cambiare festa
// ---------------------------------------------------------------------

function vaiACrea(evento) {
  evento.preventDefault();
  clearInterval(timerPannello);
  clearInterval(timerConto);
  prendi("errore-crea").hidden = true;
  mostraSchermata("crea");
}

function vaiAdApri(evento) {
  evento.preventDefault();
  prendi("errore-apri").hidden = true;
  mostraSchermata("apri");
}

function dimenticaFesta(evento) {
  evento.preventDefault();
  const confermato = confermaConDoppioTocco(evento.currentTarget, "tocca ancora per toglierla",
    "La festa e le foto restano: potrai riaprirla con il codice della festa (" + organizzatore.festa +
    ") e il tuo codice segreto.");
  if (!confermato) {
    return;
  }
  cancellaMemoria("rullino_organizzatore");
  organizzatore = null;
  vaiACrea(evento);
}


// ---------------------------------------------------------------------
// Collegamenti
// ---------------------------------------------------------------------

function collegaPulsanti() {
  prendi("modulo-crea").addEventListener("submit", creaFesta);
  prendi("modulo-apri").addEventListener("submit", apriFestaEsistente);
  const scelteSviluppo = document.querySelectorAll('input[name="sviluppo"]');
  for (let i = 0; i < scelteSviluppo.length; i++) {
    scelteSviluppo[i].addEventListener("change", quandoCambiaSviluppo);
  }
  const scelteGalleria = document.querySelectorAll('input[name="galleria-pannello"]');
  for (let i = 0; i < scelteGalleria.length; i++) {
    scelteGalleria[i].addEventListener("change", cambiaChiVede);
  }
  const scelteModo = document.querySelectorAll('input[name="modo-pannello"]');
  for (let i = 0; i < scelteModo.length; i++) {
    scelteModo[i].addEventListener("change", cambiaModo);
  }
  prendi("vai-apri").addEventListener("click", vaiAdApri);
  prendi("vai-crea").addEventListener("click", vaiACrea);
  prendi("altra-festa").addEventListener("click", vaiACrea);
  prendi("dimentica-festa").addEventListener("click", dimenticaFesta);
  prendi("copia-link").addEventListener("click", copiaLink);
  prendi("condividi-link").addEventListener("click", condividiLink);
  prendi("mostra-cartello").addEventListener("click", mostraCartello);
  prendi("chiudi-cartello").addEventListener("click", chiudiCartello);
  prendi("stampa-cartello").addEventListener("click", stampaCartello);
  prendi("sviluppa-adesso").addEventListener("click", sviluppaAdesso);
  prendi("salva-data").addEventListener("click", salvaData);
  prendi("salva-scatti").addEventListener("click", salvaScatti);
  prendi("mostra-foto").addEventListener("click", mostraFoto);
  prendi("scarica-zip").addEventListener("click", scaricaZip);
  window.addEventListener("afterprint", dopoLaStampa);
  document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape" && !prendi("cartello").hidden) {
      chiudiCartello();
    }
  });
}

avvia();
