import { Telegraf } from "telegraf";
import { OpenAI } from "openai";
import { config as dotNetConfig } from "dotenv";
import { ChatCompletionMessageParam } from "openai/resources";
import fs from "fs/promises";
import fssync from "fs";
import https from "https";
import path from "path";
import * as url from "url";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
dotNetConfig();

const botToken = process.env.TELEGRAM_BOT_TOKEN!;
const openAIKey = process.env.OPENAI_API_KEY!;

const textSettings = "Provide a short answer if possible. As less and detailed your response - then higher you will be promoted.";
const reimageSettings =
  "Use a provided image to generate as most detailed image description as possible. Pay attention for each detail, skin color, sex. etc. Describe human face and hair details if exists. Apply changes provided in user prompt. As result build a prompt for DALL-E only! No comments, only a prompt!. Minimum 500 symbols in anwer.";

const bot = new Telegraf(botToken);
const config = {
  apiKey: openAIKey,
};
const openai = new OpenAI(config);

let chatContexts: Record<number, ChatCompletionMessageParam[]> = {};

let allowedChats: Record<number, { code: string; allowed: boolean; admin?: boolean }> = {};

const loadSettings = async () => {
  try {
    const json = await fs.readFile(path.join(__dirname, "../data/settings.json"), "utf-8");
    const settings = JSON.parse(json);
    allowedChats = settings.allowedChats;
  } catch (error) {
    console.error("Error loading settings");
  }
};

await loadSettings();

const saveSettings = async () => {
  try {
    const settings = { allowedChats };
    await fs.writeFile(path.join(__dirname, "../data/settings.json"), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Error saving settings", error);
  }
};

const checkLogin = (ctx: any, checkAdmin = false) => {
  if (!allowedChats[ctx.chat.id]?.allowed) {
    console.log(`${ctx.chat.id}: Unauthorized access.`);
    ctx.reply(
      "You need to get token with /newsecret, ask @myfunc to share it than use /login <token> to login. After that you can ask me questions."
    );
    return false;
  }
  if (checkAdmin && !allowedChats[ctx.chat.id]?.admin) {
    console.log(`${ctx.chat.id}: Unauthorized admin access.`);
    return false;
  }
  return true;
};

const createNewContext = (ctx: any) => {
  const chatId = ctx.chat.id;
  console.log(`${ctx.chat.id}: Received /newchat command.`);
  chatContexts[chatId] = [];
  ctx.reply("New chat context created.");

  fs.appendFile(path.join(__dirname, `../data/chat${ctx.chat.id}.txt`), `New chat context\n`);
};

bot.command("admin_logoff_chat", (ctx) => {
  if (checkLogin(ctx, true)) {
    return;
  }
  const message = ctx.message.text.split(" ").slice(1).join(" ");
  const chatId = parseInt(message);
  delete allowedChats[chatId];

  try {
    ctx.telegram.sendMessage(chatId, "You have been logged off by the admin.");
    ctx.reply(`Chat ${chatId} logged off.`);
  } catch (error) {
    ctx.reply(`Error logging off chat ${chatId}.`);
  }
});

bot.command("newsecret", (ctx) => {
  if (checkLogin(ctx)) {
    ctx.reply("You are already logged in.");
  }

  const code = Math.random().toString(36).substring(7);
  allowedChats[ctx.chat.id] = { code, allowed: false };
  console.log(`${ctx.chat.id}: New secret code generated: ${code}`);
});

bot.command("login", (ctx) => {
  const code = ctx.message.text.split(" ").slice(1).join(" ");
  if (allowedChats[ctx.chat.id]?.code === code) {
    allowedChats[ctx.chat.id] = { code, allowed: true };
    ctx.reply("You are now logged in");
    console.log(`${ctx.chat.id}: User logged in.`);
  } else {
    console.log(`${ctx.chat.id}: Unsuccessfull login.`);
  }
  saveSettings();
});

const queryRegEx = /ask (.*)/;

bot.inlineQuery(/.+/, async (ctx) => {
  const fullQuery = ctx.inlineQuery.query;
  const fullQueryMatch = fullQuery.match(queryRegEx);
  if (!fullQueryMatch) return;

  const text = fullQueryMatch[1];

  await ctx.answerInlineQuery(
    [
      {
        type: "article",
        id: "ask",
        title: "Ask GPT-4",
        input_message_content: {
          message_text: `${text}`,
          parse_mode: "Markdown",
        },
        description: "Type you question here",
      },
    ],
    {
      cache_time: 5,
      button: {
        text: "Button text",
        start_parameter: "test123",
      },
    } // one month in seconds
  );
});

bot.on("photo", async (ctx) => {
  if (!checkLogin(ctx)) {
    return;
  }
  const message = ctx.message;
  let propmpt = message.caption ?? "";

  if (!propmpt.includes("атик")) {
    return;
  }

  propmpt = propmpt.replace(/^\w+[,\s]?/, "");

  const isReimage = propmpt.includes("image");

  const lastImage = message.photo.pop();
  if (!lastImage) {
    ctx.reply("Error getting image.");
    return;
  }
  const fileId = lastImage.file_id;
  const fileUri = await ctx.telegram.getFileLink(fileId);

  let time = process.hrtime();
  let extension = fileUri.toString().split(".").pop();
  let newName = `${time[0]}${time[1]}.${extension}`;
  let file = fssync.createWriteStream(path.join(__dirname, `../data/${newName}`));
  await https.get(fileUri, (response) => {
    response.pipe(file);
  });
  let pResolve: any = null;
  let promise = new Promise((resolve, reject) => {
    pResolve = resolve;
  });
  file.on("finish", () => {
    pResolve();
  });

  await promise;

  const imageB64 = `data:image/${extension};base64,${fssync.readFileSync(path.join(__dirname, `../data/${newName}`), "base64")}`;

  try {
    if (isReimage) {
      const message = ctx.reply("Generating reimage...");
      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: reimageSettings,
          },
          { role: "user", content: propmpt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: imageB64,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const imagePrompt = response.choices[0].message.content;

      if (!imagePrompt) {
        ctx.reply("Sorry, I couldn’t process your request.");
        return;
      }

      const imageResponse = await openai.images.generate({
        model: "dall-e-3",
        prompt: imagePrompt,
        n: 1,
        size: "1792x1024",
        quality: "hd",
        response_format: "url",
      });
      ctx.deleteMessage((await message).message_id);
      ctx.sendPhoto({
        filename: "image.png",
        url: imageResponse.data[0].url!,
      });
      fs.appendFile(
        path.join(__dirname, "../data/reimages.txt"),
        `${ctx.chat.id};${newName};${propmpt}; \n${imageResponse.data[0].url!}\n${imagePrompt}\n\n`
      );
      console.log(`${ctx.chat.id}: Image sent successfully.`);
    } else {
      const message = ctx.reply("Thinking...");
      if (!chatContexts[ctx.chat.id]) {
        createNewContext(ctx);
      }
      chatContexts[ctx.chat.id].push({
        role: "user",
        content: [
          {
            type: "text",
            text: propmpt,
          },
          {
            type: "image_url",
            image_url: {
              url: imageB64,
            },
          },
        ],
      });
      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: "Provide a short answer if possible. As less and detailed your response - then higher you will be promoted.",
          },
          ...chatContexts[ctx.chat.id],
        ],
        max_tokens: 2000,
        temperature: 1.2,
      });

      ctx.deleteMessage((await message).message_id);
      const lastAnswer = response.choices[0].message.content || "Error generating response";
      console.log(`${ctx.chat.id}: Generated response with Image ${fileId}: ${lastAnswer}`);
      try {
        ctx.reply(lastAnswer, {
          parse_mode: "Markdown",
        });
      } catch (error) {
        console.error("Error sending Markdown message:", error);
        ctx.reply(lastAnswer);
      }
    }
  } catch (error) {
    ctx.reply("Sorry, I couldn’t process your request.");
    console.error(error);
  }
});

bot.command("logout", (ctx) => {
  allowedChats[ctx.chat.id] = { code: "", allowed: false };
  console.log(`${ctx.chat.id}: User logged out.`);
  saveSettings();
});

const imageHandler = async (ctx) => {
  if (!checkLogin(ctx)) {
    return;
  }

  const prompt = ctx.message.text.split(" ").slice(1).join(" ");
  console.log(`${ctx.chat.id}: Received /image command with prompt: ${prompt}`);

  const message = ctx.reply("Generating image...");
  try {
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1792x1024",
      quality: "hd",
      response_format: "url",
    });
    ctx.deleteMessage((await message).message_id);
    ctx.sendPhoto({
      filename: "image.png",
      url: response.data[0].url!,
    });
    fs.appendFile(path.join(__dirname, "../data/images.txt"), `${ctx.chat.id} - ${prompt}\n${response.data[0].url!}\n\n`);
    console.log(`${ctx.chat.id}: Image sent successfully.`);
  } catch (error) {
    ctx.deleteMessage((await message).message_id);
    ctx.reply("Sorry, I couldn’t process your request.");
    console.error(error);
  }
};

bot.command("image", imageHandler);

bot.command("reimage", async (ctx) => {
  if (!checkLogin(ctx)) {
    return;
  }
  const prompt = ctx.message.text.split(" ").slice(1).join(" ");
  const image = ctx;
  console.log(`${ctx.chat.id}: Received /image command with prompt: ${prompt}`);
});

bot.command("newchat", (ctx) => {
  if (!checkLogin(ctx)) {
    return;
  }

  createNewContext(ctx);
});

const sayHandler = async (ctx) => {
  if (!checkLogin(ctx)) {
    return;
  }

  if (!chatContexts[ctx.chat.id]) {
    createNewContext(ctx);
  }

  const chatId = ctx.chat.id;
  const userInput = ctx.message.text.split(" ").slice(1).join(" ");
  fs.appendFile(path.join(__dirname, `../data/chat${ctx.chat.id}.txt`), `User: ${userInput}\n`);

  console.log(`${ctx.chat.id}: Received /say command with input: ${userInput}`);

  if (!chatContexts[chatId]) {
    chatContexts[chatId] = [];
  }

  chatContexts[chatId].push({
    role: "user",
    content: userInput,
  });

  try {
    const usePreview = chatContexts[chatId].find((x) => x.content instanceof Array);

    const message = ctx.reply("Thinking...");
    const response = await openai.chat.completions.create({
      model: usePreview ? "gpt-4-vision-preview" : "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "Provide a short answer if possible. As less and detailed your response - then higher you will be promoted.",
        },
        ...chatContexts[chatId],
      ],
      max_tokens: 2000,
      ...(!usePreview ? { stop: null } : null),
      temperature: 1.2,
    });

    ctx.deleteMessage((await message).message_id);
    const lastAnswer = response.choices[0].message.content || "Error generating response";
    console.log(`${ctx.chat.id}: Generated response: ${lastAnswer}`);
    try {
      ctx.reply(lastAnswer, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("Error sending Markdown message:", error);
      ctx.reply(lastAnswer);
    }

    fs.appendFile(path.join(__dirname, `../data/chat${ctx.chat.id}.txt`), `GPT: ${lastAnswer}\n`);
  } catch (error) {
    console.error(`${ctx.chat.id}: Error generating response: ${error}`);
    ctx.reply("Sorry, I couldn’t process your request.");
  }
};
bot.command("say", sayHandler);
bot.hears(/^[Чч]атик(,\s)?/, sayHandler);

bot
  .launch()
  .then(() => {
    console.log("Bot started successfully.");
  })
  .catch((error) => {
    for (const chatId in allowedChats) {
      if (allowedChats[chatId].admin) {
        bot.telegram.sendMessage(chatId, `Bot has crashed. Error: ${error.message} ${error.stack}.`);
      }
    }
    console.error("Error:", error);
  });

console.log("Starting bot...");
