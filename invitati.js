// =====================================================================
// Rullino: la pagina degli invitati
// Si entra con il nome, si scatta finché ci sono scatti, si aspetta lo
// sviluppo e poi si vedono le foto di tutti.
// =====================================================================

const SCATTI_LATO_LUNGO = 1600;     // grandezza massima delle foto (in pixel)
const MINIATURA_LATO_LUNGO = 420;   // grandezza delle foto piccole della galleria
const COLORE_LED = "#ff8a1f";

let idFesta = "";
let festa = null;              // le informazioni della festa, dal database
let ospite = null;             // { chiave, nome }, ricordato dal telefono
let scattiRimasti = 0;         // quanti scatti restano secondo il database
let coda = [];                 // foto scattate ma non ancora arrivate al database
let invioInCorso = false;
let problemaDiRete = false;
let differenzaOrologio = 0;    // di quanto l'orologio del server è avanti rispetto al telefono

// la fotocamera
let flusso = null;
let lato = "environment";      // "environment" = dietro, "user" = davanti (selfie)
let staScattando = false;
let contestoAudio = null;
let filtroFoto = "originale";  // il filtro scelto (vedi filtri.js)

// i timer
let timerConto = null;
let timerControllo = null;
let timerGalleria = null;      // con "foto subito" la galleria si aggiorna da sola

// la galleria
let elencoFoto = [];
let filtroAttivo = null;       // null = tutte le foto, altrimenti il nome di una persona
let fotoVisibili = [];
let posizioneVisore = 0;
const elementiStampa = {};     // id della foto -> il suo riquadro nella griglia
const miniatureCaricate = {};  // id della foto -> miniatura (base64)
const fotoIntere = {};         // id della foto -> foto grande (base64), solo le ultime
let ordineFotoIntere = [];


// ---------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------

async function avvia() {
  collegaPulsanti();
  preparaSceltaFiltri();

  const parametri = new URLSearchParams(location.search);
  let codice = parametri.get("f");
  if (!codice) {
    codice = parametri.get("festa");
  }
  if (!codice) {
    mostraProblema("Inquadra il QR code",
      "Per entrare in una festa inquadra il suo QR code con la fotocamera del telefono, oppure apri il link che ti hanno mandato.",
      false, true);
    return;
  }
  idFesta = codice.trim().toLowerCase();
  await caricaFesta();
}

async function caricaFesta() {
  mostraSchermata("caricamento");
  try {
    festa = await chiamaDatabase("info_festa", { p_festa: idFesta });
  } catch (errore) {
    if (errore.senzaRete) {
      mostraProblema("Niente connessione", errore.message, true, false);
    } else {
      mostraProblema("Festa non trovata", errore.message, true, false);
    }
    return;
  }
  idFesta = festa.festa;
  differenzaOrologio = new Date(festa.adesso).getTime() - Date.now();
  document.title = festa.nome + " – Rullino";
  preparaLinkOrganizzatore();

  // rullino chiuso: le foto sono sviluppate e non si scatta più
  if (rullinoChiuso()) {
    apriGalleria();
    return;
  }

  const codaSalvata = leggiMemoria("rullino_coda_" + idFesta);
  if (codaSalvata) {
    coda = codaSalvata;
  }
  ospite = leggiMemoria("rullino_ospite_" + idFesta);

  if (ospite) {
    try {
      const stato = await chiamaDatabase("stato_ospite", { p_festa: idFesta, p_chiave: ospite.chiave });
      scattiRimasti = stato.scatti_rimasti;
    } catch (errore) {
      if (errore.senzaRete) {
        mostraProblema("Niente connessione", errore.message, true, false);
        return;
      }
      // il telefono ricordava un invitato che non c'è più: si rientra col nome
      ospite = null;
      cancellaMemoria("rullino_ospite_" + idFesta);
    }
  }

  avviaControlli();

  if (!ospite) {
    mostraBenvenuto();
    return;
  }
  if (coda.length > 0) {
    inviaCoda();
  }
  if (scattiDisponibili() > 0) {
    apriFotocamera();
  } else {
    mostraAttesa();
  }
}

// I collegamenti "Apri il pannello" portano alla pagina dell'organizzatore
// con il codice di questa festa già scritto (serve comunque il codice segreto)
function preparaLinkOrganizzatore() {
  const collegamenti = document.querySelectorAll(".link-organizzatore a");
  for (let i = 0; i < collegamenti.length; i++) {
    collegamenti[i].href = "organizza.html?f=" + idFesta;
  }
}

function mostraProblema(titolo, testo, conRiprova, conOrganizza) {
  prendi("problema-titolo").textContent = titolo;
  prendi("problema-testo").textContent = testo;
  prendi("problema-riprova").hidden = !conRiprova;
  prendi("problema-organizza").hidden = !conOrganizza;
  mostraSchermata("problema");
}

// Il rullino è chiuso quando le foto si sviluppano a un orario e quell'orario
// è passato. Con "foto subito" invece resta aperto finché ci sono scatti.
function rullinoChiuso() {
  return festa.rivelata && !festa.foto_subito;
}

// Gli scatti che si possono ancora fare, contando anche le foto in viaggio
function scattiDisponibili() {
  let disponibili = scattiRimasti - coda.length;
  if (disponibili < 0) {
    disponibili = 0;
  }
  return disponibili;
}


// ---------------------------------------------------------------------
// Benvenuto: l'invitato scrive il suo nome
// ---------------------------------------------------------------------

function mostraBenvenuto() {
  clearInterval(timerGalleria);
  prendi("benvenuto-nome-festa").textContent = festa.nome;
  const regole = "Hai " + festa.scatti_per_ospite + " scatti. ";
  if (festa.foto_subito) {
    prendi("benvenuto-regole").textContent = regole + "Ogni foto compare subito nella galleria di tutti, appena scattata.";
    prendi("benvenuto-nota").textContent = "Niente anteprima e niente seconde possibilità: ogni scatto è definitivo.";
  } else {
    prendi("benvenuto-regole").textContent = regole + "Le foto si sviluppano " + quandoInParole(festa.rivela_alle) + ", tutte insieme.";
    prendi("benvenuto-nota").textContent = "Niente anteprima e niente seconde possibilità: ogni scatto è definitivo. Le foto restano nascoste a tutti fino allo sviluppo.";
  }
  // con "foto subito" si può dare un'occhiata alla galleria anche prima di entrare
  prendi("benvenuto-galleria").hidden = !(festa.foto_subito && festa.galleria_per_tutti);
  mostraSchermata("benvenuto");
}

async function entra(evento) {
  evento.preventDefault();
  const campo = prendi("campo-nome");
  const nome = campo.value.trim();
  const errore = prendi("errore-nome");
  errore.hidden = true;
  if (nome === "") {
    campo.focus();
    return;
  }

  const pulsante = prendi("pulsante-entra");
  pulsante.disabled = true;
  pulsante.textContent = "Un attimo…";
  try {
    const risposta = await chiamaDatabase("entra_nella_festa", { p_festa: idFesta, p_nome: nome });
    ospite = { chiave: risposta.chiave, nome: risposta.nome };
    scriviMemoria("rullino_ospite_" + idFesta, ospite);
    scattiRimasti = festa.scatti_per_ospite;
    apriFotocamera();
  } catch (problema) {
    errore.textContent = problema.message;
    errore.hidden = false;
  }
  pulsante.disabled = false;
  pulsante.textContent = "Prendi la macchinetta";
}


// ---------------------------------------------------------------------
// La macchinetta
// ---------------------------------------------------------------------

function apriFotocamera() {
  clearInterval(timerGalleria);
  prendi("fotocamera-nome-festa").textContent = festa.nome;
  // con "foto subito" dalla macchinetta si può andare alla galleria
  prendi("vai-galleria").hidden = !(festa.foto_subito && festa.galleria_per_tutti);
  mostraSchermata("fotocamera");
  aggiornaContatore();
  aggiornaIndicatoreInvio();
  accendiFotocamera();
}

async function accendiFotocamera() {
  spegniFotocamera();
  prendi("piano-b").hidden = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostraPianoB("Questo browser non lascia usare la fotocamera dentro la pagina.");
    return;
  }

  try {
    flusso = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: lato },
        width: { ideal: 1600 },
        height: { ideal: 1200 }
      }
    });
  } catch (errore) {
    if (errore.name === "NotAllowedError") {
      mostraPianoB("Il permesso per la fotocamera è stato negato. Puoi darlo dalle impostazioni del browser e ricaricare la pagina, oppure usare la fotocamera del telefono.");
    } else {
      mostraPianoB("Non riesco ad accendere la fotocamera dentro la pagina.");
    }
    return;
  }

  // se nel frattempo si è cambiata schermata, la fotocamera non serve più
  if (prendi("fotocamera").hidden) {
    spegniFotocamera();
    return;
  }

  const video = prendi("video");
  video.srcObject = flusso;
  if (lato === "user") {
    video.classList.add("specchio");
  } else {
    video.classList.remove("specchio");
  }
  try {
    await video.play();
  } catch (errore) {
    // alcuni browser partono da soli grazie ad "autoplay"
  }
  adattaVelo();
  controllaQuanteFotocamere();
}

function spegniFotocamera() {
  if (flusso) {
    const tracce = flusso.getTracks();
    for (let i = 0; i < tracce.length; i++) {
      tracce[i].stop();
    }
    flusso = null;
  }
  const video = prendi("video");
  if (video) {
    video.srcObject = null;
  }
}

// Nasconde il pulsante "gira" se il telefono ha una sola fotocamera
async function controllaQuanteFotocamere() {
  try {
    const dispositivi = await navigator.mediaDevices.enumerateDevices();
    let quante = 0;
    for (let i = 0; i < dispositivi.length; i++) {
      if (dispositivi[i].kind === "videoinput") {
        quante = quante + 1;
      }
    }
    prendi("gira-lato").hidden = quante < 2;
  } catch (errore) {
    // lasciamo il pulsante com'è
  }
}

// ---------- La scelta del filtro ----------

// Crea i pulsanti dei filtri e ricorda quello scelto l'ultima volta
function preparaSceltaFiltri() {
  const salvato = leggiMemoria("rullino_filtro");
  for (let i = 0; i < FILTRI.length; i++) {
    if (FILTRI[i].id === salvato) {
      filtroFoto = salvato;
    }
  }

  const contenitore = prendi("scelta-filtro");
  contenitore.innerHTML = "";
  for (let i = 0; i < FILTRI.length; i++) {
    const pulsante = document.createElement("button");
    pulsante.type = "button";
    pulsante.textContent = FILTRI[i].nome;
    pulsante.dataset.filtro = FILTRI[i].id;
    pulsante.addEventListener("click", premiFiltro);
    contenitore.appendChild(pulsante);
  }
  mostraFiltroScelto();
}

function premiFiltro(evento) {
  filtroFoto = evento.currentTarget.dataset.filtro;
  scriviMemoria("rullino_filtro", filtroFoto);
  mostraFiltroScelto();
}

// Segna il pulsante scelto e mette l'anteprima del filtro nel mirino
function mostraFiltroScelto() {
  const pulsanti = prendi("scelta-filtro").querySelectorAll("button");
  for (let i = 0; i < pulsanti.length; i++) {
    pulsanti[i].setAttribute("aria-pressed", String(pulsanti[i].dataset.filtro === filtroFoto));
  }
  const video = prendi("video");
  const velo = prendi("velo");
  for (let i = 0; i < FILTRI.length; i++) {
    video.classList.remove("filtro-" + FILTRI[i].id);
    velo.classList.remove("filtro-" + FILTRI[i].id);
  }
  video.classList.add("filtro-" + filtroFoto);
  velo.classList.add("filtro-" + filtroFoto);
}

// Il velo (angoli scuri, grana) va messo esattamente sopra la parte del
// mirino dove si vede il video, non sulle bande nere ai lati
function adattaVelo() {
  const video = prendi("video");
  const velo = prendi("velo");
  const larghezzaVideo = video.videoWidth;
  const altezzaVideo = video.videoHeight;
  const larghezzaMirino = video.clientWidth;
  const altezzaMirino = video.clientHeight;
  if (!larghezzaVideo || !altezzaVideo || !larghezzaMirino || !altezzaMirino) {
    return;
  }
  const scala = Math.min(larghezzaMirino / larghezzaVideo, altezzaMirino / altezzaVideo);
  const larghezza = larghezzaVideo * scala;
  const altezza = altezzaVideo * scala;
  velo.style.left = (larghezzaMirino - larghezza) / 2 + "px";
  velo.style.top = (altezzaMirino - altezza) / 2 + "px";
  velo.style.width = larghezza + "px";
  velo.style.height = altezza + "px";
  velo.style.right = "auto";
  velo.style.bottom = "auto";
}

function giraFotocamera() {
  if (lato === "environment") {
    lato = "user";
  } else {
    lato = "environment";
  }
  accendiFotocamera();
}

// Quando la fotocamera nella pagina non va: si usa quella del telefono
function mostraPianoB(testo) {
  prendi("piano-b-testo").textContent = testo;
  prendi("piano-b").hidden = false;
}

function apriFotocameraTelefono() {
  if (scattiDisponibili() <= 0) {
    return;
  }
  prendi("file-piano-b").click();
}

function fotoDalTelefono() {
  const campo = prendi("file-piano-b");
  const file = campo.files[0];
  if (!file || scattiDisponibili() <= 0) {
    return;
  }
  const immagine = new Image();
  const indirizzo = URL.createObjectURL(file);
  immagine.onload = function () {
    lampo();
    fotografa(immagine, immagine.naturalWidth, immagine.naturalHeight, false);
    URL.revokeObjectURL(indirizzo);
    campo.value = "";
  };
  immagine.onerror = function () {
    mostraAvviso("Non riesco a leggere la foto, riprova");
    campo.value = "";
  };
  immagine.src = indirizzo;
}

function scatta() {
  if (staScattando || scattiDisponibili() <= 0) {
    return;
  }
  // se la fotocamera nella pagina non va, il pulsante di scatto apre quella del telefono
  if (!prendi("piano-b").hidden) {
    apriFotocameraTelefono();
    return;
  }
  const video = prendi("video");
  if (!flusso || video.videoWidth === 0) {
    mostraAvviso("La fotocamera non è ancora pronta");
    return;
  }
  staScattando = true;
  prendi("pulsante-scatto").disabled = true;
  lampo();
  suonoScatto();
  if (navigator.vibrate) {
    navigator.vibrate(30);
  }
  fotografa(video, video.videoWidth, video.videoHeight, lato === "user");
  // una piccola pausa, come quando si gira la rotella della pellicola
  setTimeout(function () {
    staScattando = false;
    aggiornaContatore();
  }, 700);
}

// Trasforma quello che inquadra la fotocamera in una foto e la mette in coda
function fotografa(sorgente, larghezza, altezza, specchio) {
  // 1. la foto grande
  let scala = SCATTI_LATO_LUNGO / Math.max(larghezza, altezza);
  if (scala > 1) {
    scala = 1;
  }
  const w = Math.round(larghezza * scala);
  const h = Math.round(altezza * scala);
  const tela = document.createElement("canvas");
  tela.width = w;
  tela.height = h;
  const ctx = tela.getContext("2d");
  if (specchio) {
    // il selfie si salva come lo si vedeva nel mirino
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(sorgente, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // L'inquadratura ora è "congelata" nel canvas. Il resto (filtro, data,
  // compressione) richiede un attimo: lo si fa subito dopo, così intanto
  // il telefono riesce a mostrare il lampo.
  const filtro = filtroFoto;
  const scattataIl = new Date(Date.now() + differenzaOrologio).toISOString();
  setTimeout(function () {
    sviluppaFoto(tela, filtro, scattataIl);
  }, 30);
}

// Applica filtro e data, comprime la foto e la mette in coda per l'invio
function sviluppaFoto(tela, filtro, scattataIl) {
  const ctx = tela.getContext("2d");
  const w = tela.width;
  const h = tela.height;
  applicaFiltro(ctx, w, h, filtro);
  if (festa.data_sulle_foto) {
    stampaData(ctx, w, h);
  }
  const immagine = tela.toDataURL("image/jpeg", 0.82).split(",")[1];

  // 2. la miniatura per la galleria
  let scalaPiccola = MINIATURA_LATO_LUNGO / Math.max(w, h);
  if (scalaPiccola > 1) {
    scalaPiccola = 1;
  }
  const piccola = document.createElement("canvas");
  piccola.width = Math.round(w * scalaPiccola);
  piccola.height = Math.round(h * scalaPiccola);
  piccola.getContext("2d").drawImage(tela, 0, 0, piccola.width, piccola.height);
  const miniatura = piccola.toDataURL("image/jpeg", 0.72).split(",")[1];

  // 3. in coda per l'invio
  const foto = {
    id: nuovoId(),
    immagine: immagine,
    miniatura: miniatura,
    scattata_il: scattataIl
  };
  coda.push(foto);
  salvaCoda();
  aggiornaContatore();
  aggiornaIndicatoreInvio();
  inviaCoda();

  if (scattiDisponibili() <= 0) {
    setTimeout(mostraAttesa, 900);
  }
}

// La data arancione in basso a destra, come le macchinette vere
function stampaData(ctx, w, h) {
  const latoCorto = Math.min(w, h);
  const altezza = Math.round(latoCorto * 0.055);
  const margine = Math.round(latoCorto * 0.05);
  const testo = testoData(new Date());
  const larghezza = larghezzaDisplay(testo, altezza);
  disegnaDisplay(ctx, testo, w - margine - larghezza, h - margine - altezza, altezza, COLORE_LED, null);
}

function lampo() {
  const elemento = prendi("lampo");
  elemento.classList.remove("acceso");
  void elemento.offsetWidth; // serve a far ripartire l'animazione
  elemento.classList.add("acceso");
}

// Il "clic" dell'otturatore: un soffio di rumore che si spegne subito
function suonoScatto() {
  try {
    if (!contestoAudio) {
      const Contesto = window.AudioContext || window.webkitAudioContext;
      contestoAudio = new Contesto();
    }
    const durata = 0.09;
    const campioni = Math.floor(contestoAudio.sampleRate * durata);
    const buffer = contestoAudio.createBuffer(1, campioni, contestoAudio.sampleRate);
    const dati = buffer.getChannelData(0);
    for (let i = 0; i < campioni; i++) {
      dati[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / campioni, 4);
    }
    const sorgente = contestoAudio.createBufferSource();
    sorgente.buffer = buffer;
    const volume = contestoAudio.createGain();
    volume.gain.value = 0.5;
    sorgente.connect(volume);
    volume.connect(contestoAudio.destination);
    sorgente.start();
  } catch (errore) {
    // niente suono: pazienza
  }
}

function aggiornaContatore() {
  const disponibili = scattiDisponibili();
  scriviSuCanvasDisplay(prendi("display-contatore"), dueCifre(disponibili), 30, COLORE_LED);
  if (disponibili === 1) {
    prendi("testo-contatore").textContent = "scatto";
  } else {
    prendi("testo-contatore").textContent = "scatti";
  }
  const pulsante = prendi("pulsante-scatto");
  pulsante.disabled = disponibili <= 0 || staScattando;
  pulsante.setAttribute("aria-label", "Scatta (restano " + disponibili + " scatti)");
}


// ---------------------------------------------------------------------
// Invio delle foto: una alla volta, e se manca la rete si riprova
// ---------------------------------------------------------------------

function salvaCoda() {
  // se la memoria del telefono è piena, le foto restano solo in questa pagina
  scriviMemoria("rullino_coda_" + idFesta, coda);
}

async function inviaCoda() {
  if (invioInCorso || !ospite) {
    return;
  }
  invioInCorso = true;
  let pausa = 2000;

  while (coda.length > 0) {
    aggiornaIndicatoreInvio();
    const foto = coda[0];
    try {
      const risposta = await chiamaDatabase("scatta_foto", {
        p_festa: idFesta,
        p_chiave: ospite.chiave,
        p_id: foto.id,
        p_immagine: foto.immagine,
        p_miniatura: foto.miniatura,
        p_scattata_il: foto.scattata_il
      });
      coda.shift();
      scattiRimasti = risposta.scatti_rimasti;
      salvaCoda();
      problemaDiRete = false;
      pausa = 2000;
    } catch (errore) {
      if (errore.senzaRete) {
        // la foto resta in coda: si riprova tra poco, aspettando sempre un po' di più
        problemaDiRete = true;
        aggiornaIndicatoreInvio();
        await aspetta(pausa);
        if (pausa < 15000) {
          pausa = pausa * 2;
        }
        continue;
      }
      // un problema che non si risolve riprovando (scatti finiti, rullino chiuso...)
      coda.shift();
      salvaCoda();
      problemaDiRete = false;
      mostraAvviso("Una foto non è stata salvata: " + errore.message);
      await aggiornaStatoOspite();
    }
    aggiornaContatore();
  }

  invioInCorso = false;
  aggiornaIndicatoreInvio();
  aggiornaContatore();
}

async function aggiornaStatoOspite() {
  try {
    const stato = await chiamaDatabase("stato_ospite", { p_festa: idFesta, p_chiave: ospite.chiave });
    scattiRimasti = stato.scatti_rimasti;
  } catch (errore) {
    // si riproverà al prossimo controllo
  }
}

function aggiornaIndicatoreInvio() {
  const pillola = prendi("indicatore-invio");
  const riga = prendi("attesa-invio");
  const quante = coda.length;

  if (quante === 0) {
    pillola.hidden = true;
    riga.hidden = true;
    return;
  }

  let parolaFoto = quante + " foto";
  pillola.hidden = false;
  if (problemaDiRete) {
    pillola.classList.add("allarme");
    if (quante === 1) {
      pillola.textContent = "Senza rete: 1 foto aspetta";
    } else {
      pillola.textContent = "Senza rete: " + parolaFoto + " aspettano";
    }
  } else {
    pillola.classList.remove("allarme");
    pillola.textContent = parolaFoto + " in viaggio";
  }

  riga.hidden = false;
  if (quante === 1) {
    riga.textContent = "Non chiudere ancora la pagina: una foto deve ancora partire.";
  } else {
    riga.textContent = "Non chiudere ancora la pagina: " + parolaFoto + " devono ancora partire.";
  }
}


// ---------------------------------------------------------------------
// Rullino finito: conto alla rovescia fino allo sviluppo
// ---------------------------------------------------------------------

function mostraAttesa() {
  // se il rullino è chiuso e c'è già la galleria, non si torna indietro
  if (!prendi("galleria").hidden && rullinoChiuso()) {
    return;
  }
  // con "foto subito" non c'è niente da aspettare: si va alle foto di tutti
  if (festa.foto_subito) {
    apriGalleria();
    mostraAvviso("Hai finito il rullino: ecco le foto di tutti");
    return;
  }
  spegniFotocamera();
  let nome = "";
  if (ospite) {
    nome = ", " + ospite.nome;
  }
  prendi("attesa-titolo").textContent = "Rullino finito" + nome;
  prendi("attesa-testo").textContent = "Le foto si sviluppano " + quandoInParole(festa.rivela_alle) +
    ", tutte insieme. Fino ad allora non le vede nessuno.";
  mostraSchermata("attesa");
  aggiornaIndicatoreInvio();
  avviaConto();
}

function avviaConto() {
  clearInterval(timerConto);
  aggiornaConto();
  timerConto = setInterval(aggiornaConto, 1000);
}

function aggiornaConto() {
  const mancano = new Date(festa.rivela_alle).getTime() - (Date.now() + differenzaOrologio);
  let altezza = Math.floor((window.innerWidth - 90) / 5.4);
  if (altezza > 64) {
    altezza = 64;
  }
  scriviSuCanvasDisplay(prendi("display-attesa"), tempoSulDisplay(mancano), altezza, COLORE_LED);
  if (mancano <= 0) {
    clearInterval(timerConto);
    controllaFesta();
  }
}

// Ogni tanto si richiede la festa al database: l'organizzatore potrebbe
// aver anticipato lo sviluppo o cambiato il numero di scatti
function avviaControlli() {
  clearInterval(timerControllo);
  timerControllo = setInterval(controllaFesta, 45000);
}

async function controllaFesta() {
  let nuova;
  try {
    nuova = await chiamaDatabase("info_festa", { p_festa: idFesta });
  } catch (errore) {
    return;
  }
  festa = nuova;
  differenzaOrologio = new Date(festa.adesso).getTime() - Date.now();
  const galleriaAperta = !prendi("galleria").hidden;

  if (rullinoChiuso()) {
    if (!galleriaAperta) {
      apriGalleria();
    } else {
      aggiornaPulsanteTorna();
    }
    return;
  }

  // l'organizzatore ha tolto "foto subito" mentre si guardava la galleria:
  // le foto tornano nascoste e si torna alla macchinetta
  if (galleriaAperta && !festa.foto_subito) {
    clearInterval(timerGalleria);
    if (!ospite) {
      mostraBenvenuto();
    } else if (scattiDisponibili() > 0) {
      apriFotocamera();
    } else {
      mostraAttesa();
    }
    return;
  }

  // Si ricontrollano gli scatti: l'organizzatore potrebbe averne regalati
  // altri a tutti o solo a questa persona
  if (ospite) {
    const primaDisponibili = scattiDisponibili();
    await aggiornaStatoOspite();
    aggiornaContatore();
    const regalati = scattiDisponibili() > primaDisponibili;
    if (!prendi("attesa").hidden && scattiDisponibili() > 0) {
      // aveva finito il rullino: si torna alla macchinetta
      apriFotocamera();
      mostraAvviso("Ti hanno regalato altri scatti: la macchinetta è di nuovo carica!");
      return;
    }
    if (!prendi("fotocamera").hidden && regalati) {
      mostraAvviso("Ti hanno regalato altri scatti!");
    }
    if (galleriaAperta && regalati) {
      mostraAvviso("Ti hanno regalato altri scatti: torna alla macchinetta!");
    }
  }
  if (!prendi("attesa").hidden) {
    mostraAttesa();
  }
  if (!prendi("benvenuto").hidden) {
    mostraBenvenuto();
  }
  if (!prendi("fotocamera").hidden) {
    prendi("vai-galleria").hidden = !(festa.foto_subito && festa.galleria_per_tutti);
  }
  if (galleriaAperta) {
    aggiornaPulsanteTorna();
  }
}


// ---------------------------------------------------------------------
// La galleria: dopo lo sviluppo, oppure subito con "foto subito"
// ---------------------------------------------------------------------

async function apriGalleria() {
  spegniFotocamera();
  clearInterval(timerConto);
  // a rullino chiuso non serve più ricontrollare la festa; con "foto subito"
  // invece sì (scatti regalati, cambi dell'organizzatore)
  if (rullinoChiuso()) {
    clearInterval(timerControllo);
  }
  prendi("galleria-nome-festa").textContent = festa.nome;
  mostraSchermata("galleria");
  aggiornaPulsanteTorna();
  await aggiornaGalleria(true);

  // con "foto subito" le foto nuove compaiono da sole ogni 20 secondi
  clearInterval(timerGalleria);
  if (festa.foto_subito) {
    timerGalleria = setInterval(aggiornaGalleriaSeVisibile, 20000);
  }
}

function aggiornaGalleriaSeVisibile() {
  // non si aggiorna mentre si guarda una foto a schermo intero
  if (!prendi("galleria").hidden && prendi("visore").hidden) {
    aggiornaGalleria(false);
  }
}

// Con "foto subito" e scatti ancora da fare, dalla galleria si torna alla macchinetta
function aggiornaPulsanteTorna() {
  const pulsante = prendi("torna-macchinetta");
  if (!festa.foto_subito || rullinoChiuso()) {
    pulsante.hidden = true;
    return;
  }
  if (!ospite) {
    pulsante.textContent = "Prendi la macchinetta";
    pulsante.hidden = false;
    return;
  }
  const disponibili = scattiDisponibili();
  if (disponibili <= 0) {
    pulsante.hidden = true;
    return;
  }
  if (disponibili === 1) {
    pulsante.textContent = "Torna alla macchinetta (1 scatto)";
  } else {
    pulsante.textContent = "Torna alla macchinetta (" + disponibili + " scatti)";
  }
  pulsante.hidden = false;
}

function tornaAllaMacchinetta() {
  clearInterval(timerGalleria);
  if (!ospite) {
    mostraBenvenuto();
    return;
  }
  apriFotocamera();
}

// Chiede l'elenco delle foto e ridisegna la galleria. Le miniature già
// arrivate restano in memoria, così si scaricano solo quelle nuove.
async function aggiornaGalleria(primaVolta) {
  const conteggio = prendi("galleria-conteggio");
  const vuota = prendi("galleria-vuota");

  if (!festa.galleria_per_tutti) {
    if (festa.foto_subito) {
      conteggio.textContent = "";
    } else {
      conteggio.textContent = "Le foto sono state sviluppate.";
    }
    vuota.textContent = "Chi ha organizzato la festa ha scelto di tenere le foto per sé: le vede solo chi l'ha organizzata.";
    vuota.hidden = false;
    return;
  }

  if (primaVolta) {
    vuota.hidden = true;
    if (festa.foto_subito) {
      conteggio.textContent = "Carico le foto…";
    } else {
      conteggio.textContent = "Sviluppo in corso…";
    }
  }
  let nuovoElenco;
  try {
    nuovoElenco = await chiamaDatabase("elenco_foto", { p_festa: idFesta });
  } catch (errore) {
    if (primaVolta) {
      conteggio.textContent = "";
      vuota.textContent = errore.message + ". Ricarica la pagina per riprovare.";
      vuota.hidden = false;
    }
    return;
  }
  // dal vivo le foto più nuove stanno in alto
  if (festa.foto_subito) {
    nuovoElenco.reverse();
  }
  elencoFoto = nuovoElenco;

  if (elencoFoto.length === 0) {
    conteggio.textContent = "";
    if (festa.foto_subito) {
      vuota.textContent = "Ancora nessuna foto: la prima che qualcuno scatta compare qui.";
    } else {
      vuota.textContent = "In questo rullino non c'è nessuna foto.";
    }
    vuota.hidden = false;
    prendi("filtri").hidden = true;
    prendi("griglia").innerHTML = "";
    prendi("scarica-tutte").hidden = true;
    return;
  }
  vuota.hidden = true;

  // quante foto ha scattato ogni persona
  const perPersona = {};
  const nomi = [];
  for (let i = 0; i < elencoFoto.length; i++) {
    const nome = elencoFoto[i].nome;
    if (perPersona[nome] === undefined) {
      perPersona[nome] = 0;
      nomi.push(nome);
    }
    perPersona[nome] = perPersona[nome] + 1;
  }
  nomi.sort(confrontaNomi);

  let testo = elencoFoto.length + " foto";
  if (nomi.length === 1) {
    testo = testo + " di " + nomi[0];
  } else {
    testo = testo + " di " + nomi.length + " persone";
  }
  conteggio.textContent = testo;

  // se la persona scelta non ha più foto (cancellate), si torna a "Tutti"
  if (filtroAttivo !== null && perPersona[filtroAttivo] === undefined) {
    filtroAttivo = null;
  }
  creaFiltri(nomi, perPersona);
  creaGriglia();
  scegliFiltro(filtroAttivo);
  prendi("scarica-tutte").hidden = false;
  caricaMiniature();
}

function confrontaNomi(primo, secondo) {
  return primo.localeCompare(secondo, "it", { sensitivity: "base" });
}

function creaFiltri(nomi, perPersona) {
  const contenitore = prendi("filtri");
  contenitore.innerHTML = "";
  if (nomi.length < 2) {
    contenitore.hidden = true;
    return;
  }
  contenitore.hidden = false;
  aggiungiFiltro(contenitore, "Tutti", null);
  for (let i = 0; i < nomi.length; i++) {
    aggiungiFiltro(contenitore, nomi[i] + " " + perPersona[nomi[i]], nomi[i]);
  }
  segnaFiltri();
}

function aggiungiFiltro(contenitore, etichetta, nome) {
  const pulsante = document.createElement("button");
  pulsante.type = "button";
  pulsante.className = "filtro";
  pulsante.textContent = etichetta;
  if (nome === null) {
    pulsante.dataset.nome = "";
  } else {
    pulsante.dataset.nome = nome;
  }
  pulsante.addEventListener("click", function () {
    scegliFiltro(nome);
  });
  contenitore.appendChild(pulsante);
}

function scegliFiltro(nome) {
  filtroAttivo = nome;
  segnaFiltri();
  for (let i = 0; i < elencoFoto.length; i++) {
    const elemento = elementiStampa[elencoFoto[i].id];
    elemento.hidden = filtroAttivo !== null && elencoFoto[i].nome !== filtroAttivo;
  }
}

function segnaFiltri() {
  const pulsanti = prendi("filtri").querySelectorAll(".filtro");
  for (let i = 0; i < pulsanti.length; i++) {
    let attivo = pulsanti[i].dataset.nome === "" && filtroAttivo === null;
    if (filtroAttivo !== null && pulsanti[i].dataset.nome === filtroAttivo) {
      attivo = true;
    }
    pulsanti[i].setAttribute("aria-pressed", String(attivo));
  }
}

function creaGriglia() {
  const griglia = prendi("griglia");
  griglia.innerHTML = "";
  for (let i = 0; i < elencoFoto.length; i++) {
    const foto = elencoFoto[i];
    const stampa = document.createElement("button");
    stampa.type = "button";
    stampa.className = "stampa";
    stampa.setAttribute("aria-label", "Foto di " + foto.nome + ", apri");

    const immagine = document.createElement("img");
    immagine.className = "foto";
    immagine.alt = "";
    stampa.appendChild(immagine);

    const didascalia = document.createElement("span");
    didascalia.className = "didascalia";
    const chi = document.createElement("span");
    chi.textContent = foto.nome;
    const quando = document.createElement("span");
    quando.textContent = orario(new Date(foto.scattata_il));
    didascalia.appendChild(chi);
    didascalia.appendChild(quando);
    stampa.appendChild(didascalia);

    // se la miniatura era già arrivata (galleria aggiornata) si mostra subito,
    // già sviluppata, senza scaricarla di nuovo
    if (miniatureCaricate[foto.id]) {
      immagine.src = indirizzoImmagine(miniatureCaricate[foto.id]);
      stampa.classList.add("sviluppata");
    }

    stampa.addEventListener("click", function () {
      apriVisore(foto.id);
    });
    elementiStampa[foto.id] = stampa;
    griglia.appendChild(stampa);
  }
}

// Le miniature arrivano a gruppi di 30, e ognuna "si sviluppa" appena è pronta.
// Si chiedono solo quelle che non sono ancora arrivate.
async function caricaMiniature() {
  const mancanti = [];
  for (let i = 0; i < elencoFoto.length; i++) {
    if (!miniatureCaricate[elencoFoto[i].id]) {
      mancanti.push(elencoFoto[i].id);
    }
  }
  const gruppo = 30;
  for (let inizio = 0; inizio < mancanti.length; inizio = inizio + gruppo) {
    const ids = [];
    for (let i = inizio; i < inizio + gruppo && i < mancanti.length; i++) {
      ids.push(mancanti[i]);
    }
    let risposta = null;
    for (let tentativo = 1; tentativo <= 3 && risposta === null; tentativo++) {
      try {
        risposta = await chiamaDatabase("miniature", { p_festa: idFesta, p_ids: ids });
      } catch (errore) {
        await aspetta(2000);
      }
    }
    if (risposta === null) {
      continue;
    }
    for (let j = 0; j < risposta.length; j++) {
      miniatureCaricate[risposta[j].id] = risposta[j].miniatura;
      mostraMiniatura(elementiStampa[risposta[j].id], risposta[j].miniatura, j * 70);
    }
  }
}

function mostraMiniatura(stampa, base64, ritardo) {
  if (!stampa) {
    return;
  }
  const immagine = stampa.querySelector("img");
  immagine.onload = function () {
    setTimeout(function () {
      stampa.classList.add("sviluppata");
    }, ritardo);
  };
  immagine.src = indirizzoImmagine(base64);
}

async function scaricaTutte() {
  const pulsante = prendi("scarica-tutte");
  const megabyte = Math.round(elencoFoto.length * 0.25);
  if (navigator.maxTouchPoints > 0 && elencoFoto.length > 30) {
    const confermato = confermaConDoppioTocco(pulsante, "Tocca ancora per scaricarle",
      "Sono " + elencoFoto.length + " foto (circa " + megabyte + " MB): meglio farlo con il Wi-Fi.");
    if (!confermato) {
      return;
    }
  }
  pulsante.disabled = true;
  try {
    await scaricaTutteZip(idFesta, festa.nome, elencoFoto, null, function (testo) {
      pulsante.textContent = testo;
    });
  } catch (errore) {
    mostraAvviso(errore.message);
  }
  pulsante.disabled = false;
  pulsante.textContent = "Scarica tutte le foto (zip)";
}


// ---------------------------------------------------------------------
// Il visore: una foto a schermo intero
// ---------------------------------------------------------------------

function apriVisore(id) {
  // si scorrono solo le foto che si vedono con il filtro scelto
  fotoVisibili = [];
  for (let i = 0; i < elencoFoto.length; i++) {
    if (filtroAttivo === null || elencoFoto[i].nome === filtroAttivo) {
      fotoVisibili.push(elencoFoto[i]);
    }
  }
  posizioneVisore = 0;
  for (let i = 0; i < fotoVisibili.length; i++) {
    if (fotoVisibili[i].id === id) {
      posizioneVisore = i;
    }
  }
  prendi("visore").hidden = false;
  document.body.style.overflow = "hidden";
  mostraFotoVisore();
  prendi("visore-chiudi").focus();
}

function chiudiVisore() {
  prendi("visore").hidden = true;
  document.body.style.overflow = "";
  const foto = fotoVisibili[posizioneVisore];
  if (foto && elementiStampa[foto.id]) {
    elementiStampa[foto.id].focus();
  }
}

function spostaVisore(passo) {
  const nuova = posizioneVisore + passo;
  if (nuova < 0 || nuova >= fotoVisibili.length) {
    return;
  }
  posizioneVisore = nuova;
  mostraFotoVisore();
}

async function mostraFotoVisore() {
  const foto = fotoVisibili[posizioneVisore];
  const immagine = prendi("visore-immagine");
  prendi("visore-posizione").textContent = (posizioneVisore + 1) + " di " + fotoVisibili.length;
  prendi("visore-didascalia").textContent = foto.nome + ", " + orario(new Date(foto.scattata_il));
  prendi("visore-prima").hidden = posizioneVisore === 0;
  prendi("visore-dopo").hidden = posizioneVisore === fotoVisibili.length - 1;
  immagine.alt = "Foto di " + foto.nome;

  if (fotoIntere[foto.id]) {
    immagine.src = indirizzoImmagine(fotoIntere[foto.id]);
    immagine.classList.remove("provvisoria");
    return;
  }
  // intanto si mostra la miniatura sfocata
  if (miniatureCaricate[foto.id]) {
    immagine.src = indirizzoImmagine(miniatureCaricate[foto.id]);
  } else {
    immagine.removeAttribute("src");
  }
  immagine.classList.add("provvisoria");

  try {
    const intera = await chiamaDatabase("foto_intera", { p_festa: idFesta, p_id: foto.id });
    ricordaFotoIntera(foto.id, intera.immagine);
    // se nel frattempo si è passati a un'altra foto, non la si sovrascrive
    const ancoraQui = fotoVisibili[posizioneVisore] && fotoVisibili[posizioneVisore].id === foto.id;
    if (ancoraQui && !prendi("visore").hidden) {
      immagine.src = indirizzoImmagine(intera.immagine);
      immagine.classList.remove("provvisoria");
    }
  } catch (errore) {
    mostraAvviso(errore.message);
  }
}

// Tiene in memoria solo le ultime 12 foto grandi aperte
function ricordaFotoIntera(id, base64) {
  fotoIntere[id] = base64;
  ordineFotoIntere.push(id);
  if (ordineFotoIntere.length > 12) {
    const vecchia = ordineFotoIntere.shift();
    delete fotoIntere[vecchia];
  }
}

function salvaFotoVisore() {
  const foto = fotoVisibili[posizioneVisore];
  if (!fotoIntere[foto.id]) {
    mostraAvviso("Un attimo, la foto sta ancora arrivando");
    return;
  }
  salvaFoto(fotoIntere[foto.id], nomeFileFoto(foto.nome, foto.scattata_il));
}

// Scorrere col dito a destra e a sinistra
let inizioTocco = null;
function toccoInizio(evento) {
  inizioTocco = evento.changedTouches[0].clientX;
}
function toccoFine(evento) {
  if (inizioTocco === null) {
    return;
  }
  const spostamento = evento.changedTouches[0].clientX - inizioTocco;
  inizioTocco = null;
  if (spostamento > 50) {
    spostaVisore(-1);
  } else if (spostamento < -50) {
    spostaVisore(1);
  }
}

function tastiVisore(evento) {
  if (prendi("visore").hidden) {
    return;
  }
  if (evento.key === "Escape") {
    chiudiVisore();
  } else if (evento.key === "ArrowLeft") {
    spostaVisore(-1);
  } else if (evento.key === "ArrowRight") {
    spostaVisore(1);
  }
}


// ---------------------------------------------------------------------
// Collegamenti dei pulsanti e degli eventi della pagina
// ---------------------------------------------------------------------

function collegaPulsanti() {
  prendi("problema-riprova").addEventListener("click", caricaFesta);
  prendi("modulo-nome").addEventListener("submit", entra);
  prendi("pulsante-scatto").addEventListener("click", scatta);
  prendi("gira-lato").addEventListener("click", giraFotocamera);
  prendi("pulsante-piano-b").addEventListener("click", apriFotocameraTelefono);
  prendi("file-piano-b").addEventListener("change", fotoDalTelefono);
  prendi("scarica-tutte").addEventListener("click", scaricaTutte);
  // con "foto subito": dalla macchinetta alla galleria e ritorno
  prendi("vai-galleria").addEventListener("click", apriGalleria);
  prendi("benvenuto-galleria").addEventListener("click", apriGalleria);
  prendi("torna-macchinetta").addEventListener("click", tornaAllaMacchinetta);
  prendi("visore-chiudi").addEventListener("click", chiudiVisore);
  prendi("visore-prima").addEventListener("click", function () {
    spostaVisore(-1);
  });
  prendi("visore-dopo").addEventListener("click", function () {
    spostaVisore(1);
  });
  prendi("visore-salva").addEventListener("click", salvaFotoVisore);
  prendi("visore-foto").addEventListener("touchstart", toccoInizio, { passive: true });
  prendi("visore-foto").addEventListener("touchend", toccoFine);
  document.addEventListener("keydown", tastiVisore);

  // il velo dei filtri segue la grandezza del video
  prendi("video").addEventListener("loadedmetadata", adattaVelo);
  window.addEventListener("resize", adattaVelo);

  // quando il telefono si blocca la fotocamera si spegne, e si riaccende al ritorno
  document.addEventListener("visibilitychange", quandoCambiaVisibilita);
  // appena torna la rete si riprova a mandare le foto
  window.addEventListener("online", inviaCoda);
  // avvisa se si chiude la pagina con foto ancora da mandare
  window.addEventListener("beforeunload", primaDiChiudere);
}

function quandoCambiaVisibilita() {
  if (document.hidden) {
    spegniFotocamera();
    return;
  }
  if (!festa) {
    return;
  }
  if (!prendi("fotocamera").hidden) {
    accendiFotocamera();
  }
  if (coda.length > 0) {
    inviaCoda();
  }
  if (!rullinoChiuso()) {
    controllaFesta();
  }
  // con "foto subito" al ritorno sulla pagina si vedono subito le foto nuove
  if (!prendi("galleria").hidden && festa.foto_subito) {
    aggiornaGalleriaSeVisibile();
  }
}

function primaDiChiudere(evento) {
  if (coda.length > 0) {
    evento.preventDefault();
    evento.returnValue = "";
  }
}

avvia();
