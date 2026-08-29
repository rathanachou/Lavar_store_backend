# Deploy Checklist

## Before Deploying (schema-changing commits)

Any commit that touches `migrations/`, `models/`, or `src/utils/batchStock.js` must follow these steps **before** pushing to `main`:

1. **Verify pending migrations against production:**
   ```bash
   DATABASE_URL="<from Render environment>" npx sequelize-cli db:migrate:status --env production
   ```
   Look for any migration files listed as `down` (not yet applied). All migrations in the `migrations/` folder must show as `up` before the code that depends on them is deployed.

2. **Apply pending migrations to production:**
   ```bash
   DATABASE_URL="<from Render environment>" npx sequelize-cli db:migrate --env production
   ```
   Run this **before** the deploy reaches production traffic. Migrations should be applied atomically with the deploy, not after.

3. **Verify after migrating:**
   ```bash
   DATABASE_URL="<from Render environment>" npx sequelize-cli db:migrate:status --env production
   ```
   Confirm zero pending migrations.

4. **Deploy the code:**
   ```bash
   git push origin main
   ```

## Why This Is Necessary

This project does **not** auto-run migrations on deploy:
- No `render.yaml` with release commands
- No `postinstall` hook in `package.json` (intentionally — `postinstall` runs on every `npm install` locally, which could accidentally hit production if `.env` points there)
- The server starts without running migrations; Sequelize does not validate schema at boot

If migrations are not applied before the code that depends on them reaches production, you will see runtime errors like:

```
column "userId" does not exist (Postgres error code 42703)
```

## Finding Your Production DATABASE_URL

1. Open the Render dashboard → your service → **Environment** tab
2. Copy the value of `DATABASE_URL`
3. Use it in the commands above:
   ```bash
   export DATABASE_URL="<paste value here>"
   ```

## Runtime Warning

The server logs a `⚠️⚠️⚠️ PENDING MIGRATIONS DETECTED ⚠️⚠️⚠️` warning at startup if SequelizeMeta is behind the `migrations/` folder. This is informational only — it does not block startup or run migrations automatically. If you see this warning in production logs, run the migration command above immediately.

## Future Improvement

Consider creating a separate Neon database branch for local development. Currently the local `.env` points directly at the production Neon database, which means any local script, seed, or migration run without specifying a different `DATABASE_URL` affects live data. A local dev branch eliminates this risk entirely.
