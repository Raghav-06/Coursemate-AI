// Creates/updates the PostgreSQL tables:  npm run db:migrate
import { migrate, pool } from "../src/db/pool.js";

migrate()
  .then(() => console.log("✅ Database schema is up to date."))
  .catch((err) => {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
