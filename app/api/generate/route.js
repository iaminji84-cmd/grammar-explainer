export async function POST(req) {
  const body = await req.json();

  const system = body.system || "";
  const user = body.messages?.[0]?.content || "";
  const prompt = system + "\n\n" + user;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=" + process.env.GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: body.max_tokens || 1500 },
      }),
    }
  );

  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const p = JSON.parse(data);
            const text = p.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const out = "data: " + JSON.stringify({ type: "content_block_delta", delta: { text } }) + "\n\n";
              controller.enqueue(new TextEncoder().encode(out));
            }
          } catch(e) {}
        }
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
