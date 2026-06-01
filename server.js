const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

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
      <meta http-equiv="refres
