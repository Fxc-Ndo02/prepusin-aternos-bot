// index.js
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import express from "express";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

// -------------------- SERVIDOR WEB --------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Servidor web escuchando. Bot activo ✅"));
app.listen(PORT, () => console.log(`Servidor web escuchando en puerto ${PORT}`));

// -------------------- BOT DE DISCORD --------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Estado dinámico
let serverIP = "No disponible";
let players = "No disponible";

// -------------------- COMANDOS --------------------
const commands = [
  new SlashCommandBuilder().setName("estado").setDescription("Muestra el estado del servidor"),
  new SlashCommandBuilder().setName("jugadores").setDescription("Muestra jugadores conectados"),
  new SlashCommandBuilder().setName("start").setDescription("Inicia el servidor Aternos"),
  new SlashCommandBuilder().setName("stop").setDescription("Apaga el servidor Aternos"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.map(c => c.toJSON()) });
    console.log("Comandos registrados!");
  } catch (err) { console.error(err); }
})();

// -------------------- FUNCIONES PUPPETEER --------------------
async function loginAternos(page) {
  await page.goto("https://aternos.org/go/");
  await page.type("#login input[name='username']", process.env.ATERNOS_EMAIL);
  await page.type("#login input[name='password']", process.env.ATERNOS_PASSWORD);
  await page.click("#login button[type='submit']");
  await page.waitForNavigation({ waitUntil: "networkidle0" });
  await page.goto(`https://aternos.org/server/${process.env.SERVER_ID}/`);
}

async function startServer() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  try {
    await loginAternos(page);
    const startBtn = await page.$("button[title='Start']");
    if (!startBtn) { await browser.close(); return false; }
    await startBtn.click();
    await page.waitForTimeout(5000);
    const stopBtn = await page.$("button[title='Stop']");
    await browser.close();
    return !!stopBtn;
  } catch (err) {
    await browser.close();
    return false;
  }
}

async function stopServer() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  try {
    await loginAternos(page);
    const stopBtn = await page.$("button[title='Stop']");
    if (!stopBtn) { await browser.close(); return false; }
    await stopBtn.click();
    await page.waitForTimeout(5000);
    const startBtn = await page.$("button[title='Start']");
    await browser.close();
    return !!startBtn;
  } catch (err) {
    await browser.close();
    return false;
  }
}

async function checkServerState() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  try {
    await loginAternos(page);
    const stopBtn = await page.$("button[title='Stop']");
    await browser.close();
    return !!stopBtn;
  } catch (err) {
    await browser.close();
    return false;
  }
}

// -------------------- INTERACCIONES --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "estado":
      const running = await checkServerState();
      await interaction.reply(`Servidor actualmente: ${running ? "ENCENDIDO ✅" : "APAGADO 🛑"}\nIP: ${running ? "mc.micholandt1.aternos.me" : "No disponible"}`);
      break;

    case "jugadores":
      await interaction.reply(`Jugadores conectados: ${players}`);
      break;

    case "start":
      await interaction.reply("Iniciando el servidor... ⏳");
      if (await startServer()) {
        serverIP = "mc.micholandt1.aternos.me";
        players = 0;
        await interaction.editReply(`Servidor iniciado! Conéctate usando: ${serverIP}`);
      } else {
        await interaction.editReply("No se pudo iniciar el servidor ❌");
      }
      break;

    case "stop":
      await interaction.reply("Apagando el servidor... ⏳");
      if (await stopServer()) {
        serverIP = "No disponible";
        players = "No disponible";
        await interaction.editReply("Servidor apagado! 🛑");
      } else {
        await interaction.editReply("No se pudo apagar el servidor ❌");
      }
      break;
  }
});

// -------------------- LOGIN --------------------
client.login(process.env.TOKEN);
