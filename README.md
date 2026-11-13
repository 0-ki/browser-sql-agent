# Browser SQL Agent

A small runnable example of server-side agent orchestration with browser-side SQL execution. FastAPI and LangGraph coordinate the run; DuckDB-Wasm queries a CSV in the browser.

## Run locally

Requires Python 3.12+ and Node.js 22.12+ (tested with Python 3.14 and Node.js 24).

```sh
python -m venv .venv
# PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm run build
python -m uvicorn server:app
```

Open [localhost:8000](http://127.0.0.1:8000/) and run **Sales by category**. The built-in synthetic CSV should produce Coffee 175, Tea 125, and Pastry 60. No API key or database server is needed. Demo mode maps the sample questions to three fixed query shapes using keywords; it is not a general natural-language parser.

For frontend development, run `npm run dev` in a second terminal while Uvicorn is running and open the Vite URL. DuckDB's WASM and worker are served locally.

## How the run works

1. The browser sends the question to `POST /api/runs`.
2. The server chooses a grouping and calls LangGraph's `interrupt()`. It returns a `tool_request` SSE event with run and tool IDs, then closes the response.
3. The browser builds SQL from the requested grouping and runs it in its own DuckDB instance. It sends up to ten aggregate rows to `POST /api/runs/{run_id}/tool-result`.
4. The server resumes the same checkpoint with `Command(resume=...)`, sends a `done` event, and clears the run.

The page shows the actual request and result payloads alongside the SQL executed locally. Each SSE response carries one event; this example does not stream model tokens. See [server.py](server.py), [web/main.ts](web/main.ts), and [web/duck.ts](web/duck.ts).

## Use your own CSV or model

The CSV must contain exactly `category,region,amount` (with a header; up to 5 MB). The tool supports total sales or grouping by category or region. The model selects a structured tool argument; only the browser's fixed SQL templates are executed.

To enable model mode, set `MODEL_NAME`, `MODEL_BASE_URL`, and, if required by the provider, `MODEL_API_KEY` in the **server process environment** and restart Uvicorn. See [.env.example](.env.example) for the names and defaults. The server expects an OpenAI-compatible `/chat/completions` endpoint with function tool calling. It does not automatically load dotenv files. Keep keys out of the frontend.

CSV bytes and the full table stay in the browser. The server receives the question and aggregate rows (including group labels); in model mode the configured provider receives them as well. Grouped responses contain at most ten rows, sorted by total. Avoid sensitive labels and questions when using a remote provider.

This is a single-process localhost demo. The server holds up to 32 runs in memory and expires paused runs after five minutes. A restart drops pending runs. It has no user authentication; add access controls and request limits before hosting it for others.

Related reading: [DuckDB-Wasm](https://duckdb.org/docs/stable/clients/wasm/overview) and [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).
