const path = require("path")
const crypto = require("crypto")
const express = require("express")
const session = require("express-session")
const http = require("http")
const { Server } = require("socket.io")
require("dotenv").config()

const app = express()
const server = http.createServer(app)

const PORT = process.env.PORT || 3000
const AUTH_USER = process.env.AUTH_USER || ""
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ""
const SESSION_SECRET = process.env.SESSION_SECRET || ""

if (!AUTH_USER || !AUTH_PASSWORD || !SESSION_SECRET) {
  console.warn(
    "AVISO: defina AUTH_USER, AUTH_PASSWORD e SESSION_SECRET no .env para habilitar o login.",
  )
}

app.set("trust proxy", 1)
app.use(express.json())

const sessionMiddleware = session({
  secret: SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  name: "doomtransmit.sid",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12,
  },
})

app.use(sessionMiddleware)

const io = new Server(server)
io.engine.use(sessionMiddleware)

function safeCompare(a, b) {
  const hash = (value) =>
    crypto
      .createHmac("sha256", SESSION_SECRET || "fallback")
      .update(String(value))
      .digest()
  return crypto.timingSafeEqual(hash(a), hash(b))
}

const loginAttempts = new Map()
const MAX_ATTEMPTS = 5
const ATTEMPTS_WINDOW_MS = 5 * 60 * 1000

function isRateLimited(ip) {
  const entry = loginAttempts.get(ip)
  if (!entry) return false
  if (Date.now() - entry.firstAttempt > ATTEMPTS_WINDOW_MS) {
    loginAttempts.delete(ip)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function registerFailedAttempt(ip) {
  const entry = loginAttempts.get(ip)
  if (!entry || Date.now() - entry.firstAttempt > ATTEMPTS_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() })
  } else {
    entry.count += 1
  }
}

app.post("/api/login", (req, res) => {
  const ip = req.ip
  if (isRateLimited(ip)) {
    return res
      .status(429)
      .json({ error: "Muitas tentativas. Tente novamente em alguns minutos." })
  }

  const { username, password } = req.body || {}
  const validUser =
    typeof username === "string" && safeCompare(username, AUTH_USER)
  const validPassword =
    typeof password === "string" && safeCompare(password, AUTH_PASSWORD)

  if (!validUser || !validPassword) {
    registerFailedAttempt(ip)
    return res.status(401).json({ error: "Usuario ou senha invalidos." })
  }

  loginAttempts.delete(ip)
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Erro ao criar sessao." })
    req.session.authenticated = true
    res.json({ ok: true })
  })
})

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("doomtransmit.sid")
    res.json({ ok: true })
  })
})

app.get("/api/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session?.authenticated) })
})

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next()
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`)
}

app.get(["/", "/index.html", "/host.html"], requireAuth, (req, res, next) =>
  next(),
)

app.use(express.static(path.join(__dirname, "public")))

const rooms = new Map()

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { hostId: null, viewers: new Set() })
  }
  return rooms.get(roomId)
}

io.on("connection", (socket) => {
  let joinedRoomId = null
  let joinedRole = null

  socket.on("join-room", ({ roomId, role }) => {
    if (!roomId || (role !== "host" && role !== "viewer")) {
      socket.emit("join-error", { message: "Parametros invalidos." })
      return
    }

    if (role === "host" && !socket.request.session?.authenticated) {
      socket.emit("join-error", {
        message: "Sessao expirada. Faca login novamente.",
      })
      return
    }

    const room = getRoom(roomId)

    if (role === "host") {
      room.hostId = socket.id
      joinedRoomId = roomId
      joinedRole = "host"
      socket.join(roomId)
      socket.emit("room-ready", { roomId, viewerCount: room.viewers.size })
      return
    }

    if (!room.hostId) {
      socket.emit("join-error", {
        message: "Nenhuma transmissao ativa para este link.",
      })
      return
    }

    room.viewers.add(socket.id)
    joinedRoomId = roomId
    joinedRole = "viewer"
    socket.join(roomId)

    io.to(room.hostId).emit("viewer-joined", { viewerId: socket.id })
    socket.emit("joined-as-viewer", { hostId: room.hostId })
  })

  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return
    io.to(to).emit("signal", { from: socket.id, data })
  })

  socket.on("disconnect", () => {
    if (!joinedRoomId) return
    const room = rooms.get(joinedRoomId)
    if (!room) return

    if (joinedRole === "host" && room.hostId === socket.id) {
      io.to(joinedRoomId).emit("host-left")
      rooms.delete(joinedRoomId)
    } else if (joinedRole === "viewer") {
      room.viewers.delete(socket.id)
      if (room.hostId) {
        io.to(room.hostId).emit("viewer-left", { viewerId: socket.id })
      }
      if (room.viewers.size === 0 && !room.hostId) {
        rooms.delete(joinedRoomId)
      }
    }
  })
})

server.listen(PORT, () => {
  console.log(`DoomTransmit rodando em http://localhost:${PORT}`)
})
