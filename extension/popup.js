const $ = (id) => document.getElementById(id);
const status = (msg) => ($("status").textContent = msg);

let currentTab = null; // { url, name } quando a aba ativa é um arquivo

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

// ---------- QR code ----------
function showQr(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  $("qr").src = qr.createDataURL(6, 2);
  $("qr").hidden = false;
}

// ---------- upload ----------
async function share(body, name, type) {
  const { server, token } = await chrome.storage.sync.get(["server", "token"]);
  if (!server || !token) return status("Configure o Worker e o token primeiro.");

  $("qr").hidden = true;
  status("Enviando…");
  try {
    const res = await fetch(`${server}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": type || "application/octet-stream",
        "X-Filename": encodeURIComponent(name),
        "X-TTL-Days": $("ttl").value,
      },
      body,
    });
    const data = await res.json();
    if (!res.ok) return status(`Erro: ${data.error ?? res.status}`);
    await navigator.clipboard.writeText(data.url);
    status(`URL copiada:\n${data.url}`);
    showQr(data.url);
  } catch (e) {
    status(`Falha no envio: ${e.message}`);
  }
}

$("send").onclick = () => {
  const file = $("file").files[0];
  if (!file) return status("Escolha um arquivo.");
  share(file, file.name, file.type);
};

// ---------- aba atual ----------
function nameFromUrl(url, mime) {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {}
  if (!name) name = "arquivo";
  if (!name.includes(".")) {
    const ext = { "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv" }[mime] ?? mime?.split("/")[1];
    if (ext) name += "." + ext;
  }
  return name;
}

// Detecta se a aba exibe um arquivo (e não uma página HTML) pelo content-type do documento.
async function detectTabFile() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^(https?|file):/.test(tab.url)) return;
  try {
    const [{ result: mime }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.contentType,
    });
    if (!mime || /^(text\/html|application\/xhtml\+xml)$/.test(mime)) return;
    currentTab = { url: tab.url, name: nameFromUrl(tab.url, mime) };
    $("tabName").textContent = currentTab.name;
    $("tabBox").hidden = false;
  } catch {
    // Sem acesso à aba (ex.: file:// sem "Permitir acesso a URLs de arquivo"): não mostra o botão.
  }
}

$("shareTab").onclick = async () => {
  if (!currentTab) return;
  const { url, name } = currentTab;
  try {
    if (url.startsWith("http")) {
      // Permissão de host pedida só para a origem da aba, no clique (precisa de gesto do usuário).
      const origin = new URL(url).origin + "/*";
      const ok = await chrome.permissions.request({ origins: [origin] });
      if (!ok) return status("Permissão negada para ler o arquivo desta aba.");
    }
    status("Lendo arquivo da aba…");
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return status(`Não foi possível ler a aba (HTTP ${res.status}).`);
    const blob = await res.blob();
    await share(blob, name, blob.type);
  } catch (e) {
    status(`Falha ao ler a aba: ${e.message}`);
  }
};

detectTabFile();
