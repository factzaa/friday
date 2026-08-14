// Edge Function: tts (แปลงข้อความเป็นเสียงพูดธรรมชาติ ด้วย Gemini TTS)
// รับข้อความ -> ให้ Gemini สร้างเสียงพูด (รองรับไทย/อังกฤษ ตรวจภาษาเอง) -> คืนเสียง PCM (base64)
// ป้องกันการเข้าถึง: ต้องส่ง header x-orch-secret ให้ตรงกับ ORCH_SECRET
// ต้องตั้ง secret: GEMINI_API_KEY, ORCH_SECRET (ปรับ GEMINI_TTS_MODEL, GEMINI_TTS_VOICE ได้)

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const TTS_MODEL = Deno.env.get("GEMINI_TTS_MODEL") ?? "gemini-2.5-flash-preview-tts";
const TTS_VOICE = Deno.env.get("GEMINI_TTS_VOICE") ?? "Charon";
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

function rateFromMime(mime: string): number {
  const m = (mime || "").match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : 24000;
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

    const { text, voice } = await req.json().catch(() => ({}));
    if (!text || !String(text).trim()) return json({ error: "ต้องส่งข้อความ (text)" }, 400);

    const body = {
      contents: [{ role: "user", parts: [{ text: String(text).slice(0, 5000) }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || TTS_VOICE } },
        },
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `Gemini TTS ${r.status}: ${t.slice(0, 500)}` }, 502);
    }
    const data = await r.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData || p.inline_data,
    );
    const inline = part?.inlineData ?? part?.inline_data;
    if (!inline?.data) return json({ error: "Gemini ไม่ได้ส่งเสียงกลับมา" }, 502);
    const mime = inline.mimeType ?? inline.mime_type ?? "audio/L16;rate=24000";
    return json({ audio: inline.data, sampleRate: rateFromMime(mime), mime });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
