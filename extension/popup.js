const $ = (id) => document.getElementById(id);
const status = (msg) => ($("status").textContent = msg);

chrome.storage.sync.get(["server", "token"], ({ server, token }) => {
  $("server").value = server ?? "";
  $("token").value = token ?? "";
  if (!server || !token) $("settings").open = true;
});

$("save").onclick = async () => {
  await chrome.storage.sync.set({
    server: $("server").value.trim().replace(/\/$/, ""),
    token: $("token").value.trim(),
  });
  status("Configurações salvas.");
};

$("send").onclick = async () => {
  const file = $("file").files[0];
  const { server, token } = await chrome.storage.sync.get(["server", "token"]);
  if (!server || !token) return status("Configure o Worker e o token primeiro.");
  if (!file) return status("Escolha um arquivo.");

  status("Enviando…");
  try {
    const res = await fetch(`${server}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
        "X-TTL-Days": $("ttl").value,
      },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) return status(`Erro: ${data.error ?? res.status}`);
    await navigator.clipboard.writeText(data.url);
    status(`URL copiada:\n${data.url}`);
  } catch (e) {
    status(`Falha no envio: ${e.message}`);
  }
};
