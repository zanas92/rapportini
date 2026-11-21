# Rapportini

Web app (PWA) per registrare le ore di lavoro. Funziona interamente sul dispositivo:
i dati restano nel browser (localStorage), nessun server, funziona anche offline.

## Installazione su iPhone
1. Pubblica la cartella su un hosting HTTPS statico (es. GitHub Pages, Netlify, Cloudflare Pages).
2. Apri l'indirizzo con **Safari** → Condividi → **Aggiungi alla schermata Home**.
3. Da quel momento l'app si apre dall'icona e funziona senza connessione.

## Prova in locale sul PC
```
python3 -m http.server 8000
```
poi apri http://localhost:8000

## Backup
Menu ⋯ → *Salva backup completo (JSON)*; si ripristina con *Ripristina da backup*.
L'export CSV si apre direttamente in Excel.

Dove finiscono i file:
- **iPhone/iPad**: si apre il pannello di condivisione → *Salva su File* (iCloud Drive o Sul mio iPhone).
- **Android e PC**: il file viene scaricato direttamente nella cartella **Download**.

## Aggiornare l'app
Dopo aver modificato i file, incrementa `CACHE` in `sw.js` (es. `rapportini-v2`),
altrimenti i dispositivi continuano a usare la versione in cache.
