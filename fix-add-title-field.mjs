// fix-add-title-field.mjs
//
// Script "usa e getta": aggiunge il campo "Titolo" (string) mancante alla
// Collection creata da create-collection.mjs, che per sbaglio lo aveva
// escluso pensando fosse già presente di default.

import { connect } from "framer-api";

const FRAMER_API_KEY = process.env.FRAMER_API_KEY;
const FRAMER_PROJECT_URL = process.env.FRAMER_PROJECT_URL;
const COLLECTION_ID = process.env.FRAMER_COLLECTION_ID;

if (!FRAMER_API_KEY || !FRAMER_PROJECT_URL || !COLLECTION_ID) {
  console.error(
    "Imposta FRAMER_API_KEY, FRAMER_PROJECT_URL e FRAMER_COLLECTION_ID prima di lanciare questo script."
  );
  process.exit(1);
}

const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY);

try {
  const collection = await framer.getCollection(COLLECTION_ID);
  const fields = await collection.getFields();

  const alreadyExists = fields.some((f) => f.name === "Titolo");
  if (alreadyExists) {
    console.log("Il campo Titolo esiste già, non serve aggiungerlo.");
  } else {
    console.log("→ Aggiungo il campo Titolo...");
    await collection.addFields([{ name: "Titolo", type: "string" }]);
    console.log("✅ Fatto! Rilancia list-fields.mjs per vedere il suo nuovo ID.");
  }
} finally {
  await framer.disconnect();
}
