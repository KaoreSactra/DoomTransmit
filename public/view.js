const params = new URLSearchParams(window.location.search)
const roomId = params.get("room")

const statusDot = document.getElementById("statusDot")
const statusText = document.getElementById("statusText")
const remoteVideo = document.getElementById("remoteVideo")
const emptyMsg = document.getElementById("emptyMsg")

if (!roomId) {
  window.location.href = "/"
}

function setStatus(text, mode) {
  statusText.textContent = text
  statusDot.className = `dot${mode ? ` ${mode}` : ""}`
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]
let pc = null
let hostId = null

const socket = io()

socket.on("connect", () => {
  socket.emit("join-room", { roomId, role: "viewer" })
})

socket.on("join-error", ({ message }) => {
  setStatus(message, "error")
  emptyMsg.textContent = message
  emptyMsg.style.display = "block"
  remoteVideo.style.display = "none"
})

socket.on("joined-as-viewer", ({ hostId: id }) => {
  hostId = id
  setStatus("Conectando ao transmissor...", null)
})

socket.on("host-left", () => {
  setStatus("Transmissao encerrada.", "error")
  emptyMsg.textContent = "O transmissor encerrou o compartilhamento."
  emptyMsg.style.display = "block"
  remoteVideo.style.display = "none"
  if (pc) {
    pc.close()
    pc = null
  }
})

socket.on("signal", async ({ from, data }) => {
  if (data.type === "offer") {
    await handleOffer(from, data.sdp)
  } else if (data.type === "ice-candidate") {
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
      } catch (err) {
        console.error("Erro ao adicionar ICE candidate", err)
      }
    }
  }
})

async function handleOffer(fromId, sdp) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0]
    setStatus("Ao vivo", "live")
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        to: fromId,
        data: { type: "ice-candidate", candidate: event.candidate },
      })
    }
  }

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected"
    ) {
      setStatus("Conexao perdida.", "error")
    }
  }

  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  socket.emit("signal", { to: fromId, data: { type: "answer", sdp: answer } })
}
