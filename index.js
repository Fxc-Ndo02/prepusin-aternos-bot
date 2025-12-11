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

// -------------------- 4. FUNCIONES PUPPETEER (LOGIN AUTOMÁTICO) --------------------

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

// Función de login restaurada y con tolerancia de tiempo
async function loginAternos(page) {
  // Disfrazar User Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
  
  // Aumentar el timeout general de navegación
  page.setDefaultNavigationTimeout(180000); // 3 minutos

  console.log("🔑 Navegando a Aternos para iniciar sesión...");
  await page.goto("https://aternos.org/go/", { waitUntil: "networkidle2" });

  const usernameSelector = "input.username"; 
  const passwordSelector = "input[type='password']"; 
  const submitButtonSelector = "#login button[type='submit']";
  
  try {
    // Esperamos hasta 120 segundos (2 minutos) para que Cloudflare termine su verificación
    console.log("⏳ Esperando página de login o que Cloudflare termine (MAX 2 min)...");
    await page.waitForSelector(usernameSelector, { visible: true, timeout: 120000 }); 
    console.log("✅ Login detectado. Escribiendo credenciales...");
    
    await page.type(usernameSelector, process.env.ATERNOS_EMAIL, { delay: 75 });
    await page.type(passwordSelector, process.env.ATERNOS_PASSWORD, { delay: 75 });

    console.log("📤 Click entrar...");
    await page.click(submitButtonSelector);

  } catch (error) {
    const pageTitle = await page.title();
    if (pageTitle.includes("Just a moment") || pageTitle.includes("Cloudflare")) {
        // Error específico que indica que el tiempo de espera no fue suficiente
        throw new Error(`Fallo: Cloudflare bloqueó la IP de Render (Título: '${pageTitle}').`);
    }
    // Otro error de login
    throw new Error(`Fallo Login. Título: '${pageTitle}'. Error: ${error.message}`);
  }

  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log("🌐 Entrando al servidor...");
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
    await loginAternos(page); // LLAMADA RESTAURADA

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
    await loginAternos(page); // LLAMADA RESTAURADA

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
    await loginAternos(page); // LLAMADA RESTAURADA

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

// -------------------- 5. MANEJO DE INTERACCIONES (BLINDADO Y OPTIMIZADO) --------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Paso 1: CONFIRMAR INMEDIATAMENTE la interacción
  try {
      await interaction.deferReply({ flags: 0 }); 
  } catch (error) {
      console.error("⚠️ Error al hacer deferReply (Discord timeout, ignorado):", error.message);
      return; 
  }

  // Paso 2: Ejecutar la lógica pesada (Puppeteer)
  try {
    await interaction.editReply("⏳ **Conectando...** Esto puede tardar hasta 2 minutos debido al servidor gratuito de Render.");

    switch (interaction.commandName) {
      case "estado":
        const state = await checkServerState();
        await interaction.editReply(`📡 **Estado:** ${state.status}`);
        break;

      case "jugadores":
        await interaction.editReply(`👥 **Jugadores:** ${players}`);
        break;

      case "start":
        await interaction.editReply("🚀 **Iniciando protocolo...** (Esperando login y carga de página)");
        const started = await startServer();
        if (started) {
            await interaction.editReply(`✅ **Comando aceptado.** Aternos iniciando.\nIP: \`${serverIP}\``);
        } else {
            await interaction.editReply("⚠️ **No se pudo iniciar.** Puede que ya esté ON.");
        }
        break;

      case "stop":
        await interaction.editReply("🛑 **Apagando...** (Esperando login y carga de página)");
        const stopped = await stopServer();
        if (stopped) {
            await interaction.editReply("✅ **Comando aceptado.** Apagando servidor.");
        } else {
            await interaction.editReply("⚠️ **Error.** Ya está apagado o inaccesible.");
        }
        break;
    }
  } catch (error) {
    console.error("Error en la lógica del comando (Puppeteer):", error);
    
    if (interaction.deferred && !interaction.replied) {
        // Reporta el error más probable: Bloqueo de Cloudflare.
        const errorMessage = error.message.includes("Cloudflare") ? 
                             "❌ **Error:** Falla en el login. Cloudflare bloqueó la IP de Render, intenta de nuevo en unos minutos." :
                             `❌ **Error interno:** ${error.message.substring(0, 100)}... Revisa el log de Render.`;
                             
        await interaction.editReply(errorMessage);
    }
  }
});

// Evitar que el bot muera por errores no manejados
process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection (Bot no crashea):', error);
});

client.login(process.env.TOKEN);
