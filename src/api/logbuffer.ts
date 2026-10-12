/**
 * Captura en memoria las últimas líneas que el proceso escribe en stdout/stderr
 * para poder verlas desde el panel web (Heroku no deja leer sus logs desde fuera).
 */
const MAX_LINES = 600;
// biome-ignore lint/suspicious/noControlCharactersInRegex: quitar secuencias ANSI
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export interface LogLine {
	t: number;
	proc: string;
	line: string;
}

const lines: LogLine[] = [];
let installed = false;
let proc = "manager";
let pending = "";

function push(chunk: string) {
	pending += chunk;
	const parts = pending.split(/\r?\n/);
	pending = parts.pop() ?? "";
	for (const raw of parts) {
		const line = raw.replace(ANSI, "").trim();
		if (!line) continue;
		lines.push({ t: Date.now(), proc, line: line.slice(0, 600) });
		if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
	}
}

export function installLogBuffer(label: string): void {
	proc = label;
	if (installed) return;
	installed = true;
	for (const stream of [process.stdout, process.stderr]) {
		const original = stream.write.bind(stream) as (...a: any[]) => boolean;
		(stream as any).write = (chunk: any, ...rest: any[]) => {
			try {
				push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			} catch {
				// nunca debe romper el logging real
			}
			return original(chunk, ...rest);
		};
	}
}

export function getLogs(limit = 200): LogLine[] {
	return lines.slice(-Math.max(1, Math.min(limit, MAX_LINES)));
}
