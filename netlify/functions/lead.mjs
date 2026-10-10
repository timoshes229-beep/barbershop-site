/* ============================================================
   Відправка заявок із сайту в Telegram.
   Токен бота НЕ зберігається в цьому файлі - він лежить у
   налаштуваннях Netlify (Environment variables), тому ніхто
   не побачить його через "Перегляд коду" сторінки.

   Потрібні дві змінні в Netlify:
     TELEGRAM_BOT_TOKEN - токен від @BotFather
     TELEGRAM_CHAT_ID   - ваш числовий ID (від @userinfobot)
                          або ID групи (починається з -100)
   ============================================================ */

const LIMIT_WINDOW_MS = 60 * 1000;
const LIMIT_MAX = 5;
const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  for (const [k, v] of hits) if (now - v.start > LIMIT_WINDOW_MS) hits.delete(k);
  const rec = hits.get(ip);
  if (!rec) { hits.set(ip, { start: now, n: 1 }); return false; }
  if (now - rec.start > LIMIT_WINDOW_MS) { hits.set(ip, { start: now, n: 1 }); return false; }
  rec.n += 1;
  return rec.n > LIMIT_MAX;
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s, n) => {
  const t = String(s == null ? "" : s).trim();
  return t.length > n ? t.slice(0, n) + "..." : t;
};

export default async (req) => {
  const json = (code, body) => new Response(JSON.stringify(body), {
    status: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

  if (req.method !== "POST") return json(405, { error: "method" });

  const ip = req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for") || "unknown";
  if (tooMany(ip)) return json(429, { error: "rate" });

  let d;
  try { d = await req.json(); } catch { return json(400, { error: "body" }); }

  /* приховане поле, яке заповнюють тільки боти */
  if (d.company) return json(200, { ok: true });

  const name = clip(d.name, 80);
  const phone = clip(d.phone, 40);
  if (name.length < 2) return json(400, { error: "name" });
  if (phone.replace(/\D/g, "").length < 9) return json(400, { error: "phone" });

  /* trim обов'язковий: якщо у значенні лишився пробіл чи перенос рядка,
     адреса запиту ламається і Telegram відповідає 404 */
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) {
    console.error("TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID не задані в Netlify");
    return json(500, { error: "config" });
  }

  const academy = d.kind === "academy";
  const when = [clip(d.date, 20), clip(d.time, 10)].filter(Boolean).join(" ");

  const rows = [
    `<b>${academy ? "Заявка на навчання" : "Новий запис із сайту"}</b>`,
    "",
    `Ім'я: <b>${esc(name)}</b>`,
    `Телефон: <b>${esc(phone)}</b>`
  ];
  if (!academy && d.service) rows.push(`Послуга: ${esc(clip(d.service, 80))}`);
  if (!academy && d.barber) rows.push(`Барбер: ${esc(clip(d.barber, 40))}`);
  if (when) rows.push(`Бажаний час: ${esc(when)}`);
  if (d.comment) rows.push("", `Коментар: ${esc(clip(d.comment, 600))}`);
  rows.push("", `<i>Сторінка: ${esc(clip(d.page, 80))}</i>`);

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: rows.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Telegram відповів помилкою:", r.status, t,
        "| довжина токена:", token.length,
        "| формат токена ок:", /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token),
        "| chat_id:", chat);
      return json(502, { error: "telegram" });
    }
  } catch (e) {
    console.error("Не вдалося звернутись до Telegram:", e && e.message);
    return json(502, { error: "network" });
  }

  return json(200, { ok: true });
};
