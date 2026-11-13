import * as duckdb from "@duckdb/duckdb-wasm";
import wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import workerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

export const sample = new TextEncoder().encode(
  "category,region,amount\nCoffee,North,120\nTea,South,80\nCoffee,South,55\nTea,North,45\nPastry,North,60\n",
);
export type Row = { label: string; total: number };
export type Group = "category" | "region" | "none";

export async function openSales(bytes: Uint8Array) {
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(wasm);
    const conn = await db.connect();
    await db.registerFileBuffer("sales.csv", bytes.slice());
    await conn.insertCSVFromPath("sales.csv", { name: "incoming", header: true, delimiter: "," });
    const fields = (await conn.query("SELECT * FROM incoming LIMIT 0")).schema.fields;
    if (fields.length !== 3 || !["category", "region", "amount"].every(
      (name) => fields.some((field) => field.name === name),
    )) throw new Error("Expected exactly these CSV columns: category, region, amount.");
    await conn.query(`CREATE TABLE sales AS
      SELECT left(coalesce(category::VARCHAR, '(blank)'), 100) AS category,
             left(coalesce(region::VARCHAR, '(blank)'), 100) AS region,
             CAST(amount AS DECIMAL(18, 2)) AS amount
      FROM incoming`);
    await conn.query("DROP TABLE incoming");
    await db.dropFile("sales.csv");
    await conn.query("SET enable_external_access = false");
    await conn.query("SET lock_configuration = true");
    return {
      close: () => db.terminate(),
      async aggregate(group: Group) {
        const key = group === "category" ? '"category"' : group === "region" ? '"region"' : null;
        const sql = key
          ? `SELECT ${key} AS label, SUM(amount)::DOUBLE AS total\nFROM sales WHERE amount IS NOT NULL\nGROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`
          : "SELECT 'All sales' AS label, SUM(amount)::DOUBLE AS total\nFROM sales WHERE amount IS NOT NULL HAVING count(*) > 0";
        const result = await conn.query(sql);
        const rows: Row[] = result.toArray().map((row) => ({ label: String(row.label), total: Number(row.total) }));
        return { sql, rows };
      },
    };
  } catch (error) {
    await db.terminate();
    throw error;
  }
}
