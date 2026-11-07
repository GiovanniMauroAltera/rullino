# Rullino

La macchinetta usa e getta della festa, dentro il telefono di ogni invitato.
Niente app da scaricare: si inquadra un QR code, si scrive il proprio nome e si scatta.

## Come funziona

- **Chi organizza** crea la festa dalla pagina `organizza.html`: sceglie il nome, quanti scatti ha ogni invitato, quando si sviluppano le foto e chi potrà vederle. La pagina crea un QR code da stampare o da mostrare su uno schermo.
- **Gli invitati** inquadrano il QR code con la fotocamera del telefono, scrivono il nome e hanno la loro macchinetta. Dopo lo scatto non si può rivedere la foto: ogni scatto è definitivo, e il contatore arancione scende come su una macchinetta vera.
- **I filtri:** prima di scattare si sceglie tra *Originale*, *Usa e getta* (colori caldi e sbiaditi, grana, angoli scuri e ogni tanto un po' di luce entrata nel rullino), *Digitale* (colori accesi e freddi, tanto contrasto, come una compattina dei primi anni 2000) e *Bianco e nero*. Nel mirino si vede già l'effetto, e il telefono ricorda l'ultimo filtro scelto.
- **Due modi di vedere le foto.** Con lo sviluppo a un orario, le foto restano nascoste a tutti fino a quell'ora. A quell'ora compaiono tutte insieme nella galleria, con il nome di chi le ha scattate. Si possono guardare persona per persona e salvare una alla volta. Lo zip con tutte le foto lo scarica solo chi organizza, dal pannello, per non consumare il traffico gratuito.
- **Foto subito:** in alternativa ogni foto compare nella galleria di tutti appena scattata, durante la festa. Gli invitati la aprono con "Guarda le foto" dalla macchinetta, la galleria si aggiorna da sola e il rullino resta aperto finché ci sono scatti. Si sceglie quando si crea la festa e si può cambiare dal pannello.
- **L'organizzatore** può guardare e cancellare le foto in qualsiasi momento, sviluppare prima del previsto, spostare l'orario e regalare altri scatti, a tutti o a una persona sola (con +1 e +5 accanto al suo nome).

Le regole (quanti scatti restano, foto nascoste, codice segreto) le controlla il database e non il telefono, quindi non si possono aggirare.
Se in un punto della festa manca la rete, le foto restano nel telefono e partono da sole appena torna il segnale.

## I file

| File | Cosa contiene |
|---|---|
| `index.html`, `invitati.js` | la pagina degli invitati: la macchinetta, l'attesa e la galleria |
| `organizza.html`, `organizzatore.js` | la pagina di chi organizza |
| `filtri.js` | i filtri delle foto (usa e getta, digitale, bianco e nero) |
| `comune.js` | le funzioni che servono a tutte e due le pagine |
| `stile.css` | la grafica |
| `impostazioni.js` | l'indirizzo e la chiave del progetto Supabase |
| `database.sql` | il database: tabelle, regole e funzioni |
| `icona.svg` | l'icona della pagina |

## Come metterla online (gratis)

Servono due servizi gratuiti: **Supabase**, che conserva le foto, e **GitHub Pages**, che pubblica le pagine.

1. **Creare il database.** Su [supabase.com](https://supabase.com) ci si iscrive (va bene "Continue with GitHub"). Poi "New project": nome `rullino`, una password (da segnare, anche se all'app non serve) e la regione *Central EU (Frankfurt)*. In un paio di minuti il progetto è pronto.
2. **Caricare le regole.** Si apre "SQL Editor", poi "New query". Si incolla tutto il file `database.sql` e si preme "Run". Deve comparire "Success. No rows returned".
3. **Collegare l'app.** In "Project Settings" > "API Keys" ci sono la *Project URL* e la chiave *publishable*. Vanno copiate in `impostazioni.js`. Sono dati pubblici e possono stare nel sito: il database è protetto dalle regole del punto 2.
4. **Pubblicare le pagine.** Si caricano i file in un repository GitHub e si attiva GitHub Pages. L'app diventa raggiungibile a un indirizzo come `https://nomeutente.github.io/rullino/`.

## Alla festa

- **Prima che arrivino gli invitati** conviene provare con il proprio telefono: si apre il QR code, si fa uno scatto e si controlla nel pannello che la foto sia arrivata.
- **Il QR code** si può stampare dal pannello ("Stampa il cartello") oppure mostrare su un PC o una TV ("Mostra a schermo intero"). Il link si può anche mandare nel gruppo WhatsApp.
- **Su iPhone** si inquadra il QR con l'app Fotocamera e si tocca il link che compare: si apre Safari, che chiede il permesso per la fotocamera. Bisogna toccare "Consenti".
- **Se la fotocamera non parte**, per esempio perché il link è stato aperto dentro Instagram o WhatsApp, il pulsante di scatto apre la fotocamera normale del telefono e la foto conta lo stesso. In alternativa si apre il link con Safari o Chrome.
- **Rete:** ogni foto pesa circa 200–400 KB (con i filtri un po' di più, per via della grana). Se nel locale il segnale è scarso, conviene far collegare gli invitati al Wi-Fi.

## Limiti del piano gratuito di Supabase

- 500 MB di spazio: ogni foto con la sua miniatura pesa circa 0,35–0,4 MB, quindi ci stanno circa 1.100 foto. Con 75 invitati vuol dire al massimo 12–14 scatti a testa. Lo spazio usato si vede nel pannello.
- 5 GB al mese di traffico (i dati che il database manda ai telefoni). Per risparmiarlo le miniature della galleria si scaricano solo quando si scorre fino a loro, pesano circa 8 KB l'una, e lo zip lo scarica solo chi organizza.
- Se il progetto resta fermo per una settimana, Supabase lo mette in pausa: si riattiva dal sito con un clic. Conviene comunque scaricare lo zip con tutte le foto entro qualche giorno dalla festa.
