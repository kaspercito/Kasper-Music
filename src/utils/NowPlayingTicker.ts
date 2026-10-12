/**
 * Actualiza periódicamente la tarjeta "Reproduciendo ahora" para que la barra de progreso avance.
 * Un solo temporizador por servidor; se detiene solo cuando el callback devuelve false.
 */
const timers = new Map<string, ReturnType<typeof setInterval>>();

export function stopTicker(guildId: string): void {
	const t = timers.get(guildId);
	if (t) clearInterval(t);
	timers.delete(guildId);
}

export function startTicker(
	guildId: string,
	intervalMs: number,
	tick: () => Promise<boolean | undefined>,
): void {
	stopTicker(guildId);
	let busy = false;
	const timer = setInterval(async () => {
		if (busy) return;
		busy = true;
		try {
			const keepGoing = await tick();
			if (keepGoing === false) stopTicker(guildId);
		} catch {
			stopTicker(guildId);
		} finally {
			busy = false;
		}
	}, intervalMs);
	timers.set(guildId, timer);
}
