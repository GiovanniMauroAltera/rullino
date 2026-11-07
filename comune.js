// =====================================================================
// Rullino: le funzioni usate sia dagli invitati sia dall'organizzatore
// =====================================================================


// ---------- Parlare con il database ----------

// Dice se in impostazioni.js sono stati inseriti i dati di Supabase
function configurazionePronta() {
  if (typeof INDIRIZZO_SUPABASE !== "string" || typeof CHIAVE_PUBBLICA_SUPABASE !== "string") {
    return false;
  }
  if (INDIRIZZO_SUPABASE.indexOf("http") !== 0) {
    return false;
  }
  if (CHIAVE_PUBBLICA_SUPABASE.indexOf("INCOLLA") === 0) {
    return false;
  }
  return true;
}

// Chiama una funzione del database (quelle scritte in database.sql)
// e restituisce la sua risposta. Se qualcosa va storto lancia un errore
// con un messaggio leggibile. Se il problema è la rete, l'errore ha
// errore.senzaRete = true, così chi chiama sa che può riprovare.
async function chiamaDatabase(nomeFunzione, parametri) {
  if (!configurazionePronta()) {
    throw new Error("Manca la configurazione di Supabase nel file impostazioni.js");
  }

  let indirizzo = INDIRIZZO_SUPABASE;
  if (indirizzo.charAt(indirizzo.length - 1) === "/") {
    indirizzo = indirizzo.substring(0, indirizzo.length - 1);
  }

  const intestazioni = {
    "Content-Type": "application/json",
    "apikey": CHIAVE_PUBBLICA_SUPABASE
  };
  // le chiavi "anon" vecchie di Supabase (iniziano con eyJ) vanno messe anche qui
  if (CHIAVE_PUBBLICA_SUPABASE.indexOf("eyJ") === 0) {
    intestazioni["Authorization"] = "Bearer " + CHIAVE_PUBBLICA_SUPABASE;
  }

  let risposta;
  try {
    risposta = await fetch(indirizzo + "/rest/v1/rpc/" + nomeFunzione, {
      method: "POST",
      headers: intestazioni,
      body: JSON.stringify(parametri || {})
    });
  } catch (errore) {
    const erroreRete = new Error("Connessione assente: controlla internet e riprova");
    erroreRete.senzaRete = true;
    throw erroreRete;
  }

  const testo = await risposta.text();
  let dati = null;
  try {
    dati = JSON.parse(testo);
  } catch (errore) {
    dati = null;
  }

  if (!risposta.ok) {
    let messaggio = "Errore del server (" + risposta.status + ")";
    if (dati && dati.message) {
      messaggio = dati.message;
    }
    if (dati && dati.code === "PGRST202") {
      messaggio = "Il database non è pronto: va eseguito il file database.sql su Supabase";
    }
    const errore = new Error(messaggio);
    errore.stato = risposta.status;
    // server momentaneamente giù o troppo occupato: si può riprovare
    if (risposta.status >= 500 || risposta.status === 429 || risposta.status === 408) {
      errore.senzaRete = true;
    }
    throw errore;
  }
  return dati;
}


// ---------- Piccoli aiuti per la pagina ----------

function prendi(id) {
  return document.getElementById(id);
}

// Mostra una sola schermata (gli elementi con classe "schermata") e nasconde le altre
function mostraSchermata(id) {
  const schermate = document.querySelectorAll(".schermata");
  for (let i = 0; i < schermate.length; i++) {
    schermate[i].hidden = schermate[i].id !== id;
  }
  window.scrollTo(0, 0);
}

function aspetta(millisecondi) {
  return new Promise(function (fatto) {
    setTimeout(fatto, millisecondi);
  });
}

// Mostra un messaggio breve in basso che sparisce da solo
let timerAvviso = null;
function mostraAvviso(testo) {
  let avviso = prendi("avviso");
  if (!avviso) {
    avviso = document.createElement("div");
    avviso.id = "avviso";
    avviso.className = "avviso";
    avviso.setAttribute("role", "status");
    document.body.appendChild(avviso);
  }
  avviso.textContent = testo;
  avviso.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(function () {
    avviso.hidden = true;
  }, 4000);
}


// ---------- Memoria del telefono (localStorage) ----------
// Se il browser non la permette (navigazione privata), l'app funziona lo stesso.

function leggiMemoria(chiave) {
  try {
    const testo = localStorage.getItem(chiave);
    if (testo === null) {
      return null;
    }
    return JSON.parse(testo);
  } catch (errore) {
    return null;
  }
}

function scriviMemoria(chiave, valore) {
  try {
    localStorage.setItem(chiave, JSON.stringify(valore));
    return true;
  } catch (errore) {
    return false;
  }
}

function cancellaMemoria(chiave) {
  try {
    localStorage.removeItem(chiave);
  } catch (errore) {
    // niente da fare
  }
}


// ---------- Date e orari ----------

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
  "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function dueCifre(numero) {
  if (numero < 10) {
    return "0" + numero;
  }
  return String(numero);
}

function orario(data) {
  return data.getHours() + ":" + dueCifre(data.getMinutes());
}

// "oggi alle 23:30", "domani alle 10:00", "sabato 15 novembre alle 10:00"
function quandoInParole(testoData) {
  const data = new Date(testoData);
  const oggi = new Date();
  const domani = new Date();
  domani.setDate(oggi.getDate() + 1);

  if (data.toDateString() === oggi.toDateString()) {
    return "oggi alle " + orario(data);
  }
  if (data.toDateString() === domani.toDateString()) {
    return "domani alle " + orario(data);
  }
  return GIORNI[data.getDay()] + " " + data.getDate() + " " + MESI[data.getMonth()] + " alle " + orario(data);
}

// Valore per un campo <input type="datetime-local">
function perCampoDataOra(data) {
  return data.getFullYear() + "-" + dueCifre(data.getMonth() + 1) + "-" + dueCifre(data.getDate()) +
    "T" + dueCifre(data.getHours()) + ":" + dueCifre(data.getMinutes());
}

// Il tempo che manca, nel formato del display: "09:12:33"
function tempoSulDisplay(millisecondi) {
  if (millisecondi < 0) {
    millisecondi = 0;
  }
  let secondi = Math.floor(millisecondi / 1000);
  let ore = Math.floor(secondi / 3600);
  secondi = secondi - ore * 3600;
  const minuti = Math.floor(secondi / 60);
  secondi = secondi - minuti * 60;
  if (ore > 99) {
    ore = 99;
  }
  return dueCifre(ore) + ":" + dueCifre(minuti) + ":" + dueCifre(secondi);
}


// ---------- Il display a led arancione ----------
// Disegna cifre a 7 segmenti (come la data stampata dalle macchinette
// usa e getta) su un canvas. Si usa per il contatore, per il conto alla
// rovescia e per la data sulle foto.

const SEGMENTI_ACCESI = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
  "-": "g", " ": ""
};

// Restituisce la larghezza che occupa un testo alto "altezza"
function larghezzaDisplay(testo, altezza) {
  let larghezza = 0;
  for (let i = 0; i < testo.length; i++) {
    larghezza = larghezza + larghezzaCarattere(testo.charAt(i), altezza);
  }
  return larghezza;
}

function larghezzaCarattere(carattere, altezza) {
  const spazio = altezza * 0.2;
  if (carattere === ":" || carattere === "'") {
    return altezza * 0.14 + spazio;
  }
  return altezza * 0.56 + spazio;
}

// x e y sono l'angolo in alto a sinistra. Se "spenti" è un colore,
// disegna sotto anche i segmenti spenti (come un vero display).
function disegnaDisplay(ctx, testo, x, y, altezza, colore, spenti) {
  const larghezzaCifra = altezza * 0.56;
  const spessore = altezza * 0.12;
  const meta = altezza / 2;
  let posizione = x;

  ctx.save();
  // le cifre leggermente inclinate, come sui display veri
  ctx.translate(x, y + altezza);
  ctx.transform(1, 0, -0.1, 1, 0, 0);
  ctx.translate(-x, -(y + altezza));

  for (let i = 0; i < testo.length; i++) {
    const carattere = testo.charAt(i);

    if (carattere === ":") {
      ctx.fillStyle = colore;
      ctx.shadowColor = colore;
      ctx.shadowBlur = altezza * 0.2;
      ctx.fillRect(posizione, y + altezza * 0.25, spessore, spessore);
      ctx.fillRect(posizione, y + altezza * 0.65, spessore, spessore);
      posizione = posizione + larghezzaCarattere(carattere, altezza);
      continue;
    }
    if (carattere === "'") {
      ctx.fillStyle = colore;
      ctx.shadowColor = colore;
      ctx.shadowBlur = altezza * 0.2;
      ctx.fillRect(posizione, y, spessore * 0.9, altezza * 0.28);
      posizione = posizione + larghezzaCarattere(carattere, altezza);
      continue;
    }

    let accesi = SEGMENTI_ACCESI[carattere];
    if (accesi === undefined) {
      accesi = "";
    }
    const tutti = "abcdefg";
    for (let s = 0; s < tutti.length; s++) {
      const lettera = tutti.charAt(s);
      const acceso = accesi.indexOf(lettera) !== -1;
      if (!acceso && !spenti) {
        continue;
      }
      if (acceso) {
        ctx.fillStyle = colore;
        ctx.shadowColor = colore;
        ctx.shadowBlur = altezza * 0.2;
      } else {
        ctx.fillStyle = spenti;
        ctx.shadowBlur = 0;
      }
      const r = rettangoloSegmento(lettera, posizione, y, larghezzaCifra, altezza, spessore, meta);
      ctx.fillRect(r[0], r[1], r[2], r[3]);
    }
    posizione = posizione + larghezzaCarattere(carattere, altezza);
  }
  ctx.restore();
  return posizione - x;
}

// La posizione di ogni segmento: a in alto, poi in senso orario, g in mezzo
function rettangoloSegmento(lettera, px, y, larghezza, altezza, t, meta) {
  const breve = meta - t * 1.5;
  if (lettera === "a") return [px + t, y, larghezza - 2 * t, t];
  if (lettera === "b") return [px + larghezza - t, y + t, t, breve];
  if (lettera === "c") return [px + larghezza - t, y + meta + t / 2, t, breve];
  if (lettera === "d") return [px + t, y + altezza - t, larghezza - 2 * t, t];
  if (lettera === "e") return [px, y + meta + t / 2, t, breve];
  if (lettera === "f") return [px, y + t, t, breve];
  return [px + t, y + meta - t / 2, larghezza - 2 * t, t];
}

// Prepara un canvas della pagina (nitido anche sugli schermi ad alta
// densità) e ci scrive dentro il testo del display
function scriviSuCanvasDisplay(canvas, testo, altezza, colore) {
  const densita = window.devicePixelRatio || 1;
  const larghezza = Math.ceil(larghezzaDisplay(testo, altezza) + altezza * 0.15);
  const altezzaTotale = Math.ceil(altezza * 1.1);
  if (canvas.width !== larghezza * densita || canvas.height !== altezzaTotale * densita) {
    canvas.width = larghezza * densita;
    canvas.height = altezzaTotale * densita;
    canvas.style.width = larghezza + "px";
    canvas.style.height = altezzaTotale + "px";
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(densita, 0, 0, densita, 0, 0);
  ctx.clearRect(0, 0, larghezza, altezzaTotale);
  let testoSpento = "";
  for (let i = 0; i < testo.length; i++) {
    const c = testo.charAt(i);
    if (c === ":" || c === "'") {
      testoSpento = testoSpento + c;
    } else {
      testoSpento = testoSpento + "8";
    }
  }
  // prima i segmenti spenti, poi quelli accesi
  disegnaDisplay(ctx, testoSpento, altezza * 0.1, altezza * 0.05, altezza, "rgba(255,138,31,0.09)", null);
  disegnaDisplay(ctx, testo, altezza * 0.1, altezza * 0.05, altezza, colore, null);
}

// La data come la stampano le macchinette: '26 11 07
function testoData(data) {
  const anno = String(data.getFullYear()).substring(2);
  return "'" + anno + " " + dueCifre(data.getMonth() + 1) + " " + dueCifre(data.getDate());
}


// ---------- Foto ----------

// Un codice unico per ogni foto (serve a non salvarla due volte)
function nuovoId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  const byte = new Uint8Array(16);
  window.crypto.getRandomValues(byte);
  byte[6] = (byte[6] & 15) | 64;
  byte[8] = (byte[8] & 63) | 128;
  let esadecimale = "";
  for (let i = 0; i < 16; i++) {
    let pezzo = byte[i].toString(16);
    if (pezzo.length === 1) {
      pezzo = "0" + pezzo;
    }
    esadecimale = esadecimale + pezzo;
    if (i === 3 || i === 5 || i === 7 || i === 9) {
      esadecimale = esadecimale + "-";
    }
  }
  return esadecimale;
}

function indirizzoImmagine(base64) {
  return "data:image/jpeg;base64," + base64;
}

function blobDaBase64(base64) {
  const binario = atob(base64);
  const byte = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    byte[i] = binario.charCodeAt(i);
  }
  return new Blob([byte], { type: "image/jpeg" });
}

// Nome del file: "rullino-marco-2341.jpg"
function nomeFileFoto(nome, testoData, numero) {
  const data = new Date(testoData);
  let pulito = "";
  const minuscolo = nome.toLowerCase();
  for (let i = 0; i < minuscolo.length; i++) {
    const c = minuscolo.charAt(i);
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) {
      pulito = pulito + c;
    } else if (pulito.length > 0 && pulito.charAt(pulito.length - 1) !== "-") {
      pulito = pulito + "-";
    }
  }
  if (pulito === "" || pulito === "-") {
    pulito = "ospite";
  }
  let finale = "rullino-" + pulito + "-" + dueCifre(data.getHours()) + dueCifre(data.getMinutes());
  // con il numero davanti (001, 002...) le foto restano in ordine nello zip
  if (numero !== undefined) {
    let prefisso = String(numero);
    while (prefisso.length < 3) {
      prefisso = "0" + prefisso;
    }
    finale = prefisso + "-" + finale;
  }
  return finale + ".jpg";
}

// Sul telefono apre il menu "Condividi" (da lì si salva nella galleria),
// sul computer scarica il file
async function salvaFoto(base64, nomeFile) {
  const blob = blobDaBase64(base64);
  const suTelefono = navigator.maxTouchPoints > 0;
  if (suTelefono && navigator.canShare && window.File) {
    const file = new File([blob], nomeFile, { type: "image/jpeg" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (errore) {
        if (errore.name === "AbortError") {
          return; // ha chiuso il menu: va bene così
        }
      }
    }
  }
  scaricaBlob(blob, nomeFile);
}

function scaricaBlob(blob, nomeFile) {
  const link = document.createElement("a");
  const indirizzo = URL.createObjectURL(blob);
  link.href = indirizzo;
  link.download = nomeFile;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(indirizzo);
  }, 60000);
}

// Carica una libreria esterna solo quando serve (per lo zip)
function caricaLibreria(indirizzo) {
  return new Promise(function (fatto, fallito) {
    const script = document.createElement("script");
    script.src = indirizzo;
    script.onload = fatto;
    script.onerror = function () {
      fallito(new Error("Non riesco a scaricare la libreria per lo zip"));
    };
    document.head.appendChild(script);
  });
}

// Scarica tutte le foto in un unico file zip.
// "elenco" è la lista delle foto (id, nome, scattata_il), "codice" serve
// solo all'organizzatore prima dello sviluppo, "aggiorna" riceve il testo
// dell'avanzamento da mostrare sul pulsante.
async function scaricaTutteZip(idFesta, nomeFesta, elenco, codice, aggiorna) {
  if (!window.JSZip) {
    await caricaLibreria("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
  }
  const zip = new JSZip();
  for (let i = 0; i < elenco.length; i++) {
    aggiorna("Scarico " + (i + 1) + " di " + elenco.length + "…");
    let foto = null;
    // fino a 3 tentativi per ogni foto, se la rete fa i capricci
    for (let tentativo = 1; tentativo <= 3 && foto === null; tentativo++) {
      try {
        foto = await chiamaDatabase("foto_intera", { p_festa: idFesta, p_id: elenco[i].id, p_codice: codice });
      } catch (errore) {
        if (tentativo === 3) {
          throw errore;
        }
        await aspetta(1500);
      }
    }
    zip.file(nomeFileFoto(foto.nome, foto.scattata_il, i + 1), foto.immagine, { base64: true });
  }
  aggiorna("Preparo lo zip…");
  const contenuto = await zip.generateAsync({ type: "blob" });
  scaricaBlob(contenuto, "Rullino - " + nomeFesta + ".zip");
}
