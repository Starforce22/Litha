// sync-and-publish.mjs
//
// Cosa fa questo script, in ordine:
//   1. Si collega al tuo database Notion e legge tutte le righe (i tuoi articoli)
//   2. Si collega al progetto Framer e trova la Collection CMS giusta
//   3. Crea o aggiorna gli item della Collection con i dati presi da Notion
//   4. Pubblica una nuova versione del sito e la promuove in produzione
//
// Non devi capire ogni riga al primo colpo: segui il file README.md per la
// configurazione, poi torna qui solo se vuoi personalizzare la logica.

import { Client as NotionClient } from "@notionhq/client";
import { connect } from "framer-api";

// ---------------------------------------------------------------------------
// 1. CONFIGURAZIONE — questi valori arrivano da variabili d'ambiente (mai
//    scritti a mano nel codice, per sicurezza). Vedi README.md per sapere
//    dove impostarli.
// ---------------------------------------------------------------------------

const NOTION_API_KEY = requireEnv("NOTION_API_KEY");
const NOTION_DATABASE_ID = requireEnv("NOTION_DATABASE_ID");
const FRAMER_API_KEY = requireEnv("FRAMER_API_KEY");
const FRAMER_PROJECT_URL = requireEnv("FRAMER_PROJECT_URL"); // es. https://framer.com/projects/xxxxx
const FRAMER_COLLECTION_ID = requireEnv("FRAMER_COLLECTION_ID");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Manca la variabile d'ambiente ${name}. Controlla il README.md.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// 2. MAPPATURA DEI CAMPI — QUESTA È LA PARTE DA PERSONALIZZARE PER TE.
//
//    A sinistra: il nome esatto della proprietà così com'è scritta in Notion.
//    A destra: l'ID del campo Framer corrispondente (lo trovi con lo script
//    list-fields.mjs incluso in questa cartella, vedi README.md).
// ---------------------------------------------------------------------------

const FIELD_MAP = {
  // "Nome proprietà su Notion": "id-campo-framer"
  //
  // Gli ID a destra sono già quelli reali della tua Collection "Elenco
  // Articoli" (li abbiamo presi dall'output di list-fields.mjs). I nomi a
  // sinistra invece sono la mia ipotesi di come si chiamano le colonne nel
  // TUO database Notion: controllali e correggili se sul tuo Notion si
  // chiamano diversamente (es. "Autore" potrebbe essere "Scritto da").
  Titolo: "title",
  Contenuto: "page-content",
  Estratto: "HOSi",
  Categoria: "Qi%3Ek",
  "Data di pubblicazione": "GuES",
  Copertina: "LgrJ",
  Slug: "_S%40W",
  Autore: "yhUL",
  "In evidenza": "G%40%3Cl",
};

// Campi che su Framer sono di tipo "enum": per questi non si può scrivere il
// testo libero, ma serve l'ID dell'opzione corrispondente. Lo script lo
// risolve da solo leggendo le opzioni disponibili nel campo, purché il testo
// scritto su Notion corrisponda ESATTAMENTE (stessa scrittura, maiuscole
// comprese) al nome di una delle opzioni già create su Framer.
const ENUM_FIELD_IDS = new Set([
  "Qi%3Ek", // Categoria
  "tTqa", // Stato
]);

// Il campo "Stato" della Collection non arriva da Notion: dato che lo script
// sincronizza SOLO gli articoli già marcati come pronti (vedi
// NOTION_PUBLISHED_PROPERTY più sotto), ogni item sincronizzato viene sempre
// impostato su questo valore, così diventa visibile sul sito.
const FRAMER_STATO_FIELD_ID = "tTqa";
const FRAMER_STATO_VALORE_PUBBLICATO = "Pubblicato"; // deve combaciare col nome esatto dell'opzione su Framer

// Nome della proprietà Notion (tipo "Status" o "Checkbox") che indica se un
// articolo è pronto per essere pubblicato. Lo script sincronizza SOLO le
// righe che risultano pubblicabili secondo questa proprietà.
const NOTION_PUBLISHED_PROPERTY = "Pubblicato"; // adatta al nome reale

// ---------------------------------------------------------------------------
// 3. LETTURA DA NOTION
// ---------------------------------------------------------------------------

async function getPublishableNotionPages(notion) {
  const pages = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      filter: {
        property: NOTION_PUBLISHED_PROPERTY,
        checkbox: { equals: true },
      },
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// Estrae un valore "semplice" (stringa/numero/data) da una proprietà Notion,
// a seconda del suo tipo. Copre i tipi più comuni: aggiungi altri case se ti
// servono (es. select, multi_select, url...).
function extractPlainValue(property) {
  switch (property.type) {
    case "title":
      return property.title.map((t) => t.plain_text).join("");
    case "rich_text":
      return property.rich_text.map((t) => t.plain_text).join("");
    case "date":
      return property.date?.start ?? null;
    case "select":
      return property.select?.name ?? null;
    case "checkbox":
      return property.checkbox;
    case "files":
      return property.files[0]?.file?.url ?? property.files[0]?.external?.url ?? null;
    case "url":
      return property.url;
    case "number":
      return property.number;
    default:
      console.warn(`Tipo di proprietà non gestito: ${property.type}`);
      return null;
  }
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// 4. COSTRUZIONE DEGLI ITEM PER FRAMER
// ---------------------------------------------------------------------------

function buildFramerItems(notionPages, enumLookup) {
  return notionPages.map((page) => {
    const fieldData = {};

    for (const [notionPropertyName, framerFieldId] of Object.entries(FIELD_MAP)) {
      const property = page.properties[notionPropertyName];
      if (!property) {
        console.warn(
          `Proprietà "${notionPropertyName}" non trovata sulla pagina Notion ${page.id}`
        );
        continue;
      }

      let value = extractPlainValue(property);

      if (ENUM_FIELD_IDS.has(framerFieldId) && value !== null) {
        const optionId = enumLookup[framerFieldId]?.[value];
        if (!optionId) {
          console.warn(
            `Il valore "${value}" per il campo enum "${notionPropertyName}" ` +
              `non corrisponde a nessuna opzione esistente su Framer: l'item verrà salvato senza questo campo.`
          );
          continue;
        }
        value = optionId;
      }

      fieldData[framerFieldId] = value;
    }

    // Ogni item sincronizzato è per definizione "pronto" (lo abbiamo già
    // filtrato da Notion), quindi lo marchiamo come Pubblicato su Framer.
    const statoOptionId = enumLookup[FRAMER_STATO_FIELD_ID]?.[FRAMER_STATO_VALORE_PUBBLICATO];
    if (statoOptionId) {
      fieldData[FRAMER_STATO_FIELD_ID] = statoOptionId;
    } else {
      console.warn(
        `Non ho trovato l'opzione "${FRAMER_STATO_VALORE_PUBBLICATO}" nel campo Stato: ` +
          `controlla che il nome coincida esattamente con quello su Framer.`
      );
    }

    const titleProperty = Object.values(page.properties).find(
      (p) => p.type === "title"
    );
    const title = titleProperty ? extractPlainValue(titleProperty) : page.id;

    return {
      // Usiamo l'id della pagina Notion (ripulito) come id stabile dell'item:
      // così, ri-eseguendo lo script, Framer AGGIORNA l'item invece di
      // duplicarlo.
      id: `notion-${page.id.replace(/-/g, "")}`,
      slug: slugify(title),
      fieldData,
    };
  });
}

// Legge dalla Collection Framer le opzioni disponibili per ogni campo enum
// elencato in ENUM_FIELD_IDS, e costruisce una mappa "nome opzione" → "id
// opzione", da usare per tradurre il testo scritto su Notion nell'ID che
// Framer si aspetta.
async function buildEnumLookup(collection) {
  const fields = await collection.getFields();
  const lookup = {};

  for (const field of fields) {
    if (!ENUM_FIELD_IDS.has(field.id)) continue;
    const options = field.cases ?? field.options ?? [];
    lookup[field.id] = Object.fromEntries(
      options.map((option) => [option.name, option.id])
    );
  }

  return lookup;
}

// ---------------------------------------------------------------------------
// 5. MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log("→ Leggo gli articoli pubblicabili da Notion...");
  const notion = new NotionClient({ auth: NOTION_API_KEY });
  const notionPages = await getPublishableNotionPages(notion);
  console.log(`  trovati ${notionPages.length} articoli da sincronizzare`);

  if (notionPages.length === 0) {
    console.log("Nessun articolo da sincronizzare, esco senza pubblicare.");
    return;
  }

  console.log("→ Mi collego a Framer...");
  const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY);

  try {
    const collection = await framer.getCollection(FRAMER_COLLECTION_ID);

    console.log("→ Leggo le opzioni dei campi a scelta (es. Categoria)...");
    const enumLookup = await buildEnumLookup(collection);

    const items = buildFramerItems(notionPages, enumLookup);
    console.log(`→ Scrivo ${items.length} item nella Collection Framer...`);
    await collection.addItems(items);

    console.log("→ Pubblico una nuova versione del sito...");
    const { deployment } = await framer.publish();

    console.log("→ Promuovo la versione in produzione...");
    await framer.deploy(deployment.id);

    console.log("✅ Fatto! Il sito è aggiornato e pubblicato.");
  } finally {
    await framer.disconnect();
  }
}

main().catch((error) => {
  console.error("❌ Errore durante la sincronizzazione:", error);
  process.exit(1);
});
