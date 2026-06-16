"use client";

import { useState, useRef } from "react";

const MASTER_PROMPT = `너는 중등 영어 문법 교재의 정답 및 해설 원고를 작성하는 전문 편집자이다.
대상 독자는 중학생이며, 해설은 학습자가 정답 근거를 빠르게 이해할 수 있도록 간결하고 정확하게 작성한다.

[참고 해설 스타일]
- 해설은 장황하게 쓰지 않는다.
- "~이므로 …를 쓴다.", "~의 형태로 쓴다.", "~자리에는 …가 온다."와 같은 교재식 문체를 사용한다.
- 문법 용어는 중등 수준에서 통용되는 표현을 사용한다.
- 정답 근거를 먼저 설명하고, 그다음 정답 형태를 제시한다.
- 오답 선지는 필요한 경우 "selled → sold" 형식으로 간단히 교정한다.
- 가능한 한 한 문항당 해설은 1~3문장으로 작성한다.

[금지사항]
- 확실하지 않은 문법 설명을 단정하지 않는다.
- 고등 문법 수준의 과도한 설명을 넣지 않는다.
- "학생 여러분", "쉽게 말해", "정답은 바로" 같은 강의식 표현을 쓰지 않는다.
- 해설을 지나치게 길게 쓰지 않는다.`;

const MULTI_SYSTEM = `너는 중등 영어 문법 교재의 정답 및 해설 원고를 작성하는 전문 편집자이다.
여러 문항이 주어지면 각 문항별로 번호를 붙여 순서대로 출력한다.

[출력 형식]
1
[정답] sold
[해석] 그는 어제 자신의 낡은 자전거를 팔았다.
[해설] sell의 과거형은 불규칙 변화형 sold이므로 selled는 쓸 수 없다.

2
[정답] found
...

[해설 스타일]
- 교재식 문체 사용, 한 문항당 1~2문장으로 간결하게
- "학생 여러분", "쉽게 말해" 같은 강의식 표현 금지`;

function parseBracketItems(text) {
  const lines = text.trim().split("\n").filter(Boolean);
  const result = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const num = match[1];
    const rest = match[2];
    const bm = rest.match(/\[([^\]]+)\]/);
    if (!bm) continue;
    const opts = bm[1].split("/").map((s) => s.trim());
    let answer = null;
    const clean = opts.map((o) => {
      if (o.endsWith("*")) { answer = o.slice(0, -1).trim(); return o.slice(0, -1).trim(); }
      if (o.startsWith("*")) { answer = o.slice(1).trim(); return o.slice(1).trim(); }
      return o;
    });
    const sentence = rest.replace(/\[[^\]]+\]/, "[" + clean.join(" / ") + "]");
    result.push({ num, sentence, answer });
  }
  return result;
}

function buildMultiPrompt(items, grade, chapter, toggles) {
  const out = [];
  if (toggles.answer) out.push("[정답]");
  if (toggles.translation) out.push("[해석]");
  if (toggles.explanation) out.push("[해설]");
  if (toggles.vocabulary) out.push("[어휘]");
  const lines = ["학년: " + grade, "단원: " + (chapter || "미입력"), "출력 항목: " + out.join(", "), "", "문항 목록:"];
  items.forEach((it) => {
    lines.push(it.num + ". 문장: " + it.sentence);
    if (it.answer) lines.push("   정답: " + it.answer);
  });
  lines.push("\n위 문항들을 번호 순서대로 출력하라. 각 문항 사이에 빈 줄을 넣어라.");
  return lines.join("\n");
}

function buildSinglePrompt(fields, toggles) {
  const parts = ["학년: " + (fields.grade || "미입력"), "단원: " + (fields.chapter || "미입력"), "문제: " + fields.question];
  if (fields.choices) parts.push("선지:\n" + fields.choices);
  if (fields.answer) parts.push("정답: " + fields.answer);
  if (fields.targetExplanation) parts.push("출제 포인트: " + fields.targetExplanation);
  if (fields.vocabCandidates) parts.push("어휘 후보: " + fields.vocabCandidates);
  const out = [];
  if (toggles.answer) out.push("[정답]");
  if (toggles.translation) out.push("[해석]");
  if (toggles.explanation) out.push("[해설]");
  if (toggles.vocabulary) out.push("[어휘]");
  parts.push("\n출력할 항목: " + out.join(", "));
  parts.push("위 정보를 바탕으로 최종 원고만 작성하라.");
  return parts.join("\n");
}

async function callAPI(system, user, onChunk, maxTokens) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens || 1500,
      stream: true,
      system: system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("API error: " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value);
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const p = JSON.parse(data);
        if (p.type === "content_block_delta" && p.delta && p.delta.text) onChunk(p.delta.text);
      } catch (e) {}
    }
  }
}

export default function Page() {
  const [tab, setTab] = useState("single");
  const [grade, setGrade] = useState("중3");
  const [chapter, setChapter] = useState("");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState("");
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const [vocab, setVocab] = useState("");
  const [gradeM, setGradeM] = useState("중3");
  const [chapterM, setChapterM] = useState("");
  const [multiText, setMultiText] = useState("");
  const [items, setItems] = useState([]);
  const [parseErr, setParseErr] = useState("");
  const [toggles, setToggles] = useState({ answer: true, translation: true, explanation: true, vocabulary: false });
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const outRef = useRef(null);

  function toggle(k) {
    setToggles(function(t) { return Object.assign({}, t, { [k]: !t[k] }); });
  }

  function handleMulti(v) {
    setMultiText(v);
    setParseErr("");
    if (!v.trim()) { setItems([]); return; }
    const parsed = parseBracketItems(v);
    if (!parsed.length) { setParseErr("형식을 인식하지 못했습니다."); setItems([]); }
    else setItems(parsed);
  }

  async function generate() {
    setError(""); setOutput("");
    if (!Object.values(toggles).some(Boolean)) { setError("출력 항목을 하나 이상 선택해 주세요."); return; }
    if (tab === "single") {
      if (!question.trim()) { setError("문제를 입력해 주세요."); return; }
      setLoading(true);
      try {
        const fields = { grade, chapter, question, choices, answer, targetExplanation: hint, vocabCandidates: vocab };
        await callAPI(MASTER_PROMPT, buildSinglePrompt(fields, toggles), function(c) {
          setOutput(function(p) { return p + c; });
          if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
        }, 1500);
      } catch(e) { setError("생성 중 오류가 발생했습니다."); }
      finally { setLoading(false); }
    } else {
      if (!items.length) { setError("문항을 입력하고 형식을 확인해 주세요."); return; }
      setLoading(true);
      try {
        await callAPI(MULTI_SYSTEM, buildMultiPrompt(items, gradeM, chapterM, toggles), function(c) {
          setOutput(function(p) { return p + c; });
          if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
        }, Math.max(1500, items.length * 200));
      } catch(e) { setError("생성 중 오류가 발생했습니다."); }
      finally { setLoading(false); }
    }
  }

  function copy() {
    navigator.clipboard.writeText(output).then(function() { setCopied(true); setTimeout(function() { setCopied(false); }, 1800); });
  }

  function clear() {
    setOutput(""); setError("");
    if (tab === "single") { setQuestion(""); setChoices(""); setAnswer(""); setHint(""); setVocab(""); }
    else { setMultiText(""); setItems([]); setParseErr(""); }
  }

  var inp = { width: "100%", padding: "8px 10px", fontSize: "13px", border: "1px solid #ddd", borderRadius: "6px", outline: "none", fontFamily: "inherit", color: "#111", boxSizing: "border-box" };
  var ta = Object.assign({}, inp, { fontFamily: "ui-monospace,monospace", resize: "vertical", lineHeight: "1.7" });
  var sel = Object.assign({}, inp, { background: "#fff" });

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px 80px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#111" }}>
      <h1 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "4px" }}>중등 문법 해설 원고 생성기</h1>
      <p style={{ fontSize: "13px", color: "#666", marginBottom: "28px" }}>교재식 해설 원고를 자동으로 생성합니다.</p>

      <div style={{ display: "flex", borderBottom: "1px solid #e5e5e5", marginBottom: "28px" }}>
        {["single", "multi"].map(function(t) {
          return (
            <button key={t} onClick={function() { setTab(t); setOutput(""); setError(""); }} style={{ padding: "8px 20px", fontSize: "13px", fontWeight: tab === t ? "600" : "400", background: "transparent", border: "none", borderBottom: tab === t ? "2px solid #111" : "2px solid transparent", color: tab === t ? "#111" : "#888", cursor: "pointer", marginBottom: "-1px" }}>
              {t === "single" ? "단일 문항" : "다문항 (괄호 선택형)"}
            </button>
          );
        })}
      </div>

      {tab === "single" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: "14px" }}>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>학년</label><select style={sel} value={grade} onChange={function(e) { setGrade(e.target.value); }}><option>중1</option><option>중2</option><option>중3</option></select></div>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>단원명</label><input style={inp} type="text" placeholder="예: 문장의 형식, 시제" value={chapter} onChange={function(e) { setChapter(e.target.value); }} /></div>
          </div>
          <div style={{ marginBottom: "14px" }}><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>문제 *</label><textarea style={ta} rows={4} placeholder="문제 전체를 붙여넣기 하세요." value={question} onChange={function(e) { setQuestion(e.target.value); }} /></div>
          <div style={{ marginBottom: "14px" }}><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>선지 (선택)</label><textarea style={ta} rows={5} placeholder={"① My parents allowed me to go out.\n② I saw him cross the street.\n③ She made me to clean my room."} value={choices} onChange={function(e) { setChoices(e.target.value); }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: "14px" }}>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>정답</label><input style={inp} type="text" placeholder="예: ③" value={answer} onChange={function(e) { setAnswer(e.target.value); }} /></div>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>어휘 후보 (선택)</label><input style={inp} type="text" placeholder="예: allow, cross, join" value={vocab} onChange={function(e) { setVocab(e.target.value); }} /></div>
          </div>
          <div style={{ marginBottom: "22px" }}><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>출제 포인트 힌트 (선택)</label><input style={inp} type="text" placeholder="예: 사역동사 make는 목적격 보어로 동사원형을 쓴다." value={hint} onChange={function(e) { setHint(e.target.value); }} /></div>
        </div>
      )}

      {tab === "multi" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: "14px" }}>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>학년</label><select style={sel} value={gradeM} onChange={function(e) { setGradeM(e.target.value); }}><option>중1</option><option>중2</option><option>중3</option></select></div>
            <div><label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>단원명</label><input style={inp} type="text" placeholder="예: 과거시제 불규칙 동사" value={chapterM} onChange={function(e) { setChapterM(e.target.value); }} /></div>
          </div>
          <div style={{ background: "#f5f5f5", borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", fontSize: "12px", color: "#555", lineHeight: "2" }}>
            <strong>입력 형식</strong> — 정답에 <code style={{ background: "#e8e8e8", padding: "1px 5px", borderRadius: "3px" }}>*</code> 를 붙여 표시하세요.<br />
            <code>1 He [sold* / selled] his old bike.</code> ← sold가 정답<br />
            <code>2 She [finded / *found] her ring.</code> ← found가 정답
          </div>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "12px", color: "#555", display: "block", marginBottom: "4px", fontWeight: "500" }}>문항 입력 *</label>
            <textarea style={ta} rows={10} placeholder={"1 He [sold* / selled] his old bike yesterday.\n2 She [finded / *found] her ring under the sofa.\n3 I [read* / readed] an interesting book yesterday."} value={multiText} onChange={function(e) { handleMulti(e.target.value); }} />
          </div>
          {parseErr && <p style={{ fontSize: "13px", color: "#c00", marginBottom: "10px" }}>{"⚠ " + parseErr}</p>}
          {items.length > 0 && <p style={{ fontSize: "13px", color: "#080", marginBottom: "14px" }}>{"✅ " + items.length + "개 문항 인식 — 정답: " + items.map(function(it) { return it.num + "번 " + it.answer; }).join(", ")}</p>}
        </div>
      )}

      <div style={{ background: "#f9f9f9", border: "1px solid #eee", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px" }}>
        <p style={{ fontSize: "12px", color: "#555", marginBottom: "10px", fontWeight: "500" }}>출력 항목</p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[["answer","정답"],["translation","해석"],["explanation","해설"],["vocabulary","어휘"]].map(function(pair) {
            var k = pair[0]; var label = pair[1];
            return (
              <button key={k} onClick={function() { toggle(k); }} style={{ padding: "6px 16px", borderRadius: "20px", fontSize: "13px", fontWeight: toggles[k] ? "600" : "400", background: toggles[k] ? "#111" : "#fff", color: toggles[k] ? "#fff" : "#666", border: toggles[k] ? "1px solid #111" : "1px solid #ccc", cursor: "pointer" }}>
                {toggles[k] ? "✓ " : ""}{label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p style={{ fontSize: "13px", color: "#c00", marginBottom: "12px" }}>{"⚠ " + error}</p>}

      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <button onClick={generate} disabled={loading} style={{ flex: "1", padding: "11px 0", fontSize: "14px", fontWeight: "600", background: loading ? "#ccc" : "#111", color: "#fff", border: "none", borderRadius: "8px", cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "⏳ 생성 중…" : "✦ 해설 생성"}
        </button>
        {output && (
          <>
            <button onClick={copy} style={{ padding: "11px 18px", fontSize: "13px", background: "#fff", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", color: "#444" }}>{copied ? "✓ 복사됨" : "복사"}</button>
            <button onClick={clear} style={{ padding: "11px 18px", fontSize: "13px", background: "#fff", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", color: "#444" }}>초기화</button>
          </>
        )}
      </div>

      {(output || loading) && (
        <div ref={outRef} style={{ background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: "8px", padding: "18px 20px", minHeight: "80px", maxHeight: "560px", overflowY: "auto", fontFamily: "ui-monospace,monospace", fontSize: "13px", lineHeight: "1.9", whiteSpace: "pre-wrap", color: "#111" }}>
          {output || "생성 중…"}
          {loading && <span style={{ display: "inline-block", width: "7px", height: "14px", background: "#999", marginLeft: "2px", verticalAlign: "-2px", animation: "blink 1s step-end infinite" }} />}
        </div>
      )}

      <style>{"@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}"}</style>
    </div>
  );
}
