import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { nowPlayingEmbed, tx, warn } from "../../utils/Embeds";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Nowplaying extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "nowplaying",
			description: {
				content: I18N.commands.nowplaying.description,
				examples: ["nowplaying"],
				usage: "nowplaying",
			},
			category: "music",
			aliases: ["np"],
			cooldown: 3,
			args: false,
			vote: false,
			player: {
				voice: true,
				dj: false,
				active: true,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		const player = client.manager.getPlayer(ctx.guild.id);
		const locale = await client.db.getLanguage(ctx.guild.id);

		if (!player || !player.queue.current) {
			return ctx.sendMessage({ embeds: [warn(tx(locale).noMusic)] });
		}

		return ctx.sendMessage({
			embeds: [
				nowPlayingEmbed(player, player.queue.current, {
					locale,
					botAvatar: client.user?.displayAvatarURL(),
				}),
			],
		});
	}
}
