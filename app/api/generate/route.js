export async function POST(req) {
  const body = await req.json();

  const system = body.system || "";
  const user = (body.messages && body.messages[0] && body.messages[0].content) || "";
  const prompt = system + "\n\n" + user;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: body.max_tokens || 1500 },
      }),
    }
  );

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const out = "data: " + JSON.stringify({ type: "content_block_delta", delta: { text } }) + "\n\n";

  return new Response(out, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
