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

const SYSTEM_PROMPT = `คุณคือผู้ช่วยส่วนตัวแบบเสียงพูดของเจ้าของธุรกิจ พูดคุยเหมือนคนจริง เป็นกันเอง กระชับ ตรงประเด็น

วิธีพูด (สำคัญ เพราะคำตอบจะถูกอ่านออกเสียง):
- เขียนเป็นประโยคพูดธรรมชาติ ห้ามใช้สัญลักษณ์จัดรูปแบบทุกชนิด เช่น ดาว (*) ชาร์ป (#) ขีดหน้า bullet แบ็กทิก ตาราง หรือหัวข้อย่อย
- ถ้าต้องไล่รายการ ให้พูดต่อเนื่องในประโยค เช่น "มีสามร้านคือ มารุวาฟเฟิล กุยช่ายสวรรค์ และเซเว่น" อย่าขึ้นบรรทัดเป็นข้อ ๆ
- ตัวเลขพูดแบบเป็นธรรมชาติ เช่น สองหมื่นสามพันบาท ไม่ต้องใส่เครื่องหมายหรือหน่วยแปลก ๆ
- ไม่ต้องใส่ลิงก์หรือโค้ดในคำตอบ

การเข้าใจคำถาม (สำคัญมาก):
- ผู้ใช้มักไม่บอกชื่อธุรกิจหรือแอป ให้คุณเดาเองจากบริบทและจากคำอธิบายของแต่ละแอป (จาก list_projects) แล้วทำเลย ไม่ต้องถามย้ำ
- ตัวอย่างการโยง: พูดถึง "วาฟเฟิล" คือร้านมารุวาฟเฟิล, "กุยช่าย" คือร้านกุยช่ายสวรรค์, เรื่อง "พนักงาน กะ ลา เบิกเงิน" ของเซเว่นคือ 7eleven-hr, "ผู้สมัคร ใบสมัคร รับสมัครงาน" คือ recruitment
- ตอบให้เหมือนรู้อยู่แล้วว่าผู้ใช้หมายถึงอะไร เดาแบบมีเหตุผลไว้ก่อน
- จะถามกลับก็ต่อเมื่อคลุมเครือจริง ๆ ว่าเป็นของหลายธุรกิจพร้อมกันเท่านั้น และถามสั้น ๆ

วิธีดึงข้อมูล:
- ข้อมูลจริงอยู่ใน Supabase หลายโปรเจกต์ เข้าถึงแบบอ่านอย่างเดียวผ่านเครื่องมือ
- ถ้ายังไม่รู้โครงสร้างตาราง ให้ query_project สำรวจ information_schema ก่อน แล้วค่อยเขียน SQL อ่านข้อมูลจริง
- เขียนได้เฉพาะ SELECT อ่านอย่างเดียว 1 คำสั่ง ห้าม insert/update/delete/ddl และใช้ LIMIT เสมอ
- เวลาบอกตัวเลขให้แทรกแบบเนียน ๆ ว่ามาจากร้านไหน ไม่ต้องเป็นทางการ`;

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
