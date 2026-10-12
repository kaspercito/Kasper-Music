/** Mensajes IPC entre el manager (servidor HTTP) y cada shard (cliente de Discord). */
export interface PanelRequest {
	__panel: true;
	id: string;
	action: string;
	args: Record<string, any>;
}

export interface PanelReply {
	__panelReply: true;
	id: string;
	shard: number;
	/** true cuando esta shard no tiene el servidor pedido. */
	skip?: boolean;
	ok?: boolean;
	data?: unknown;
	error?: string;
	/** Código HTTP sugerido cuando ok = false. */
	status?: number;
}

export class PanelError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}
