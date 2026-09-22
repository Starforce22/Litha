// list-fields.mjs
//
// Script "usa e getta": lo lanci una volta sola per scoprire gli ID di cui
// hai bisogno per compilare il FIELD_MAP dentro sync-and-publish.mjs e le
// variabili d'ambiente FRAMER_COLLECTION_ID.
//
// Uso:
//   FRAMER_API_KEY=xxx FRAMER_PROJECT_URL=https://framer.com/projects/xxxxx node list-fields.mjs

import { connect } from "framer-api";

const FRAMER_API_KEY = process.env.FRAMER_API_KEY;
const FRAMER_PROJECT_URL = process.env.FRAMER_PROJECT_URL;

if (!FRAMER_API_KEY || !FRAMER_PROJECT_URL) {
  console.error(
    "Imposta FRAMER_API_KEY e FRAMER_PROJECT_URL prima di lanciare questo script."
  );
  process.exit(1);
}

const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY);

try {
  const collections = await framer.getCollections();

  console.log(`\nTrovate ${collections.length} Collection nel progetto:\n`);

  for (const collection of collections) {
    console.log(`— "${collection.name}"  (id: ${collection.id})`);
    const fields = await collection.getFields();
    for (const field of fields) {
      console.log(`    campo "${field.name}"  →  id: ${field.id}  (tipo: ${field.type})`);
    }
    console.log("");
  }

  console.log(
    "Copia l'id della Collection che vuoi sincronizzare in FRAMER_COLLECTION_ID,\n" +
      "e gli id dei campi che ti servono dentro FIELD_MAP in sync-and-publish.mjs."
  );
} finally {
  await framer.disconnect();
}
