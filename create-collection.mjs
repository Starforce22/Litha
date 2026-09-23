// create-collection.mjs
//
// Script "usa e getta": crea una NUOVA Collection su Framer, non gestita da
// nessun plugin, replicando gli stessi campi (nomi, tipi e opzioni) della
// Collection "Elenco Articoli" attuale. Questa nuova Collection sarà quella
// su cui sync-and-publish.mjs potrà scrivere liberamente.
//
// Dopo averlo lanciato dovrai:
//   1. Prendere nota del nuovo ID di Collection stampato in fondo
//   2. Aggiornare il secret FRAMER_COLLECTION_ID su GitHub con quel valore
//   3. Rilanciare list-fields.mjs per avere i nuovi ID dei campi
//   4. Aggiornare FIELD_MAP in sync-and-publish.mjs con quei nuovi ID
//   5. (passaggio manuale, solo tu puoi farlo) Dentro l'editor Framer,
//      selezionare la lista/pagina articoli sul canvas e ricollegarla alla
//      nuova Collection al posto di "Elenco Articoli"

import { connect } from "framer-api";

const FRAMER_API_KEY = process.env.FRAMER_API_KEY;
const FRAMER_PROJECT_URL = process.env.FRAMER_PROJECT_URL;
const OLD_COLLECTION_ID = process.env.OLD_COLLECTION_ID || "bb6ycoqF5"; // "Elenco Articoli"
const NEW_COLLECTION_NAME = process.env.NEW_COLLECTION_NAME || "Articoli (sync automatico)";

if (!FRAMER_API_KEY || !FRAMER_PROJECT_URL) {
  console.error("Imposta FRAMER_API_KEY e FRAMER_PROJECT_URL prima di lanciare questo script.");
  process.exit(1);
}

const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY);

try {
  console.log(`→ Leggo i campi della Collection esistente (${OLD_COLLECTION_ID})...`);
  const oldCollection = await framer.getCollection(OLD_COLLECTION_ID);
  const oldFields = await oldCollection.getFields();

  console.log(`→ Creo la nuova Collection "${NEW_COLLECTION_NAME}"...`);
  const newCollection = await framer.createCollection(NEW_COLLECTION_NAME);

  // Il campo "titolo" esiste già di default su ogni nuova Collection, quindi
  // lo saltiamo per evitare un duplicato.
  const fieldsToCreate = oldFields
    .filter((f) => f.type !== "unsupported" && f.name.toLowerCase() !== "title" && f.id !== "title")
    .map((f) => {
      const definition = { name: f.name, type: f.type };
      if (f.type === "enum") {
        definition.cases = (f.cases ?? f.options ?? []).map((c) => ({ name: c.name }));
      }
      return definition;
    });

  console.log(`→ Aggiungo ${fieldsToCreate.length} campi alla nuova Collection...`);
  await newCollection.addFields(fieldsToCreate);

  console.log("\n✅ Fatto! Nuova Collection creata.");
  console.log(`   ID della nuova Collection: ${newCollection.id}`);
  console.log("\nProssimi passi:");
  console.log("  1. Aggiorna il secret FRAMER_COLLECTION_ID su GitHub con l'ID qui sopra");
  console.log("  2. Rilancia list-fields.mjs per ottenere i nuovi ID dei campi");
  console.log("  3. Aggiorna FIELD_MAP in sync-and-publish.mjs con quei nuovi ID");
  console.log("  4. Nell'editor Framer, ricollega la lista/pagina articoli a questa nuova Collection");
} finally {
  await framer.disconnect();
}
