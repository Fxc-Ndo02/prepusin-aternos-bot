import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import express from "express";
import dotenv from "dotenv";

// Importamos Puppeteer con modo Sigilo (Stealth)
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Activamos el plugin de sigilo
puppeteer.use(StealthPlugin());

dotenv.config();

// -------------------- 1. SERVIDOR WEB --------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot activo."));
app.listen(PORT, () =>
  console.log(`Servidor web escuchando en puerto ${PORT}`)
);

// -------------------- 2. BOT DISCORD CONFIG --------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let serverIP = "mc.micholandt1.aternos.me"; 
let players = "Desconocido";

// -------------------- 3. SLASH COMMANDS --------------------
const commands = [
  new SlashCommandBuilder().setName("estado").setDescription("Ver estado del servidor"),
  new SlashCommandBuilder().setName("jugadores").setDescription("Ver jugadores"),
  new SlashCommandBuilder().setName("start").setDescription("Iniciar servidor Aternos"),
  new SlashCommandBuilder().setName("stop").setDescription("Apagar servidor Aternos"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map((c) => c.toJSON()) }
    );
    console.log("✅ Comandos registrados.");
  } catch (err) {
    console.error("❌ Error registrando comandos:", err);
  }
})();

// -------------------- 4. FUNCIONES PUPPETEER (INYECCIÓN DE COOKIES) --------------------

async function launchBrowser() {
  console.log("🚀 Lanzando navegador (Stealth)...");
  return await puppeteer.launch({
    headless: true, // true para producción en Render
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--window-size=1920,1080", 
    ],
  });
}

// Función para cargar la sesión usando cookies (REEMPLAZA loginAternos)
async function loadAternosSession(page) {
    page.setDefaultNavigationTimeout(120000); 

    // Verificación de variables de entorno
    if (!process.env.ATERNOS_SESSION || !process.env.ATERNOS_SERVER_COOKIE) {
        throw new Error("ERROR CRÍTICO: Las variables ATERNOS_SESSION o ATERNOS_SERVER_COOKIE no están configuradas en Render.");
    }

    console.log("🍪 Inyectando cookies de sesión...");

    // Inyectamos las cookies copiadas para saltar el login de Aternos/Cloudflare
    await page.setCookie(
        { name: 'ATERNOS_SESSION', value: process.env.ATERNOS_SESSION, domain: 'aternos.org', path: '/', secure: true, httpOnly: true },
        { name: 'ATERNOS_SERVER', value: process.env.ATERNOS_SERVER_COOKIE, domain: 'aternos.org', path: '/', secure: true, httpOnly: true },
        { name: 'ATERNOS_LANGUAGE', value: process.env.ATERNOS_LANGUAGE || 'es-ES', domain: 'aternos.org', path: '/', secure: true, httpOnly: false }
    );

    console.log("🌐 Navegando directamente al panel del servidor...");
    
    // Navegación directa al servidor, sin pasar por el login
    await page.goto(`https://aternos.org/server/${process.env.SERVER_ID}/`, {
        waitUntil: "networkidle2",
    });
    
    const title = await page.title();
    if (title.includes("Just a moment") || title.includes("Login")) {
        // Si sigue apareciendo, es que las cookies expiraron.
        throw new Error("BLOQUEO ACTIVO. Las cookies de sesión han expirado. Necesitas actualizarlas en Render.");
    }
}


// Acción: START
async function startServer() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loadAternosSession(page); // LLAMADA ACTUALIZADA

    const startBtn = await page.$("#start"); 
    
    if (!startBtn) {
      console.log("⚠️ No veo el botón START.");
      await browser.close();
      return false; 
    }

    console.log("✅ Clic en START");
    await startBtn.click();

    try {
        await page.waitForSelector("#confirm", { timeout: 5000 });
        console.log("⚠️ Cola detectada, confirmando...");
        await page.click("#confirm");
    } catch (e) {}

    await browser.close();
    return true; 
  } catch (err) {
    console.error("❌ Error en startServer:", err);
    if (browser) await browser.close();
    throw err; 
  }
}

// Acción: STOP
async function stopServer() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loadAternosSession(page); // LLAMADA ACTUALIZADA

    const stopBtn = await page.$("#stop"); 
    
    if (!stopBtn) {
      console.log("⚠️ No veo el botón STOP.");
      await browser.close();
      return false;
    }

    console.log("🛑 Clic en STOP");
    await stopBtn.click();
    await browser.close();
    return true;
  } catch (err) {
    console.error("❌ Error en stopServer:", err);
    if (browser) await browser.close();
    throw err;
  }
}

// Acción: ESTADO
async function checkServerState() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loadAternosSession(page); // LLAMADA ACTUALIZADA

    const statusElement = await page.$(".server-status-label");
    let status = "Desconocido";
    if (statusElement) status = await page.evaluate(el => el.innerText, statusElement);
    
    const stopBtn = await page.$("#stop");
    
    await browser.close();
    return { status: status, isOnline: !!stopBtn };
  } catch (err) {
    console.error("❌ Error en checkServerState:", err);
    if (browser) await browser.close();
    return { status: "Error/Bloqueado", isOnline: false };
  }
}

// -------------------- 5. MANEJO DE INTERACCIONES (BLINDADO) --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
      await interaction.deferReply();
  } catch (error) {
      console.error("⚠️ Error al hacer deferReply:", error.message);
      return; 
  }

  try {
    switch (interaction.commandName) {
      case "estado":
        await interaction.editReply("📡 Consultando Aternos...");
        const state = await checkServerState();
        await interaction.editReply(`📡 **Estado:** ${state.status}`);
        break;

      case "jugadores":
        await interaction.editReply(`👥 **Jugadores:** ${players}`);
        break;

      case "start":
        await interaction.editReply("🚀 **Iniciando protocolo...** (Paciencia, Render es lento)");
        const started = await startServer();
        if (started) {
            await interaction.editReply(`✅ **Comando aceptado.** Aternos iniciando.\nIP: \`${serverIP}\``);
        } else {
            await interaction.editReply("⚠️ **No se pudo iniciar.** Puede que ya esté ON o la sesión expiró.");
        }
        break;

      case "stop":
        await interaction.editReply("🛑 **Apagando...**");
        const stopped = await stopServer();
        if (stopped) {
            await interaction.editReply("✅ **Comando aceptado.** Apagando servidor.");
        } else {
            await interaction.editReply("⚠️ **Error.** Ya está apagado o inaccesible.");
        }
        break;
    }
  } catch (error) {
    console.error("Error en la lógica del comando:", error);
    if (interaction.deferred && !interaction.replied) {
        // Reporta el error específico de cookies expiradas si ocurre
        const errorMessage = error.message.includes("expirado") || error.message.includes("BLOQUEO") ? 
                             "❌ **Error Crítico:** Las cookies de sesión han expirado. Por favor, actualiza las variables en Render." :
                             `❌ **Error:** ${error.message.substring(0, 100)}... Revisa Render.`;
                             
        await interaction.editReply(errorMessage);
    }
  }
});

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

client.login(process.env.TOKEN);
