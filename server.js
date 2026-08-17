const path = require("path")
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const PORT = process.env.PORT || 3000

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
