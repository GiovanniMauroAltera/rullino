// =====================================================================
// Rullino: i filtri delle foto
//
// Al momento dello scatto il filtro cambia i colori della foto pixel
// per pixel (funziona su tutti i telefoni, anche su iPhone).
// Nel mirino invece si vede un'anteprima simile fatta con il CSS
// (classi "filtro-..." in stile.css).
// =====================================================================

const FILTRI = [
  { id: "originale", nome: "Originale" },
  { id: "usa-e-getta", nome: "Usa e getta" },
  { id: "digitale", nome: "Digitale" },
  { id: "bianco-e-nero", nome: "Bianco e nero" }
];

// Una curva "a S": scurisce un po' le ombre e schiarisce le luci, cioè
// aumenta il contrasto. forza 0 = nessun cambiamento, 1 = il massimo.
function curvaContrasto(valore, forza) {
  const x = valore / 255;
  const curva = x * x * (3 - 2 * x);
  return (x + (curva - x) * forza) * 255;
}

// Prepara una tabella di 256 valori: per ogni valore di partenza (0-255)
// dice quello di arrivo. Così il calcolo pesante si fa 256 volte e non
// una volta per ogni pixel.
// - contrasto: forza della curva a S
// - gamma: sotto 1 schiarisce i mezzitoni, sopra 1 li scurisce
// - minimo: quanto si "sbiadisce" il nero (0 = nero pieno)
// - massimo: fin dove arriva il bianco (255 = bianco pieno)
function tabellaColore(contrasto, gamma, minimo, massimo) {
  const tabella = new Uint8ClampedArray(256);
  for (let valore = 0; valore < 256; valore++) {
    let x = curvaContrasto(valore, contrasto) / 255;
    x = Math.pow(x, gamma);
    tabella[valore] = Math.round(minimo + x * (massimo - minimo));
  }
  return tabella;
}

// Le "ricette" dei filtri
function ricettaFiltro(idFiltro) {
  if (idFiltro === "usa-e-getta") {
    // Pellicola economica con il flash: colori caldi e un po' slavati,
    // neri sbiaditi verso il verde, luci gialline, angoli scuri e grana.
    return {
      grigio: false,
      saturazione: 1.12,
      rosso: tabellaColore(0.25, 0.92, 20, 255),
      verde: tabellaColore(0.25, 0.97, 26, 246),
      blu: tabellaColore(0.25, 1.08, 40, 212),
      vignetta: 0.5,
      grana: 26,
      granaColorata: false
    };
  }
  if (idFiltro === "digitale") {
    // Fotocamera digitale compatta dei primi anni 2000: colori accesi,
    // tanto contrasto, luci "bruciate", tono freddo e rumore colorato.
    return {
      grigio: false,
      saturazione: 1.45,
      rosso: tabellaColore(0.75, 0.82, 0, 238),
      verde: tabellaColore(0.75, 0.82, 4, 255),
      blu: tabellaColore(0.75, 0.76, 24, 255),
      vignetta: 0,
      grana: 18,
      granaColorata: true
    };
  }
  if (idFiltro === "bianco-e-nero") {
    // Pellicola in bianco e nero: neri profondi, contrasto deciso e grana
    return {
      grigio: true,
      saturazione: 1,
      toni: tabellaColore(0.65, 0.95, 4, 252),
      vignetta: 0.3,
      grana: 22,
      granaColorata: false
    };
  }
  return null;
}

// Applica il filtro alla foto disegnata sul canvas
function applicaFiltro(ctx, larghezza, altezza, idFiltro) {
  const ricetta = ricettaFiltro(idFiltro);
  if (ricetta === null) {
    return; // "originale": la foto resta com'è
  }

  const immagine = ctx.getImageData(0, 0, larghezza, altezza);
  const pixel = immagine.data;

  // Per la vignetta: quanto è lontana dal centro ogni colonna e ogni riga
  // (0 al centro, 1 sul bordo), calcolato una volta sola
  const distanzaColonne = new Float32Array(larghezza);
  for (let x = 0; x < larghezza; x++) {
    const d = (x - larghezza / 2) / (larghezza / 2);
    distanzaColonne[x] = d * d;
  }
  const distanzaRighe = new Float32Array(altezza);
  for (let y = 0; y < altezza; y++) {
    const d = (y - altezza / 2) / (altezza / 2);
    distanzaRighe[y] = d * d;
  }

  // Per la grana: numeri a caso calcolati con una formula veloce
  // (Math.random() su milioni di pixel sarebbe più lento)
  let seme = Math.floor(Math.random() * 4294967296);

  let i = 0;
  for (let y = 0; y < altezza; y++) {
    const distanzaRiga = distanzaRighe[y];
    for (let x = 0; x < larghezza; x++) {
      let r = pixel[i];
      let g = pixel[i + 1];
      let b = pixel[i + 2];

      if (ricetta.grigio) {
        // la luminosità percepita: il verde conta di più, il blu di meno
        const luce = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        r = ricetta.toni[luce];
        g = r;
        b = r;
      } else {
        if (ricetta.saturazione !== 1) {
          // allontana ogni colore dal grigio della stessa luminosità
          const luce = 0.299 * r + 0.587 * g + 0.114 * b;
          r = luce + (r - luce) * ricetta.saturazione;
          g = luce + (g - luce) * ricetta.saturazione;
          b = luce + (b - luce) * ricetta.saturazione;
          if (r < 0) { r = 0; } else if (r > 255) { r = 255; }
          if (g < 0) { g = 0; } else if (g > 255) { g = 255; }
          if (b < 0) { b = 0; } else if (b > 255) { b = 255; }
        }
        r = ricetta.rosso[r | 0];
        g = ricetta.verde[g | 0];
        b = ricetta.blu[b | 0];
      }

      if (ricetta.vignetta > 0) {
        // 0 al centro, 1 negli angoli: più è lontano, più si scurisce
        const lontananza = (distanzaColonne[x] + distanzaRiga) / 2;
        const fattore = 1 - ricetta.vignetta * lontananza * lontananza;
        r = r * fattore;
        g = g * fattore;
        b = b * fattore;
      }

      if (ricetta.grana > 0) {
        seme = (seme * 1664525 + 1013904223) >>> 0;
        const rumore = (seme / 4294967296 - 0.5) * ricetta.grana;
        if (ricetta.granaColorata) {
          // ogni colore il suo rumore, come i sensori digitali
          r = r + rumore;
          seme = (seme * 1664525 + 1013904223) >>> 0;
          g = g + (seme / 4294967296 - 0.5) * ricetta.grana;
          seme = (seme * 1664525 + 1013904223) >>> 0;
          b = b + (seme / 4294967296 - 0.5) * ricetta.grana;
        } else {
          r = r + rumore;
          g = g + rumore;
          b = b + rumore;
        }
      }

      // Uint8ClampedArray tiene da solo i valori tra 0 e 255
      pixel[i] = r;
      pixel[i + 1] = g;
      pixel[i + 2] = b;
      i = i + 4;
    }
  }
  ctx.putImageData(immagine, 0, 0);

  // Ogni tanto nelle usa e getta entra un po' di luce nella pellicola
  if (idFiltro === "usa-e-getta" && Math.random() < 0.3) {
    disegnaLuceEntrata(ctx, larghezza, altezza);
  }
}

// Una macchia arancione che sfuma da un bordo, come la luce che entra nel rullino
function disegnaLuceEntrata(ctx, larghezza, altezza) {
  let x = 0;
  if (Math.random() < 0.5) {
    x = larghezza;
  }
  const y = Math.random() * altezza;
  const raggio = Math.max(larghezza, altezza) * (0.35 + Math.random() * 0.25);
  const sfumatura = ctx.createRadialGradient(x, y, 0, x, y, raggio);
  sfumatura.addColorStop(0, "rgba(255, 110, 40, 0.55)");
  sfumatura.addColorStop(0.5, "rgba(255, 70, 30, 0.18)");
  sfumatura.addColorStop(1, "rgba(255, 60, 20, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = sfumatura;
  ctx.fillRect(0, 0, larghezza, altezza);
  ctx.restore();
}
