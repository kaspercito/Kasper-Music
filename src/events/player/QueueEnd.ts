import type { TextChannel } from "discord.js";
import type { Player, Track, TrackStartEvent } from "lavalink-client";
import { Event, type Lavamusic } from "../../structures/index";
import { LavamusicEventType } from "../../types/events";
import { queueEndEmbed } from "../../utils/Embeds";
import { updateSetup } from "../../utils/SetupSystem";

export default class QueueEnd extends Event {
	constructor(client: Lavamusic, file: string) {
		super(client, file, {
			type: LavamusicEventType.Player,
			name: "queueEnd",
		});
	}

	public async run(player: Player, _track: Track | null, _payload: TrackStartEvent): Promise<void> {
		const guild = this.client.guilds.cache.get(player.guildId);
		if (!guild) return;
		const locale = await this.client.db.getLanguage(player.guildId);
		await updateSetup(this.client, guild, locale);

		if (player.voiceChannelId) {
			await this.client.utils.setVoiceStatus(this.client, player.voiceChannelId, "");
		}

		// Aviso visual de fin de cola (solo si no hay canal de setup dedicado)
		const setup = await this.client.db.getSetup(guild.id).catch(() => null);
		if (!setup?.textId && player.textChannelId) {
			const notify = guild.channels.cache.get(player.textChannelId) as TextChannel | undefined;
			await notify?.send({ embeds: [queueEndEmbed(locale)] }).catch(() => null);
		}

		const messageId = player.get<string | undefined>("messageId");
		if (!messageId) return;

		const channel = guild.channels.cache.get(player.textChannelId!) as TextChannel;
		if (!channel) return;

		const message = await channel.messages.fetch(messageId).catch(() => {
			null;
		});
		if (!message) return;

		if (message.editable) {
			await message.edit({ components: [] }).catch(() => {
				null;
			});
		}
	}
}
