import type { LocalTrack } from "./sources";

/** Cola compatible con la API de lavalink-client que usa el bot. */
export class LocalQueue {
	public tracks: LocalTrack[] = [];
	public previous: LocalTrack[] = [];
	public current: LocalTrack | null = null;
	public maxPrevious: number;

	public utils = {
		/** Duración total (canción actual + pendientes), en ms. */
		totalDuration: (): number =>
			(this.current?.info.duration ?? 0) + this.tracks.reduce((a, t) => a + (t.info.duration || 0), 0),
	};

	constructor(maxPrevious = 25) {
		this.maxPrevious = maxPrevious;
	}

	public async add(toAdd: LocalTrack | LocalTrack[], index?: number): Promise<number> {
		const list = Array.isArray(toAdd) ? toAdd : [toAdd];
		if (typeof index === "number" && index >= 0 && index <= this.tracks.length) {
			this.tracks.splice(index, 0, ...list);
		} else {
			this.tracks.push(...list);
		}
		return this.tracks.length;
	}

	public async splice(
		index: number,
		amount: number,
		...toAdd: (LocalTrack | LocalTrack[])[]
	): Promise<LocalTrack[]> {
		const flat = toAdd.flat();
		return this.tracks.splice(index, amount, ...flat);
	}

	public remove(index: number): LocalTrack | null {
		if (index < 0 || index >= this.tracks.length) return null;
		return this.tracks.splice(index, 1)[0] ?? null;
	}

	public shuffle(): number {
		for (let i = this.tracks.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
		}
		return this.tracks.length;
	}

	public pushPrevious(track: LocalTrack): void {
		this.previous.unshift(track);
		if (this.previous.length > this.maxPrevious) this.previous.length = this.maxPrevious;
	}
}
