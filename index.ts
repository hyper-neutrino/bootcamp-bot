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
let mentors: GuildMember[] = [];

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
        )
            before.channel.delete();

        if (after.channel === null) {
            mentors = mentors.filter((mentor) => mentor.id !== after.member!.id);
            return;
        }

        if (after.channel.id === process.env.MENTEE_WAITING_ROOM) {
            const channel = await after.guild.channels.create({
                name: "Interview Room (Awaiting Mentor)",
                type: ChannelType.GuildVoice,
                parent: process.env.QUEUE_CATEGORY,
                permissionOverwrites: [
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

            channel.send({
                content: `${after.member} You are now in the queue. There ${queue.length === 1 ? `is 1 person` : `are ${queue.length} people`} ahead of you.`,
                allowedMentions: { users: [after.member.id] },
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
        } else if (after.channel.parent?.id === process.env.QUEUE_CATEGORY && after.member.roles.cache.has(process.env.MENTOR_ROLE!)) {
            if (after.channel.name === "Interview Room (Awaiting Mentor)") {
                await after.channel.setName("Interview Room (Taken)");
            }
        }
    });
});
