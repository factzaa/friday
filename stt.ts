// Edge Function: stt (แปลงเสียงเป็นข้อความ + ตรวจภาษาอัตโนมัติ ด้วย Gemini)
// รับไฟล์เสียง (base64) -> ส่งให้ Gemini ถอดข้อความและบอกภาษา (ไทย/อังกฤษ/ปนกัน)
// ป้องกันการเข้าถึง: ต้องส่ง header x-orch-secret ให้ตรงกับ ORCH_SECRET
// ต้องตั้ง secret: GEMINI_API_KEY, ORCH_SECRET (ปรับ GEMINI_MODEL ได้)

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";
const ORCH_SECRET = Deno.env.get("ORCH_SECRET") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-orch-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

const PROMPT = `คุณเป็นตัวถอดเสียงเป็นข้อความ (speech-to-text)
- ถอดสิ่งที่ผู้พูดพูดออกมาให้ตรงที่สุด เสียงอาจเป็นภาษาไทย อังกฤษ หรือปนกัน
- อย่าเติมคำ อย่าตอบคำถาม อย่าอธิบาย ถอดเฉพาะสิ่งที่ได้ยินเท่านั้น
- ถ้าไม่มีเสียงพูดหรือฟังไม่ออก ให้ text เป็นค่าว่าง
ตอบกลับเป็น JSON ล้วน ๆ รูปแบบ {"text":"...","lang":"th"} โดย lang เป็นหนึ่งใน th, en, mixed เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

function extractJson(s: string): { text: string; lang: string } {
  // ตัด code fence ถ้ามี แล้วหาบล็อค JSON ตัวแรก
  let t = s.replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) t = m[0];
  try {
    const o = JSON.parse(t);
    return { text: String(o.text ?? "").trim(), lang: String(o.lang ?? "th") };
  } catch {
    // เผื่อโมเดลตอบเป็นข้อความล้วน
    return { text: s.trim(), lang: "th" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    if (ORCH_SECRET && (req.headers.get("x-orch-secret") ?? "") !== ORCH_SECRET) {
      return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
    }
    if (!GEMINI_API_KEY) {
      return json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY (ไปที่ Edge Functions > Secrets)" }, 500);
    }

    const { audio, mime } = await req.json().catch(() => ({}));
    if (!audio) return json({ error: "ต้องส่งไฟล์เสียง (audio base64)" }, 400);

    const body = {
      contents: [{
        role: "user",
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime || "audio/wav", data: audio } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `Gemini API ${r.status}: ${t.slice(0, 500)}` }, 502);
    }
    const data = await r.json();
    const out = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p.text || "")
      .join("")
      .trim();
    const result = extractJson(out);
    return json(result);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
