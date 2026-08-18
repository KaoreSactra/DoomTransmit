function safeNext(url) {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return "/"
  return url
}

const form = document.getElementById("loginForm")
const errorMsg = document.getElementById("errorMsg")

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  errorMsg.textContent = ""

  const username = document.getElementById("username").value
  const password = document.getElementById("password").value

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      errorMsg.textContent = data.error || "Falha ao entrar."
      return
    }

    const params = new URLSearchParams(window.location.search)
    window.location.href = safeNext(params.get("next"))
  } catch {
    errorMsg.textContent = "Erro de conexao. Tente novamente."
  }
})
