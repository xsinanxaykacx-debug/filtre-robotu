import { useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Activity, ArrowDownToLine, Plus, Trash2, Upload, LogOut, Save, SlidersHorizontal, Database, Search, X, RefreshCw } from "lucide-react";
import { applyFilter, displayField, downloadCsv, operators, parseCsv, type Condition, type DataType, type Field, type FilterDefinition, type Group } from "./lib";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
type Dataset = { id: string; name: string; row_count: number; source_filename: string; created_at: string };
type Saved = { id: string; name: string; definition: FilterDefinition };
const emptyDef: FilterDefinition = { version: 1, logic: "and", conditions: [] };
const groupNames: Record<Group, string> = { match: "Maç bilgileri", odds: "Oran / market alanları", outcome: "Gerçekleşen sonuçlar", other: "Diğer alanlar" };

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false); const [message, setMessage] = useState("");
  const [datasets, setDatasets] = useState<Dataset[]>([]); const [datasetId, setDatasetId] = useState("");
  const [fields, setFields] = useState<Field[]>([]); const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [filter, setFilter] = useState<FilterDefinition>(emptyDef); const [saved, setSaved] = useState<Saved[]>([]);
  const [filterName, setFilterName] = useState(""); const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false); const [showAuth, setShowAuth] = useState(false);
  const client = supabase;

  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session?.user?.id) void loadDatasets(); else { setDatasets([]); setDatasetId(""); setRows([]); setFields([]); } }, [session?.user?.id]);
  useEffect(() => { if (datasetId) { setFilter(emptyDef); setQuery(""); void loadDataset(datasetId); } }, [datasetId]);

  async function loadDatasets() {
    if (!client) return;
    const { data, error } = await client.from("filter_datasets").select("*").order("created_at", { ascending: false });
    if (error) { setMessage(error.message); return; }
    const list = (data ?? []) as Dataset[]; setDatasets(list);
    if (!datasetId && list.length) setDatasetId(list[0].id);
  }
  async function loadDataset(id: string) {
    if (!client) return;
    setBusy(true);
    const [{ data: cols, error: ce }, { data: filters, error: fe }] = await Promise.all([
      client.from("filter_dataset_columns").select("*").eq("dataset_id", id).order("ordinal"),
      client.from("filter_saved_filters").select("id,name,definition").eq("dataset_id", id).order("created_at", { ascending: false })
    ]);
    const allRecords: Record<string, unknown>[] = [];
    let page = 0; let recordError: any = null;
    while (page < 50000) {
      const { data: batch, error } = await client.from("filter_dataset_records").select("data").eq("dataset_id", id).order("row_number").range(page, page + 999);
      if (error) { recordError = error; break; }
      allRecords.push(...(batch ?? []).map((r: any) => r.data as Record<string, unknown>));
      if (!batch || batch.length < 1000) break;
      page += 1000;
    }
    if (ce || fe || recordError) setMessage(ce?.message ?? fe?.message ?? recordError?.message ?? "Veri yüklenemedi.");
    const mapped = (cols ?? []).map((f: any) => ({ ...f, data_type: f.data_type as DataType, semantic_group: f.semantic_group as Group, is_filterable: f.is_filterable !== false })) as Field[];
    setFields(mapped); setRows(allRecords);
    setSaved((filters ?? []) as Saved[]); setBusy(false);
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!client) return; setAuthBusy(true); setMessage("");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message); setAuthBusy(false);
  }
  async function signUp() {
    if (!client) return; setAuthBusy(true); setMessage("");
    const { error } = await client.auth.signUp({ email, password });
    setMessage(error ? error.message : "Kayıt isteği gönderildi. E-posta doğrulaması açıksa gelen kutunu kontrol et."); setAuthBusy(false);
  }
  async function signOut() { await client?.auth.signOut(); }
  async function importFile(file?: File) {
    if (!client || !file || !session?.user?.id) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setMessage("Şimdilik CSV dosyası yükleyebilirsin."); return; }
    setBusy(true); setMessage("CSV dosyası okunuyor...");
    let createdId = "";
    try {
      const parsed = await parseCsv(file);
      if (!parsed.fields.length || !parsed.rows.length) throw new Error("Dosyada aktarılacak satır bulunamadı.");
      if (parsed.rows.length > 50000) throw new Error("Tek dosyada en fazla 50.000 satır aktarılabilir.");
      const { data: ds, error: de } = await client.from("filter_datasets").insert({
        owner_id: session.user.id,
        name: file.name.replace(/\.csv$/i, ""),
        source_filename: file.name,
        source_format: "csv",
        row_count: parsed.rows.length
      }).select("id").single();
      if (de) throw de;
      createdId = ds.id;

      const cols = parsed.fields.map(f => ({ ...f, dataset_id: createdId, owner_id: session.user.id }));
      const { error: colErr } = await client.from("filter_dataset_columns").insert(cols);
      if (colErr) throw colErr;

      // 1.000 satırlık paketler ve en fazla 3 eşzamanlı istek.
      const batchSize = 1000;
      const batches: Array<Array<Record<string, unknown>>> = [];
      for (let i = 0; i < parsed.rows.length; i += batchSize) {
        batches.push(parsed.rows.slice(i, i + batchSize).map((data, j) => ({
          dataset_id: createdId,
          owner_id: session.user.id,
          row_number: i + j + 1,
          data
        })));
      }
      let nextBatch = 0;
      let completedRows = 0;
      const worker = async () => {
        while (true) {
          const batchIndex = nextBatch++;
          if (batchIndex >= batches.length) return;
          let lastError: any = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            const { error } = await client.from("filter_dataset_records").insert(batches[batchIndex]);
            if (!error) { lastError = null; break; }
            lastError = error;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
          }
          if (lastError) throw lastError;
          completedRows += batches[batchIndex].length;
          setMessage(`CSV aktarılıyor: ${completedRows.toLocaleString("tr-TR")} / ${parsed.rows.length.toLocaleString("tr-TR")} satır`);
        }
      };
      const workerResults = await Promise.allSettled(
        Array.from({ length: Math.min(3, batches.length) }, () => worker())
      );
      const failedWorker = workerResults.find(result => result.status === "rejected");
      if (failedWorker?.status === "rejected") throw failedWorker.reason;

      setDatasets(prev => [{
        id: createdId,
        name: file.name.replace(/\.csv$/i, ""),
        row_count: parsed.rows.length,
        source_filename: file.name,
        created_at: new Date().toISOString()
      }, ...prev]);
      setDatasetId(createdId);
      setFilter(emptyDef);
      setMessage(`${parsed.rows.length.toLocaleString("tr-TR")} satır içe aktarıldı.`);
    } catch (err: any) {
      let cleanupWarning = "";
      if (createdId) {
        const recordsCleanup = await client.from("filter_dataset_records").delete().eq("dataset_id", createdId);
        const columnsCleanup = await client.from("filter_dataset_columns").delete().eq("dataset_id", createdId);
        const filtersCleanup = await client.from("filter_saved_filters").delete().eq("dataset_id", createdId);
        const datasetCleanup = await client.from("filter_datasets").delete().eq("id", createdId);
        const cleanupError = recordsCleanup.error ?? columnsCleanup.error ?? filtersCleanup.error ?? datasetCleanup.error;
        if (cleanupError) cleanupWarning = ` Temizlik tamamlanamadı: ${cleanupError.message}`;
      }
      setMessage(`İçe aktarma başarısız: ${err?.message ?? "Bilinmeyen hata"}.${cleanupWarning}`);
    } finally { setBusy(false); }
  }
  async function deleteDataset() {
    if (!client || !datasetId || !confirm("Bu veri seti ve kayıtlı filtreleri silinsin mi?")) return;
    const children = await Promise.all([
      client.from("filter_dataset_records").delete().eq("dataset_id", datasetId),
      client.from("filter_dataset_columns").delete().eq("dataset_id", datasetId),
      client.from("filter_saved_filters").delete().eq("dataset_id", datasetId)
    ]);
    const childError = children.find(x => x.error)?.error;
    if (childError) { setMessage(childError.message); return; }
    const { error } = await client.from("filter_datasets").delete().eq("id", datasetId);
    if (error) setMessage(error.message); else {
      const remaining = datasets.filter(d => d.id !== datasetId);
      setDatasets(remaining); setDatasetId(remaining[0]?.id ?? ""); setRows([]); setFields([]); setMessage("Veri seti silindi.");
    }
  }
  function updateCondition(id: string, patch: Partial<Condition>) {
    setFilter(prev => ({ ...prev, conditions: prev.conditions.map(c => c.id === id ? { ...c, ...patch } : c) }));
  }
  function addCondition() {
    const f = fields.find(x => x.is_filterable);
    if (!f) return;
    setFilter(prev => ({ ...prev, conditions: [...prev.conditions, { id: crypto.randomUUID(), field: f.field_key, operator: "eq", value: "" }] }));
  }
  async function saveFilter() {
    if (!client || !datasetId || !filterName.trim()) return;
    const { data, error } = await client.from("filter_saved_filters").insert({ owner_id: session.user.id, dataset_id: datasetId, name: filterName.trim(), definition: filter }).select("id,name,definition").single();
    if (error) setMessage(error.message); else { setSaved(prev => [data as Saved, ...prev]); setFilterName(""); setMessage("Filtre kaydedildi."); }
  }
  async function removeSaved(id: string) {
    if (!client) return; const { error } = await client.from("filter_saved_filters").delete().eq("id", id);
    if (error) setMessage(error.message); else setSaved(prev => prev.filter(s => s.id !== id));
  }
  const filtered = useMemo(() => applyFilter(rows, filter), [rows, filter]);
  const visibleRows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return filtered;
    return filtered.filter(r => fields.some(f => String(r[f.field_key] ?? "").toLocaleLowerCase("tr").includes(q)));
  }, [filtered, query, fields]);
  const displayFields = fields.slice(0, 12);
  const activeDataset = datasets.find(d => d.id === datasetId);

  if (!client) return <main className="setup"><div className="setup-card"><div className="brand-mark"><Activity /></div><h1>Filtre Robotu</h1><p>Supabase bağlantısı henüz tanımlanmadı.</p><p className="muted">Vercel ortam değişkenlerine <code>VITE_SUPABASE_URL</code> ve <code>VITE_SUPABASE_ANON_KEY</code> eklenmeli. Yalnızca publishable/anon anahtar kullanılır; service role anahtarı tarayıcıya konmaz.</p></div></main>;
  if (!session) return <main className="setup"><form className="auth-card" onSubmit={signIn}><div className="brand-mark"><Activity /></div><h1>Filtre Robotu</h1><p>Kendi koşullarınla maç verilerini bul.</p><label>E-posta<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Şifre<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></label><button className="primary full" disabled={authBusy}>{authBusy ? "Bekle..." : "Giriş yap"}</button><button type="button" className="link-button" onClick={signUp} disabled={authBusy}>Hesap oluştur</button>{message && <p className="notice">{message}</p>}</form></main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Activity /></div><div><strong>Filtre Robotu</strong><small>MAÇ VERİSİ FİLTRELEME</small></div></div>
      <div className="side-section"><span className="section-label">VERİ SETLERİ</span>
        {datasets.map(d => <button key={d.id} className={datasetId === d.id ? "dataset active" : "dataset"} onClick={() => setDatasetId(d.id)}><Database size={16}/><span>{d.name}<small>{d.row_count.toLocaleString("tr-TR")} kayıt</small></span></button>)}
        {!datasets.length && <p className="muted small-pad">Henüz veri seti yok.</p>}
      </div>
      <div className="sidebar-bottom"><span className="user-email">{session.user.email}</span><button className="ghost full" onClick={signOut}><LogOut size={15}/> Çıkış yap</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">VERİ ÇALIŞMA ALANI</div><h1>{activeDataset?.name ?? "Yeni çalışma"}</h1></div><div className="top-actions"><label className="upload-button"><Upload size={16}/> CSV içe aktar<input type="file" accept=".csv,text/csv" onChange={e => { void importFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>{activeDataset && <button className="icon-button danger" title="Veri setini sil" onClick={deleteDataset}><Trash2 size={17}/></button>}</div></header>
      {message && <div className="notice-bar">{message}<button onClick={() => setMessage("")}><X size={15}/></button></div>}
      {!datasets.length ? <section className="empty-state"><div className="empty-icon"><Upload size={25}/></div><h2>İlk veri setini yükle</h2><p>CSV dosyanı içe aktar. Kolonlar otomatik algılanır; yeni alanlar için kod değişikliği gerekmez.</p><label className="primary upload-button"><Upload size={16}/> CSV dosyası seç<input type="file" accept=".csv,text/csv" onChange={e => { void importFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label><small>İlk sürüm: CSV · En fazla 50.000 satır / dosya</small></section> :
      <div className="workspace">
        <section className="panel filters-panel"><div className="panel-heading"><div><SlidersHorizontal size={17}/><h2>Filtre koşulları</h2></div><span className="count-pill">{filter.conditions.length} koşul</span></div>
          <div className="logic-row"><span>Koşulların bağlanma şekli</span><div className="segmented"><button className={filter.logic === "and" ? "selected" : ""} onClick={() => setFilter(p => ({...p,logic:"and"}))}>VE</button><button className={filter.logic === "or" ? "selected" : ""} onClick={() => setFilter(p => ({...p,logic:"or"}))}>VEYA</button></div></div>
          {filter.conditions.length === 0 && <p className="muted no-conditions">Henüz koşul eklenmedi. Bir alan seçerek filtre oluşturmaya başla.</p>}
          {filter.conditions.map((c, i) => <div className="condition" key={c.id}><span className="condition-index">{i + 1}</span><select value={c.field} onChange={e => updateCondition(c.id,{field:e.target.value})}>{fields.filter(f => f.is_filterable).map(f => <option key={f.field_key} value={f.field_key}>{displayField(f,fields)}</option>)}</select><select value={c.operator} onChange={e => updateCondition(c.id,{operator:e.target.value})}>{operators.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{!["empty","not_empty"].includes(c.operator) && <input value={c.value} onChange={e => updateCondition(c.id,{value:e.target.value})} placeholder="Değer..." /> }<label className="not-toggle" title="Bu koşulu tersine çevir"><input type="checkbox" checked={!!c.negate} onChange={e => updateCondition(c.id,{negate:e.target.checked})}/> NOT</label><button className="remove-condition" onClick={() => setFilter(p => ({...p,conditions:p.conditions.filter(x => x.id !== c.id)}))}><X size={16}/></button></div>)}
          <div className="filter-actions"><button className="secondary" onClick={addCondition}><Plus size={16}/> Koşul ekle</button><button className="text-button" onClick={() => setFilter(emptyDef)}>Temizle</button></div>
          <div className="save-row"><input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Filtre adı..." /><button className="secondary" onClick={saveFilter} disabled={!filterName.trim()}><Save size={15}/> Kaydet</button></div>
          {saved.length > 0 && <div className="saved-list"><span className="section-label">KAYITLI FİLTRELER</span>{saved.map(s => <div className="saved-item" key={s.id}><button onClick={() => setFilter(s.definition)}>{s.name}</button><button title="Kaydı sil" onClick={() => void removeSaved(s.id)}><Trash2 size={14}/></button></div>)}</div>}
          <div className="field-groups"><span className="section-label">ALGILANAN ALANLAR · {fields.length}</span>{(["match","odds","outcome","other"] as Group[]).map(g => <div className="field-group" key={g}><span>{groupNames[g]}</span><b>{fields.filter(f => f.semantic_group === g).length}</b></div>)}</div>
        </section>
        <section className="results">
          <div className="stats-grid"><div className="stat-card"><span>TOPLAM KAYIT</span><strong>{rows.length.toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>FİLTRE SONUCU</span><strong>{filtered.length.toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>GÖSTERİLEN</span><strong>{visibleRows.length.toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>ALAN SAYISI</span><strong>{fields.length}</strong></div></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Sonuç kayıtları</h2><span>{busy ? "Veriler yükleniyor..." : "Filtre koşullarına uyan kayıtlar"}</span></div><div className="table-tools"><div className="search-box"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Sonuçlarda ara..." /></div><button className="secondary" onClick={() => downloadCsv(visibleRows,fields)} disabled={!visibleRows.length}><ArrowDownToLine size={15}/> Dışa aktar</button><button className="icon-button" onClick={() => void loadDataset(datasetId)} title="Yenile"><RefreshCw size={16}/></button></div></div>
            {busy ? <div className="table-empty">Veriler yükleniyor...</div> : <div className="table-scroll"><table><thead><tr><th>#</th>{displayFields.map(f => <th key={f.field_key} title={f.source_name}>{displayField(f,fields)}</th>)}</tr></thead><tbody>{visibleRows.slice(0,500).map((r,i) => <tr key={i}><td className="row-number">{i+1}</td>{displayFields.map(f => <td key={f.field_key}>{String(r[f.field_key] ?? "—")}</td>)}</tr>)}</tbody></table>{!visibleRows.length && <div className="table-empty">Bu koşullara uyan kayıt bulunamadı.</div>}{visibleRows.length > 500 && <div className="table-foot">Ekranda ilk 500 kayıt gösteriliyor. CSV dışa aktarımı tüm sonuçları içerir.</div>}</div>}
          </div><p className="data-note">Maç, oran ve gerçekleşmiş sonuç alanları ayrı gruplandırılır. Filtre motoru mevcut veri satırlarını değerlendirir; maç öncesi/sonrası uygunluğu veri alanlarının anlamına göre ayrıca seçilmelidir.</p>
        </section>
      </div>}
    </main>
  </div>;
}