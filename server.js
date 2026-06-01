const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');

const app = express();
app.use(express.json());

let sock = null;
let qrCode = null;
let isConnected = false;

const logger = pino();

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QRCode.generate(qr, { small: true });
      qrCode = qr;
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
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
}

// POST para enviar mensagens
app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!isConnected) {
      return res.status(503).json({ error: 'WhatsApp não conectado' });
    }

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone e message são obrigatórios' });
    }

    // Formata o número
    const cleanPhone = phone.replace(/\D/g, '');
    const jid = cleanPhone.endsWith('@s.whatsapp.net') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });

    res.json({ success: true, message: 'Mensagem enviada!' });
  } catch (error) {
    console.error('Erro ao enviar:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET para verificar status
app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    qrCode: qrCode,
  });
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  connectWhatsApp();
});
