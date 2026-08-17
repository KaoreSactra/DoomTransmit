const params = new URLSearchParams(window.location.search)
const roomId = params.get("room")

const statusDot = document.getElementById("statusDot")
const statusText = document.getElementById("statusText")
const viewerCountEl = document.getElementById("viewerCount")
const linkInput = document.getElementById("linkInput")
const copyBtn = document.getElementById("copyBtn")
const stopBtn = document.getElementById("stopBtn")
const preview = document.getElementById("preview")

if (!roomId) {
  window.location.href = "/"
}

const viewUrl = `${window.location.origin}/view.html?room=${roomId}`
linkInput.value = viewUrl

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(viewUrl)
    copyBtn.textContent = "Copiado!"
    setTimeout(() => (copyBtn.textContent = "Copiar link"), 1500)
  } catch {
    linkInput.select()
    document.execCommand("copy")
  }
})

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]

let localStream = null
const peerConnections = new Map()

function setStatus(text, mode) {
  statusText.textContent = text
  statusDot.className = `dot${mode ? ` ${mode}` : ""}`
}

function updateViewerCount() {
  const count = peerConnections.size
  viewerCountEl.textContent = `${count} espectador(es) conectado(s)`
}

async function createPeerForViewer(viewerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  peerConnections.set(viewerId, pc)
  updateViewerCount()

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        to: viewerId,
        data: { type: "ice-candidate", candidate: event.candidate },
      })
    }
  }

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      pc.close()
      peerConnections.delete(viewerId)
      updateViewerCount()
    }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  socket.emit("signal", { to: viewerId, data: { type: "offer", sdp: offer } })
}

async function handleAnswer(viewerId, sdp) {
  const pc = peerConnections.get(viewerId)
  if (!pc) return
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
}

async function handleIceCandidate(viewerId, candidate) {
  const pc = peerConnections.get(viewerId)
  if (!pc) return
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate))
  } catch (err) {
    console.error("Erro ao adicionar ICE candidate", err)
  }
}

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
  }
  peerConnections.forEach((pc) => pc.close())
  peerConnections.clear()
  socket.disconnect()
  window.location.href = "/"
}

stopBtn.addEventListener("click", stopSharing)

const socket = io()

socket.on("connect", () => {
  socket.emit("join-room", { roomId, role: "host" })
})

socket.on("join-error", ({ message }) => {
  setStatus(message, "error")
})

socket.on("room-ready", () => {
  setStatus("Transmitindo ao vivo", "live")
})

socket.on("viewer-joined", ({ viewerId }) => {
  createPeerForViewer(viewerId).catch((err) => console.error(err))
})

socket.on("viewer-left", ({ viewerId }) => {
  const pc = peerConnections.get(viewerId)
  if (pc) {
    pc.close()
    peerConnections.delete(viewerId)
    updateViewerCount()
  }
})

socket.on("signal", ({ from, data }) => {
  if (data.type === "answer") {
    handleAnswer(from, data.sdp)
  } else if (data.type === "ice-candidate") {
    handleIceCandidate(from, data.candidate)
  }
})

async function start() {
  try {
    setStatus("Aguardando permissao de compartilhamento...")
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
    preview.srcObject = localStream

    localStream.getVideoTracks()[0].addEventListener("ended", stopSharing)
  } catch (err) {
    setStatus("Permissao negada ou compartilhamento cancelado.", "error")
  }
}

start()
