import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import Pino from 'pino'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import path, { dirname } from 'path'
import { botName, sessionPath } from './config.js'
import { handleMessage, handleParticipantsUpdate } from './handler.js'

config()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let conn
let reconnectTimer
let loginConfirmed = false
let reconnectAttempts = 0
const maxReconnectAttempts = 10

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version } = await fetchLatestBaileysVersion()

  if (conn?.end) {
    conn.end()
    conn = null
  }

  conn = makeWASocket({
    logger: Pino({ level: 'fatal' }),
    printQRInTerminal: true,
    auth: state,
    version
  })

  conn.ev.on('creds.update', saveCreds)

  conn.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('Scan den WhatsApp QR-Code im Terminal:')
      qrcode.generate(qr, { small: true })
    }
    const statusCode = lastDisconnect?.error?.output?.statusCode
    const statusMessage = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message || 'Unbekannter Grund'

    if (connection === 'connecting') {
      console.log(`${botName} stellt die Verbindung her...`)
      return
    }

    if (connection === 'open') {
      console.log(`${botName} ist verbunden`)
      reconnectAttempts = 0
      loginConfirmed = true
      if (conn.user?.id) {
        try {
          await conn.sendMessage(conn.user.id, { text: '✅ Login erfolgreich. Ich bin jetzt verbunden.' })
        } catch (error) {
          console.warn('Login-Bestätigung konnte nicht gesendet werden:', error.message || error)
        }
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      return
    }

    if (connection === 'close') {
      console.log(`Verbindung geschlossen: ${statusCode} - ${statusMessage}`)
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('Abgemeldet. Bitte neu anmelden.')
        return
      }
      if (reconnectAttempts >= maxReconnectAttempts) {
        console.log('Maximale Reconnect-Versuche erreicht. Bitte überprüfe die Verbindung und starte den Bot bei Bedarf manuell neu.')
        return
      }

      reconnectAttempts += 1
      const retryDelay = Math.min(60000, 5000 * reconnectAttempts)
      if (!reconnectTimer) {
        console.log(`Erneuter Verbindungsversuch in ${retryDelay / 1000} Sekunden... (Versuch ${reconnectAttempts}/${maxReconnectAttempts})`)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          start()
        }, retryDelay)
      }
    }
  })

  conn.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      await handleMessage(chatUpdate, conn)
    } catch (error) {
      console.error('Fehler beim Verarbeiten der Nachricht:', error)
    }
  })

  conn.ev.on('group-participants.update', async (update) => {
    try {
      await handleParticipantsUpdate(update, conn)
    } catch (error) {
      console.error('Fehler im Gruppen-Teilnehmer-Update:', error)
    }
  })
}

start().catch((error) => console.error('Startfehler:', error))
