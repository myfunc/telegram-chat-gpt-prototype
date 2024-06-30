# Telegram ChatGPT bot with DALL-E

This is a small undocumented experimental project that hosts TelegramBot with ChatGPT support.
A bot can be added to group chat and used by 1 or many people.
Authorization is included to avoid uncontrolled access.

There is no documentation, sorry.

## How to run
Set OpenAI and TelegramBotTokens in .env files and run `npm i`, `npm run start`.

## BotFather commands
```
newchat - Create a new chat context
say - {text} to the current context
image - {prompt} generates the image with DALL-E 3
ask - inline test
newsecret - Generates a login secret on the server
login - {secret} Authorizes current chat
logout - Unauthorizes current chat
```