// Equivalent of mmr.py: builds a tiny in-memory vector store and compares
// plain similarity search against MMR search for the same query.
import { Document } from "@langchain/core/documents";
import { createInMemoryStore, similaritySearch, mmrSearch } from "../src/services/vectorStore.js";

const docs = [
  new Document({ pageContent: "Gradient descent is an optimization algorithm used in machine learning." }),
  new Document({ pageContent: "Gradient descent minimizes the loss function." }),
  new Document({ pageContent: "Gradient descent is an optimization that minimizes the loss function." }),
  new Document({ pageContent: "Neural networks use gradient descent for training." }),
  new Document({ pageContent: "Support Vector Machines are supervised learning algorithms." }),
];

async function main() {
  const store = await createInMemoryStore(docs);

  console.log("\n===== Similarity Search Results =====\n");
  const similarityDocs = await similaritySearch(store, "What is gradient descent?", 3);
  similarityDocs.forEach((d) => console.log(d.pageContent));

  console.log("\n===== MMR Results =====\n");
  const mmrDocs = await mmrSearch(store, "What is gradient descent?", { k: 3 });
  mmrDocs.forEach((d) => console.log(d.pageContent));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
