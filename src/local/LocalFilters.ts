import type { LocalPlayer } from "./LocalPlayer";

const EQ_FREQS = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];

/**
 * Filtros de audio traducidos a filtros de FFmpeg (-af).
 * Mantiene los mismos métodos que usa el bot con lavalink-client.
 */
export class LocalFilterManager {
	public filters = {
		rotation: false,
		vibrato: false,
		tremolo: false,
		nightcore: false,
		lowPass: false,
		karaoke: false,
	};
	private params = {
		rotationHz: 0.2,
		vibratoFreq: 4,
		vibratoDepth: 0.5,
		tremoloFreq: 4,
		tremoloDepth: 0.5,
		nightcoreSpeed: 1.25,
		lowPassSmoothing: 20,
	};
	public speed = 1;
	public rate = 1;
	public pitch = 1;
	public equalizer: { band: number; gain: number }[] = [];
	private timer: NodeJS.Timeout | null = null;

	constructor(private player: LocalPlayer) {}

	/** Evita reiniciar FFmpeg varias veces si se encadenan cambios (p. ej. Reset). */
	private schedule(): boolean {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.player.refreshStream();
		}, 60);
		return true;
	}

	public get active(): boolean {
		return this.toFfmpeg() !== "";
	}

	public toFfmpeg(): string {
		const f: string[] = [];
		const p = this.params;

		const eq = this.equalizer.filter((b) => b.gain !== 0 && EQ_FREQS[b.band] !== undefined);
		for (const b of eq) {
			const db = Math.max(-24, Math.min(24, b.gain * 12));
			f.push(`equalizer=f=${EQ_FREQS[b.band]}:t=q:w=1.2:g=${db.toFixed(2)}`);
		}
		if (this.filters.rotation) f.push(`apulsator=mode=sine:hz=${p.rotationHz}`);
		if (this.filters.vibrato)
			f.push(`vibrato=f=${Math.max(0.1, p.vibratoFreq)}:d=${Math.min(1, Math.max(0, p.vibratoDepth))}`);
		if (this.filters.tremolo)
			f.push(`tremolo=f=${Math.max(0.1, p.tremoloFreq)}:d=${Math.min(1, Math.max(0, p.tremoloDepth))}`);
		if (this.filters.karaoke) f.push("pan=stereo|c0=c0-c1|c1=c1-c0");
		if (this.filters.lowPass)
			f.push(`lowpass=f=${Math.max(300, Math.round(40000 / Math.max(1, p.lowPassSmoothing)))}`);

		// Velocidad / tono: se combinan en asetrate + atempo.
		let rate = this.rate;
		let tempo = this.speed;
		if (this.filters.nightcore) rate *= p.nightcoreSpeed;
		if (this.pitch !== 1) {
			rate *= this.pitch;
			tempo /= this.pitch;
		}
		if (rate !== 1) f.push(`asetrate=${Math.round(48000 * rate)}`, "aresample=48000");
		tempo = Math.max(0.25, Math.min(4, tempo));
		while (tempo > 2) {
			f.push("atempo=2");
			tempo /= 2;
		}
		while (tempo < 0.5) {
			f.push("atempo=0.5");
			tempo /= 0.5;
		}
		if (Math.abs(tempo - 1) > 0.001) f.push(`atempo=${tempo.toFixed(4)}`);

		return f.join(",");
	}

	private flip(key: keyof LocalFilterManager["filters"]): boolean {
		this.filters[key] = !this.filters[key];
		return this.schedule();
	}

	public async toggleRotation(hz?: number) {
		if (hz !== undefined) this.params.rotationHz = hz;
		return this.flip("rotation");
	}
	public async toggleVibrato(frequency?: number, depth?: number) {
		if (frequency !== undefined) this.params.vibratoFreq = frequency;
		if (depth !== undefined) this.params.vibratoDepth = depth;
		return this.flip("vibrato");
	}
	public async toggleTremolo(frequency?: number, depth?: number) {
		if (frequency !== undefined) this.params.tremoloFreq = frequency;
		if (depth !== undefined) this.params.tremoloDepth = depth;
		return this.flip("tremolo");
	}
	public async toggleNightcore(speed?: number) {
		if (speed !== undefined) this.params.nightcoreSpeed = speed;
		return this.flip("nightcore");
	}
	public async toggleLowPass(smoothing?: number) {
		if (smoothing !== undefined) this.params.lowPassSmoothing = smoothing;
		return this.flip("lowPass");
	}
	public async toggleKaraoke(..._args: unknown[]) {
		return this.flip("karaoke");
	}
	public async setSpeed(speed = 1) {
		this.speed = speed;
		return this.schedule();
	}
	public async setRate(rate = 1) {
		this.rate = rate;
		return this.schedule();
	}
	public async setPitch(pitch = 1) {
		this.pitch = pitch;
		return this.schedule();
	}
	public async setEQ(bands: { band: number; gain: number }[] | { band: number; gain: number }) {
		this.equalizer = (Array.isArray(bands) ? bands : [bands]).map((b) => ({ band: b.band, gain: b.gain }));
		return this.schedule();
	}
	public async clearEQ() {
		this.equalizer = [];
		return this.schedule();
	}
	public async resetFilters() {
		for (const k of Object.keys(this.filters) as (keyof typeof this.filters)[]) this.filters[k] = false;
		this.speed = 1;
		this.rate = 1;
		this.pitch = 1;
		this.schedule();
		return this;
	}
}
