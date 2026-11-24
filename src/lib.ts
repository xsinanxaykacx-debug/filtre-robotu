import Papa from "papaparse";

export type DataType = "text" | "number" | "date" | "time" | "boolean" | "json";
export type Group = "match" | "odds" | "outcome" | "other";
export type Field = { id?: string; source_name: string; field_key: string; ordinal: number; data_type: DataType; semantic_group: Group; is_filterable: boolean };
export type Condition = { id: string; field: string; operator: string; value: string; negate?: boolean };
export type FilterDefinition = { version: 1; logic: "and" | "or"; conditions: Condition[] };

export function parseCsv(file: File): Promise<{ fields: Field[]; rows: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: result => {
        const matrix = result.data;
        if (!matrix.length || !matrix[0]?.length) return reject(new Error("CSV dosyasında başlık satırı bulunamadı."));
        const headers = matrix[0].map((h, i) => String(h ?? "").trim() || `Kolon ${i + 1}`);
        const counts = new Map<string, number>();
        const fields = headers.map((source_name, ordinal) => {
          const count = (counts.get(source_name) ?? 0) + 1; counts.set(source_name, count);
          const field_key = `${slug(source_name)}${count > 1 ? "__" + count : ""}`;
          const samples = matrix.slice(1, 101).map(r => r?.[ordinal]).filter(v => v !== undefined && String(v).trim() !== "");
          return { source_name, field_key, ordinal, data_type: inferType(source_name, samples), semantic_group: inferGroup(source_name), is_filterable: true };
        });
        const rows = matrix.slice(1).filter(r => r.some(v => String(v ?? "").trim() !== "")).map(r => {
          const item: Record<string, unknown> = {};
          fields.forEach(f => { item[f.field_key] = normalizeValue(r[f.ordinal] ?? "", f.data_type); });
          return item;
        });
        resolve({ fields, rows });
      },
      error: err => reject(err)
    });
  });
}
function slug(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "kolon";
}
function inferType(name: string, samples: unknown[]): DataType {
  const n = name.toLocaleLowerCase("tr-TR");
  if (/tarih|date/.test(n)) return "date";
  if (/saat|time/.test(n)) return "time";
  const vals = samples.map(v => String(v).trim());
  if (vals.length && vals.every(v => /^(true|false|evet|hayır|hayir|var|yok)$/i.test(v))) return "boolean";
  if (vals.length && vals.every(v => v !== "" && /^[-+]?\d+(?:[.,]\d+)?$/.test(v.replace(/\s/g, "")))) return "number";
  return "text";
}
function inferGroup(name: string): Group {
  const n = name.toLocaleLowerCase("tr-TR");
  if (/oran|odds|iddaa|handikap|alt.?üst|çifte şans|maç sonucu|ilk yarı\/maç|ilk gol|korner|kart|gol aralığı|tek\/çift/.test(n)) return "odds";
  if (/skor|durum|sonuç|gol yemeden|gol atacak|daha çok gol|uzatma|gerçekleş|kazandı|kaybetti/.test(n)) return "outcome";
  if (/tarih|saat|lig|sezon|ev sahibi|evsahibi|deplasman|maç id|maç$|kaynak url|arşiv|arsiv/.test(n)) return "match";
  return "other";
}
function normalizeValue(value: unknown, type: DataType): unknown {
  const s = String(value ?? "").trim();
  if (type === "number" && s !== "") { const n = Number(s.replace(",", ".")); return Number.isFinite(n) ? n : s; }
  if (type === "boolean") {
    if (/^(true|evet|var|1)$/i.test(s)) return true;
    if (/^(false|hayır|hayir|yok|0)$/i.test(s)) return false;
  }
  return s;
}
export function displayField(field: Field, all: Field[]) {
  const duplicates = all.filter(f => f.source_name === field.source_name).length;
  return duplicates > 1 ? `${field.source_name} (${field.ordinal + 1})` : field.source_name;
}
export const operators = [
  { value: "eq", label: "Eşittir" }, { value: "neq", label: "Eşit değildir" },
  { value: "contains", label: "İçerir" }, { value: "not_contains", label: "İçermez" },
  { value: "gt", label: "Büyüktür" }, { value: "gte", label: "Büyük veya eşit" },
  { value: "lt", label: "Küçüktür" }, { value: "lte", label: "Küçük veya eşit" },
  { value: "empty", label: "Boş" }, { value: "not_empty", label: "Boş değil" },
  { value: "starts", label: "Şununla başlar" }, { value: "ends", label: "Şununla biter" }
];
export function matches(row: Record<string, unknown>, c: Condition): boolean {
  const raw = row[c.field];
  const a = raw === null || raw === undefined ? "" : String(raw).trim();
  const b = c.value.trim();
  const an = Number(String(raw ?? "").replace(",", "."));
  const bn = Number(b.replace(",", "."));
  let ok = false;
  switch (c.operator) {
    case "eq": ok = a.localeCompare(b, "tr", { sensitivity: "base" }) === 0; break;
    case "neq": ok = a.localeCompare(b, "tr", { sensitivity: "base" }) !== 0; break;
    case "contains": ok = a.toLocaleLowerCase("tr").includes(b.toLocaleLowerCase("tr")); break;
    case "not_contains": ok = !a.toLocaleLowerCase("tr").includes(b.toLocaleLowerCase("tr")); break;
    case "gt": ok = a !== "" && Number.isFinite(an) && Number.isFinite(bn) && an > bn; break;
    case "gte": ok = a !== "" && Number.isFinite(an) && Number.isFinite(bn) && an >= bn; break;
    case "lt": ok = a !== "" && Number.isFinite(an) && Number.isFinite(bn) && an < bn; break;
    case "lte": ok = a !== "" && Number.isFinite(an) && Number.isFinite(bn) && an <= bn; break;
    case "empty": ok = a === ""; break;
    case "not_empty": ok = a !== ""; break;
    case "starts": ok = a.toLocaleLowerCase("tr").startsWith(b.toLocaleLowerCase("tr")); break;
    case "ends": ok = a.toLocaleLowerCase("tr").endsWith(b.toLocaleLowerCase("tr")); break;
  }
  return c.negate ? !ok : ok;
}
export function applyFilter(rows: Record<string, unknown>[], def: FilterDefinition) {
  const active = def.conditions.filter(c => c.field && c.operator);
  if (!active.length) return rows;
  return rows.filter(row => def.logic === "or" ? active.some(c => matches(row, c)) : active.every(c => matches(row, c)));
}
export function downloadCsv(rows: Record<string, unknown>[], fields: Field[]) {
  const data = [fields.map(f => f.source_name), ...rows.map(r => fields.map(f => r[f.field_key] ?? ""))];
  const csv = "\uFEFF" + Papa.unparse(data);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = "filtre-sonuclari.csv"; a.click(); URL.revokeObjectURL(url);
}