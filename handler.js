import { Jimp, JimpMime } from 'jimp'
import { botName, ownerJids } from './config.js'

const pendingGroupJoin = new Set()
const groupXpEnabled = new Map()
const groupWelcomeEnabled = new Map()
const groupLanguage = new Map()
const languagePollSent = new Set()
const userXp = new Map()
const userLevel = new Map()
const afkUsers = new Map()
const lastUserMessageKey = new Map()
const groupMessageHistory = new Map()

const rankList = [
  { name: 'Neuling', minLevel: 1 },
  { name: 'Lehrling', minLevel: 3 },
  { name: 'Veteran', minLevel: 6 },
  { name: 'Rang A', minLevel: 10 },
  { name: 'Rang B', minLevel: 20 },
  { name: 'Rang C', minLevel: 30 },
  { name: 'Rang D', minLevel: 40 },
  { name: 'Rang S', minLevel: 50 }
]

function getGroupUserKey(groupId, userId) {
  return `${groupId}|${userId}`
}

function getRankName(level) {
  let rank = rankList[0].name
  for (const item of rankList) {
    if (level >= item.minLevel) rank = item.name
    else break
  }
  return rank
}

function getRankListText() {
  return rankList.map((item) => `• ${item.name}: Ab Level ${item.minLevel}`).join('\n')
}

function getTextFromMessage(message) {
  const content = Object.values(message.message)[0]
  if (typeof content === 'string') return content
  return content?.conversation || content?.extendedTextMessage?.text || ''
}

function getMentionedJids(message) {
  const content = Object.values(message.message)[0]
  const contextInfo = content?.extendedTextMessage?.contextInfo || content?.imageMessage?.contextInfo || content?.videoMessage?.contextInfo || content?.stickerMessage?.contextInfo || content?.documentMessage?.contextInfo
  const mentions = contextInfo?.mentionedJid
  if (Array.isArray(mentions) && mentions.length) return mentions

  const text = getTextFromMessage(message)
  const matches = text.match(/@\+?(\d{5,20})/g)
  if (matches?.length) {
    return matches.map((m) => `${m.replace(/[^0-9]/g, '')}@s.whatsapp.net`)
  }
  return []
}

function buildJidFromNumber(number) {
  const digits = String(number || '').replace(/\D/g, '')
  if (!digits) return null
  const normalized = digits.replace(/^00/, '')
  if (normalized.length < 8 || normalized.length > 15) return null
  return `${normalized}@s.whatsapp.net`
}

function getContactName(conn, userId) {
  const contact = conn.contacts?.[userId] || {}
  return contact.notify || contact.name || contact.vname || userId.split('@')[0]
}

function isProbablyBot(conn, userId) {
  const name = getContactName(conn, userId).toLowerCase()
  return /bot|auto|assistant/.test(name)
}

function isOwner(userId) {
  return ownerJids.includes(userId)
}

const supportedLanguages = [
  'English','Deutsch','Español','Français','Português','Italiano','Nederlands','Русский','Türkçe','العربية',
  'اردو','हिन्दी','বাংলা','فارسی','हिंदी-देवनागरी','中文','日本語','한국어','ไทย','Tiếng Việt',
  'Polski','Română','Svenska','Norsk','Dansk','Suomi','Ελληνικά','עברית','Čeština','Magyar'
]

const welcomeTemplates = {
  English: (name) => `👋 Hello everyone! I will speak English now. Welcome ${name}!`,
  Deutsch: (name) => `👋 Hallo zusammen! Ich spreche jetzt Deutsch. Willkommen ${name}!`,
  Español: (name) => `👋 ¡Hola a todos! Hablaré en Español ahora. Bienvenido ${name}!`,
  Français: (name) => `👋 Bonjour à tous! Je parlerai Français maintenant. Bienvenue ${name}!`,
  Português: (name) => `👋 Olá a todos! Falarei Português agora. Bem-vindo ${name}!`,
  Italiano: (name) => `👋 Ciao a tutti! Parlerò Italiano ora. Benvenuto ${name}!`,
  Nederlands: (name) => `👋 Hallo allemaal! Ik spreek nu Nederlands. Welkom ${name}!`,
  Русский: (name) => `👋 Привет всем! Теперь я буду говорить по-русски. Добро пожаловать ${name}!`,
  Türkçe: (name) => `👋 Herkese merhaba! Artık Türkçe konuşacağım. Hoş geldin ${name}!`,
  العربية: (name) => `👋 مرحبًا بالجميع! سأتحدث بالعربية الآن. مرحبًا ${name}!`,
  اردو: (name) => `👋 سب کو سلام! میں اب اردو بولوں گا۔ خوش آمدید ${name}!`,
  हिन्दी: (name) => `👋 नमस्ते सबको! अब मैं हिन्दी बोलूँगा। स्वागत ${name}!`,
  বাংলা: (name) => `👋 সবাইকে স্বাগত! আমি এখন বাংলা বলব। স্বাগতম ${name}!`,
  فارسی: (name) => `👋 سلام بر همه! اکنون فارسی صحبت می‌کنم. خوش آمدید ${name}!`,
  'हिंदी-देवनागरी': (name) => `👋 नमस्ते! मैं अब हिंदी बोलूँगा। स्वागत ${name}!`,
  中文: (name) => `👋 大家好！我现在开始说中文。欢迎 ${name}！`,
  日本語: (name) => `👋 皆さんこんにちは！これから日本語で話します。ようこそ ${name}！`,
  한국어: (name) => `👋 여러분 안녕하세요! 이제 한국어로 말하겠습니다. 환영합니다 ${name}!`,
  ไทย: (name) => `👋 สวัสดีทุกคน! ฉันจะพูดภาษาไทยตอนนี้ ยินดีต้อนรับ ${name}!`,
  'Tiếng Việt': (name) => `👋 Xin chào mọi người! Tôi sẽ nói tiếng Việt bây giờ. Chào mừng ${name}!`,
  Polski: (name) => `👋 Witajcie wszyscy! Teraz będę mówić po polsku. Witamy ${name}!`,
  Română: (name) => `👋 Bună tuturor! Voi vorbi în Română acum. Bine ai venit ${name}!`,
  Svenska: (name) => `👋 Hej allihopa! Jag kommer att prata Svenska nu. Välkommen ${name}!`,
  Norsk: (name) => `👋 Hei alle sammen! Jeg vil snakke Norsk nå. Velkommen ${name}!`,
  Dansk: (name) => `👋 Hej alle! Jeg vil nu tale Dansk. Velkommen ${name}!`,
  Suomi: (name) => `👋 Hei kaikki! Puhun nyt Suomea. Tervetuloa ${name}!`,
  Ελληνικά: (name) => `👋 Γεια σε όλους! Θα μιλήσω Ελληνικά τώρα. Καλώς ήρθατε ${name}!`,
  עברית: (name) => `👋 היי לכולם! אדבר בעברית עכשיו. ברוכים הבאים ${name}!`,
  Čeština: (name) => `👋 Ahoj všichni! Budu mluvit česky. Vítejte ${name}!`,
  Magyar: (name) => `👋 Sziasztok! Mostantól magyarul beszélek. Üdv ${name}!`
}

function getWelcomeFor(language, name) {
  const fn = welcomeTemplates[language] || ((n) => `👋 Hello ${n}!`)
  return fn(name)
}

async function getGroupMetadata(conn, groupId) {
  try {
    return await conn.groupMetadata(groupId)
  } catch {
    return null
  }
}

async function isGroupAdmin(conn, groupId, userId) {
  if (isOwner(userId)) return true
  const metadata = await getGroupMetadata(conn, groupId)
  if (!metadata?.participants) return false
  const participant = metadata.participants.find((p) => p.id === userId)
  return participant?.admin || participant?.admin === 'superadmin'
}

async function isBotAdmin(conn, groupId) {
  const botId = conn.user?.id
  if (!botId) return false
  const metadata = await getGroupMetadata(conn, groupId)
  if (!metadata?.participants) return false
  const participant = metadata.participants.find((p) => p.id === botId)
  return participant?.admin || participant?.admin === 'superadmin'
}

async function announceBotArrival(conn, groupId) {
  const metadata = await getGroupMetadata(conn, groupId)
  if (!metadata) return

  const members = metadata.participants?.map((p) => p.id) || []
  const mentionAll = members.slice(0, 40)
  const mentionText = mentionAll.map(() => '<at>').join(' ')
  // Ask in English which language the group prefers and provide instruction to use /spike
  const available = supportedLanguages.slice(0, 30).join(', ')
  const greetText = `👋 Hello! I am *${botName}*.
I was sent by my developer to help group admins.

Which language do you speak? You can set the group language with /spike <language> (admins only).
Available (examples): ${available}

${mentionText}`

  await conn.sendMessage(groupId, {
    text: greetText,
    contextInfo: { mentionedJid: mentionAll }
  })

  // send a one-time admin prompt (store to avoid repeated prompts)
  if (!languagePollSent.has(groupId)) {
    const admins = metadata.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id)
    if (admins.length) {
      languagePollSent.add(groupId)
      await conn.sendMessage(groupId, {
        text: `🔔 Admins: Please choose the group language by replying with /spike <language>. Only admins can change it.`,
        contextInfo: { mentionedJid: admins }
      })
    }
  }

  return
}

async function sendGroupReply(conn, jid, text, quoted) {
  return conn.sendMessage(jid, { text }, { quoted })
}

function getPingMs(message) {
  const ts = message.messageTimestamp || message.message?.timestamp
  if (!ts) return null
  return Math.max(0, Date.now() - Number(ts) * 1000)
}

async function getProfilePicture(conn, userId) {
  try {
    const url = await conn.profilePictureUrl(userId, 'image')
    if (!url) return null
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const image = await Jimp.read(buffer)
    return await image.getBufferAsync(JimpMime.png)
  } catch {
    return null
  }
}

function buildQuotedMessageKey(from, contextInfo) {
  const stanzaId = contextInfo?.stanzaId || contextInfo?.id
  if (!stanzaId) return null
  return {
    remoteJid: from,
    id: stanzaId,
    participant: contextInfo?.participant
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createProgressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

async function sendLoadingProgress(conn, jid, initialText, quoted, durationMs = 120000) {
  const steps = 20
  const stepMs = Math.max(250, Math.floor(durationMs / steps))
  const response = await conn.sendMessage(jid, {
    text: `${initialText}\nLädt: 1% ${createProgressBar(1)}`
  }, { quoted })

  const progressKey = response.key
  for (let i = 1; i < steps; i++) {
    const percent = i * 5
    await sleep(stepMs)
    await conn.sendMessage(jid, {
      text: `${initialText}\nLädt: ${percent}% ${createProgressBar(percent)}`,
      edit: progressKey
    })
  }

  await sleep(stepMs)
  await conn.sendMessage(jid, {
    text: `${initialText}\nFertig geladen ✅`,
    edit: progressKey
  })

  return progressKey
}

function parseTikTokProfile(html, username) {
  const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>(.*?)<\/script>/s)
  const windowMatch = html.match(/window\['SIGI_STATE'\]\s*=\s*({.*?});\s*<\/script>/s)
  const jsonText = sigiMatch?.[1] || windowMatch?.[1]
  if (!jsonText) return null

  const data = JSON.parse(jsonText)
  const users = data?.UserModule?.users || {}
  const stats = data?.UserModule?.stats || {}
  const userData = users[username] || Object.values(users)[0]
  if (!userData) return null

  const userId = userData.id
  const userStats = stats[userId] || {}
  return {
    uniqueId: userData.uniqueId || username,
    nickname: userData.nickname || userData.shortId || username,
    bio: userData.signature || userData.bioDescription || '',
    avatar: userData.avatarLarger || userData.avatarMedium || userData.avatarThumb || null,
    followerCount: userStats.followerCount || 0,
    followingCount: userStats.followingCount || 0,
    heartCount: userStats.heart || 0,
    videoCount: userStats.videoCount || 0,
    verified: userData.verified || false,
    private: userData.privateAccount || false,
    tiktokUrl: `https://www.tiktok.com/@${userData.uniqueId || username}`
  }
}

async function fetchTikTokProfile(username) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  })
  if (!response.ok) {
    throw new Error(`TikTok konnte nicht geladen werden (${response.status}).`)
  }
  const html = await response.text()
  const profile = parseTikTokProfile(html, username.toLowerCase())
  if (!profile) {
    throw new Error('Konnte TikTok-Profilinformationen nicht finden.')
  }
  return profile
}

async function greetNewMember(conn, groupId, userId) {
  const level = userLevel.get(getGroupUserKey(groupId, userId)) || 1
  const xp = userXp.get(getGroupUserKey(groupId, userId)) || 0
  const welcomeText = `👋 Willkommen <at>!\n` +
    `⭐ Level: ${level}\n` +
    `💠 XP: ${xp}\n` +
    `Schön, dass du in der Gruppe bist!`
  const ppUrl = await getProfilePicture(conn, userId)

  if (ppUrl) {
    return await conn.sendMessage(groupId, {
      image: { url: ppUrl },
      caption: welcomeText,
      contextInfo: { mentionedJid: [userId] }
    })
  }

  return await conn.sendMessage(groupId, {
    text: welcomeText,
    contextInfo: { mentionedJid: [userId] }
  })
}

export async function handleMessage(chatUpdate, conn) {
  if (!chatUpdate?.messages?.length) return
  const message = chatUpdate.messages[chatUpdate.messages.length - 1]
  const ownJid = conn.user?.id || conn.user?.jid
  if (!message || !message.message) return
  if (message.key.fromMe) return
  if (message.key.participant === ownJid || message.key.remoteJid === ownJid) return

  const from = message.key.remoteJid
  const sender = message.key.participant || from
  const isGroup = from?.endsWith('@g.us')
  const text = getTextFromMessage(message)
  const trimmed = text.trim()
  if (!trimmed) return

  const isCommand = trimmed.startsWith('/')
  const historyKey = `${from}|${sender}`
  if (!isCommand) {
    lastUserMessageKey.set(historyKey, message.key)
  }
  if (isGroup) {
    const history = groupMessageHistory.get(from) || []
    history.push(message.key)
    if (history.length > 120) history.shift()
    groupMessageHistory.set(from, history)
  }

  if (isGroup && afkUsers.has(sender)) {
    afkUsers.delete(sender)
    await conn.sendMessage(from, {
      text: `✅ <at> ist nicht mehr AFK. Willkommen zurück!`,
      contextInfo: { mentionedJid: [sender] }
    }, { quoted: message })
    return
  }

  if (isGroup) {
    const mentionedJids = getMentionedJids(message)
    const afkNotices = mentionedJids
      .map((jid) => ({ jid, data: afkUsers.get(jid) }))
      .filter((entry) => entry.data)

    if (afkNotices.length) {
      const replies = afkNotices.map((entry) => `🔕 <at> ist AFK: ${entry.data.reason}`).join('\n')
      await conn.sendMessage(from, { text: replies, contextInfo: { mentionedJid: afkNotices.map((entry) => entry.jid) } }, { quoted: message })
      return
    }
  }

  const command = trimmed.split(/\s+/)[0].toLowerCase()
  const args = trimmed.slice(command.length).trim()

  if (command === '/menu') {
    const menuText = `*${botName} Menü*\n\n` +
      '/join <chat.whatsapp.com/xxxx>\n' +
      '/info oder /-info\n' +
      '/help oder /-help\n' +
      '/myinfo\n' +
      '/ranklist\n' +
      '/profile @user\n' +
      '/tiktok <username> pro\n' +
      '/kick @user\n' +
      '/kick all user\n' +
      '/add <nummer> - Fügt einen Nutzer anhand der internationalen Nummer zur Gruppe hinzu.\n' +
      '/like - Markiert alle Nutzer in der Gruppe.\n' +
      '/addp <bild-url>\n' +
      '/be - Begrüßungen an/aus\n' +
      '/xp on | /xp off\n' +
      '/afk <grund>\n' +
      '/lesve oder /leave - Bot verlässt die Gruppe\n' +
      '/xp - Zeigt den aktuellen XP-Status\n\n' +
      'Nur Admins oder der Owner können Gruppenbefehle verwenden, und der Bot muss Admin sein.'
    return await sendGroupReply(conn, from, menuText, message)
  }

  if (command === '/join') {
    if (isGroup) {
      return await conn.sendMessage(from, { text: '✳️ Bitte sende mir den /join Befehl privat mit dem Gruppenlink.' }, { quoted: message })
    }

    const match = args.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i)
    if (!match) {
      return await conn.sendMessage(from, { text: '✳️ Ungültiger Gruppenlink. Bitte sende einen gültigen chat.whatsapp.com Link.' }, { quoted: message })
    }

    const code = match[1]
    await conn.sendMessage(from, { text: '😎 Ich trete der Gruppe bei...' }, { quoted: message })

    try {
      const groupId = await conn.groupAcceptInvite(code)
      pendingGroupJoin.add(groupId)
      await conn.sendMessage(from, { text: `✅ Ich bin der Gruppe beigetreten: ${groupId}` }, { quoted: message })
      await announceBotArrival(conn, groupId)
    } catch (error) {
      await conn.sendMessage(from, { text: `❌ Fehler beim Betreten der Gruppe: ${error?.message || error}` }, { quoted: message })
    }
    return
  }

  const infoCommands = ['/info', '/-info']
  const helpCommands = ['/help', '/-help']

  if (infoCommands.includes(command)) {
    const uptime = new Date(process.uptime() * 1000).toISOString().substr(11, 8)
    const ping = getPingMs(message)
    const infoText = `*${botName} Information*\n\n` +
      '🔹 Status: Online\n' +
      `🔹 Derping: aktiv\n` +
      `🔹 Uptime: ${uptime}\n` +
      (ping !== null ? `🔹 Ping: ${ping} ms\n` : '') +
      '🔹 Modus: Privat /join only\n' +
      '🔹 Hilfe: /menu'
    return await sendGroupReply(conn, from, infoText, message)
  }

  if (helpCommands.includes(command)) {
    const helpText = `*${botName} Hilfe*\n\n` +
      '/join <chat.whatsapp.com/xxxx> - Der Bot tritt der Gruppe privat über den Einladungslink bei.\n' +
      '/menu - Zeigt dieses Menü mit allen verfügbaren Befehlen.\n' +
      '/info oder /-info - Zeigt allgemeine Bot-Informationen, Status und Uptime.\n' +
      '/help oder /-help - Zeigt diese ausführliche Hilfe mit wichtigen Befehlen.\n' +
      '/ping - Zeigt nur die aktuelle Verbindungslatenz zum Bot an.\n' +
      '/bot - Erzählt wer ich bin, wie ich entstanden bin und worin meine Aufgabe besteht.\n' +
      '/myinfo - Zeigt dein persönliches Profil, dein Level, XP und Rang an.\n' +
      '/ranklist - Listet alle verfügbaren Ränge im XP-System auf.\n' +
      '/profile @user - Sendet das Profilbild eines markierten Nutzers.\n' +
      '/tiktok <username> pro - Ruft Informationen zu einem TikTok-Profil ab.\n' +
      '/kick @user - Entfernt einen einzelnen Nutzer aus der Gruppe (Admin).\n' +
      '/kick all user - Entfernt alle nicht-admin Nutzer aus der Gruppe.\n' +
      '/add <nummer> - Fügt einen Nutzer anhand der internationalen Nummer hinzu.\n' +
      '/like - Markiert alle Nutzer in der Gruppe.\n' +
      '/addp <bild-url> - Setzt das Gruppenbild mit dem angegebenen Link.\n' +
      '/be - Aktiviert oder deaktiviert Begrüßungen in dieser Gruppe.\n' +
      '/xp on | /xp off - Schaltet das XP-System in der Gruppe ein oder aus.\n' +
      '/afk <grund> - Setzt deinen AFK-Status mit einem Grund.\n' +
      '/lesve oder /leave - Lässt den Bot die Gruppe verlassen.\n\n' +
      'Hinweis: Nur Admins oder der Owner können Gruppenbefehle verwenden, und der Bot muss Admin sein.'
    return await sendGroupReply(conn, from, helpText, message)
  }

  const pingCommands = ['/ping']
  const botCommands = ['/bot']

  if (pingCommands.includes(command)) {
    const ping = getPingMs(message)
    const pingText = ping !== null
      ? `🏓 Pong! Verbindungslatenz: ${ping} ms`
      : '🏓 Pong! Verbindungslatenz konnte nicht ermittelt werden.'
    return await sendGroupReply(conn, from, pingText, message)
  }

  if (botCommands.includes(command)) {
    const botText = `*${botName}*\n\n` +
      '👤 Ich bin ein Gruppenhelfer-Bot, entwickelt, um Admins und Gruppen zu unterstützen.\n' +
      '🧠 Mein Entwickler ist Felix / Errox1322.\n' +
      '📅 Geboren: 03.04.2206.\n' +
      '💻 Ich habe seit 4 Jahren Programmier-Erfahrung gesammelt.\n' +
      '🚀 Seit 2024 helfe ich größeren Gruppen als Projekt Alpha sAura MD.\n' +
      '🤖 Meine Aufgabe ist es, Gruppenmoderation, Begrüßungen, XP und nützliche Verwaltungsbefehle zu übernehmen.'
    return await sendGroupReply(conn, from, botText, message)
  }

  if (command === '/profile') {
    const mentionedJids = getMentionedJids(message)
    const quotedSender = message.message?.extendedTextMessage?.contextInfo?.participant
    const target = mentionedJids[0] || quotedSender || sender
    if (!target) {
      return await sendGroupReply(conn, from, '❌ Kein Nutzer gefunden. Markiere jemanden oder nutze /profile im Chat.', message)
    }

    const contact = conn.contacts?.[target] || {}
    const name = contact.notify || contact.name || contact.vname || target.split('@')[0]
    const number = target.split('@')[0]
    const caption = `📸 Profilbild von ${name}\n📱 Nummer: ${number}`

    const ppPromise = getProfilePicture(conn, target)
    await sendLoadingProgress(conn, from, `🔎 Profil wird geladen für ${name}...`, message, 5000)
    const ppUrl = await ppPromise

    if (!ppUrl) {
      return await sendGroupReply(conn, from, `❌ Profilbild konnte nicht geladen werden.\nName: ${name}\nNummer: ${number}`, message)
    }

    return await conn.sendMessage(from, { image: { url: ppUrl }, caption }, { quoted: message })
  }

  if (command === '/tiktok') {
    const parts = args.split(/\s+/).filter(Boolean)
    const username = parts[0]?.replace(/^@/, '')
    const proFlag = parts[1]?.toLowerCase() === 'pro'

    if (!username || !proFlag) {
      return await sendGroupReply(conn, from, '✳️ Bitte nutze: /tiktok <username> pro', message)
    }

    const progressText = `🔎 TikTok-Profil wird geladen: @${username}`
    await sendLoadingProgress(conn, from, progressText, message)

    try {
      const profile = await fetchTikTokProfile(username)
      const info = `*TikTok Profi*\n\n` +
        `👤 Name: ${profile.nickname}\n` +
        `🔗 Profil: ${profile.tiktokUrl}\n` +
        `⭐ Verifiziert: ${profile.verified ? 'Ja' : 'Nein'}\n` +
        `🔒 Privat: ${profile.private ? 'Ja' : 'Nein'}\n` +
        `👥 Abos: ${profile.followerCount}\n` +
        `👤 Folgt: ${profile.followingCount}\n` +
        `❤️ Likes: ${profile.heartCount}\n` +
        `🎬 Beiträge: ${profile.videoCount}\n` +
        `📝 Bio: ${profile.bio || 'Keine Bio verfügbar.'}`

      if (profile.avatar) {
        return await conn.sendMessage(from, {
          image: { url: profile.avatar },
          caption: info
        }, { quoted: message })
      }

      return await sendGroupReply(conn, from, info, message)
    } catch (error) {
      return await sendGroupReply(conn, from, `❌ TikTok-Profil konnte nicht abgerufen werden: ${error.message || error}`, message)
    }
  }

  if (command === '/add') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Gruppenadmins oder der Owner können Nutzer hinzufügen.', message)
    }
    if (!await isBotAdmin(conn, from)) {
      return await sendGroupReply(conn, from, '⚠️ Ich benötige Adminrechte, um Nutzer hinzuzufügen.', message)
    }
    const number = args.split(/\s+/).find(Boolean)
    const target = buildJidFromNumber(number)
    if (!target) {
      return await sendGroupReply(conn, from, '✳️ Bitte gib eine gültige internationale Nummer an, z.B. /add +491234567890', message)
    }
    if (target === conn.user?.id) {
      return await sendGroupReply(conn, from, '⚠️ Ich kann mich nicht selbst zur Gruppe hinzufügen.', message)
    }
    try {
      await conn.groupParticipantsUpdate(from, [target], 'add')
      return await conn.sendMessage(from, {
        text: '✅ <at> wurde zur Gruppe hinzugefügt.',
        contextInfo: { mentionedJid: [target] }
      }, { quoted: message })
    } catch (error) {
      return await sendGroupReply(conn, from, `❌ Nutzer konnte nicht hinzugefügt werden: ${error?.message || error}`, message)
    }
  }

  if (command === '/like') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    const metadata = await getGroupMetadata(conn, from)
    const participants = metadata?.participants || []
    if (!participants.length) {
      return await sendGroupReply(conn, from, '⚠️ Gruppeninformationen konnten nicht geladen werden.', message)
    }

    const mentionedJid = participants.map((p) => p.id)
    const mentionText = mentionedJid.map(() => '<at>').join(' ')
    const likeText = `❤️ Like für alle!
${mentionText}`
    return await conn.sendMessage(from, {
      text: likeText,
      contextInfo: { mentionedJid }
    }, { quoted: message })
  }

  if (command === '/spike') {
    if (!isGroup) return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    if (!await isGroupAdmin(conn, from, sender)) return await sendGroupReply(conn, from, '⚠️ Nur Admins können die Gruppensprache setzen.', message)

    const chosen = args || ''
    if (!chosen) {
      // list available languages
      const listText = `🌐 Verfügbare Sprachen:\n${supportedLanguages.join(', ')}`
      return await sendGroupReply(conn, from, listText, message)
    }

    // try to match language case-insensitive
    const match = supportedLanguages.find((l) => l.toLowerCase() === chosen.toLowerCase())
    if (!match) return await sendGroupReply(conn, from, `⚠️ Sprache nicht gefunden. Nutze /spike um die Liste anzuzeigen.`, message)

    groupLanguage.set(from, match)
    // announce in the chosen language
    const name = getContactName(conn, sender)
    const welcome = getWelcomeFor(match, '<at>')
    const admins = (await getGroupMetadata(conn, from))?.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id) || []
    await conn.sendMessage(from, {
      text: welcome,
      contextInfo: { mentionedJid: admins.length ? admins : [sender] }
    }, { quoted: message })

    return
  }

  if (command === '/lesve' || command === '/leave') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Gruppenadmins oder der Owner können mich die Gruppe verlassen lassen.', message)
    }
    await conn.sendMessage(from, { text: '👋 Ich wurde geschickt, um den Admins zu helfen. Ich verlasse nun die Gruppe.' }, { quoted: message })
    await conn.groupLeave(from)
    return
  }

  if (command === '/lösche') {
    const lowerArgs = args.toLowerCase()
    const quotedInfo = message.message?.extendedTextMessage?.contextInfo
    const quotedKey = buildQuotedMessageKey(from, quotedInfo)

    if (lowerArgs.startsWith('deine letzte')) {
      const key = lastUserMessageKey.get(historyKey)
      if (!key) {
        return await sendGroupReply(conn, from, '⚠️ Ich habe keine letzte Nachricht zum Löschen gefunden.', message)
      }
      const deleted = await deleteMessage(conn, from, key)
      return await sendGroupReply(conn, from, deleted ? '✅ Deine letzte Nachricht wurde gelöscht.' : '❌ Die Nachricht konnte nicht gelöscht werden.', message)
    }

    if (lowerArgs.startsWith('alle')) {
      if (!isGroup) {
        return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
      }
      if (!await isGroupAdmin(conn, from, sender)) {
        return await sendGroupReply(conn, from, '⚠️ Nur Gruppenadmins können alle Nachrichten löschen.', message)
      }
      if (!await isBotAdmin(conn, from)) {
        return await sendGroupReply(conn, from, '⚠️ Ich brauche Adminrechte, um alle Nachrichten zu löschen.', message)
      }
      const history = groupMessageHistory.get(from) || []
      if (!history.length) {
        return await sendGroupReply(conn, from, '⚠️ Keine Nachrichten zum Löschen gefunden.', message)
      }
      const uniqueKeys = [...new Map(history.map((key) => [`${key.remoteJid}|${key.id}|${key.participant || ''}`, key])).values()]
      let deletedCount = 0
      for (const msgKey of uniqueKeys) {
        const ok = await deleteMessage(conn, from, msgKey)
        if (ok) deletedCount++
      }
      groupMessageHistory.set(from, [])
      return await sendGroupReply(conn, from, `✅ Ich habe ${deletedCount} Nachrichten in dieser Gruppe zum Löschen angefragt.`, message)
    }

    if (quotedKey) {
      const quotedSender = quotedInfo.participant || sender
      if (quotedSender !== sender) {
        if (!isGroup) {
          return await sendGroupReply(conn, from, '⚠️ Ich kann nur eigene Nachrichten in privaten Chats löschen.', message)
        }
        if (!await isGroupAdmin(conn, from, sender)) {
          return await sendGroupReply(conn, from, '⚠️ Nur Admins können fremde Nachrichten löschen.', message)
        }
        if (!await isBotAdmin(conn, from)) {
          return await sendGroupReply(conn, from, '⚠️ Ich brauche Adminrechte, um fremde Nachrichten zu löschen.', message)
        }
      }
      const deleted = await deleteMessage(conn, from, quotedKey)
      return await sendGroupReply(conn, from, deleted ? '✅ Die markierte Nachricht wurde gelöscht.' : '❌ Die markierte Nachricht konnte nicht gelöscht werden.', message)
    }

    return await sendGroupReply(conn, from, '✳️ Verwende /lösche deine letzte nachricht, /lösche markierte nachricht oder /lösche alle.', message)
  }

  if (command === '/ranklist') {
    return await sendGroupReply(conn, from, `*Ränge*\n\n${getRankListText()}`, message)
  }

  if (command === '/myinfo') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    const key = getGroupUserKey(from, sender)
    const level = userLevel.get(key) || 1
    const xp = userXp.get(key) || 0
    const nextThreshold = level * 100
    const needed = Math.max(0, nextThreshold - xp)
    const rank = getRankName(level)
    const contact = conn.contacts?.[sender] || {}
    const name = contact.notify || contact.name || contact.vname || sender.split('@')[0]
    const caption = `👤 ${name}\n⭐ Level: ${level}\n💠 XP: ${xp}\n⏳ Bis nächstes Level: ${needed}\n🏅 Rang: ${rank}`

    await sendLoadingProgress(conn, from, `🔎 Deine Info wird geladen...`, message, 5000)
    const ppUrl = await getProfilePicture(conn, sender)

    if (!ppUrl) {
      return await sendGroupReply(conn, from, `*Deine Info*\n\n${caption}`, message)
    }

    return await conn.sendMessage(from, { image: { url: ppUrl }, caption }, { quoted: message })
  }

  if (command === '/afk') {
    const reason = args || 'AFK'
    afkUsers.set(sender, { reason, since: Date.now() })
    return await sendGroupReply(conn, from, `🔕 Du bist jetzt AFK: ${reason}`, message)
  }

  if (command === '/xp') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Admins können XP ein- oder ausschalten.', message)
    }
    if (args.toLowerCase().startsWith('off')) {
      groupXpEnabled.set(from, false)
      return await sendGroupReply(conn, from, '✅ XP wurde für diese Gruppe deaktiviert.', message)
    }
    if (args.toLowerCase().startsWith('on')) {
      groupXpEnabled.set(from, true)
      return await sendGroupReply(conn, from, '✅ XP wurde für diese Gruppe aktiviert.', message)
    }
    const xpKey = getGroupUserKey(from, sender)
    const level = userLevel.get(xpKey) || 1
    const xp = userXp.get(xpKey) || 0
    return await sendGroupReply(conn, from, `📊 Dein Level: ${level}\n💠 XP: ${xp}`, message)
  }

  if (command === '/be') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Admins können Begrüßungen ein- oder ausschalten.', message)
    }
    const current = groupWelcomeEnabled.get(from) !== false
    groupWelcomeEnabled.set(from, !current)
    const stateText = current ? 'deaktiviert' : 'aktiviert'
    return await sendGroupReply(conn, from, `✅ Begrüßungen wurden ${stateText}.`, message)
  }

  if (command === '/kick') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Admins können Nutzer entfernen.', message)
    }
    if (!await isBotAdmin(conn, from)) {
      return await sendGroupReply(conn, from, '⚠️ Ich benötige Adminrechte, um Nutzer zu entfernen.', message)
    }

    const lowerArgs = args.toLowerCase()
    if (lowerArgs.includes('all')) {
      const metadata = await getGroupMetadata(conn, from)
      const toRemove = metadata?.participants
        .filter((p) => {
          const isBot = p.id === conn.user?.id
          const isAdmin = p.admin === 'admin' || p.admin === 'superadmin'
          return !isBot && !isAdmin
        })
        .map((p) => p.id) || []
      if (!toRemove.length) {
        return await sendGroupReply(conn, from, '⚠️ Es gibt keine nicht-admin Nutzer zum Entfernen.', message)
      }
      await conn.groupParticipantsUpdate(from, toRemove, 'remove')
      return await sendGroupReply(conn, from, `✅ Alle nicht-admin Nutzer wurden entfernt (${toRemove.length}).`, message)
    }

    const mentionedJids = getMentionedJids(message)
    if (!mentionedJids.length) {
      return await sendGroupReply(conn, from, '✳️ Bitte erwähne den Nutzer, den ich entfernen soll.', message)
    }

    const target = mentionedJids[0]
    const targetName = getContactName(conn, target)
    const targetIsBot = isProbablyBot(conn, target)

    if (target === conn.user?.id) {
      await conn.sendMessage(from, { text: `✅ Ich habe mich selbst entfernt.`, contextInfo: { mentionedJid: [target] } }, { quoted: message })
      await conn.groupLeave(from)
      return
    }

    await conn.groupParticipantsUpdate(from, [target], 'remove')
    const botLabel = targetIsBot ? 'Ein anderer Bot' : 'Ein Nutzer'
    return await conn.sendMessage(from, {
      text: `✅ <at> wurde entfernt von *${botName}*.
${botLabel}: ${targetName}`,
      contextInfo: { mentionedJid: [target] }
    }, { quoted: message })
  }

  if (command === '/addp') {
    if (!isGroup) {
      return await sendGroupReply(conn, from, '⚠️ Dieser Befehl funktioniert nur in Gruppen.', message)
    }
    if (!await isGroupAdmin(conn, from, sender)) {
      return await sendGroupReply(conn, from, '⚠️ Nur Admins können das Gruppenbild ändern.', message)
    }
    if (!await isBotAdmin(conn, from)) {
      return await sendGroupReply(conn, from, '⚠️ Ich benötige Adminrechte, um das Gruppenbild zu ändern.', message)
    }
    if (!args) {
      return await sendGroupReply(conn, from, '✳️ Bitte sende einen Bild-Link hinter /addp.', message)
    }
    try {
      const response = await fetch(args)
      if (!response.ok) throw new Error('Bild konnte nicht geladen werden.')
      const buffer = Buffer.from(await response.arrayBuffer())
      const upload = { image: buffer }
      await conn.updateProfilePicture(from, upload)
      return await sendGroupReply(conn, from, '✅ Das Gruppenbild wurde erfolgreich geändert.', message)
    } catch (error) {
      return await sendGroupReply(conn, from, `❌ Gruppenbild konnte nicht aktualisiert werden: ${error.message || error}`, message)
    }
  }

  if (isGroup && groupXpEnabled.get(from) !== false) {
    const key = getGroupUserKey(from, sender)
    const hasLevel = userLevel.has(key)
    const hasXp = userXp.has(key)

    if (!hasLevel && !hasXp) {
      userLevel.set(key, 1)
      userXp.set(key, 0)
      return await conn.sendMessage(from, {
        text: `🎉 <at> hat Level 1 erreicht! Du startest jetzt mit Level 1.`,
        contextInfo: { mentionedJid: [sender] }
      }, { quoted: message })
    }

    const currentLevel = userLevel.get(key) || 1
    const currentXp = userXp.get(key) || 0
    const textLength = Math.max(1, trimmed.length)
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length
    const baseXp = Math.min(8000, Math.max(1, Math.floor(textLength * 3 + wordCount * 10)))
    const gain = Math.min(8000, Math.floor(baseXp * (1 + currentLevel * 0.05)))
    const newXp = currentXp + gain
    const threshold = currentLevel * 1000
    const oldRank = getRankName(currentLevel)

    if (newXp >= threshold) {
      const nextLevel = currentLevel + 1
      userLevel.set(key, nextLevel)
      userXp.set(key, newXp - threshold)
      const newRank = getRankName(nextLevel)
      let levelUpText = `🎉 <at> hat Level ${nextLevel} erreicht!`
      if (newRank !== oldRank) {
        levelUpText += `\n🏅 Neuer Rang: ${newRank}`
      }
      await conn.sendMessage(from, {
        text: levelUpText,
        contextInfo: { mentionedJid: [sender] }
      }, { quoted: message })
    } else {
      userXp.set(key, newXp)
    }
  }
}

export async function handleParticipantsUpdate(update, conn) {
  const { id, participants, action } = update
  if (!id || !participants?.length) return

  const botId = conn.user?.id
  if (!botId) return

  if (participants.includes(botId)) {
    if (action !== 'add') return
    if (pendingGroupJoin.has(id)) {
      pendingGroupJoin.delete(id)
      return
    }
    await conn.sendMessage(id, { text: '⚠️ Ich wurde direkt eingeladen, ohne privaten /join. Ich verlasse diese Gruppe jetzt.' })
    await conn.groupLeave(id)
    return
  }

  if (action === 'add' && groupWelcomeEnabled.get(id)) {
    for (const userId of participants) {
      await greetNewMember(conn, id, userId)
    }
  }
}
