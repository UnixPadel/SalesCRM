/*
 * Service worker: yalnız Web Push (2026-11-23). Sayfa ya da API yanıtı önbelleğe almaz, ağ isteklerine karışmaz;
 * `fetch` dinleyicisi bilerek yoktur. Sunucu iletinin metnini kişinin dilinde hazır yollar
 * ({ id, title, body, lang, url }); burada yalnız gösterilir ve tıklanınca lead sayfası açılır.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** İletinin JSON gövdesi; boş ya da bozuksa boş nesne (yine de genel bir bildirim gösterilir). */
function payloadOf(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const data = payloadOf(event);
  event.waitUntil(
    self.registration.showNotification(data.title || "Unixpadel CRM", {
      body: data.body || "",
      // Aynı bildirim iki kez gelirse (yeniden teslim) tek satır görünür.
      tag: data.id || undefined,
      lang: data.lang || "tr",
      dir: data.lang === "ar" ? "rtl" : "auto",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      // Açık sekme varsa yeniden yüklemeden o sekmede lead'e gidilir (sayfa `crm-open` iletisini dinler).
      open.postMessage({ type: "crm-open", url });
      return open.focus();
    })(),
  );
});
