# CLAUDE.md

## Regola fondamentale: solo locale, nessuna trasmissione in rete

L'app deve funzionare **esclusivamente in locale**. Non deve trasmettere **NESSUN dato** all'esterno via rete, in nessuna forma.

- Niente chiamate a server, API, backend o servizi esterni (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, form con `action` remota, ecc.).
- Niente analytics, telemetria, tracking, crash reporting, font/CDN/immagini remote o qualsiasi altra risorsa caricata da domini esterni.
- Tutte le librerie vanno incluse in locale (cartella `vendor/`), mai caricate da CDN.
- I dati restano solo sul dispositivo (storage del browser). Esportazioni e condivisioni avvengono solo su azione esplicita dell'utente (es. download del PDF).
- Il service worker (`sw.js`) può servire solo file dell'app stessa: non deve mai inoltrare richieste verso origini esterne.
- La Content-Security-Policy in `index.html` fa rispettare questa regola dal browser: non va mai allentata (niente domini esterni, `connect-src` resta `'none'`). Niente script o stili scritti dentro l'HTML: vanno in file `.js`/`.css` separati, aggiunti anche alla lista `FILES` di `sw.js`.
- Qualsiasi modifica che introduca traffico di rete verso l'esterno è vietata, anche se "opzionale" o "solo per comodità".
