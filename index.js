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

// -------------------- 1. SERVIDOR WEB (Para mantener activo en Render) --------------------
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

// Variables globales simples
let serverIP = "mc.micholandt1.aternos.me"; // Pon tu IP aquí por defecto
let players = "Desconocido";

// -------------------- 3. SLASH COMMANDS --------------------
const commands = [
  new SlashCommandBuilder()
    .setName("estado")
    .setDescription("Muestra si el servidor está ON u OFF"),

  new SlashCommandBuilder()
    .setName("jugadores")
    .setDescription("Muestra jugadores conectados (simulado)"),

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
    console.log("✅ Comandos registrados en Discord!");
  } catch (err) {
    console.error("❌ Error registrando comandos:", err);
  }
})();

// -------------------- 4. FUNCIONES PUPPETEER --------------------

// Configuración para lanzar el navegador en Render
async function launchBrowser() {
  console.log("🚀 Lanzando navegador...");
  return await puppeteer.launch({
    headless: true, // "new" está obsoleto, usa true
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process", 
      "--no-zygote",
    ],
  });
}

// Función común para loguearse
async function loginAternos(page) {
  // Timeout de 2 minutos porque Aternos es lento y Render a veces también
  page.setDefaultNavigationTimeout(120000); 

  console.log("🔑 Entrando al login...");
  await page.goto("https://aternos.org/go/", { waitUntil: "domcontentloaded" });

  // Esperar y llenar usuario
  await page.waitForSelector("#login input[name='username']", { visible: true });
  await page.type("#login input[name='username']", process.env.ATERNOS_EMAIL);
  await page.type("#login input[name='password']", process.env.ATERNOS_PASSWORD);

  console.log("📤 Enviando formulario...");
  await page.click("#login button[type='submit']");

  // Esperar a que cargue la siguiente página
  await page.waitForNavigation({ waitUntil: "domcontentloaded" });

  console.log("🌐 Navegando al panel del servidor...");
  await page.goto(`https://aternos.org/server/${process.env.SERVER_ID}/`, {
    waitUntil: "domcontentloaded",
  });
  
  // Pequeña espera extra para asegurar carga de elementos dinámicos
  await new Promise(r => setTimeout(r, 2000));
}

// Acción: START
async function startServer() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loginAternos(page);

    // Intentar encontrar botón de inicio
    const startBtn = await page.$("#start"); 
    
    if (!startBtn) {
      console.log("⚠️ No veo el botón START. ¿Quizás ya está encendido?");
      await browser.close();
      return false; // Retorna falso si no pudo hacer click
    }

    console.log("✅ Clic en START");
    await startBtn.click();

    // Esperar confirmación de cola si aparece
    try {
        await page.waitForSelector("#confirm", { timeout: 5000 });
        console.log("⚠️ Cola detectada, confirmando...");
        await page.click("#confirm");
    } catch (e) {
        // No hubo cola, seguimos
    }

    await browser.close();
    return true; // Retorna verdadero si hizo click
  } catch (err) {
    console.error("❌ Error en startServer:", err);
    if (browser) await browser.close();
    throw err; // Lanza el error para que el bot avise
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
      console.log("⚠️ No veo el botón STOP. ¿Quizás ya está apagado?");
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

// Acción: ESTADO (Checkear si está on/off)
async function checkServerState() {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await loginAternos(page);

    // Buscamos el estado en el texto de la página
    const statusElement = await page.$(".server-status-label");
    let status = "Desconocido";
    
    if (statusElement) {
        status = await page.evaluate(el => el.innerText, statusElement);
    }
    
    // Si vemos el botón de STOP, es que está ON (o cargando)
    const stopBtn = await page.$("#stop");
    
    await browser.close();
    return { status: status, isOnline: !!stopBtn };
  } catch (err) {
    console.error("❌ Error en checkServerState:", err);
    if (browser) await browser.close();
    return { status: "Error obteniendo estado", isOnline: false };
  }
}

// -------------------- 5. MANEJO DE INTERACCIONES --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // IMPORTANTE: deferReply evita el error "Unknown interaction"
  // Le da al bot 15 minutos para responder en lugar de 3 segundos
  await interaction.deferReply(); 

  try {
    switch (interaction.commandName) {
      case "estado":
        const state = await checkServerState();
        let emoji = state.status.toLowerCase().includes("offline") ? "🔴" : "🟢";
        if (state.status.toLowerCase().includes("starting")) emoji = "⏳";
        
        await interaction.editReply(`📡 **Estado:** ${state.status} ${emoji}`);
        break;

      case "jugadores":
        // Aternos no muestra jugadores fácilmente sin prenderlo y hacer scrape complejo
        // Por ahora devolvemos lo guardado o un mensaje genérico
        await interaction.editReply(`👥 **Jugadores:** ${players} (Solo visible si el servidor reporta query)`);
        break;

      case "start":
        await interaction.editReply("🚀 **Intentando iniciar servidor...** (Esto toma unos segundos en verificar)");
        const started = await startServer();
        if (started) {
            await interaction.editReply(`✅ **Comando enviado.** El servidor debería estar iniciándose.\nIP: \`${serverIP}\`\n*Espera unos minutos a que Aternos cargue.*`);
        } else {
            await interaction.editReply("⚠️ **No pude iniciarlo.**\nPosibles causas:\n1. Ya está encendido.\n2. Hay cola de espera.\n3. Aternos pidió captcha (no puedo resolverlo).");
        }
        break;

      case "stop":
        await interaction.editReply("🛑 **Intentando apagar servidor...**");
        const stopped = await stopServer();
        if (stopped) {
            await interaction.editReply("✅ **Comando enviado.** El servidor se está apagando.");
        } else {
            await interaction.editReply("⚠️ **No pude apagarlo.** Probablemente ya esté apagado.");
        }
        break;
    }
  } catch (error) {
    console.error(error);
    await interaction.editReply("❌ **Error crítico:** Algo falló al intentar conectar con Aternos. Revisa la consola de Render.");
  }
});

// -------------------- START --------------------
client.login(process.env.TOKEN);
