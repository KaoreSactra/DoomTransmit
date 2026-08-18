const params = new URLSearchParams(window.location.search)
const roomId = params.get("room")

const sourceSelect = document.getElementById("sourceSelect")
const broadcastPanel = document.getElementById("broadcastPanel")
const shareScreenBtn = document.getElementById("shareScreenBtn")
const shareAppBtn = document.getElementById("shareAppBtn")
const switchSourceBtn = document.getElementById("switchSourceBtn")
const logoutBtn = document.getElementById("logoutBtn")
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

function cleanupStream() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
  }
  peerConnections.forEach((pc) => pc.close())
  peerConnections.clear()
  socket.disconnect()
}

function stopSharing() {
  cleanupStream()
  window.location.href = "/"
}

stopBtn.addEventListener("click", stopSharing)

logoutBtn.addEventListener("click", async () => {
  cleanupStream()
  await fetch("/api/logout", { method: "POST" })
  window.location.href = "/login.html"
})

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

function buildDisplayMediaConstraints(mode) {
  const constraints = {
    video: { displaySurface: mode === "app" ? "window" : "monitor" },
    audio: true,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  }

  if (mode === "app") {
    // esconde a opcao de "tela inteira" e o audio do sistema, deixando so
    // janelas/abas e o audio proprio do item escolhido
    constraints.monitorTypeSurfaces = "exclude"
    constraints.systemAudio = "exclude"
    constraints.windowAudio = "window"
  }

  return constraints
}

function requestDisplayMedia(mode) {
  return navigator.mediaDevices.getDisplayMedia(
    buildDisplayMediaConstraints(mode),
  )
}

async function replaceStreamOnPeers(newStream) {
  const newVideoTrack = newStream.getVideoTracks()[0]
  const newAudioTrack = newStream.getAudioTracks()[0]

  for (const pc of peerConnections.values()) {
    const senders = pc.getSenders()
    const videoSender = senders.find((s) => s.track?.kind === "video")
    const audioSender = senders.find((s) => s.track?.kind === "audio")

    try {
      if (videoSender && newVideoTrack) {
        await videoSender.replaceTrack(newVideoTrack)
      }
    } catch (err) {
      console.error("Falha ao trocar video de um espectador", err)
    }

    try {
      if (newAudioTrack) {
        if (audioSender) {
          await audioSender.replaceTrack(newAudioTrack)
        } else {
          pc.addTrack(newAudioTrack, newStream)
        }
      } else if (audioSender) {
        // fonte nova sem audio (ex.: janela sem "compartilhar audio" marcado):
        // silencia em vez de continuar enviando o audio da fonte anterior
        await audioSender.replaceTrack(null)
      }
    } catch (err) {
      console.error("Falha ao trocar audio de um espectador", err)
    }
  }
}

async function applyNewStream(mode) {
  const isSwitch = Boolean(localStream)
  setStatus(
    isSwitch
      ? "Trocando fonte..."
      : "Aguardando permissao de compartilhamento...",
  )

  try {
    const newStream = await requestDisplayMedia(mode)

    if (isSwitch) {
      await replaceStreamOnPeers(newStream)
      localStream.getTracks().forEach((track) => track.stop())
    }

    localStream = newStream
    preview.srcObject = localStream
    localStream.getVideoTracks()[0].addEventListener("ended", stopSharing)
    setStatus("Transmitindo ao vivo", "live")
  } catch (err) {
    console.error("Erro ao capturar/trocar fonte", err)
    if (isSwitch) {
      setStatus(`Troca cancelada (${err.name || "erro"})`, "error")
      setTimeout(() => setStatus("Transmitindo ao vivo", "live"), 2500)
    } else {
      setStatus(
        `Permissao negada ou cancelada (${err.name || "erro"}).`,
        "error",
      )
    }
  }
}

function onChooseSource(mode) {
  const isInitial = broadcastPanel.classList.contains("hidden")
  sourceSelect.classList.add("hidden")
  if (isInitial) {
    broadcastPanel.classList.remove("hidden")
  }
  applyNewStream(mode)
}

shareScreenBtn.addEventListener("click", () => onChooseSource("screen"))
shareAppBtn.addEventListener("click", () => onChooseSource("app"))
switchSourceBtn.addEventListener("click", () => {
  sourceSelect.classList.remove("hidden")
})
