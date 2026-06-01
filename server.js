const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;

async function connectWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(), 3000);
        } else {
          isConnected = false;
        }
      } else if (connection === 'open') {
        isConnected = true;
        console.log('✅ WhatsApp conectado!');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Erro ao conectar:', error);
    setTimeout(() => connectWhatsApp(), 5000);
  }
}

app.get('/', (req, res) => {
  res.send(`
    <h1>📱 Baileys WhatsApp Server</h1>
    <p>Status: ${isConnected ? '✅ Conectado' : '⏳ Desconectado'}</p>
    <p>Verifique o console/logs do Render para ver o QR Code</p>
  `);
});

app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!isConnected || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado' });
    }

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone e message obrigatórios' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor na porta ${PORT}`);
  connectWhatsApp();
});
