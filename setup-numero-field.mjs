// setup-numero-field.mjs
//
// Script "usa e getta": crea la proprietà "Numero" sul database Notion, e i
// campi corrispondenti "Numero" e "NumeroDisplay" sulla Collection Framer.
// Lo lanci una volta sola, prima di usare la numerazione automatica dentro
// sync-and-publish.mjs.

import { Client as NotionClient } from "@notionhq/client";
import { connect } from "framer-api";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const FRAMER_API_KEY = process.env.FRAMER_API_KEY;
const FRAMER_PROJECT_URL = process.env.FRAMER_PROJECT_URL;
const FRAMER_COLLECTION_ID = process.env.FRAMER_COLLECTION_ID;

for (const [name, value] of Object.entries({
  NOTION_API_KEY,
  NOTION_DATABASE_ID,
  FRAMER_API_KEY,
  FRAMER_PROJECT_URL,
  FRAMER_COLLECTION_ID,
})) {
  if (!value) {
    console.error(`Manca la variabile d'ambiente ${name}.`);
    process.exit(1);
  }
}

// --- Notion: aggiunge la proprietà "Numero" (tipo Number) -----------------

console.log('→ Aggiungo la proprietà "Numero" al database Notion...');
const notion = new NotionClient({ auth: NOTION_API_KEY });

const database = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
if (database.properties["Numero"]) {
  console.log('  la proprietà "Numero" esiste già su Notion, non la ricreo.');
} else {
  await notion.databases.update({
    database_id: NOTION_DATABASE_ID,
    properties: {
      Numero: { number: { format: "number" } },
    },
  });
  console.log('  fatto.');
}

// --- Framer: aggiunge i campi "Numero" e "NumeroDisplay" -------------------

console.log("→ Aggiungo i campi alla Collection Framer...");
const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY);

try {
  const collection = await framer.getCollection(FRAMER_COLLECTION_ID);
  const existingFields = await collection.getFields();
  const existingNames = new Set(existingFields.map((f) => f.name));

  const fieldsToAdd = [];
  if (!existingNames.has("Numero")) fieldsToAdd.push({ name: "Numero", type: "number" });
  if (!existingNames.has("NumeroDisplay")) fieldsToAdd.push({ name: "NumeroDisplay", type: "string" });

  if (fieldsToAdd.length === 0) {
    console.log("  i campi esistono già su Framer, non li ricreo.");
  } else {
    await collection.addFields(fieldsToAdd);
    console.log(`  aggiunti ${fieldsToAdd.length} campi.`);
  }

  console.log("\n✅ Fatto! Rilancia list-fields.mjs per ottenere gli ID dei nuovi campi.");
} finally {
  await framer.disconnect();
}
