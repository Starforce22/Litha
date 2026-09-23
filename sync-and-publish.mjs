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
//    A destra: l'ID del campo Framer corrispondente (li trovi con
//    list-fields.mjs). Se il valore di una proprietà Notion non esiste per
//    una pagina, il campo viene semplicemente saltato (non causa un errore).
// ---------------------------------------------------------------------------

const FIELD_MAP = {
  Titolo: "title",
  Estratto: "HOSi",
  Categoria: "Qi%3Ek",
  "Data di pubblicazione": "GuES",
  Copertina: "LgrJ",
  Slug: "_S%40W",
  Autore: "yhUL",
};

// Il campo "Contenuto" è un caso speciale: nella maggior parte dei database
// Notion il testo dell'articolo non è una proprietà a colonna, ma il CORPO
// della pagina stessa (i blocchi che scrivi aprendo la riga). Per questo lo
// script lo gestisce a parte, leggendo i blocchi della pagina invece di una
// proprietà — vedi getPageBodyAsMarkdown più sotto.
const FRAMER_CONTENT_FIELD_ID = "page-content";

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

// Nome della proprietà Notion che indica se un articolo è pronto per essere
// pubblicato, e valore che deve avere per considerarlo tale. Lo script
// rileva da solo se la proprietà è di tipo "status" o "select".
const NOTION_PUBLISHED_PROPERTY = "Stato";
const NOTION_PUBLISHED_VALUE = "Pubblicato";

// ---------------------------------------------------------------------------
// 3. LETTURA DA NOTION
// ---------------------------------------------------------------------------

async function getPublishableNotionPages(notion) {
  const database = await notion.databases.retrieve({
    database_id: NOTION_DATABASE_ID,
  });

  const property = database.properties[NOTION_PUBLISHED_PROPERTY];
  if (!property) {
    throw new Error(
      `La proprietà "${NOTION_PUBLISHED_PROPERTY}" non esiste sul database Notion. ` +
        `Controlla il nome esatto con list-notion-properties.mjs.`
    );
  }

  let filter;
  if (property.type === "checkbox") {
    filter = { property: NOTION_PUBLISHED_PROPERTY, checkbox: { equals: true } };
  } else if (property.type === "status") {
    filter = {
      property: NOTION_PUBLISHED_PROPERTY,
      status: { equals: NOTION_PUBLISHED_VALUE },
    };
  } else if (property.type === "select") {
    filter = {
      property: NOTION_PUBLISHED_PROPERTY,
      select: { equals: NOTION_PUBLISHED_VALUE },
    };
  } else {
    throw new Error(
      `Tipo di proprietà "${property.type}" non gestito per "${NOTION_PUBLISHED_PROPERTY}". ` +
        `Aggiungi un case per questo tipo dentro getPublishableNotionPages.`
    );
  }

  const pages = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      filter,
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// Legge tutti i blocchi del corpo di una pagina Notion e li converte in un
// markdown molto semplice (paragrafi, titoli, elenchi puntati). Copre i tipi
// di blocco più comuni: aggiungi altri case se il tuo editor ne usa altri
// (es. immagini, citazioni, codice...).
async function getPageBodyAsMarkdown(notion, pageId) {
  const lines = [];
  let cursor = undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });

    for (const block of response.results) {
      const text = (block[block.type]?.rich_text ?? [])
        .map((t) => t.plain_text)
        .join("");

      switch (block.type) {
        case "paragraph":
          lines.push(text);
          break;
        case "heading_1":
          lines.push(`# ${text}`);
          break;
        case "heading_2":
          lines.push(`## ${text}`);
          break;
        case "heading_3":
          lines.push(`### ${text}`);
          break;
        case "bulleted_list_item":
          lines.push(`- ${text}`);
          break;
        case "numbered_list_item":
          lines.push(`1. ${text}`);
          break;
        case "quote":
          lines.push(`> ${text}`);
          break;
        default:
          // Blocco non gestito esplicitamente (es. immagine, codice,
          // divisore...): se contiene testo semplice lo aggiungiamo comunque
          // come paragrafo, altrimenti lo saltiamo.
          if (text) lines.push(text);
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n\n");
}

// Estrae un valore "semplice" (stringa/numero/data) da una proprietà Notion,
// a seconda del suo tipo. Copre i tipi più comuni: aggiungi altri case se ti
// servono (es. multi_select, url...).
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

// Avvolge un valore "nudo" nel formato { type, value } richiesto da Framer
// per ogni campo del CMS. È il pezzo che mancava e causava l'errore
// "invalid type on ... fieldData".
function wrapFieldValue(framerFieldType, rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  switch (framerFieldType) {
    case "formattedText":
      return { type: "formattedText", value: String(rawValue), contentType: "markdown" };
    case "boolean":
      return { type: "boolean", value: Boolean(rawValue) };
    case "number":
      return { type: "number", value: Number(rawValue) };
    case "enum":
      // rawValue qui è già l'ID dell'opzione (risolto da buildEnumLookup).
      return { type: "enum", value: rawValue };
    case "date":
    case "string":
    case "color":
    case "image":
    case "file":
    case "link":
      return { type: framerFieldType, value: rawValue };
    default:
      console.warn(`Tipo di campo Framer non gestito nel wrapping: ${framerFieldType}`);
      return { type: "string", value: String(rawValue) };
  }
}

// ---------------------------------------------------------------------------
// 4. COSTRUZIONE DEGLI ITEM PER FRAMER
// ---------------------------------------------------------------------------

async function buildFramerItems(notion, notionPages, enumLookup, fieldTypes) {
  const items = [];

  for (const page of notionPages) {
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
              `non corrisponde a nessuna opzione esistente su Framer: campo saltato.`
          );
          continue;
        }
        value = optionId;
      }

      const wrapped = wrapFieldValue(fieldTypes[framerFieldId], value);
      if (wrapped) fieldData[framerFieldId] = wrapped;
    }

    // Contenuto: letto dal corpo della pagina Notion, non da una proprietà.
    const bodyMarkdown = await getPageBodyAsMarkdown(notion, page.id);
    if (bodyMarkdown) {
      fieldData[FRAMER_CONTENT_FIELD_ID] = wrapFieldValue(
        fieldTypes[FRAMER_CONTENT_FIELD_ID],
        bodyMarkdown
      );
    }

    // Stato: sempre "Pubblicato", perché abbiamo già filtrato su Notion.
    const statoOptionId = enumLookup[FRAMER_STATO_FIELD_ID]?.[FRAMER_STATO_VALORE_PUBBLICATO];
    if (statoOptionId) {
      fieldData[FRAMER_STATO_FIELD_ID] = wrapFieldValue("enum", statoOptionId);
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

    items.push({
      id: `notion-${page.id.replace(/-/g, "")}`,
      slug: slugify(title),
      fieldData,
    });
  }

  return items;
}

// Legge dalla Collection Framer i tipi di ogni campo, e per i campi enum
// anche le opzioni disponibili (mappa "nome opzione" → "id opzione").
async function getCollectionMeta(collection) {
  const fields = await collection.getFields();
  const fieldTypes = {};
  const enumLookup = {};

  for (const field of fields) {
    fieldTypes[field.id] = field.type;
    if (ENUM_FIELD_IDS.has(field.id)) {
      const options = field.cases ?? field.options ?? [];
      enumLookup[field.id] = Object.fromEntries(
        options.map((option) => [option.name, option.id])
      );
    }
  }

  return { fieldTypes, enumLookup };
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

    console.log("→ Leggo i tipi di campo e le opzioni (es. Categoria, Stato)...");
    const { fieldTypes, enumLookup } = await getCollectionMeta(collection);

    console.log("→ Leggo il corpo di ogni articolo da Notion...");
    const items = await buildFramerItems(notion, notionPages, enumLookup, fieldTypes);

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
