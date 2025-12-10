import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import express from "express";
import dotenv from "dotenv";

// IMPORTANTE: Usamos la versión 'extra' para camuflaje
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Activamos el camuflaje para engañar a Aternos/Cloudflare
puppeteer.use(StealthPlugin());

dotenv.config();

// -------------------- 1. SERVIDOR WEB --------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot activo y escuchando correctamente."));
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
  new SlashCommandBuilder().setName("estado").setDescription("Muestra si el servidor está ON u OFF"),
  new SlashCommandBuilder().setName("jugadores").setDescription("Muestra jugadores conectados"),
  new SlashCommandBuilder().setName("start").setDescription("Inicia el servidor Aternos"),
  new SlashCommandBuilder().setName("stop").setDescription("Apaga el servidor Aternos"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map((c) => c.toJSON()) }
    );
    console.log("✅ Comandos registrados en Discord!");
  } catch (err) {
    console.error("❌ Error registrando comandos:", err);
  }
})();

// -------------------- 4. FUNCIONES PUPPETEER (SIGILO) --------------------

async function launchBrowser() {
  console.log("🚀 Lanzando navegador en modo SIGILO...");
  return await puppeteer.launch({
    headless: true, // Debe ser true en Render
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--window-size=1920,1080", // Ventana grande para parecer humano
    ],
  });
}

async function loginAternos(page) {
  // 1. Disfrazar el User Agent (parecer un usuario de Windows)
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
  
  page.setDefaultNavigationTimeout(120000); 

  console.log("🔑 Navegando a Aternos...");
  await page.goto("https://aternos.org/go/", { waitUntil: "networkidle2" });

  // Selectores actualizados
  const usernameSelector = "input.username"; 
  const passwordSelector = "input[type='password']"; 
  const submitButtonSelector = "#login button[type='submit']";
  
  try {
    // Esperamos 60s. El plugin Stealth debería evitar el bloqueo inmediato
    await page.waitForSelector(usernameSelector, { visible: true, timeout: 60000 });
    console.log("✅ Login detectado. Escribiendo credenciales...");
    
    // Escribir lento (delay) para parecer humano
    await page.type(usernameSelector, process.env.ATERNOS_EMAIL, { delay: 100 });
    await page.type(passwordSelector, process.env.ATERNOS_PASSWORD, { delay: 100 });

    console.log("📤 Click en entrar...");
    await page.click(submitButtonSelector);

  } catch (error) {
    // Si falla, obtenemos el título para saber si nos bloquearon
    const pageTitle = await page.title();
    throw new Error(`Fallo Login (60s). Título de la página: '${pageTitle}'. Aternos está bloqueando la conexión.`);
  }

  // Esperar a que cargue el dashboard
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("🌐 Entrando al servidor...");
  // Navegación directa al servidor específico
  await page.goto(`https://aternos.org/server/${process.env.SERVER_ID}/`, {
    waitUntil: "networkidle2",
  });
}

// Acción: START
async function startServer() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loginAternos(page);

    // Buscamos botón START
    const startBtn = await page.$("#start"); 
    
    if (!startBtn) {
      console.log("⚠️ No veo el botón START (¿Ya encendido o selector cambió?).");
      await browser.close();
      return false; 
    }

    console.log("✅ Clic en START");
    await startBtn.click();

    // Confirmación de cola (A veces sale un popup)
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
    await loginAternos(page);

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
    await loginAternos(page);

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

// -------------------- 5. MANEJO DE INTERACCIONES --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // 1. Responder rápido para evitar error "Unknown interaction"
    await interaction.deferReply(); 

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
        await interaction.editReply("🚀 **Iniciando protocolo de arranque...** (Puede tardar 1-2 mins)");
        const started = await startServer();
        if (started) {
            await interaction.editReply(`✅ **Comando aceptado.** Aternos está iniciando el servidor.\nIP: \`${serverIP}\``);
        } else {
            // SINTAXIS CORREGIDA AQUI:
            await interaction.editReply("⚠️ **No pude iniciarlo.** Posibles causas:\n1. Ya está encendido.\n2. Bloqueo de seguridad de Aternos.");
        }
        break;

      case "stop":
        await interaction.editReply("🛑 **Apagando...**");
        const stopped = await stopServer();
        if (stopped) {
            await interaction.editReply("✅ **Comando aceptado.** Apagando servidor.");
        } else {
            await interaction.editReply("⚠️ **Error.** Ya está apagado o no se pudo acceder.");
        }
        break;
    }
  } catch (error) {
    console.error(error);
    await interaction.editReply(`❌ **Error:** ${error.message.substring(0, 100)}... Revisa Render.`);
  }
});

client.login(process.env.TOKEN);
