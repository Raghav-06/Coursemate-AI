// Verifies the API key(s) and both the chat and embedding models (through LangChain):
//   npm run check-api
import { config } from "../src/config/index.js";
import { complete } from "../src/services/llm.js";
import { getEmbeddings } from "../src/services/embeddings.js";

async function main() {
  const { chat, embedding, chatModel, embeddingModel } = config.ai;
  console.log(`Chat:       ${chat.baseUrl}`);
  console.log(`Embeddings: ${embedding.provider}${embedding.baseUrl ? ` (${embedding.baseUrl})` : ""}`);

  process.stdout.write(`Embeddings (${embeddingModel})... `);
  const vector = await getEmbeddings().embedQuery("warm up");
  console.log(`OK — ${vector.length} dimensions`);

  process.stdout.write(`Chat (${chatModel})... `);
  const reply = await complete("You are a terse assistant.", "Reply with the single word: ready");
  console.log(`OK — "${reply}"`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
