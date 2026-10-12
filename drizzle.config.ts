import type { Config } from "drizzle-kit";
import { env } from "./src/env";

if (!env.DATABASE_URL) env.DATABASE_URL = "file:./lavamusic-pgdata";

const isPgLite =
	!env.DATABASE_URL.startsWith("postgres://") && !env.DATABASE_URL.startsWith("postgresql://");

// Heroku Postgres exige SSL (certificado autofirmado): se añade sslmode=no-verify si falta.
let dbUrl = env.DATABASE_URL;
if (!isPgLite) {
	const isLocalDb = /@(localhost|127\.0\.0\.1|postgres|db)(:|\/)/.test(dbUrl);
	if (!isLocalDb && !/[?&](ssl|sslmode)=/.test(dbUrl)) {
		dbUrl += `${dbUrl.includes("?") ? "&" : "?"}sslmode=no-verify`;
	}
}

const config: Config = {
	out: "./drizzle/postgres",
	schema: "./src/database/schemas.ts",
	dialect: "postgresql",
	dbCredentials: { url: dbUrl },
};

// Only add driver for PGLite
if (isPgLite) {
	config.driver = "pglite";
}

export default config;
