# Auto-pubblicazione Litha: Notion → Framer

Questo mini-progetto sincronizza automaticamente gli articoli scritti su
Notion con il CMS di Framer, e pubblica il sito — tutto gratis, tramite
GitHub Actions.

Non serve installare nulla sul tuo computer: puoi fare tutto dal browser.

---

## Come funziona, in breve

Ogni ora (o quando vuoi tu), un piccolo "robot" gratuito di GitHub:

1. Legge dal tuo database Notion gli articoli marcati come "pronti"
2. Li scrive nella Collection del CMS di Framer
3. Pubblica il sito

Se non hai scritto nulla di nuovo, non succede nulla di rilevante — è
sicuro farlo girare spesso.

---

## Passo 1 — Crea un repository GitHub

1. Vai su [github.com](https://github.com) e crea un account gratuito se
   non ce l'hai già
2. Crea un nuovo repository (può essere **privato**, va benissimo — i
   minuti di GitHub Actions gratuiti valgono anche per i repo privati)
3. Carica dentro tutti i file di questa cartella (`sync-and-publish.mjs`,
   `list-fields.mjs`, `package.json`, la cartella `.github/`)

## Passo 2 — Crea una API key di Notion

1. Vai su [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Crea una nuova "integrazione interna", dalle un nome (es. "Litha Sync")
3. Copia la **API key** che ti viene generata (inizia con `secret_` o `ntn_`)
4. Apri il tuo database Notion nel browser, clicca sui tre puntini in alto
   a destra → **Connections** → collega l'integrazione che hai appena
   creato (altrimenti non potrà leggerlo)
5. Copia anche l'**ID del database**: è la stringa di 32 caratteri
   nell'URL del database, tra l'ultimo `/` e il `?`

## Passo 3 — Crea una API key di Framer

1. Apri il tuo progetto su Framer → **Site Settings** → **General**
2. Genera una nuova API key e copiala subito (non potrai rivederla dopo)
3. Copia anche l'URL del progetto (tipo `https://framer.com/projects/xxxxxxx`)

## Passo 4 — Trova gli ID di Collection e campi

Questo passaggio richiede di lanciare uno script una sola volta. Il modo
più semplice senza installare nulla in locale:

1. Su GitHub, apri il tuo repository → tab **Actions**
2. (Se non l'hai già fatto) aggiungi temporaneamente questo comando come
   nuovo step in un workflow, oppure — più semplice — chiedimi di
   aiutarti a farlo girare da qui in chat: posso eseguirlo io stesso e
   darti l'elenco degli ID, se mi incolli la tua Framer API key e l'URL
   del progetto in un messaggio (puoi anche rigenerarla subito dopo, per
   sicurezza).

Una volta ottenuto l'elenco, apri `sync-and-publish.mjs` e:

- sostituisci ogni `TODO_INCOLLA_ID_...` nel `FIELD_MAP` con l'id del
  campo Framer corrispondente
- aggiorna `NOTION_PUBLISHED_PROPERTY` con il nome esatto della proprietà
  Notion che usi per marcare un articolo come pronto (es. una checkbox
  "Pubblicato")

## Passo 5 — Aggiungi i "Secrets" su GitHub

Nel repository: **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**. Aggiungi questi cinque:

| Nome secret            | Valore                                      |
| ----------------------- | -------------------------------------------- |
| `NOTION_API_KEY`         | la API key di Notion dal Passo 2             |
| `NOTION_DATABASE_ID`     | l'ID del database Notion dal Passo 2         |
| `FRAMER_API_KEY`         | la API key di Framer dal Passo 3             |
| `FRAMER_PROJECT_URL`     | l'URL del progetto Framer dal Passo 3        |
| `FRAMER_COLLECTION_ID`   | l'ID della Collection dal Passo 4            |

I secrets non sono mai visibili a nessuno, nemmeno a te dopo averli
salvati — è il modo sicuro di passare le chiavi allo script.

## Passo 6 — Prova il workflow

1. Vai nella tab **Actions** del repository
2. Seleziona "Sincronizza Notion e pubblica Litha" dalla lista a sinistra
3. Clicca **Run workflow** per lanciarlo manualmente subito, senza
   aspettare l'orario schedulato
4. Guarda i log: se qualcosa non va, l'errore ti dirà quale variabile o
   proprietà manca

Da questo momento, lo script gira automaticamente ogni ora, gratis.

---

## Personalizzazioni comuni

- **Cambiare la frequenza**: modifica la riga `cron:` in
  `.github/workflows/sync.yml`. Ogni 30 minuti: `*/30 * * * *`. Una volta
  al giorno alle 8:00: `0 8 * * *`.
- **Aggiungere altri campi**: aggiungi una riga a `FIELD_MAP` nello
  script principale.
- **Gestire tipi di campo diversi** (es. select multiplo, testo
  formattato): aggiungi un nuovo `case` dentro la funzione
  `extractPlainValue`.
