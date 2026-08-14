// Edge Function: ask (มีระบบล็อกรหัส passphrase)
// รับคำถามภาษาไทย -> ใช้ Claude (Anthropic) แบบ tool-use ดึงข้อมูลจากโปรเจกต์งาน -> สรุปคำตอบ
// ป้องกันการเข้าถึง: ต้องส่ง header x-orch-secret ให้ตรงกับ secret ORCH_SECRET
// ต้องตั้ง secret: ANTHROPIC_API_KEY, ORCH_SECRET (และปรับ ANTHROPIC_MODEL ได้)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";
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

const SYSTEM_PROMPT = `คุณชื่อ "Friday" เป็นผู้ช่วยส่วนตัวอัจฉริยะแบบเสียงพูด สไตล์เดียวกับใน Iron Man ฉลาด รอบรู้ พูดคุยเหมือนคนจริง เป็นกันเอง กระชับ ตรงประเด็น
ถ้าถูกถามว่าชื่ออะไรหรือเป็นใคร ให้บอกว่าชื่อ Friday ผู้ช่วยส่วนตัวของเจ้านาย

การเรียกผู้ใช้:
- เรียกผู้ใช้ว่า "เจ้านาย" หรือ "บอส" (Boss) แทรกอย่างเป็นธรรมชาติ ไม่ต้องทุกประโยค แค่พองามให้ได้อารมณ์ผู้ช่วยคู่ใจแบบในหนัง

ความสามารถของคุณ:
1) ผู้ช่วยทั่วไป: ตอบได้ทุกเรื่องเหมือน AI ผู้ช่วยชั้นนำ ทั้งความรู้ทั่วไป ไอเดีย เขียน/แปลข้อความ วางแผน สรุป ให้คำแนะนำ ฯลฯ ใช้ความรู้ของคุณตอบได้ทันที
2) ข้อมูลธุรกิจ: ถ้าเป็นคำถามเกี่ยวกับข้อมูลจริงในธุรกิจของเจ้านาย (ยอดขาย พนักงาน สต็อก การเงิน ผู้สมัคร ฯลฯ) ให้ดึงจากฐานข้อมูลผ่านเครื่องมือ (ดูหัวข้อ "การดึงข้อมูล")
3) ครูสอนภาษาอังกฤษสำหรับลูกสาวของเจ้านาย: ฝึกสนทนา สอนคำศัพท์ การออกเสียง ไวยากรณ์ แก้ประโยคให้ ชวนโต้ตอบ ใจเย็น ให้กำลังใจ เหมาะกับเด็ก เวลายกตัวอย่างภาษาอังกฤษให้เขียนเป็นภาษาอังกฤษชัด ๆ แล้วอธิบายความหมายเป็นไทยสั้น ๆ (เพราะแอปจะออกเสียงคำอังกฤษด้วยสำเนียงอังกฤษให้เอง)
4) ครูสอนคณิตศาสตร์สำหรับลูกสาว: อธิบายทีละขั้นตอนแบบเข้าใจง่าย ยกตัวอย่างใกล้ตัว ตรวจคำตอบ ออกโจทย์ฝึกให้ ชมเชยเมื่อทำได้ ถ้าเป็นการฝึกอย่าเฉลยทันที ให้ค่อย ๆ ตั้งคำถามนำทางให้เด็กคิดเอง
- เมื่อรู้ว่ากำลังสอนเด็ก ให้ใช้ภาษาอ่อนโยน น่ารัก ให้กำลังใจ และเนื้อหาเหมาะกับเด็กเสมอ
5) สภาพอากาศ: ถ้าผู้ใช้ถามเรื่องอากาศ ฝน อุณหภูมิ ให้ใช้เครื่องมือ get_weather (ค่าเริ่มต้นกรุงเทพฯ) แล้วสรุปเป็นคำพูดธรรมชาติ

วิธีพูด (คำตอบจะถูกอ่านออกเสียง):
- เขียนเป็นประโยคพูดธรรมชาติ ห้ามใช้สัญลักษณ์จัดรูปแบบทุกชนิด เช่น ดาว (*) ชาร์ป (#) bullet แบ็กทิก ตาราง หรือหัวข้อย่อย
- ไล่รายการให้พูดต่อเนื่องในประโยค ตัวเลขพูดแบบเป็นธรรมชาติ ไม่ต้องใส่ลิงก์หรือโค้ด
- ตอบให้กระชับ ได้ใจความ ไม่เยิ่นเย้อ เพื่อให้เร็วและฟังสบาย

ความเร็วในการตอบ:
- ถ้าเป็นคำถามทั่วไป สอนภาษา หรือสอนคณิต ที่ไม่เกี่ยวกับข้อมูลธุรกิจ ให้ตอบทันทีจากความรู้ ห้ามเรียกเครื่องมือ (จะได้เร็ว)
- เรียกเครื่องมือเฉพาะตอนที่ต้องดึงข้อมูลจริงจากฐานข้อมูลธุรกิจเท่านั้น

การเข้าใจว่าเป็นเรื่องธุรกิจไหน:
- ผู้ใช้มักไม่บอกชื่อแอป ให้เดาเองจากบริบทและคำอธิบายแต่ละแอป (จาก list_projects) แล้วทำเลย ไม่ต้องถามย้ำ
- โยงคำ: "วาฟเฟิล"=ร้านมารุวาฟเฟิล, "กุยช่าย"=ร้านกุยช่ายสวรรค์, "พนักงาน กะ ลา เบิกเงินของเซเว่น"=7eleven-hr, "ผู้สมัคร ใบสมัคร รับสมัครงาน"=recruitment
- จะถามกลับเฉพาะตอนคลุมเครือจริง ๆ ว่าเป็นของหลายธุรกิจพร้อมกัน และถามสั้น ๆ

การดึงข้อมูล:
- ข้อมูลจริงอยู่ใน Supabase หลายโปรเจกต์ อ่านอย่างเดียวผ่านเครื่องมือ
- ถ้ายังไม่รู้โครงสร้างตาราง ให้ query_project สำรวจ information_schema ก่อน แล้วค่อยเขียน SELECT
- เขียนได้เฉพาะ SELECT อ่านอย่างเดียว 1 คำสั่ง ห้าม insert/update/delete/ddl และใช้ LIMIT เสมอ
- เวลาบอกตัวเลขให้แทรกแบบเนียน ๆ ว่ามาจากร้านไหน`;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TOOLS = [
  {
    name: "list_projects",
    description: "ดูรายชื่อแอป/โปรเจกต์ที่เชื่อมไว้ พร้อมคำอธิบายว่าแต่ละแอปเก็บข้อมูลอะไร",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_project",
    description:
      "รันคำสั่ง SQL แบบอ่านอย่างเดียว (SELECT/WITH เท่านั้น) กับฐานข้อมูลของแอปที่ระบุ คืนผลเป็น JSON. ใช้ information_schema เพื่อสำรวจตาราง/คอลัมน์ได้",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "ชื่อแอปตามที่ได้จาก list_projects" },
        sql: { type: "string", description: "คำสั่ง SELECT อ่านอย่างเดียว 1 คำสั่ง" },
      },
      required: ["project", "sql"],
    },
  },
  {
    name: "get_weather",
    description:
      "ดูสภาพอากาศปัจจุบัน (ค่าเริ่มต้น: กรุงเทพฯ) คืนอุณหภูมิ อุณหภูมิที่รู้สึก ความชื้น ลม และสภาพท้องฟ้า ใช้เมื่อผู้ใช้ถามเรื่องอากาศ/ฝน/อุณหภูมิ",
    input_schema: {
      type: "object",
      properties: {
        latitude: { type: "number", description: "ละติจูด (ถ้าไม่ระบุใช้กรุงเทพฯ)" },
        longitude: { type: "number", description: "ลองจิจูด (ถ้าไม่ระบุใช้กรุงเทพฯ)" },
        place: { type: "string", description: "ชื่อสถานที่ไว้ใช้ในคำตอบ เช่น กรุงเทพฯ" },
      },
    },
  },
];

async function runTool(name: string, input: any): Promise<unknown> {
  if (name === "list_projects") {
    const { data, error } = await supa
      .from("connected_projects")
      .select("name, description")
      .eq("enabled", true)
      .order("name");
    if (error) return { error: error.message };
    return { projects: data };
  }
  if (name === "query_project") {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/query-project`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        ...(ORCH_SECRET ? { "x-orch-secret": ORCH_SECRET } : {}),
      },
      body: JSON.stringify({ project: input.project, sql: input.sql, limit: 200 }),
    });
    return await res.json();
  }
  if (name === "get_weather") {
    const lat = typeof input.latitude === "number" ? input.latitude : 13.7563;
    const lon = typeof input.longitude === "number" ? input.longitude : 100.5018;
    const place = input.place ?? "กรุงเทพฯ";
    const codes: Record<number, string> = {
      0: "ท้องฟ้าโปร่ง", 1: "มีเมฆบางส่วน", 2: "มีเมฆบางส่วน", 3: "เมฆมาก",
      45: "หมอก", 48: "หมอก", 51: "ฝนปรอย", 53: "ฝนปรอย", 55: "ฝนปรอยหนัก",
      61: "ฝนตกเล็กน้อย", 63: "ฝนตก", 65: "ฝนตกหนัก", 71: "หิมะ", 80: "ฝนซู่",
      81: "ฝนซู่", 82: "ฝนซู่หนัก", 95: "พายุฝนฟ้าคะนอง", 96: "พายุฝนฟ้าคะนอง",
    };
    try {
      const wr = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`,
      );
      if (!wr.ok) return { error: "ดึงข้อมูลอากาศไม่สำเร็จ" };
      const wd = await wr.json();
      const c = wd.current ?? {};
      return {
        place,
        temperature_c: c.temperature_2m,
        feels_like_c: c.apparent_temperature,
        humidity_pct: c.relative_humidity_2m,
        wind_kmh: c.wind_speed_10m,
        condition: codes[c.weather_code] ?? "—",
      };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) };
    }
  }
  return { error: `unknown tool: ${name}` };
}

async function callClaude(messages: any[]): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${t}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    // ล็อกด้วย passphrase (ฝั่งเซิร์ฟเวอร์)
    if (ORCH_SECRET && (req.headers.get("x-orch-secret") ?? "") !== ORCH_SECRET) {
      return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
    }

    if (!ANTHROPIC_API_KEY) {
      return json({ error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY (ไปที่ Edge Functions > Secrets)" }, 500);
    }

    const { question } = await req.json().catch(() => ({}));
    if (!question) return json({ error: "ต้องส่ง question" }, 400);

    const messages: any[] = [{ role: "user", content: question }];
    const toolTrace: any[] = [];

    for (let step = 0; step < 8; step++) {
      const reply = await callClaude(messages);
      messages.push({ role: "assistant", content: reply.content });

      if (reply.stop_reason === "tool_use") {
        const toolResults: any[] = [];
        for (const block of reply.content) {
          if (block.type === "tool_use") {
            const result = await runTool(block.name, block.input);
            toolTrace.push({ tool: block.name, input: block.input });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 20000),
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      const answer = (reply.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return json({ answer, steps: toolTrace });
    }

    return json({ answer: "ประมวลผลนานเกินไป (เกิน 8 รอบ) ลองถามให้เจาะจงขึ้น", steps: toolTrace });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
