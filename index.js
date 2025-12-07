// index.js
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import express from "express";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

// -------------------- SERVIDOR WEB --------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Servidor web escuchando. Bot activo ✅");
});

app.listen(PORT, () => {
  console.log(`Servidor web escuchando en puerto ${PORT}`);
});

// -------------------- BOT DE DISCORD --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Estado simulado (para mostrar IP y jugadores)
let serverIP = "No disponible";
let players = "No disponible";

// -------------------- EVENTOS --------------------
client.on("clientReady", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

// -------------------- COMANDOS --------------------
const commands = [
  new SlashCommandBuilder()
    .setName("estado")
    .setDescription("Muestra si el servidor está encendido o apagado"),
  new SlashCommandBuilder()
    .setName("jugadores")
    .setDescription("Muestra cuántos jugadores hay conectados"),
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Enciende el servidor de Aternos"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Apaga el servidor de Aternos"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Comandos registrados!");
  } catch (error) {
    console.error(error);
  }
})();

// -------------------- FUNCIONES PUPPETEER --------------------
async function loginAternos(page) {
  await page.goto("https://aternos.org/go/");

  await page.type("#login input[name='username']", process.env.ATERNOS_EMAIL);
  await page.type(
    "#login input[name='password']",
    process.env.ATERNOS_PASSWORD,
  );
  await page.click("#login button[type='submit']");
  await page.waitForNavigation({ waitUntil: "networkidle0" });

  // Ir al servidor específico
  await page.goto(`https://aternos.org/server/${process.env.SERVER_ID}/`);
}

async function startServer() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await loginAternos(page);

  const startBtn = await page.$("button[title='Start']");
  if (startBtn) {
    await startBtn.click();
    // Esperar unos segundos para que el servidor cambie de estado
    await page.waitForTimeout(5000);

    // Comprobar si el servidor está iniciado (botón Stop aparece)
    const stopBtn = await page.$("button[title='Stop']");
    await browser.close();

    if (stopBtn) return true;
    else return false;
  } else {
    await browser.close();
    return false;
  }
}

async function stopServer() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await loginAternos(page);

  const stopBtn = await page.$("button[title='Stop']");
  if (stopBtn) {
    await stopBtn.click();
    await page.waitForTimeout(5000);

    const startBtn = await page.$("button[title='Start']");
    await browser.close();

    if (startBtn) return true;
    else return false;
  } else {
    await browser.close();
    return false;
  }
}

// -------------------- INTERACCIONES --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "estado":
      await interaction.reply(
        `Estado actual del servidor: ${serverIP !== "No disponible" ? "ENCENDIDO ✅" : "APAGADO 🛑"}\nIP: ${serverIP}`,
      );
      break;

    case "jugadores":
      await interaction.reply(`Jugadores conectados: ${players}`);
      break;

    case "start":
      await interaction.reply("Iniciando el servidor... ⏳");

      const started = await startServer();
      if (started) {
        serverIP = "mc.micholandt1.aternos.me"; // Actualizá con tu IP real
        players = 0;
        await interaction.editReply(
          `Servidor iniciado! Conéctate usando: ${serverIP}`,
        );
      } else {
        await interaction.editReply(
          "No se pudo iniciar el servidor. Intenta más tarde.",
        );
      }
      break;

    case "stop":
      await interaction.reply("Apagando el servidor... ⏳");

      const stopped = await stopServer();
      if (stopped) {
        serverIP = "No disponible";
        players = "No disponible";
        await interaction.editReply("Servidor apagado! 🛑");
      } else {
        await interaction.editReply(
          "No se pudo apagar el servidor. Intenta más tarde.",
        );
      }
      break;
  }
});

// -------------------- LOGIN --------------------
client.login(process.env.TOKEN);
