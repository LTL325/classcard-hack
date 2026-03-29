import { CategoryChannel, Client, Collection, Message, TextChannel, EmbedBuilder, Partials, ComponentType, ChannelType } from "discord.js";
import { Activity, ClassCard, learningType, QuizBattle, setType } from "./classcard.js";
import * as fs from "fs";
import * as crypto from "crypto";

if (!fs.existsSync("./config.json")) {
    fs.writeFileSync("./config.json", JSON.stringify({ token: "디스코드 봇 토큰", owners: ["대빵 디코 아이디"], prefix: "!", secret: "", guild: "적지마", ticketCategory: "적지마", ticketChannel: "적지마" }, null, 4));
    console.info("config.json 설정좀");
    process.exit(0);
};
if (!fs.existsSync("./users.json")) fs.writeFileSync("./users.json", "{}");
let config: {
    token: string,
    owners: string[],
    prefix: string,
    secret: string,
    guild: string,
    ticketCategory: string,
    ticketChannel: string
} = JSON.parse(fs.readFileSync("./config.json", "utf8"));
let secret: string = config.secret || randPassword(32);
let users: {
    [key: string]: {
        id: string,
        password: string,
        channelID: string,
        messageID: string,
        setID: number,
        classID: number,
    }
} = JSON.parse(fs.readFileSync("./users.json", "utf8"));

let classes: { [key: string]: ClassCard } = {};
let qbClasses: { [key: string]: QuizBattle } = {};

const client: Client = new Client({
    "intents": [
        "DirectMessageReactions",
        "DirectMessageTyping",
        "DirectMessages",
        "GuildBans",
        "GuildEmojisAndStickers",
        "GuildIntegrations",
        "GuildInvites",
        "GuildMembers",
        "GuildMessageReactions",
        "GuildMessageTyping",
        "GuildMessages",
        "GuildPresences",
        "GuildScheduledEvents",
        "GuildVoiceStates",
        "GuildWebhooks",
        "Guilds",
        "MessageContent"
    ],
    "partials": [
        Partials.Channel,
        Partials.GuildMember,
        Partials.GuildScheduledEvent,
        Partials.Message,
        Partials.Reaction,
        Partials.ThreadMember,
        Partials.User,
    ]
});

console.info("잠시만 기다려주세요.");
await Promise.all(Object.keys(users).map(async key => {
    try {
        let user = users[key];
        if (!classes[key]) classes[key] = new ClassCard();
        if (decrypt(user.id) && decrypt(user.password)) {
            classes[key].login(decrypt(user.id), decrypt(user.password));
            let res = await classes[key].login(decrypt(user.id), decrypt(user.password)).then(res => res?.success);
            if (!res) {
                user.id = "";
                user.password = "";
                user.setID = 0;
                user.classID = 0;
            };
        } else {
            user.id = "";
            user.password = "";
            user.setID = 0;
            user.classID = 0;
        };
        if (user.setID) {
            let res = user.setID && await classes[key].setSetInfo(user.setID).then(res => res?.success);
            if (!res) user.setID = 0;
        };
        if (user.classID) {
            let res = user.classID && await classes[key].setClassInfo(user.classID).then(res => res?.success);
            if (!res) user.classID = 0;
        };
        saveUsers()
        if (user.channelID && user.messageID) client.once("ready", async () => {
            if (!user.channelID || !user.messageID) return;
            let guild = client.guilds.cache.get(config.guild)
            if (!guild) return;
            let channel = guild?.channels.cache.get(user.channelID) as TextChannel;
            if (!channel) return;
            let message = await channel.messages.fetch(user.messageID).catch(() => false);
            if (!message) {
                channel.delete();
                user.channelID = "";
                user.messageID = "";
                saveUsers()
                return;
            };
            updateMessage(message, key, "edit");
        });
    } catch { };
}));
console.clear();
client.login(config.token);

process.on("unhandledRejection", (e) => console.error(e));
process.on("uncaughtException", (e) => console.error(e));

client.on("ready", () => console.info("Logged in as " + client.user?.tag));

client.on("interactionCreate", async (interaction) => {
    try {
        if (!users[interaction.user.id]) users[interaction.user.id] = { id: "", password: "", channelID: "", messageID: "", setID: 0, classID: 0 };
        saveUsers()
        let user = users[interaction.user.id];
        if (interaction.isButton()) {
            const channel = interaction.channel as TextChannel;
            if (!channel.topic?.includes("Created By " + client.user?.username)) return;
            if (!interaction.customId.startsWith("_")) await interaction.reply({ embeds: [new EmbedBuilder().setTitle("⚙️ 잠시만 기다려주세요.").setColor("Green")], ephemeral: true });
            if (interaction.customId === "create_ticket") {
                let channel = interaction.guild?.channels.cache.get(user.channelID) as TextChannel;
                if (user.channelID && channel) await channel.delete();
                channel = await (interaction.guild?.channels.cache.get(config.ticketCategory) as CategoryChannel).children.create({ "name": interaction.user.username.toLowerCase() /* ＃${interaction.user.discriminator} */, "topic": "Created By " + client.user?.username + " | USER: " + interaction.user.id });
                user.channelID = channel.id;
                if (!classes[interaction.user.id]) classes[interaction.user.id] = new ClassCard();
                let message: Message = await updateMessage(channel, interaction.user.id, "send") as Message;
                if (message.id) user.messageID = message.id;
                saveUsers()
                await channel.permissionOverwrites.create(interaction.user, { "ViewChannel": true, "SendMessages": true });
                interaction.editReply({ "embeds": [new EmbedBuilder().setTitle("✅ Success").setDescription(`설정이 완료되었습니다. 채널: <#${channel.id}>`).setColor("Green")] });
                return;
            };
            if (!channel.topic.split("|")[1].includes(interaction.user.id)) {
                interaction[interaction.replied ? "editReply" : "reply"]({ embeds: [new EmbedBuilder().setTitle("❌ 티켓을 만든 유저만 사용할 수 있습니다.").setColor("Red")], ephemeral: true });
                return;
            };
            if (interaction.customId.startsWith("s_") && !user.setID) {
                interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ 세트를 설정한 뒤 사용해주세요.").setColor("Red")] });
                return;
            };
            if (interaction.customId === "delete_channel") {
                let message: Message = await interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("⚠️ 정말 채널을 삭제하시겠습니까?").setColor("Yellow")], components: [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "label": "네",
                                    "style": 4,
                                    "customId": "_yes"
                                },
                                {
                                    "type": 2,
                                    "label": "아니요",
                                    "style": 1,
                                    "customId": "_no"
                                }
                            ]
                        }
                    ]
                }) as Message;
                let i = await message.awaitMessageComponent({ filter: (i: any) => i.user.id === interaction.user.id, time: 0, componentType: ComponentType.Button }).then(async (inter) => {
                    if (inter.customId !== "_yes") return false;
                    await channel.delete();
                    user.channelID = "";
                    user.messageID = "";
                    saveUsers()
                    return true;
                }).catch(() => false);
                if (!i) interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("✅ 취소되었습니다.").setColor("Green")],
                    components: []
                }).catch(() => false);
                return;
            } else if (interaction.customId === "delete_info") {
                let message: Message = await interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("⚠️ 정말 저장된 정보를 삭제하시겠습니까?").setColor("Yellow")], components: [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "label": "네",
                                    "style": 4,
                                    "customId": "_yes"
                                },
                                {
                                    "type": 2,
                                    "label": "아니요",
                                    "style": 1,
                                    "customId": "_no"
                                }
                            ]
                        }
                    ]
                }) as Message;
                let i = await message.awaitMessageComponent({ filter: (i: any) => i.user.id === interaction.user.id, time: 0, componentType: ComponentType.Button }).then(async (inter) => {
                    if (inter.customId !== "_yes") return false;
                    user.id = "";
                    user.password = "";
                    user.setID = 0;
                    user.classID = 0;
                    delete classes[interaction.user.id];
                    classes[interaction.user.id] = new ClassCard();
                    saveUsers();
                    updateMessage(interaction.channel?.messages.cache.get(user.messageID), interaction.user.id, "edit");
                    return true;
                }).catch(() => false);
                if (!i) interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("✅ 취소되었습니다.").setColor("Green")],
                    components: []
                }).catch(() => false);
                else interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("✅ 정보가 삭제되었습니다.").setColor("Green")],
                    components: []
                }).catch(() => false);
                return;
            } else if (interaction.customId === "_set_id_pass") {
                interaction.showModal({
                    "title": "아이디와 비밀번호를 입력해주세요.",
                    "customId": "_set_id_pass",
                    "components": [{
                        "type": 1,
                        "components": [{
                            "type": 4,
                            "customId": "id",
                            "label": "아이디",
                            "style": 1,
                            "minLength": 5,
                            "maxLength": 20,
                            "placeholder": "아이디",
                            "required": true
                        }]
                    },
                    {
                        "type": 1,
                        "components": [{
                            "type": 4,
                            "customId": "password",
                            "label": "비밀번호",
                            "style": 1,
                            "minLength": 5,
                            "maxLength": 4000,
                            "placeholder": "비밀번호",
                            "required": true
                        }]
                    }],
                });
            } else if (interaction.customId === "_set_set") {
                interaction.showModal({
                    "title": "세트 정보를 입력해주세요.",
                    "customId": "_set_set",
                    "components": [{
                        "type": 1,
                        "components": [{
                            "type": 4,
                            "customId": "set_id",
                            "label": "세트 아이디",
                            "style": 1,
                            "minLength": 1,
                            "maxLength": 20,
                            "placeholder": "0000000",
                            "required": true
                        }]
                    }]
                });
            } else if (interaction.customId === "get_sets") {
                let foldersResult = await classes[interaction.user.id].getFolders();
                if (!foldersResult || !foldersResult.success) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (foldersResult?.message || "알 수 없는 오류입니다.")).setColor("Red")] });
                    return;
                };
                let folders: { id: number, name: string, isFolder?: boolean }[] = [];
                foldersResult.data?.forEach(f => folders.push({ //Object.keys(foldersResult.data!).for~
                    id: f.id,
                    name: f.name,
                    isFolder: true
                }));
                let classesResult = await classes[interaction.user.id].getClasses();
                if (!classesResult || !classesResult.success) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (classesResult?.message || "알 수 없는 오류입니다.")).setColor("Red")] });
                    return;
                };
                folders = [...classesResult.data!, ...folders];
                let message: Message = await interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("❓ 가져올 폴더나 클래스를 선택해주세요.").setColor("Yellow")],
                    components: [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 3,
                                    "customId": "class_select_1",
                                    "options": folders.map(f => {
                                        return {
                                            "label": f.name,
                                            "value": String(f.isFolder ? f.name : f.id),
                                            "description": (f.isFolder ? "폴더" : "클래스"),
                                            // "emoji": {
                                            //     "name": "",
                                            //     "id": ""
                                            // }
                                        };
                                    }),
                                    "placeholder": "폴더나 클래스를 선택해주세요.",
                                    "minValues": 1,
                                    "maxValues": 1
                                }
                            ]
                        }
                    ]
                }) as Message;
                let i: string | false = await message.awaitMessageComponent({ filter: (i: any) => i.user.id === interaction.user.id, time: 0, componentType: ComponentType.SelectMenu }).then((interaction) => interaction.values[0]).catch(() => false);
                if (!i) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ 알 수 없는 오류입니다.").setColor("Red")], components: [] });
                    return;
                };
                if (/[0-9]/.test(i)) {
                    await classes[interaction.user.id].setClassInfo(Number(i));
                    user.classID = Number(i);
                    saveUsers();
                } else {
                    classes[interaction.user.id].class.id = -1;
                    classes[interaction.user.id].class.name = "";
                    user.classID = 0;
                };
                let setsResult = await classes[interaction.user.id].getSets(/[0-9]/.test(i) ? "클래스" : i, /[0-9]/.test(i) ? Number(i) : 0);
                if (!setsResult || !setsResult.success || !setsResult.data) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (setsResult?.message || "알 수 없는 오류입니다.")).setColor("Red")], components: [] });
                    return;
                };
                let sets = setsResult.data;
                interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle(`✅ **${/[0-9]/.test(i) ? folders.find(x => x.id === Number(i))?.name : i}**에 있는 세트 목록`).setColor("Green").setDescription(sets.length < 1 ? `이 ${/[0-9]/.test(i) ? "클래스" : "폴더"}에 세트가 하나도 없습니다.` : "\`세트 이름\` [**세트 아이디**]\n\n" + sets.map(s => `\`${s.name}\` [**${s.id}**]`).join("\n"))],
                    components: []
                });
            } else if (["s_memorize", "s_recall", "s_spell"].includes(interaction.customId)) {
                let result = await classes[interaction.user.id].sendLearnAll(learningType[((interaction.customId === "s_memorize" ? "암기" : interaction.customId === "s_recall" ? "리콜" : "스펠") + "학습") as "암기학습" | "리콜학습" | "스펠학습"]);
                updateMessage(interaction.channel?.messages.cache.get(user.messageID), interaction.user.id, "edit");
                if (!result || !result.success) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (result?.message || "알 수 없는 오류입니다.")).setColor("Red")] });
                    return;
                };
                interaction.editReply({
                    embeds: [new EmbedBuilder().setTitle("✅ 학습 완료.").addFields([
                        {
                            "name": "before",
                            "value": String(result.data?.before) + "%",
                            "inline": true
                        },
                        {
                            "name": "after",
                            "value": String(result.data?.after) + "%",
                            "inline": true
                        }
                    ]).setColor("Green")]
                });
            } else if (["s_match_scramble", "s_crash"].includes(interaction.customId)) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❓ 원하는 점수를 입력해주세요.").setColor("Yellow")] });
                let collected: Collection<string, Message<boolean>> | false = await channel.awaitMessages({
                    filter: (m: Message) => m.author.id === interaction.user.id,
                    time: 30000,
                    max: 1,
                    errors: ["time"]
                }).catch(() => interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ 시간이 초과되었습니다.").setColor("Red")] }).then(() => false));
                if (!collected || !collected.first()) return;
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("⚙️ 잠시만 기다려주세요.").setColor("Aqua")] });
                collected.first()?.delete();
                let score = parseInt(String(collected.first()?.content));
                let scoreUnit = interaction.customId === "s_match_scramble" ? 100 : 10;
                if (isNaN(score) || score > 990000 || score < scoreUnit) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`❌ 점수를 ${score % scoreUnit != 0 ? scoreUnit + "점 단위로" : isNaN(score) ? "숫자로만" : score > 990000 ? "990000점 이하로" : (scoreUnit + "점 이상으로")} 입력해주세요.`).setColor("Red")] });
                    return;
                };
                let result = await classes[interaction.user.id].addGameScore((interaction.customId === "s_match_scramble" ? Activity["매칭"] : Activity["크래시"]), score, true);
                if (!result || !result.success) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (result?.message || "알 수 없는 오류입니다.")).setColor("Red")] });
                    return;
                };
                let embed = new EmbedBuilder().setTitle("✅ " + result.message).setColor("Green");
                if (result.data?.rank) {
                    if (result.data.rank.all) embed.addFields([{
                        "name": "전체 순위",
                        "value": String(result.data.rank.all) + (typeof result.data.rank.all === "number" ? "위" : ""),
                        "inline": true
                    }]);
                    if (result.data.rank.class) embed.addFields([{
                        "name": "반 순위",
                        "value": String(result.data.rank.class) + (typeof result.data.rank.class === "number" ? "위" : ""),
                        "inline": true
                    }]);
                };
                interaction.editReply({ embeds: [embed] });
            } else if (interaction.customId === "s_test") {
                let result = await classes[interaction.user.id].postTest();
                updateMessage(interaction.channel?.messages.cache.get(user.messageID), interaction.user.id, "edit");
                if (!result || !result.success) {
                    interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ " + (result?.message || "알 수 없는 오류입니다.")).setColor("Red")] });
                    return;
                };
                interaction.editReply({ embeds: [new EmbedBuilder().setTitle("✅ 성공.").setDescription(result.message || "100점").setColor("Green")] });
            } else if (interaction.customId === "_quiz_battle") {
                interaction.deferUpdate();
                if (qbClasses[interaction.user.id]) {
                    qbClasses[interaction.user.id].leave();
                    qbClasses[interaction.user.id].removeAllListeners();
                    delete qbClasses[interaction.user.id];
                };
                let message = await (interaction.channel as TextChannel).send({
                    "embeds": [new EmbedBuilder().setTitle("❓ 배틀코드를 입력해주세요.").setColor("Yellow")],
                });
                let collected: Collection<string, Message<boolean>> | false = await channel.awaitMessages({
                    filter: (m: Message) => m.author.id === interaction.user.id,
                    time: 30000,
                    max: 1,
                    errors: ["time"]
                }).catch(() => message.edit({ embeds: [new EmbedBuilder().setTitle("❌ 시간이 초과되었습니다.").setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).then(() => false));
                if (!collected || !collected.first()) return;
                collected.first()?.delete().catch(() => false);
                let battleCode = Number(collected.first()?.content);
                await message.edit({ "embeds": [new EmbedBuilder().setTitle("❓ 표시될 이름을 입력해주세요.").setColor("Yellow")] });
                collected = await channel.awaitMessages({
                    filter: (m: Message) => m.author.id === interaction.user.id,
                    time: 30000,
                    max: 1,
                    errors: ["time"]
                }).catch(() => message.edit({ embeds: [new EmbedBuilder().setTitle("❌ 시간이 초과되었습니다.").setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).then(() => false));
                if (!collected || !collected.first()) return;
                collected.first()?.delete().catch(() => false);
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 잠시만 기다려주세요.").setColor("Aqua")] });
                let quizBattle = new QuizBattle(battleCode);
                let end = false;
                quizBattle.on("error", (error: string) => {
                    end = true;
                    message.edit({ embeds: [new EmbedBuilder().setTitle(`❌ ${error}`).setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false);
                    quizBattle.leave();
                    quizBattle.removeAllListeners();
                });
                quizBattle.on("start", async () => {
                    try {
                        var next: typeof QuizBattle.prototype.battleInfo.quest_list[0] = quizBattle.battleInfo.quest_list[0];
                        while (!end) {
                            let firstLine = {
                                correct: String(quizBattle.correct) + "개",
                                wrong: String(quizBattle.wrong) + "개",
                                total: String(quizBattle.correct + quizBattle.wrong) + "개"
                            };
                            Object.keys(firstLine).forEach((key: string) => firstLine[key as "correct" | "wrong" | "total"] += Math.max(firstLine.correct.length, firstLine.wrong.length, firstLine.total.length) > firstLine[key as "correct" | "wrong" | "total"].length ? " ".repeat(Math.max(firstLine.correct.length, firstLine.wrong.length, firstLine.total.length) - firstLine[key as "correct" | "wrong" | "total"].length) : "");
                            message.edit({
                                "embeds": [new EmbedBuilder().setTitle("퀴즈배틀 실시간 경쟁").setDescription(`
                            전체: ${firstLine.total} 현재 점수: ${quizBattle.score}점
                            정답: ${firstLine.correct} 반 평균 점수: ${quizBattle.classAvg}점
                            오답: ${firstLine.wrong} 순위 갱신까지 남은 문제: ${quizBattle.round.remaining}개
                            `.trim()).setColor("Green")],
                                "components": [{
                                    "type": 1,
                                    "components": [{
                                        "type": 2,
                                        "label": `정답 처리(+${(100 * next!.weight) || "unknown"}점)`,
                                        "style": 3,
                                        "customId": "_quiz_battle_answer|correct"
                                    }, {
                                        "type": 2,
                                        "label": "오답 처리(+0점)",
                                        "style": 4,
                                        "customId": "_quiz_battle_answer|wrong"
                                    }]
                                }]
                            }).catch(() => end = true);
                            await message.awaitMessageComponent({
                                filter: (m: any) => m.user.id === interaction.user.id,
                                time: 0,
                                componentType: ComponentType.Button,
                            }).then(async (i: any) => {
                                next = (i.customId.endsWith("correct") ? quizBattle.mark(true) : quizBattle.mark(false)).nextQuestion;
                                await i.deferUpdate();
                            }).catch(() => end = true);
                        };
                    } catch (e) {
                        end = true;
                        message.edit({ embeds: [new EmbedBuilder().setTitle(`❌ ${e}`).setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false);
                    };
                });
                quizBattle.on("end", () => {
                    end = true;
                    message.edit({ embeds: [new EmbedBuilder().setTitle("🎮 배틀이 종료되었습니다.").setColor("Green")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false);
                    quizBattle.leave();
                    quizBattle.removeAllListeners();
                });
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 웹소켓 연결 중...").setColor("Aqua")] });
                await quizBattle.init();
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 접속 중...").setColor("Aqua")] });
                await quizBattle.join(String(collected.first()?.content));
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⌛ 배틀 시작을 기다리는 중입니다.").setColor("Aqua")] });
            } else if (interaction.customId === "_quiz_battle_crash") {
                interaction.deferUpdate();
                let message = await (interaction.channel as TextChannel).send({
                    "embeds": [new EmbedBuilder().setTitle("❓ 배틀코드를 입력해주세요.").setColor("Yellow")],
                });
                let collected: Collection<string, Message<boolean>> | false = await channel.awaitMessages({
                    filter: (m: Message) => m.author.id === interaction.user.id,
                    time: 30000,
                    max: 1,
                    errors: ["time"]
                }).catch(() => message.edit({ embeds: [new EmbedBuilder().setTitle("❌ 시간이 초과되었습니다.").setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).then(() => false));
                if (!collected || !collected.first()) return;
                collected.first()?.delete().catch(() => false);
                let battleCode = Number(collected.first()?.content);
                await message.edit({ "embeds": [new EmbedBuilder().setTitle("❓ 표시될 이름을 입력해주세요.").setColor("Yellow")] });
                collected = await channel.awaitMessages({
                    filter: (m: Message) => m.author.id === interaction.user.id,
                    time: 30000,
                    max: 1,
                    errors: ["time"]
                }).catch(() => message.edit({ embeds: [new EmbedBuilder().setTitle("❌ 시간이 초과되었습니다.").setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).then(() => false));
                if (!collected || !collected.first()) return;
                collected.first()?.delete().catch(() => false);
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 잠시만 기다려주세요.").setColor("Aqua")] });
                let quizBattle = new QuizBattle(battleCode);
                quizBattle.on("error", (error: string) => {
                    message.edit({ embeds: [new EmbedBuilder().setTitle(`❌ ${error}`).setColor("Red")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false);
                    quizBattle.leave();
                    quizBattle.removeAllListeners();
                });
                quizBattle.on("start", () => {
                    quizBattle.setScore(10000000);
                    message.edit({ embeds: [new EmbedBuilder().setTitle("⌛ 게임이 끝날 때까지 기다리는 중입니다.").setColor("Green")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false)
                });
                quizBattle.on("end", () => {
                    message.edit({ embeds: [new EmbedBuilder().setTitle("🎮 크래셔 작동 성공.").setColor("Green")], components: [] }).then(() => setTimeout(() => message.fetch().then(() => message.delete().catch(() => false)), 10000)).catch(() => false);
                    quizBattle.leave();
                    quizBattle.removeAllListeners();
                });
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 웹소켓 연결 중...").setColor("Aqua")] });
                await quizBattle.init();
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⚙️ 접속 중...").setColor("Aqua")] });
                await quizBattle.join("<script>location.reload()</script>" + collected.first()?.content);
                await message.edit({ embeds: [new EmbedBuilder().setTitle("⌛ 배틀 시작을 기다리는 중입니다.").setColor("Aqua")] });
            } else if (interaction.customId.startsWith("_delete_message")) {
                if (interaction.customId.split("|")[1] != interaction.user.id) {
                    interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ 잘못된 접근입니다.").setColor("Red")], ephemeral: true });
                    return;
                };
                (interaction.message as Message).delete();
            };
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId === "_set_id_pass") {
                const id = interaction.fields.getTextInputValue("id");
                const password = interaction.fields.getTextInputValue("password");
                if (!classes[interaction.user.id]) classes[interaction.user.id] = new ClassCard();
                let loginResult = await classes[interaction.user.id].login(id, password);
                if (loginResult?.success) {
                    user.id = encrypt(id);
                    user.password = encrypt(password);
                    user.setID = 0;
                    user.classID = 0;
                    saveUsers()
                    updateMessage(interaction.channel?.messages.cache.get(user.messageID), interaction.user.id, "edit");
                    interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ 로그인 성공. 아이디와 비밀번호가 저장되었습니다.").setColor("Green")], ephemeral: true });
                } else {
                    interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ " + (loginResult?.message || "알 수 없는 오류입니다.")).setColor("Red")], ephemeral: true });
                };
            } else if (interaction.customId === "_set_set") {
                let setID = Number(interaction.fields.getTextInputValue("set_id"));
                let result = await classes[interaction.user.id].setSetInfo(setID);
                if (result && result?.success) {
                    user.setID = setID;
                    saveUsers()
                    updateMessage(interaction.channel?.messages.cache.get(user.messageID), interaction.user.id, "edit");
                    let embed = new EmbedBuilder().setTitle("✅ 세트가 설정되었습니다.").setDescription("자세한 내용은 위 두번째 임베드를 봐주세요.").setColor("Green");
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle("❌ " + (result?.message || "알 수 없는 오류입니다.")).setColor("Red")], ephemeral: true });
                };
            };
        };
    } catch (e) {
        if (e instanceof Error && interaction.isRepliable()) {
            if (interaction.replied) {
                interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`❌ ${e.message}`).setColor("Red")] }).catch(() => false);
            } else {
                interaction.reply({ embeds: [new EmbedBuilder().setTitle(`❌ ${e.message}`).setColor("Red")], ephemeral: true }).catch(() => false);
            }
        }
    };
});

client.on("messageCreate", async (message: Message) => {
    if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).split(" ");
        const cmd = args.shift()!.toLowerCase();
        if (config.owners.includes(message.author.id)) {
            if (cmd === "setup" && !!message.guild) {
                if (!!config.ticketCategory && message.guild.channels.cache.has(config.ticketCategory)) {
                    let category: CategoryChannel = message.guild.channels.cache.get(config.ticketCategory) as CategoryChannel;
                    await Promise.all(category.children.cache.map(async channel => await channel.delete()));
                    await category.delete();
                };
                if (!!config.ticketChannel && message.guild.channels.cache.has(config.ticketChannel)) await message.guild.channels.cache.get(config.ticketChannel)?.delete();
                let category = await message.guild.channels.create({ "name": "TICKETS", "type": ChannelType.GuildCategory, "permissionOverwrites": [{ "id": message.guild.roles.everyone.id, "allow": ["ReadMessageHistory"], "deny": ["ViewChannel", "SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads"] }] });
                config.ticketCategory = category.id;
                let channel = await category.children.create({ "name": "사용", "topic": "Created By " + client.user?.username + " | DO NOT DELETE" });
                await channel.permissionOverwrites.edit(message.guild!.roles.everyone, { "ViewChannel": true });
                config.ticketChannel = channel.id;
                config.guild = message.guild.id;
                fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));
                await channel.send({
                    "embeds": [new EmbedBuilder().setTitle("버튼을 눌러주세요.").setColor("Green")],
                    "components": [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 2,
                                    "label": "채널 만들기",
                                    "style": 3,
                                    "customId": "create_ticket"
                                }
                            ]
                        }
                    ]
                });
                let replied = await message.reply("설정 성공.");
                setTimeout(() => {
                    message.delete().catch(() => false);
                    replied.delete();
                }, 5000);
            };

            if (cmd === "eval") {
                try {
                    let res = await eval(args.join(" "));
                    message.reply({ embeds: [new EmbedBuilder().setTitle(`✅ Success`).setDescription(`\`\`\`xl\n${res}\`\`\``).setColor("Green").setTimestamp()] });
                } catch (e) {
                    message.reply({ embeds: [new EmbedBuilder().setTitle(`❌ Failed`).setDescription(`\`\`\`xl\n${e}\`\`\``).setColor("Red").setTimestamp()] });
                };
            };

            if (cmd === "s") {
                message.delete().catch(() => false);
                secret = args[0];
            };
        }
    };
});

function encrypt(text: string): string {
    try {
        let iv = crypto.randomBytes(8).toString("hex");
        const cipher = crypto.createCipheriv('aes-256-cbc', secret, iv);
        return cipher.update(text, 'utf8', 'hex') + cipher.final('hex') + "'" + iv;
    } catch {
        return "";
    };
};

function decrypt(text: string): string {
    try {
        let text2: string[] = text.split("'");
        const decipher = crypto.createDecipheriv('aes-256-cbc', secret, text2.pop()!);
        return decipher.update(text2[0], 'hex', 'utf8') + decipher.final('utf8');
    } catch {
        return "";
    };
};

async function updateMessage(message: any, userID: string, s: string): Promise<Message | undefined> {
    try {
        let disableMode = "";
        (!classes[userID].set.id || !classes[userID].class.id) && (disableMode = "set");
        (!users[userID].id || !users[userID].password) && (disableMode = "idPass");
        let disabled = disableMode === "idPass" || disableMode === "set";
        let components = [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "label": "클래스카드 아이디/비번 설정",
                        "style": 1,
                        "customId": "_set_id_pass",
                        "disabled": false
                    }
                ]
            }
        ];
        if (disableMode !== "idPass") components[0].components.push({
            "type": 2,
            "label": "세트 설정",
            "style": 1,
            "customId": "_set_set",
            "disabled": false
        });
        if (!disabled) {
            let row = {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "label": "암기학습",
                        "style": 3,
                        "customId": "s_memorize",
                        "disabled": false
                    },
                    {
                        "type": 2,
                        "label": "리콜학습",
                        "style": 3,
                        "customId": "s_recall",
                        "disabled": false
                    },
                    {
                        "type": 2,
                        "label": "스펠학습",
                        "style": 3,
                        "customId": "s_spell",
                        "disabled": false
                    },
                    {
                        "type": 2,
                        "label": "테스트",
                        "style": 3,
                        "customId": "s_test",
                        "disabled": !classes[userID].class.id
                    }
                ]
            };
            if (!classes[userID].class.id) row.components.pop();
            if (classes[userID].set.type !== setType["word"] && classes[userID].set.type !== setType["sentence"]) for (let i = 0; i < 3; i++) row.components.shift();
            if (row.components.length > 0) components.push(row);
        };
        components.push({
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "label": "퀴즈배틀",
                    "style": 3,
                    "customId": "_quiz_battle",
                    "disabled": false
                },
                {
                    "type": 2,
                    "label": "퀴즈배틀 크래셔",
                    "style": 3,
                    "customId": "_quiz_battle_crash",
                    "disabled": false
                }
            ]
        });
        if (!disabled && (classes[userID].set.type === setType["word"] || classes[userID].set.type === setType["sentence"])) {
            components.at(-1)!.components.unshift({
                "type": 2,
                "label": "매칭/스크램블 게임",
                "style": 3,
                "customId": "s_match_scramble",
                "disabled": disabled
            });
        };
        if (disableMode !== "idPass") components.push({
            "type": 1,
            "components": [{
                "type": 2,
                "label": "세트 목록 가져오기",
                "style": 3,
                "customId": "get_sets",
                "disabled": false
            }]
        });
        components.push({
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "label": "채널 삭제하기",
                    "style": 4,
                    "customId": "delete_channel",
                    "disabled": false
                },
                {
                    "type": 2,
                    "label": "정보 삭제하기",
                    "style": 4,
                    "customId": "delete_info",
                    "disabled": disableMode === "idPass"
                }
            ]
        });
        var embeds: EmbedBuilder[] = [];
        var embed = new EmbedBuilder()
            .setColor(!disableMode ? "Green" : "Yellow");
        if (disableMode === "idPass") embed.setTitle("아이디/비번을 설정해주세요.");
        else if (disableMode === "set") embed.setTitle((classes[userID].set.id && !classes[userID].class.id) ? "클래스 외부에서는 학습이 제한되니, 클래스로 이동하세요." : "세트를 설정해주세요.");
        else embed.setTitle("원하는 메뉴를 선택해주세요.");
        embeds.push(embed);
        if (disableMode !== "idPass" && disableMode !== "set") {
            let total = await classes[userID].getTotal();
            var embed = new EmbedBuilder()
                .setTitle(classes[userID].set.name + "(" + classes[userID].set.id.toString() + ")")
                .addFields([
                    {
                        "name": "세트 종류",
                        "value": setType[classes[userID].set.type],
                        "inline": true
                    },
                    {
                        "name": "카드 개수",
                        "value": String(classes[userID].set.study_data.length) + "개",
                        "inline": true
                    },
                    {
                        "name": "클래스 정보",
                        "value": `${classes[userID].class.name}(${classes[userID].class.id})`,
                        "inline": true
                    }
                ])
                .setColor("Green");
            if (total && total.data) {
                if (classes[userID].set.type === setType["word"] || classes[userID].set.type === setType["sentence"]) embed.addFields([{ name: "현재 학습 진행도", value: `암기: **${total.data.Memorize}%**\n리콜: **${total.data.Recall}%**\n스펠: **${total.data.Spell}%**`, inline: true }]);
                if (total.data.Test) {
                    let order = 1;
                    var array = total.data.Test.map(score => `${order++}차 - **${score}점**`);
                    embed.addFields([{
                        name: "테스트", value: array.length > 0 ? array.reduce((all: any, one: any, i) => {
                            const ch = Math.floor(i / 2);
                            all[ch] = [].concat((all[ch] || []), one);
                            return all
                        }, []).map((x: string[]) => x[0] + (x[1] ? " " + x[1] : "")).join("\n") : "테스트 기록이 없습니다.", inline: true
                    }]);
                };
            };
            embeds.push(embed)
        };
        return message && message[s]({
            "content": `<@${userID}>`,
            "embeds": embeds,
            "components": components
        }).catch(() => false);
    } catch (e) {
        console.log(e)
    };
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
};

function saveUsers(): void {
    fs.writeFileSync("./users.json", JSON.stringify(users, null, 4));
};

//ExpressVPN security tools -> Password Generator URL: https://www.expressvpn.com/password-generator
function randPassword(length: number = 32): string {
    let charsArray = ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789", "~!@#$%^&*()_+-={}|[]:<>?,./"];
    var i = "";
    var r = crypto.randomFillSync(new Uint32Array(length - charsArray.length));
    var n = charsArray.join("");
    for (var s = 0; s < r.length; s++) i += n.charAt(r[s] % n.length);
    return charsArray.forEach(((e) => {
        let ri = getRandomIndex(i.length + 1);
        i = i.substring(0, ri) + e.charAt(getRandomIndex(e.length)) + i.substring(ri);
    })), i
};
function getRandomIndex(e: number): number {
    if (e < 0) return -1;
    var a = new Uint32Array(1);
    return crypto.randomFillSync(a), a[0] % e;
};
