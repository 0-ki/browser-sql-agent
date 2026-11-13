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
  status.textContent = "Loading CSV into DuckDB…";
  try {
    if (selected && selected.size > 5 * 1024 * 1024) throw new Error("Use a CSV of 5 MB or less.");
    const next = await openSales(selected ? new Uint8Array(await selected.arrayBuffer()) : sample);
    await sales?.close();
    sales = next;
    sourceName.textContent = selected?.name ?? "Synthetic sales sample";
    answer.textContent = "Run an analysis to see the answer here.";
    trace.replaceChildren(Object.assign(document.createElement("li"), { textContent: "Waiting for a question." }));
    status.textContent = "Ready";
  } catch (error) {
    file.value = "";
    status.textContent = `Could not load CSV: ${message(error)}`;
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
  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
  // This protocol sends one SSE event per response, then closes the stream.
  const frame = (await response.text()).split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!frame) throw new Error("No event received from the server.");
  return JSON.parse(frame.slice(6)) as Event;
}

get<HTMLFormElement>("ask").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!sales || busy || !text) return;
  working(true);
  status.textContent = "Waiting for the agent…";
  answer.textContent = "";
  trace.replaceChildren();
  let pending: string | undefined;
  try {
    const input = { question: text };
    record("Browser → server · question", input);
    const request = await post("/api/runs", input);
    if (request.type === "error") throw new Error(request.message);
    if (request.type !== "tool_request") throw new Error("Expected a tool request.");
    pending = request.run_id;
    record("Server → browser · tool request (stream closed)", request);
    if (request.tool !== "aggregate_sales" || !["category", "region", "none"].includes(request.args?.group_by)) {
      throw new Error("Unsupported browser tool.");
    }
    status.textContent = "Running SQL in this tab…";
    const result = await sales.aggregate(request.args.group_by);
    record("Browser only · SQL", result.sql);
    const payload = { tool_id: request.tool_id, rows: result.rows };
    record("Browser → server · tool result", payload);
    status.textContent = "Waiting for the final answer…";
    const done = await post(`/api/runs/${pending}/tool-result`, payload);
    if (done.type === "error") throw new Error(done.message);
    if (done.type !== "done") throw new Error("Expected a final answer.");
    pending = undefined;
    record("Server → browser · final answer", done);
    answer.textContent = done.answer;
    status.textContent = "Complete";
  } catch (error) {
    status.textContent = message(error);
    answer.textContent = "No answer. You can run the analysis again.";
  } finally {
    if (pending) void fetch(`/api/runs/${pending}`, { method: "DELETE" }).catch(() => {});
    working(false);
  }
});

const examples: Record<string, string> = {
  category: "What are total sales by category?",
  region: "What are total sales by region?",
  total: "What are total sales?",
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
  get("mode").textContent = (await response.json()).mode === "demo" ? "Demo mode · no model key" : "Model mode";
}).catch(() => { get("mode").textContent = "Start the API server to run a question"; });
void load();
