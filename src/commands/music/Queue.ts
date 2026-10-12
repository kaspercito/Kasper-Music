import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { queuePages, tx, warn } from "../../utils/Embeds";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Queue extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "queue",
			description: {
				content: I18N.commands.queue.description,
				examples: ["queue"],
				usage: "queue",
			},
			category: "music",
			aliases: ["q"],
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
			return await ctx.sendMessage({ embeds: [warn(tx(locale).noMusic)] });
		}

		const pages = queuePages(player, {
			locale,
			guildName: ctx.guild.name,
			guildIcon: ctx.guild.iconURL(),
		});
		return await client.utils.paginate(client, ctx, pages);
	}
}
