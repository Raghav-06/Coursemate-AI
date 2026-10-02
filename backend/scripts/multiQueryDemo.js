// Multi-query retrieval demo: uses the LLM to generate query variations and
// merges the retrieved results.
import { Document } from "@langchain/core/documents";
import { createInMemoryStore, similaritySearch } from "../src/services/vectorStore.js";
import { complete } from "../src/services/llm.js";

const docs = [
  new Document({ pageContent: "Gradient descent is an optimization algorithm used in machine learning." }),
  new Document({ pageContent: "Gradient descent minimizes the loss function." }),
  new Document({ pageContent: "Gradient descent is an optimization that minimizes the loss function." }),
  new Document({ pageContent: "Neural networks use gradient descent for training." }),
  new Document({ pageContent: "Support Vector Machines are supervised learning algorithms." }),
];

async function generateQueryVariants(question) {
  const response = await complete(
    "Generate 3 different phrasings of the user's question to help retrieve relevant documents. Reply with one phrasing per line, no numbering or extra text.",
    question
  );
  return response
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const store = await createInMemoryStore(docs);

  const query = "What is gradient descent?";
  const variants = await generateQueryVariants(query);

  console.log("Generated query variants:\n", variants);

  const seen = new Set();
  const merged = [];
  for (const q of [query, ...variants]) {
    const results = await similaritySearch(store, q, 3);
    for (const doc of results) {
      if (!seen.has(doc.pageContent)) {
        seen.add(doc.pageContent);
        merged.push(doc);
      }
    }
  }

  console.log("\nRetrieved Documents:\n");
  merged.forEach((d) => console.log(d.pageContent));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
