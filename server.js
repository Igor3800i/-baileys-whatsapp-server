const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;
let lastQR = null;
let connectionAttempts = 0;

async function connectWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome', '120.0.1080.0', 'Windows 10'],
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        lastQR = qr;
        console.log('\n🔐 NOVO QR CODE GERADO - ESCANEIE AGORA!\n');
        console.log('Link para visualizar: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          connectionAttempts++;
          console.log(`Tentando reconectar... (${connectionAttempts})`);
          setTimeout(() => connectWhatsApp(), 3000);
        } else {
          isConnected = false;
          console.log('❌ WhatsApp desconectado permanentemente');
        }
      } else if (connection === 'open') {
        isConnected = true;
        connectionAttempts = 0;
        lastQR = null;
        console.log('✅ WhatsApp conectado com sucesso!');
      }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async (m) => {
      console.log('📨 Nova mensagem recebida');
    });
  } catch (error) {
    console.error('❌ Erro ao conectar:', error.message);
    setTimeout(() => connectWhatsApp(), 5000);
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
        body { font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0f0f0; }
        .container { background: white; padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #25D366; }
        .status { font-size: 18px; margin: 20px 0; padding: 15px; border-radius: 5px; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        img { max-width: 300px; margin: 20px 0; border: 2px solid #25D366; padding: 10px; }
        p { color: #666; }
        a { color: #25D366; text-decoration: none; }
      </style>
      <meta http-equiv="refresh" content="5">
    </head>
    <body>
      <div class="container">
        <h1>📱 Baileys WhatsApp Server</h1>
        <div class="status ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? '✅ CONECTADO' : '⏳ AGUARDANDO QR CODE'}
        </div>
        ${qrLink ? `
          <p>📸 Escaneie este QR Code com seu WhatsApp:</p>
          <img src="${qrLink}" alt="QR Code">
          <p><small>Se a imagem não aparecer, <a href="${qrLink}" target="_blank">clique aqui</a></small></p>
        ` : '<p>Gerando QR Code... Aguarde alguns segundos.</p>'}
        <p><a href="/status">Ver Status JSON</a></p>
      </div>
    </body>
    </html>
  `);
});

app.post('/send-message', async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!isConnected || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado', connected: false });
    }

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone e message obrigatórios' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });
    console.log(`✅ Mensagem enviada para ${phone}`);
    res.json({ success: true, message: 'Mensagem enviada!' });
  } catch (error) {
    console.error('Erro ao enviar:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    hasQR: !!lastQR,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor na porta ${PORT}`);
  console.log(`📍 URL: https://baileys-whatsapp-server-eagw.onrender.com`);
  connectWhatsApp();
});
