import { Mutex } from "async-mutex";
import { ChannelType, Client, Events, GatewayIntentBits, GuildMember, OverwriteType, PermissionFlagsBits, TextChannel, VoiceBasedChannel } from "discord.js";
import "dotenv/config";

process.on("uncaughtException", console.error);

const mutex = new Mutex();

const client = new Client({
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates | GatewayIntentBits.GuildMembers,
    allowedMentions: { parse: [] },
});

const promise = new Promise<Client<true>>((res) => client.on(Events.ClientReady, res));

await client.login(process.env.TOKEN);

const bot = await promise;

console.log(`${bot.user.tag} is ready.`);

const queue: VoiceBasedChannel[] = [];
const mentors: GuildMember[] = [];

const logs = (await bot.channels.fetch(process.env.LOGS!)) as TextChannel;

function log(message: string, panic: boolean = false) {
    logs.send({ content: `${panic ? `<@${process.env.OWNER}>` : ""} ${message}`, allowedMentions: panic ? { users: [process.env.OWNER!] } : undefined });
}

bot.on(Events.VoiceStateUpdate, (before, after) => {
    mutex.runExclusive(async () => {
        if (!after.member) return;

        if (
            before.channel !== null &&
            after.channel !== before.channel &&
            before.channel?.parent?.id === process.env.QUEUE_CATEGORY &&
            before.guild.voiceStates.cache.every((state) => state.channel?.id !== before.channel?.id)
        ) {
            const index = queue.findIndex((channel) => channel.id === before.channel!.id);

            if (index !== -1) {
                queue.splice(index, 1);
                queue.slice(index).forEach((channel, i) => channel.send(`You are now **#${index + i + 1}** in the queue.`));
            }

            before.channel.delete();
        }

        if (before.channel?.id === process.env.MENTOR_WAITING_ROOM && after.channel?.id !== process.env.MENTOR_WAITING_ROOM) {
            const index = mentors.findIndex((mentor) => mentor.id === after.member!.id);

            if (index !== -1) {
                mentors.splice(index, 1);
                log(`${after.member} left the mentor queue, which is now: ${mentors.join(", ")}`);
            }
        }

        if (after.channel === null) return;

        if (after.channel.id === process.env.MENTEE_WAITING_ROOM) {
            const channel = await after.guild.channels.create({
                name: "Interview Room (Awaiting Mentor)",
                type: ChannelType.GuildVoice,
                parent: process.env.QUEUE_CATEGORY,
                permissionOverwrites: [
                    {
                        id: after.guild.roles.everyone.id,
                        type: OverwriteType.Role,
                        deny: PermissionFlagsBits.ViewChannel,
                    },
                    {
                        id: process.env.MENTOR_ROLE!,
                        type: OverwriteType.Role,
                        allow: PermissionFlagsBits.ViewChannel,
                    },
                    {
                        id: after.member.id,
                        type: OverwriteType.Member,
                        allow: PermissionFlagsBits.ViewChannel,
                    },
                ],
            });

            await after.member.voice.setChannel(channel).catch(() => {
                channel.send({ content: `${after.member} Please join this channel!`, allowedMentions: { users: [after.member!.id] } });
                log(`could not move ${after.member} to ${channel}`, true);
            });

            if (mentors.length > 0) {
                const mentor = mentors.shift()!;
                log(`shifting ${mentor} to ${channel}`);

                try {
                    await mentor.voice.setChannel(channel);
                } catch {
                    channel.send(`${mentor} I couldn't move you here; please join this voice channel.`);
                    log(`could not move ${mentor} to ${channel}`, true);
                }

                return;
            }

            queue.push(channel);

            channel.send({
                content: `${after.member} You are **#${queue.length}** in the queue. Please hold tight and a mentor will join you soon!`,
                allowedMentions: { users: [after.member.id] },
            });

            log(`${channel} is in the queue which is now: ${queue.join(", ")}`);
        } else if (after.channel.id === process.env.MENTOR_WAITING_ROOM) {
            const channel = queue.shift();

            if (!channel) {
                mentors.push(after.member);
                log(`no pending interviewees, so ${after.member} is now in the queue, which is now: ${mentors.join(", ")}`);
                return;
            }

            log(`shifting ${after.member} to ${channel}`);

            await after.member.voice.setChannel(channel).catch(() => {
                channel.send(`${after.member} I couldn't move you here; please join this voice channel.`);
                log(`could not move ${after.member} to ${channel}`, true);
            });

            queue.forEach((channel, index) => channel.send(`You are now **#${index + 1}** in the queue.`));
        } else if (after.channel.parent?.id === process.env.QUEUE_CATEGORY && after.member.roles.cache.has(process.env.MENTOR_ROLE!)) {
            if (after.channel.name === "Interview Room (Awaiting Mentor)") {
                await after.channel.setName("Interview Room (Taken)");
            }
        }
    });
});
