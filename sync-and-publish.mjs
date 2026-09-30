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
import sharp from "sharp";

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

// Servono per "mirrorare" le immagini di copertina su GitHub in modo
// permanente, dato che i link di Notion scadono dopo circa un'ora. Su
// GitHub Actions, GITHUB_REPOSITORY è già disponibile in automatico; basta
// passare esplicitamente GITHUB_TOKEN (il token integrato di Actions, non
// serve crearne uno nuovo) — vedi README.md per come abilitarlo.
const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const GITHUB_REPOSITORY = requireEnv("GITHUB_REPOSITORY"); // formato "utente/repo"
const GITHUB_BRANCH = process.env.GITHUB_ASSET_BRANCH || "main";

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
  Titolo: "DNjJrqRRS",
  Estratto: "HI2mtYr87",
  Categoria: "yDTLObBo6",
  "Data di pubblicazione": "HmUZDQnsm",
  Copertina: "HcIoGcJgE",
  Slug: "mQ9xbTI8t",
  Autore: "ElHA9CYzt",
  Numero: "TODO_AGGIORNA_DOPO_SETUP_NUMERO",
};

// Il campo "Contenuto" è un caso speciale: nella maggior parte dei database
// Notion il testo dell'articolo non è una proprietà a colonna, ma il CORPO
// della pagina stessa (i blocchi che scrivi aprendo la riga). Per questo lo
// script lo gestisce a parte, leggendo i blocchi della pagina invece di una
// proprietà — vedi getPageBodyAsMarkdown più sotto.
const FRAMER_CONTENT_FIELD_ID = "cSe1aZScB";

// Campi che su Framer sono di tipo "enum": per questi non si può scrivere il
// testo libero, ma serve l'ID dell'opzione corrispondente. Lo script lo
// risolve da solo leggendo le opzioni disponibili nel campo, purché il testo
// scritto su Notion corrisponda ESATTAMENTE (stessa scrittura, maiuscole
// comprese) al nome di una delle opzioni già create su Framer.
const ENUM_FIELD_IDS = new Set([
  "yDTLObBo6", // Categoria
  "KbxpGcjwm", // Stato
]);

// Il campo "Stato" della Collection non arriva da Notion: dato che lo script
// sincronizza SOLO gli articoli già marcati come pronti (vedi
// NOTION_PUBLISHED_PROPERTY più sotto), ogni item sincronizzato viene sempre
// impostato su questo valore, così diventa visibile sul sito.
const FRAMER_STATO_FIELD_ID = "KbxpGcjwm";
const FRAMER_STATO_VALORE_PUBBLICATO = "Pubblicato"; // deve combaciare col nome esatto dell'opzione su Framer

// Nome della proprietà Notion che indica se un articolo è pronto per essere
// pubblicato, e valore che deve avere per considerarlo tale. Lo script
// rileva da solo se la proprietà è di tipo "status" o "select".
const NOTION_PUBLISHED_PROPERTY = "Stato";
const NOTION_PUBLISHED_VALUE = "Pubblicato";

// Numerazione automatica progressiva ("stile Pokédex"): il numero viene
// assegnato UNA SOLA VOLTA per articolo e scritto permanentemente su questa
// proprietà Notion, così resta stabile anche nei sync futuri. Va creata con
// setup-numero-field.mjs prima di usare questa funzionalità.
const NOTION_NUMBER_PROPERTY = "Numero";
// Proprietà usata per decidere l'ordine con cui assegnare i numeri ai nuovi
// articoli (i più vecchi ricevono i numeri più bassi).
const NOTION_DATE_PROPERTY_FOR_ORDERING = "Data di pubblicazione";
// ID del campo Framer "NumeroDisplay" (testo già formattato, es. "#007").
// Aggiornalo dopo aver lanciato setup-numero-field.mjs + list-fields.mjs.
const FRAMER_NUMERO_DISPLAY_FIELD_ID = "TODO_AGGIORNA_DOPO_SETUP_NUMERO";

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

// Assegna un numero progressivo a ogni pagina che non ne ha ancora uno,
// scrivendolo PERMANENTEMENTE su Notion (non viene mai ricalcolato dopo).
// I nuovi articoli vengono numerati in ordine di data di pubblicazione,
// proseguendo dal numero più alto già assegnato finora.
async function assignArticleNumbers(notion, pages) {
  const withNumber = pages.filter(
    (p) => p.properties[NOTION_NUMBER_PROPERTY]?.number != null
  );
  const withoutNumber = pages.filter(
    (p) => p.properties[NOTION_NUMBER_PROPERTY]?.number == null
  );

  let currentMax = withNumber.reduce(
    (max, p) => Math.max(max, p.properties[NOTION_NUMBER_PROPERTY].number),
    0
  );

  withoutNumber.sort((a, b) => {
    const dateA =
      a.properties[NOTION_DATE_PROPERTY_FOR_ORDERING]?.date?.start ?? a.created_time;
    const dateB =
      b.properties[NOTION_DATE_PROPERTY_FOR_ORDERING]?.date?.start ?? b.created_time;
    return new Date(dateA) - new Date(dateB);
  });

  for (const page of withoutNumber) {
    currentMax += 1;
    console.log(`  assegno il numero ${currentMax} alla pagina ${page.id}`);
    await notion.pages.update({
      page_id: page.id,
      properties: { [NOTION_NUMBER_PROPERTY]: { number: currentMax } },
    });
    // Aggiorniamo anche l'oggetto in memoria, così il resto dello script
    // vede subito il valore senza dover rileggere da Notion.
    page.properties[NOTION_NUMBER_PROPERTY] = { type: "number", number: currentMax };
  }
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

// ---------------------------------------------------------------------------
// MIRRORING DELLE IMMAGINI SU GITHUB
//
// I link ai file caricati su Notion sono temporanei (scadono dopo circa
// un'ora). Per non ritrovarsi con copertine rotte, questa funzione scarica
// l'immagine, la ottimizza (ridimensiona + converte in WebP compresso), e la
// carica in modo permanente dentro il repository stesso, sotto la cartella
// assets/covers/. Restituisce l'URL pubblico e stabile su
// raw.githubusercontent.com da passare a Framer al posto del link Notion.
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const MAX_IMAGE_WIDTH = 1600; // px: oltre non serve, per un blog è già di più del necessario
const IMAGE_QUALITY = 80; // 0-100: buon compromesso qualità/peso per WebP

async function mirrorImageToGitHub(sourceUrl, assetPath) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Impossibile scaricare l'immagine da Notion: ${response.status}`);
  }
  const originalBuffer = Buffer.from(await response.arrayBuffer());

  const optimizedBuffer = await sharp(originalBuffer)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();

  // Se il file esiste già (da un sync precedente), serve il suo "sha"
  // corrente per poterlo sovrascrivere: GitHub lo richiede per evitare
  // sovrascritture accidentali fatte "alla cieca".
  let existingSha;
  const getResponse = await fetch(`${GITHUB_API_BASE}/contents/${assetPath}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (getResponse.ok) {
    existingSha = (await getResponse.json()).sha;
  } else if (getResponse.status !== 404) {
    throw new Error(`Errore nel controllare il file esistente su GitHub: ${getResponse.status}`);
  }

  const putResponse = await fetch(`${GITHUB_API_BASE}/contents/${assetPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      message: `Aggiorna asset immagine: ${assetPath}`,
      content: optimizedBuffer.toString("base64"),
      branch: GITHUB_BRANCH,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`Errore nel caricare l'immagine su GitHub: ${putResponse.status} — ${body}`);
  }

  return `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${GITHUB_BRANCH}/${assetPath}`;
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

async function buildFramerItems(notion, notionPages, enumLookup, fieldTypes, existingIdsBySlug) {
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

      // Le immagini vengono "mirrorate" su GitHub: il link di Notion scade
      // dopo circa un'ora, quindi non possiamo passarlo direttamente a
      // Framer così com'è.
      if (fieldTypes[framerFieldId] === "image" && typeof value === "string" && value) {
        const assetPath = `assets/covers/notion-${page.id.replace(/-/g, "")}.webp`;
        try {
          value = await mirrorImageToGitHub(value, assetPath);
        } catch (error) {
          console.warn(
            `Impossibile mirrorare l'immagine per la pagina ${page.id}: ${error.message}. ` +
              `Il campo verrà saltato per questo sync.`
          );
          continue;
        }
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

    // NumeroDisplay: testo già formattato (es. "#007"), comodo da mostrare
    // direttamente su Framer senza bisogno di logica di formattazione lì.
    const numero = page.properties[NOTION_NUMBER_PROPERTY]?.number;
    if (numero != null) {
      fieldData[FRAMER_NUMERO_DISPLAY_FIELD_ID] = wrapFieldValue(
        "string",
        `#${String(numero).padStart(3, "0")}`
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
    const slug = slugify(title);

    // Su una Collection normale (non gestita), addItems tratta l'id in
    // modo diverso da come funziona sulle Managed Collection: un id
    // "inventato" da noi che non esiste già viene rifiutato. Quindi lo
    // includiamo SOLO se esiste già un item con lo stesso slug (per
    // aggiornarlo); per i nuovi articoli lo omettiamo del tutto e lasciamo
    // che sia Framer ad assegnarne uno.
    const item = { slug, fieldData };
    const existingId = existingIdsBySlug.get(slug);
    if (existingId) item.id = existingId;

    items.push(item);
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

  console.log("→ Assegno un numero progressivo ai nuovi articoli, se necessario...");
  await assignArticleNumbers(notion, notionPages);

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

    console.log("→ Leggo gli item già presenti nella Collection (per capire cosa aggiornare)...");
    const existingItems = await collection.getItems();
    const existingIdsBySlug = new Map(existingItems.map((item) => [item.slug, item.id]));

    console.log("→ Leggo il corpo di ogni articolo da Notion...");
    const items = await buildFramerItems(notion, notionPages, enumLookup, fieldTypes, existingIdsBySlug);

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
