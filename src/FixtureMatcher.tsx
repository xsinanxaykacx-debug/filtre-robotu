import { useMemo, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { Field, MackolikFixture } from "./lib";

type Props = { rows: Record<string, unknown>[]; fields: Field[]; hasDataset: boolean };
type Match = { row: Record<string, unknown>; score: string; result: string; similarity: number; distance: number };
const oddsGroups = [
  [["AvgH", "odds_AvgH"], ["AvgD", "odds_AvgD"], ["AvgA", "odds_AvgA"]],
  [["BbAvH", "odds_BbAvH"], ["BbAvD", "odds_BbAvD"], ["BbAvA", "odds_BbAvA"]],
  [["B365H", "odds_B365H"], ["B365D", "odds_B365D"], ["B365A", "odds_B365A"]]
];
function field(fields: Field[], aliases: string[]) {
  const names = aliases.map(x => x.toLowerCase());
  return fields.find(f => names.includes(f.field_key.toLowerCase()) || names.includes(f.source_name.trim().toLowerCase()));
}
function probabilities(values: unknown[]): number[] | null {
  const odds = values.map(v => Number(String(v ?? "").replace(",", ".")));
  if (odds.some(v => !Number.isFinite(v) || v <= 1)) return null;
  const inv = odds.map(v => 1 / v);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map(v => v / sum);
}
function search(rows: Record<string, unknown>[], fields: Field[], fixture: MackolikFixture | null, tolerance: number): Match[] {
  if (!fixture) return [];
  const target = probabilities([fixture.odds_home, fixture.odds_draw, fixture.odds_away]);
  if (!target) return [];
  const group = oddsGroups.map(g => g.map(a => field(fields, a))).find(g => g.every(Boolean));
  if (!group) return [];
  const home = field(fields, ["FTHG", "HomeGoals", "FullTimeHomeGoals"]);
  const away = field(fields, ["FTAG", "AwayGoals", "FullTimeAwayGoals"]);
  const found: Match[] = [];
  for (const row of rows) {
    const p = probabilities(group.map(f => row[(f as Field).field_key]));
    if (!p) continue;
    const diffs = p.map((v, i) => Math.abs(v - target[i]));
    if (Math.max(...diffs) > tolerance) continue;
    const distance = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0));
    const hg = home ? Number(row[home.field_key]) : NaN;
    const ag = away ? Number(row[away.field_key]) : NaN;
    const valid = Number.isFinite(hg) && Number.isFinite(ag);
    found.push({
      row, distance, similarity: Math.max(0, 1 - distance / Math.sqrt(3)),
      score: valid ? String(hg) + "-" + String(ag) : "—",
      result: valid ? (hg > ag ? "MS1" : hg === ag ? "MSX" : "MS2") : "Bilinmiyor"
    });
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, 500);
}
export default function FixtureMatcher({ rows, fields, hasDataset }: Props) {
  const [fixtures, setFixtures] = useState<MackolikFixture[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tolerance, setTolerance] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const selected = fixtures.find(f => f.match_id === selectedId) ?? null;
  const matches = useMemo(() => search(rows, fields, selected, Number(tolerance)), [rows, fields, selected, tolerance]);
  const counts = {
    MS1: matches.filter(x => x.result === "MS1").length,
    MSX: matches.filter(x => x.result === "MSX").length,
    MS2: matches.filter(x => x.result === "MS2").length
  };
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/fixtures/today", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Maçkolik verisi alınamadı.");
      const next = (payload.fixtures || []) as MackolikFixture[];
      setFixtures(next); setSelectedId(next[0]?.match_id || ""); setOpened(true);
      if (!next.length) setError("Bugün oranı alınabilen maç bulunamadı.");
    } catch (e) { setError(e instanceof Error ? e.message : "Fikstür alınamadı."); }
    finally { setBusy(false); }
  }
  return <section className="panel fixtures-panel">
    <div className="panel-heading"><div><Activity size={17}/><h2>Günlük maçlar ve tarihsel benzerlik</h2></div>
      <button className="secondary" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14}/>{busy ? "Yükleniyor..." : "Maçkolik'ten al"}</button>
    </div>
    {error && <p className="notice">{error}</p>}
    {opened && fixtures.length > 0 && <>
      <div className="fixture-controls">
        <label>Maç seç<select value={selectedId} onChange={e => setSelectedId(e.target.value)}>{fixtures.map(f => <option key={f.match_id} value={f.match_id}>{f.date} · {f.home} - {f.away} · {f.league}</option>)}</select></label>
        <label>Olasılık farkı sınırı<select value={tolerance} onChange={e => setTolerance(e.target.value)}><option value="0.02">±2 yüzde puanı</option><option value="0.03">±3 yüzde puanı</option><option value="0.05">±5 yüzde puanı</option><option value="0.07">±7 yüzde puanı</option><option value="0.10">±10 yüzde puanı</option></select></label>
      </div>
      {selected && <div className="fixture-summary"><div><strong>{selected.home} – {selected.away}</strong><small>{selected.league} · {selected.date} · Oran alım zamanı: {selected.odds_captured_at}</small></div><div className="fixture-odds"><span>1 <b>{Number(selected.odds_home).toFixed(2)}</b></span><span>X <b>{Number(selected.odds_draw).toFixed(2)}</b></span><span>2 <b>{Number(selected.odds_away).toFixed(2)}</b></span></div></div>}
      <div className="fixture-counts"><span>Benzer maç: <b>{matches.length}</b></span><span>MS1: <b>{counts.MS1}</b></span><span>MSX: <b>{counts.MSX}</b></span><span>MS2: <b>{counts.MS2}</b></span></div>
      {!hasDataset ? <p className="muted">Tarihsel maç arşivini CSV olarak yükleyince benzer maçlar burada listelenecek.</p> :
      matches.length > 0 ? <div className="table-scroll fixture-table"><table><thead><tr><th>Benzerlik</th><th>Skor</th><th>Sonuç</th><th>Ev oranı</th><th>Beraberlik oranı</th><th>Dep. oranı</th></tr></thead><tbody>
        {matches.slice(0, 100).map((m, i) => <tr key={i}><td>{(m.similarity * 100).toFixed(1)}%</td><td>{m.score}</td><td>{m.result}</td>
          {oddsGroups[0].map((aliases, j) => <td key={j}>{String(m.row[(field(fields, aliases)?.field_key || "")] ?? "—")}</td>)}
        </tr>)}
      </tbody></table></div> : <p className="muted">Bu toleransta benzer tam 1X2 oran üçlüsü bulunamadı. Arşivde AvgH / AvgD / AvgA (veya BbAv / B365) ve FTHG / FTAG alanları bulunmalı.</p>}
      <p className="data-note">Benzerlik, marjdan arındırılmış 1X2 olasılıklarının mutlak farkıyla hesaplanır. FTHG/FTAG yalnızca geçmiş skor ve sonuç etiketinde kullanılır; bu bir tahmin veya bahis önerisi değildir. Tarihsel oran yakalama zamanları arşivde yoksa maç öncesi uygunluğu doğrulanamaz.</p>
    </>}
  </section>;
}
