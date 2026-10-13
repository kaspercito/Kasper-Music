import { ShardEvents, ShardingManager } from "discord.js";
import { env } from "./env";
import { launch } from "./LavaClient";
import { startPanelServer } from "./api/manager";
import logger from "./structures/Logger";

/**
 * Starts the Sharding Manager
 */
export async function start() {
	// Por defecto TODO corre en un solo proceso (ahorra ~150 MB de RAM; ideal para Heroku de 512 MB).
	// Con USE_SHARDING=true vuelve el ShardingManager (solo hace falta con miles de servidores).
	if (process.env.USE_SHARDING !== "true") {
		let client: Awaited<ReturnType<typeof launch>> | null = null;
		try {
			startPanelServer(null, () => client);
		} catch (error) {
			logger.error("[PANEL] No se pudo iniciar el panel:", error);
		}
		try {
			client = await launch();
			logger.start("[MANAGER] Bot iniciado en un solo proceso.");
		} catch (error) {
			logger.error("[MANAGER] Error al iniciar el bot:", error);
			process.exit(1);
		}
		return;
	}

	const shardPath = process.argv[1];

	const manager = new ShardingManager(shardPath, {
		respawn: true,
		token: env.TOKEN,
		totalShards: "auto",
		shardList: "auto",
		execArgv: ["--smol"],
	});

	manager.on("shardCreate", (shard) => {
		logger.info(`[MANAGER] Launching Shard ${shard.id}...`);

		shard.on(ShardEvents.Ready, () => {
			logger.start(`[MANAGER] Shard ${shard.id} connected to Discord's Gateway.`);
		});

		shard.on(ShardEvents.Death, () => {
			logger.error(`[MANAGER] Shard ${shard.id} died unexpectedly.`);
		});

		shard.on(ShardEvents.Error, (err) => {
			logger.error(`[MANAGER] Shard ${shard.id} error:`, err);
		});
	});

	// El servidor del panel debe abrir el puerto YA (Heroku exige hacerlo en menos de 60 s).
	try {
		startPanelServer(manager);
	} catch (error) {
		logger.error("[PANEL] No se pudo iniciar el panel:", error);
	}

	try {
		// Disable timeout to allow heavy DB initialization (prevent ShardingReadyDied)
		await manager.spawn({ timeout: -1 });
		const totalShards = manager.shards.size;
		logger.start(
			`[MANAGER] ${totalShards} shard${totalShards > 1 ? "s" : ""} spawned successfully.`,
		);
	} catch (error) {
		logger.error("[MANAGER] Failed to spawn shards:", error);
	}
}
