import fs from "node:fs/promises";
import { createApp } from "./src/app.js";
import { config, configProblems } from "./src/config/index.js";
import { migrate, pool } from "./src/db/pool.js";
import { failInterruptedSources } from "./src/db/store.js";

async function main() {
  await fs.mkdir(config.paths.uploadDir, { recursive: true });
  await fs.mkdir(config.paths.originalsDir, { recursive: true });

  for (const problem of configProblems()) console.warn(`⚠️  ${problem}`);

  try {
    await migrate();
    console.log("🐘 Connected to PostgreSQL — schema is up to date");
    const interrupted = await failInterruptedSources();
    if (interrupted) console.warn(`⚠️  ${interrupted} source(s) were mid-processing when the server stopped — marked as failed; re-process them.`);
  } catch (err) {
    console.error(`❌ Could not connect to PostgreSQL: ${err.message}`);
    console.error("   Check DATABASE_URL (or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) in backend/.env");
    process.exit(1);
  }

  if (!config.ai.apiKey) {
    console.warn(`⚠️  ${config.ai.apiKeyName} is not set — adding sources and chat will fail until it's in .env`);
  } else {
    console.log(`🤖 AI provider: ${config.ai.provider} (chat=${config.ai.chatModel}, embeddings=${config.ai.embeddingModel})`);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`✅ CourseMate AI backend running at http://localhost:${config.port}`);
  });

  const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
