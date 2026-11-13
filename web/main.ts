import "./style.css";
import { openSales, sample, type Group } from "./duck";

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const file = get<HTMLInputElement>("file");
const question = get<HTMLInputElement>("question");
const run = get<HTMLButtonElement>("run");
const sampleButton = get<HTMLButtonElement>("sample");
const sourceName = get("source-name");
const status = get("status");
const answer = get("answer");
const trace = get("trace");
let sales: Awaited<ReturnType<typeof openSales>> | undefined;
let busy = false;

function working(value: boolean) {
  busy = value;
  file.disabled = sampleButton.disabled = value;
  run.disabled = value || !sales;
}

function record(title: string, value: unknown) {
  const item = document.createElement("li");
  const label = document.createElement("strong");
  label.textContent = title;
  const detail = document.createElement("pre");
  detail.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  item.append(label, detail);
  trace.append(item);
}

async function load(selected?: File) {
  working(true);
  status.textContent = "CSV를 불러오는 중입니다…";
  try {
    if (selected && selected.size > 5 * 1024 * 1024) throw new Error("5MB 이하의 CSV를 선택해 주세요.");
    const next = await openSales(selected ? new Uint8Array(await selected.arrayBuffer()) : sample);
    await sales?.close();
    sales = next;
    sourceName.textContent = selected?.name ?? "합성 매출 데이터";
    answer.textContent = "분석을 실행하면 답변이 표시됩니다.";
    trace.replaceChildren(Object.assign(document.createElement("li"), { textContent: "질문을 입력해 주세요." }));
    status.textContent = "분석할 준비가 됐습니다";
  } catch (error) {
    file.value = "";
    status.textContent = `CSV를 불러오지 못했습니다. ${message(error)}`;
  } finally {
    working(false);
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type Event =
  | { type: "tool_request"; run_id: string; tool_id: string; tool: string; args: { group_by: Group } }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };

async function post(url: string, payload: unknown): Promise<Event> {
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`서버 요청에 실패했습니다. HTTP ${response.status}.`);
  // This protocol sends one SSE event per response, then closes the stream.
  const frame = (await response.text()).split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!frame) throw new Error("서버 응답을 받지 못했습니다.");
  return JSON.parse(frame.slice(6)) as Event;
}

get<HTMLFormElement>("ask").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!sales || busy || !text) return;
  working(true);
  status.textContent = "서버 Agent가 질문을 처리하는 중입니다…";
  answer.textContent = "";
  trace.replaceChildren();
  let pending: string | undefined;
  try {
    const input = { question: text };
    record("브라우저 → 서버 · 질문", input);
    const request = await post("/api/runs", input);
    if (request.type === "error") throw new Error(request.message);
    if (request.type !== "tool_request") throw new Error("서버에서 도구 실행 요청을 받지 못했습니다.");
    pending = request.run_id;
    record("서버 → 브라우저 · 도구 요청 후 연결 종료", request);
    if (request.tool !== "aggregate_sales" || !["category", "region", "none"].includes(request.args?.group_by)) {
      throw new Error("지원하지 않는 브라우저 도구입니다.");
    }
    status.textContent = "이 탭에서 SQL을 실행하는 중입니다…";
    const result = await sales.aggregate(request.args.group_by);
    record("브라우저에서 실행한 SQL", result.sql);
    const payload = { tool_id: request.tool_id, rows: result.rows };
    record("브라우저 → 서버 · 도구 실행 결과", payload);
    status.textContent = "서버 Agent가 답변을 작성하는 중입니다…";
    const done = await post(`/api/runs/${pending}/tool-result`, payload);
    if (done.type === "error") throw new Error(done.message);
    if (done.type !== "done") throw new Error("서버에서 최종 답변을 받지 못했습니다.");
    pending = undefined;
    record("서버 → 브라우저 · 최종 답변", done);
    answer.textContent = done.answer;
    status.textContent = "분석을 완료했습니다";
  } catch (error) {
    status.textContent = message(error);
    answer.textContent = "답변을 가져오지 못했습니다. 분석을 다시 실행해 주세요.";
  } finally {
    if (pending) void fetch(`/api/runs/${pending}`, { method: "DELETE" }).catch(() => {});
    working(false);
  }
});

const examples: Record<string, string> = {
  category: "카테고리별 매출 합계는 얼마인가요?",
  region: "지역별 매출 합계는 얼마인가요?",
  total: "전체 매출 합계는 얼마인가요?",
};
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-example]")) {
  button.addEventListener("click", () => {
    question.value = examples[button.dataset.example!];
    question.focus();
  });
}
file.addEventListener("change", () => { if (file.files?.[0]) void load(file.files[0]); });
sampleButton.addEventListener("click", () => { file.value = ""; void load(); });
void fetch("/api/mode").then(async (response) => {
  if (!response.ok) throw new Error();
  get("mode").textContent = (await response.json()).mode === "demo" ? "데모 모드 · API 키 없이 실행" : "모델 모드";
}).catch(() => { get("mode").textContent = "분석하려면 API 서버를 실행해 주세요"; });
void load();
