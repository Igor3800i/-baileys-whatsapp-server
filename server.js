// ============ POLYFILL CRYPTO - DEVE SER A PRIMEIRA LINHA ============
try {
  const { webcrypto } = require('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
} catch (e) {
  console.error('Falha ao configurar crypto:', e);
}

// ============ IMPORTS ============
const express = require('express');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;
let lastQR = null;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 5;

const authPath = path.join(os.tmpdir(), 'baileys_auth');

async function connectWhatsApp() {
  if (connectionAttempts >= MAX_ATTEMPTS) {
    console.log('⚠️ Máximo de tentativas atingido. Aguardando 30s...');
    setTimeout(() => {
      connectionAttempts = 0;
      connectWhatsApp();
    }, 30000);
    return;
  }

  connectionAttempts++;
  console.log(`🔄 Tentativa de conexão #${connectionAttempts}`);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome', '110', '0.0'],
      syncFullHistory: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        connectionAttempts = 0;
        console.log('✅ QR CODE GERADO!');
      }

      if (connection === 'close') {
        isConnected = false;
        lastQR = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`🔴 Conexão fechada. Código: ${statusCode}`);

        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(), 3000);
        } else {
          console.log('🚪 Sessão encerrada (logout). Reinicie o servidor.');
        }
      }

      if (connection === 'open') {
        isConnected = true;
        connectionAttempts = 0;
        lastQR = null;
        console.log('✅ WhatsApp CONECTADO!');
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error('❌ Erro ao conectar:', error.message);
    setTimeout(() => connectWhatsApp(), 5000);
  }
}

app.get('/', (req, res) => {
  const qrLink = lastQR
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(lastQR)}`
    : null;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Baileys WhatsApp</title>
      <meta http-equiv="refresh" content="3">
      <style>
        body { font-family: Arial; text-align: center; padding: 40px; background: #f0f0f0; }
        .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; }
        h1 { color: #25D366; }
        .status { font-size: 18px; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        img { max-width: 350px; margin: 20px 0; border: 2px solid #25D366; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 Baileys WhatsApp</h1>
        <div class="status ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? '✅ CONECTADO' : '⏳ AGUARDANDO SCAN'}
        </div>
        ${qrLink
          ? `<p>Escaneie com seu WhatsApp:</p><img src="${qrLink}" alt="QR Code">`
          : `<p>${isConnected ? 'Sessão ativa!' : 'Gerando QR Code... (atualiza em 3s)'}</p>`
        }
        <p><a href="/status">Status JSON</a></p>
      </div>
    </body>
    </html>
  `);
});

app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!isConnected || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado' });
    }

    if (!phone || !message) {
      return res.status(400).json({ error: 'phone e message são obrigatórios' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });

    res.json({ success: true, to: jid });
  } catch (error) {
    console.error('Erro ao enviar:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    qrReady: !!lastQR,
    attempts: connectionAttempts,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  connectWhatsApp();
});
