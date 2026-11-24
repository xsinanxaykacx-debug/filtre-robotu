import { useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Activity, ArrowDownToLine, Plus, Trash2, Upload, LogOut, Save, SlidersHorizontal, Database, Search, X, RefreshCw } from "lucide-react";
import { displayField, downloadCsv, parseCsv, type Condition, type DataType, type Field, type FilterDefinition, type Group, type DomainFilters } from "./lib";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
type Dataset = { id: string; name: string; row_count: number; source_filename: string; created_at: string };
type Saved = { id: string; name: string; definition: FilterDefinition };
const emptyDomain: DomainFilters = { oddsRanges: [], htHome: "", htAway: "", ftHome: "", ftAway: "", totalBucket: "", btts: "" };
const emptyDef: FilterDefinition = { version: 1, logic: "and", conditions: [], domain: emptyDomain };
const groupNames: Record<Group, string> = { match: "Maç bilgileri", odds: "Oran / market alanları", outcome: "Gerçekleşen sonuçlar", other: "Diğer alanlar" };

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false); const [message, setMessage] = useState("");
  const [datasets, setDatasets] = useState<Dataset[]>([]); const [datasetId, setDatasetId] = useState("");
  const [fields, setFields] = useState<Field[]>([]); const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalFiltered, setTotalFiltered] = useState(0); const [page, setPage] = useState(0); const [exporting, setExporting] = useState(false);
  const PAGE_SIZE = 100;
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
  useEffect(() => { if (datasetId) { setFilter(emptyDef); setQuery(""); setPage(0); void loadDataset(datasetId); } }, [datasetId]);
  useEffect(() => { if (datasetId && fields.length) void loadPage(datasetId, filter, query, page); }, [datasetId, filter, query, page, fields.length]);

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
    setRows([]);
    setTotalFiltered(0);
    const [{ data: cols, error: ce }, { data: filters, error: fe }] = await Promise.all([
      client.from("filter_dataset_columns").select("*").eq("dataset_id", id).order("ordinal"),
      client.from("filter_saved_filters").select("id,name,definition").eq("dataset_id", id).order("created_at", { ascending: false })
    ]);
    if (ce || fe) setMessage(ce?.message ?? fe?.message ?? "Veri alanları yüklenemedi.");
    const mapped = (cols ?? []).map((f: any) => ({ ...f, data_type: f.data_type as DataType, semantic_group: f.semantic_group as Group, is_filterable: f.is_filterable !== false })) as Field[];
    setFields(mapped);
    setSaved((filters ?? []) as Saved[]);
    setBusy(false);
  }
  function activeConditions(definition: FilterDefinition) {
    const d = definition.domain ?? emptyDomain;
    const conditions: Condition[] = [];
    for (const range of d.oddsRanges ?? []) {
      if (range.min.trim()) conditions.push({ id: range.id + "-min", field: range.field, operator: "gte", value: range.min.trim() });
      if (range.max.trim()) conditions.push({ id: range.id + "-max", field: range.field, operator: "lte", value: range.max.trim() });
    }
    if (d.htHome.trim() !== "" && d.htAway.trim() !== "") conditions.push({ id: "iy-score", field: "iy_skor", operator: "score_eq", value: `${d.htHome.trim()}-${d.htAway.trim()}` });
    if (d.ftHome.trim() !== "" && d.ftAway.trim() !== "") conditions.push({ id: "ft-score", field: "skor", operator: "score_eq", value: `${d.ftHome.trim()}-${d.ftAway.trim()}` });
    if (d.totalBucket) conditions.push({ id: "total-bucket", field: "skor", operator: "total_bucket", value: d.totalBucket });
    if (d.btts) conditions.push({ id: "btts", field: "skor", operator: "btts", value: d.btts });
    return conditions;
  }
  function updateDomain(patch: Partial<DomainFilters>) {
    setPage(0);
    setFilter(prev => ({ ...prev, logic: "and", domain: { ...(prev.domain ?? emptyDomain), ...patch } }));
  }
  function addOddsRange() {
    const options = fields.filter(f => f.semantic_group === "odds" && !/istatistik|kartlar/i.test(f.source_name));
    if (!options.length) return;
    updateDomain({ oddsRanges: [...(filter.domain?.oddsRanges ?? []), { id: crypto.randomUUID(), field: options[0].field_key, min: "", max: "" }] });
  }
  async function loadPage(id: string, definition: FilterDefinition, search: string, pageIndex: number) {
    if (!client) return;
    setBusy(true);
    const { data, error } = await client.rpc("firo_search_records", {
      p_dataset_id: id,
      p_conditions: activeConditions(definition),
      p_logic: definition.logic,
      p_search: search,
      p_limit: PAGE_SIZE,
      p_offset: pageIndex * PAGE_SIZE
    });
    if (error) {
      setMessage("Veri sorgusu başarısız: " + error.message);
      setRows([]);
      setTotalFiltered(0);
    } else {
      const result = data as { total_count?: number; rows?: Array<{ row_number: number; data: Record<string, unknown> }> };
      setRows((result?.rows ?? []).map(item => item.data));
      setTotalFiltered(Number(result?.total_count ?? 0));
    }
    setBusy(false);
  }
  async function exportAllResults() {
    if (!client || !datasetId || exporting || totalFiltered === 0) return;
    setExporting(true);
    setMessage("Filtre sonuçları CSV için hazırlanıyor...");
    try {
      const all: Record<string, unknown>[] = [];
      let offset = 0;
      while (offset < totalFiltered) {
        const { data, error } = await client.rpc("firo_search_records", {
          p_dataset_id: datasetId,
          p_conditions: activeConditions(filter),
          p_logic: filter.logic,
          p_search: query,
          p_limit: 500,
          p_offset: offset
        });
        if (error) throw error;
        const result = data as { rows?: Array<{ row_number: number; data: Record<string, unknown> }> };
        const batch = (result?.rows ?? []).map(item => item.data);
        if (!batch.length) break;
        all.push(...batch);
        offset += batch.length;
        setMessage(`CSV hazırlanıyor: ${all.length.toLocaleString("tr-TR")} / ${totalFiltered.toLocaleString("tr-TR")}`);
      }
      downloadCsv(all, fields);
      setMessage(`${all.length.toLocaleString("tr-TR")} kayıt CSV olarak dışa aktarıldı.`);
    } catch (error: any) {
      setMessage("Dışa aktarma başarısız: " + (error?.message ?? "Bilinmeyen hata"));
    } finally {
      setExporting(false);
    }
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

      // Küçük paketler kullan: 1.000 satırlık istekler geniş CSV'lerde 10 MB'ı aşabiliyor.
      // 100 satır/paket ve 2 işçi, Supabase Free veritabanına aşırı yük bindirmeden aktarır.
      const batchSize = 100;
      const concurrency = 2;
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
            try {
              // Ağ yanıtı kaybolsa bile tekrar deneme yinelenen satır üretmesin.
              const { error } = await client.from("filter_dataset_records").upsert(
                batches[batchIndex],
                { onConflict: "dataset_id,row_number", ignoreDuplicates: true }
              );
              if (!error) { lastError = null; break; }
              lastError = error;
            } catch (error) {
              lastError = error;
            }
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750 * (2 ** attempt)));
          }
          if (lastError) throw lastError;
          completedRows += batches[batchIndex].length;
          setMessage(`CSV aktarılıyor: ${completedRows.toLocaleString("tr-TR")} / ${parsed.rows.length.toLocaleString("tr-TR")} satır`);
        }
      };
      const workerResults = await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, batches.length) }, () => worker())
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
    setPage(0);
    setFilter(prev => ({ ...prev, conditions: prev.conditions.map(c => c.id === id ? { ...c, ...patch } : c) }));
  }
  function addCondition() {
    const f = fields.find(x => x.is_filterable);
    if (!f) return;
    setPage(0);
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
  const visibleRows = rows;
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
        <section className="panel filters-panel">
          <div className="panel-heading"><div><SlidersHorizontal size={17}/><h2>Maç ve oran filtreleri</h2></div><span className="count-pill">{activeConditions(filter).length} koşul</span></div>
          <p className="muted" style={{fontSize:13,margin:"0 0 18px"}}>Eklediğin bütün koşullar birlikte uygulanır (VE).</p>
          <div className="domain-section">
            <div className="domain-title"><strong>Oran aralıkları</strong><span>Her market için minimum ve maksimum oran</span></div>
            {(filter.domain?.oddsRanges ?? []).map((range, i) => <div className="condition" key={range.id} style={{display:"grid",gridTemplateColumns:"minmax(150px,1fr) 100px 100px 30px",gap:8,alignItems:"center"}}>
              <select value={range.field} onChange={e => updateDomain({oddsRanges:(filter.domain?.oddsRanges ?? []).map(x => x.id === range.id ? {...x,field:e.target.value} : x)})}>
                {fields.filter(f => f.semantic_group === "odds" && !/istatistik|kartlar/i.test(f.source_name)).map(f => <option key={f.field_key} value={f.field_key}>{displayField(f,fields)}</option>)}
              </select>
              <input inputMode="decimal" value={range.min} placeholder="Min oran" onChange={e => updateDomain({oddsRanges:(filter.domain?.oddsRanges ?? []).map(x => x.id === range.id ? {...x,min:e.target.value} : x)})}/>
              <input inputMode="decimal" value={range.max} placeholder="Maks oran" onChange={e => updateDomain({oddsRanges:(filter.domain?.oddsRanges ?? []).map(x => x.id === range.id ? {...x,max:e.target.value} : x)})}/>
              <button className="remove-condition" title="Oran filtresini kaldır" onClick={() => updateDomain({oddsRanges:(filter.domain?.oddsRanges ?? []).filter(x => x.id !== range.id)})}><X size={16}/></button>
            </div>)}
            <button className="secondary" onClick={addOddsRange}><Plus size={16}/> Oran marketi ekle</button>
          </div>
          <div className="domain-section">
            <div className="domain-title"><strong>Gerçekleşen skor</strong><span>Skor alanları oranlardan bağımsızdır</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
              <div><label className="domain-label">İY skoru</label><div className="score-inputs"><input type="number" min="0" step="1" placeholder="Ev" value={filter.domain?.htHome ?? ""} onChange={e => updateDomain({htHome:e.target.value})}/><span>–</span><input type="number" min="0" step="1" placeholder="Dep" value={filter.domain?.htAway ?? ""} onChange={e => updateDomain({htAway:e.target.value})}/></div></div>
              <div><label className="domain-label">Maç skoru</label><div className="score-inputs"><input type="number" min="0" step="1" placeholder="Ev" value={filter.domain?.ftHome ?? ""} onChange={e => updateDomain({ftHome:e.target.value})}/><span>–</span><input type="number" min="0" step="1" placeholder="Dep" value={filter.domain?.ftAway ?? ""} onChange={e => updateDomain({ftAway:e.target.value})}/></div></div>
            </div>
          </div>
          <div className="domain-section">
            <div className="domain-title"><strong>Gerçekleşen maç sonuçları</strong><span>Skordan hesaplanır; bahis oranı değildir</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
              <div><label className="domain-label">Toplam gol</label><select value={filter.domain?.totalBucket ?? ""} onChange={e => updateDomain({totalBucket:e.target.value})}><option value="">Hepsi</option><option value="0-1">0–1 gol</option><option value="2-3">2–3 gol</option><option value="4-5">4–5 gol</option><option value="6+">6+ gol</option></select></div>
              <div><label className="domain-label">Karşılıklı gol sonucu</label><select value={filter.domain?.btts ?? ""} onChange={e => updateDomain({btts:e.target.value})}><option value="">Hepsi</option><option value="Var">KG Var</option><option value="Yok">KG Yok</option></select></div>
            </div>
          </div>
          <div className="filter-actions"><button className="text-button" onClick={() => { setFilter(emptyDef); setPage(0); }}>Tüm filtreleri temizle</button></div>
          <div className="save-row"><input value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Filtre adı..."/><button className="secondary" onClick={saveFilter} disabled={!filterName.trim()}><Save size={15}/> Kaydet</button></div>
          {saved.length > 0 && <div className="saved-list"><span className="section-label">KAYITLI FİLTRELER</span>{saved.map(s => <div className="saved-item" key={s.id}><button onClick={() => { setFilter({...s.definition, domain:s.definition.domain ?? emptyDomain}); setPage(0); }}>{s.name}</button><button title="Kaydı sil" onClick={() => void removeSaved(s.id)}><Trash2 size={14}/></button></div>)}</div>}
          <div className="field-groups"><span className="section-label">ALGILANAN ALANLAR · {fields.length}</span>{(["match","odds","outcome","other"] as Group[]).map(g => <div className="field-group" key={g}><span>{groupNames[g]}</span><b>{fields.filter(f => f.semantic_group === g).length}</b></div>)}</div>
        </section>
        <section className="results">
          <div className="stats-grid"><div className="stat-card"><span>TOPLAM KAYIT</span><strong>{(activeDataset?.row_count ?? 0).toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>FİLTRE SONUCU</span><strong>{totalFiltered.toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>GÖSTERİLEN</span><strong>{rows.length.toLocaleString("tr-TR")}</strong></div><div className="stat-card"><span>ALAN SAYISI</span><strong>{fields.length}</strong></div></div>
          <div className="table-panel"><div className="table-toolbar"><div><h2>Sonuç kayıtları</h2><span>{busy ? "Veriler yükleniyor..." : "Filtre koşullarına uyan kayıtlar"}</span></div><div className="table-tools"><div className="search-box"><Search size={15}/><input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Sonuçlarda ara..." /></div><button className="secondary" onClick={() => void exportAllResults()} disabled={!totalFiltered || exporting}>{exporting ? "Hazırlanıyor..." : <><ArrowDownToLine size={15}/> Dışa aktar</>}</button><button className="icon-button" onClick={() => void loadPage(datasetId, filter, query, page)} title="Yenile"><RefreshCw size={16}/></button></div></div>
            {busy ? <div className="table-empty">Veriler yükleniyor...</div> : <><div className="table-scroll"><table><thead><tr><th>#</th>{displayFields.map(f => <th key={f.field_key} title={f.source_name}>{displayField(f,fields)}</th>)}</tr></thead><tbody>{visibleRows.slice(0,500).map((r,i) => <tr key={i}><td className="row-number">{i+1}</td>{displayFields.map(f => <td key={f.field_key}>{String(r[f.field_key] ?? "—")}</td>)}</tr>)}</tbody></table>{!visibleRows.length && !busy && <div className="table-empty">Bu koşullara uyan kayıt bulunamadı.</div>}</div>
            <div className="table-foot" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}><span>{totalFiltered.toLocaleString("tr-TR")} sonuç · Sayfa {totalFiltered ? page + 1 : 0} / {Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))}</span><div style={{display:"flex",gap:8}}><button className="secondary" onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0 || busy}>Önceki</button><button className="secondary" onClick={() => setPage(p => p+1)} disabled={busy || (page+1)*PAGE_SIZE>=totalFiltered}>Sonraki</button></div></div></>}
          </div><p className="data-note">Maç, oran ve gerçekleşmiş sonuç alanları ayrı gruplandırılır. Filtre motoru mevcut veri satırlarını değerlendirir; maç öncesi/sonrası uygunluğu veri alanlarının anlamına göre ayrıca seçilmelidir.</p>
        </section>
      </div>}
    </main>
  </div>;
}