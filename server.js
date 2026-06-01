const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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

// Usar /tmp do sistema ao invés de ./auth_info
const authPath = path.join(os.tmpdir(), 'baileys_auth');

async function connectWhatsApp() {
  if (connectionAttempts >= MAX_ATTEMPTS) {
    console.log('⚠️ Máximo de tentativas atingido. Aguardando...');
    setTimeout(() => {
      connectionAttempts = 0;
      connectWhatsApp();
    }, 10000);
    return;
  }

  try {
    console.log(`🔄 Tentativa de conexão #${connectionAttempts + 1}`);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'error' }),
      browser: ['Ubuntu', '20.04', 'Desktop'],
      syncFullHistory: false,
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        console.log('✅ QR CODE GERADO - ESCANEIE AGORA!');
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`Connection closed: ${statusCode}`);
        
        if (statusCode !== DisconnectReason.loggedOut) {
          connectionAttempts++;
          setTimeout(() => connectWhatsApp(), 2000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        connectionAttempts = 0;
        lastQR = null;
        console.log('✅ WhatsApp CONECTADO!');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Erro:', error.message);
    connectionAttempts++;
    setTimeout(() => connectWhatsApp(), 3000);
  }
}

app.get('/', (req, res) => {
  const qrLink = lastQR ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(lastQR)}` : null;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Baileys WhatsApp</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 40px; background: #f0f0f0; }
        .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; }
        h1 { color: #25D366; }
        .status { font-size: 18px; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        img { max-width: 300px; margin: 20px 0; }
      </style>
      <meta http-equiv="refresh" content="3">
    </head>
    <body>
      <div class="container">
        <h1>📱 Baileys WhatsApp</h1>
        <div class="status ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? '✅ CONECTADO' : '⏳ AGUARDANDO SCAN'}
        </div>
        ${qrLink ? `<img src="${qrLink}" alt="QR">` : '<p>Gerando QR Code...</p>'}
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
      return res.status(503).json({ error: 'Não conectado' });
    }
    const cleanPhone = phone.replace(/\D/g, '');
    await sock.sendMessage(`${cleanPhone}@s.whatsapp.net`, { text: message });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected, qrReady: !!lastQR });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🚀 Servidor iniciado');
  connectWhatsApp();
});
