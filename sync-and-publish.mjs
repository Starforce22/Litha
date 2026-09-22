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
  // "Nome proprietà Notion": "id-campo-framer"
  Titolo: "TODO_INCOLLA_ID_TITOLO",
  Contenuto: "TODO_INCOLLA_ID_CONTENUTO",
  Categoria: "TODO_INCOLLA_ID_CATEGORIA",
  "Data pubblicazione": "TODO_INCOLLA_ID_DATA",
  Copertina: "TODO_INCOLLA_ID_IMMAGINE",
};

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

function buildFramerItems(notionPages) {
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
      fieldData[framerFieldId] = extractPlainValue(property);
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

    const items = buildFramerItems(notionPages);
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
