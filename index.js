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

app.get("/", (req, res) => res.send("Bot activo y escuchando correctamente."));
app.listen(PORT, () =>
  console.log(`Servidor web escuchando en puerto ${PORT}`)
);

// -------------------- BOT DISCORD --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let serverIP = "No disponible";
let players = "No disponible";

// -------------------- SLASH COMMANDS --------------------
const commands = [
  new SlashCommandBuilder()
    .setName("estado")
    .setDescription("Muestra el estado del servidor"),

  new SlashCommandBuilder()
    .setName("jugadores")
    .setDescription("Muestra jugadores conectados"),

  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Inicia el servidor Aternos"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Apaga el servidor Aternos"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map((c) => c.toJSON()) }
    );
    console.log("Comandos registrados!");
  } catch (err) {
    console.error("Error registrando comandos:", err);
  }
})();

// -------------------- PUPPETEER LAUNCH --------------------
async function launchBrowser() {
  return await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=IsolateOrigins",
      "--disable-site-isolation-trials",
    ],
  });
}

// -------------------- LOGIN ATERNOS --------------------
async function loginAternos(page) {
  console.log("Abriendo login...");

  await page.goto("https://aternos.org/go/", {
    waitUntil: "networkidle2",
  });

  // Esperar formulario
  await page.waitForSelector("#login input[name='username']");

  console.log("Ingresando usuario...");
  await page.type("#login input[name='username']", process.env.ATERNOS_EMAIL);
  await page.type("#login input[name='password']", process.env.ATERNOS_PASSWORD);

  console.log("Enviando login...");
  await page.click("#login button[type='submit']");

  // Esperar carga principal
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("Login OK, navegando al servidor...");
  await page.goto(
    `https://aternos.org/server/${process.env.SERVER_ID}/`,
    { waitUntil: "networkidle2" }
  );

  console.log("URL actual:", page.url());
}

// -------------------- START SERVER --------------------
async function startServer() {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await loginAternos(page);

    const startBtn = await page.$("button.btn.btn-green");

    if (!startBtn) {
      console.log("No se encontró botón START.");
      await browser.close();
      return false;
    }

    console.log("Clic en START...");
    await startBtn.click();

    await page.waitForTimeout(7000);

    const stopBtn = await page.$("button.btn.btn-red");

    await browser.close();
    return !!stopBtn;
  } catch (err) {
    console.error("Error en startServer:", err);
    await browser.close();
    return false;
  }
}

// -------------------- STOP SERVER --------------------
async function stopServer() {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await loginAternos(page);

    const stopBtn = await page.$("button.btn.btn-red");

    if (!stopBtn) {
      console.log("No se encontró botón STOP.");
      await browser.close();
      return false;
    }

    console.log("Clic en STOP...");
    await stopBtn.click();

    await page.waitForTimeout(7000);

    const startBtn = await page.$("button.btn.btn-green");

    await browser.close();
    return !!startBtn;
  } catch (err) {
    console.error("Error en stopServer:", err);
    await browser.close();
    return false;
  }
}

// -------------------- CHECK SERVER STATE --------------------
async function checkServerState() {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await loginAternos(page);

    const running = await page.$("button.btn.btn-red");

    await browser.close();
    return !!running;
  } catch (err) {
    console.error("Error en checkServerState:", err);
    await browser.close();
    return false;
  }
}

// -------------------- DISCORD COMMAND HANDLING --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "estado":
      await interaction.reply("Verificando estado... ⏳");
      const running = await checkServerState();
      await interaction.editReply(
        `Servidor: ${running ? "ENCENDIDO ✅" : "APAGADO 🛑"}`
      );
      break;

    case "jugadores":
      await interaction.reply(`Jugadores conectados: ${players}`);
      break;

    case "start":
      await interaction.reply("Iniciando servidor... ⏳");
      if (await startServer()) {
        serverIP = "mc.micholandt1.aternos.me";
        players = 0;
        await interaction.editReply(
          `Servidor iniciado correctamente. IP: ${serverIP}`
        );
      } else {
        await interaction.editReply("No se pudo iniciar el servidor ❌");
      }
      break;

    case "stop":
      await interaction.reply("Deteniendo servidor... ⏳");
      if (await stopServer()) {
        serverIP = "No disponible";
        players = "No disponible";
        await interaction.editReply("Servidor apagado correctamente 🛑");
      } else {
        await interaction.editReply("No se pudo apagar el servidor ❌");
      }
      break;
  }
});

// -------------------- START DISCORD BOT --------------------
client.login(process.env.TOKEN);
