import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	type ChannelSelectMenuInteraction,
	type MentionableSelectMenuInteraction,
	PermissionFlagsBits,
	type RoleSelectMenuInteraction,
	type StringSelectMenuInteraction,
	type TextChannel,
	type UserSelectMenuInteraction,
} from "discord.js";
import type { Player, Track, TrackStartEvent } from "lavalink-client";
import { I18N, t } from "../../structures/I18n";
import { Event, type Lavamusic } from "../../structures/index";
import type { Requester } from "../../types";
import { LavamusicEventType } from "../../types/events";
import { nowPlayingEmbed } from "../../utils/Embeds";
import { startTicker } from "../../utils/NowPlayingTicker";
import { trackStart } from "../../utils/SetupSystem";

export default class TrackStart extends Event {
	constructor(client: Lavamusic, file: string) {
		super(client, file, {
			type: LavamusicEventType.Player,
			name: "trackStart",
		});
	}

	public async run(player: Player, track: Track | null, _payload: TrackStartEvent): Promise<void> {
		const guild = this.client.guilds.cache.get(player.guildId);
		if (!guild) return;
		if (!player.textChannelId) return;
		if (!track) return;
		const channel = guild.channels.cache.get(player.textChannelId) as TextChannel;
		if (!channel) return;

		const locale = await this.client.db.getLanguage(guild.id);

		if (player.voiceChannelId) {
			await this.client.utils.setVoiceStatus(
				this.client,
				player.voiceChannelId,
				`♫ • ${track.info.title}`,
			);
		}

		const embed = nowPlayingEmbed(player, track, {
			locale,
			botAvatar: this.client.user?.displayAvatarURL(),
		});

		const setup = await this.client.db.getSetup(guild.id);

		if (setup?.textId) {
			const textChannel = guild.channels.cache.get(setup.textId) as TextChannel;
			if (textChannel) {
				await trackStart(setup.messageId, textChannel, player, track, this.client, locale);
			}
		} else {
			const message = await channel.send({
				embeds: [embed],
				components: [createButtonRow(player)],
			});

			player.set("messageId", message.id);

			// Mantiene viva la barra de progreso: edita la tarjeta cada 3 s
			// (Discord limita las ediciones; ir más rápido provoca rate limits)
			const botAvatar = this.client.user?.displayAvatarURL();
			startTicker(guild.id, 3_000, async () => {
				const p = this.client.manager.getPlayer(guild.id);
				const cur = p?.queue.current;
				if (!p || !cur || cur.encoded !== track.encoded) return false;
				if (p.paused) return true;
				await message.edit({
					embeds: [nowPlayingEmbed(p, cur, { locale, botAvatar })],
					components: [createButtonRow(p)],
				});
				return true;
			});
		}
	}
}

export function createButtonRow(player: Player): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("resume")
			.setLabel(player.paused ? t(I18N.buttons.resume) : t(I18N.buttons.pause))
			.setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId("previous")
			.setLabel(t(I18N.buttons.previous))
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(!player.queue.previous || player.queue.previous.length === 0),
		new ButtonBuilder()
			.setCustomId("stop")
			.setLabel(t(I18N.buttons.stop))
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId("skip")
			.setLabel(t(I18N.buttons.skip))
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId("loop")
			.setLabel(t(I18N.buttons.loop))
			.setStyle(player.repeatMode !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary),
	);
}

export async function checkDj(
	client: Lavamusic,
	interaction:
		| ButtonInteraction<"cached">
		| StringSelectMenuInteraction<"cached">
		| UserSelectMenuInteraction<"cached">
		| RoleSelectMenuInteraction<"cached">
		| MentionableSelectMenuInteraction<"cached">
		| ChannelSelectMenuInteraction<"cached">,
): Promise<boolean> {
	const dj = await client.db.getDj(interaction.guildId);
	if (dj?.mode) {
		const djRole = await client.db.getRoles(interaction.guildId);
		if (!djRole) return false;
		const hasDjRole = interaction.member.roles.cache.some((role) =>
			djRole.map((r) => r.roleId).includes(role.id),
		);
		if (!(hasDjRole || interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))) {
			return false;
		}
	}
	return true;
}
