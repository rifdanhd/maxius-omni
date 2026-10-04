"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, CircleHelp, Code2, Coffee, FileText, LayoutGrid, Moon, RefreshCw, Search, Sun, Terminal, Pause, Play, X } from "lucide-react";
import { useTheme } from "@/context/theme-provider";
import type { AgentStatus, OfficeAgent, OfficeSnapshot } from "@/lib/agent-office/types";
import { AgentPresence } from "./agent-presence";
import "./office.css";

const statuses: Record<AgentStatus, { label: string; symbol: string }> = {
  working: { label: "Bekerja", symbol: "···" }, waiting: { label: "Menunggu", symbol: "?" }, done: { label: "Selesai", symbol: "✓" }, error: { label: "Error", symbol: "!" },
};
const colors = ["#759a73", "#b694ce", "#e3a56e", "#75a8bd", "#d58281", "#d0b65f"];

function Workstation({ agent, index, selected, leaving, onSelect }: { agent: OfficeAgent; index: number; selected: boolean; leaving: boolean; onSelect: () => void }) {
  return <button data-agent-id={agent.id} data-status={agent.status} className={`workstation ${agent.status} ${selected ? "selected" : ""} ${leaving ? "leaving" : ""}`} disabled={leaving} aria-hidden={leaving} onClick={onSelect} aria-label={`${agent.name}: ${statuses[agent.status].label}. ${agent.task}`} aria-pressed={selected}>
    <span className="sprite-bubble">{statuses[agent.status].symbol}</span>
    <svg viewBox="0 0 140 130" className="desk-sprite" aria-hidden="true" shapeRendering="crispEdges">
      <ellipse cx="70" cy="116" rx="57" ry="8" fill="#554333" opacity=".13" />
      <path d="M19 64h102v35H19z" fill="#a77950"/><path d="M14 61h112v12H14z" fill="#ddb98c"/><path d="M19 73h102v7H19z" fill="#bb9166"/><path d="M22 96h8v21h-8zm88 0h8v21h-8z" fill="#886344"/>
      <path d="M47 25h46v33H47z" fill="#425353"/><path d="M51 29h38v25H51z" fill={agent.status === "error" ? "#8c5558" : "#85aba0"}/><path d="M55 34h15v3H55zm0 7h25v3H55zm0 7h19v2H55z" fill="#d4e7bc"/><path d="M66 58h8v5H66zm-7 5h22v3H59z" fill="#425353"/>
      <path d="M103 51h12v12h-12zm12 3h4v6h-4z" fill="#f2ecd5"/><path d="M104 51h10v3h-10z" fill="#815c40"/>
      <path d="M38 85h64v29H38z" fill="#4b605b"/><path d="M43 89h54v29H43z" fill="#657e73"/><path d="M64 114h12v12H64zm-12 10h36v4H52z" fill="#425353"/>
      <path d="M53 69h34v31H53z" fill={colors[index % colors.length]}/><g className="agent-head"><path d="M58 48h24v24H58z" fill="#e6b594"/><path d="M54 44h32v13H54zm0 10h7v10h-7zm26 0h6v10h-6z" fill={index % 2 ? "#68524d" : "#3d4543"}/><path d="M61 68h18v6H61z" fill="#cc9678"/></g>
      <g className="typing-hands"><path d="M43 72h12v12H43zm42 0h12v12H85z" fill={colors[index % colors.length]}/><path d="M43 69h10v6H43zm44 0h10v6H87z" fill="#e6b594"/></g>
    </svg>
    <span className="desk-name">{agent.name}<span className={`status-dot ${agent.status}`} /></span><span className="desk-role">{agent.role}</span>
  </button>;
}

export default function Office() {
  const { resolvedTheme, setTheme } = useTheme();
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | AgentStatus>("all");
  const [query, setQuery] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [clock, setClock] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch("/api/agents", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sumber status tidak terhubung.");
        if (active) { setSnapshot(data); setLastSyncedAt(new Date().toISOString()); setClock(Date.now()); setError(""); }
      } catch (failure) { if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Koneksi gagal."); }
      finally { if (active) timer = setTimeout(load, 3000); }
    };
    void load();

    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [paused, refreshKey]);
  const agents = useMemo(() => snapshot?.agents || [], [snapshot]);
  const visible = useMemo(() => agents.filter(agent => (filter === "all" || agent.status === filter) && `${agent.name} ${agent.task}`.toLowerCase().includes(query.toLowerCase())), [agents, filter, query]);
  const activeAgent = agents.find(agent => agent.id === selected);

  const resumeAgent = async () => {
    if (!activeAgent || resumeBusy) return;
    setResumeBusy(true);
    setActionMessage("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(activeAgent.id)}/resume`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updatedAt: activeAgent.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setActionMessage(result.message);
      if (!paused) setRefreshKey(key => key + 1);
    } catch (failure) { setActionMessage(failure instanceof Error ? failure.message : "Perintah gagal dikirim."); }
    finally { setResumeBusy(false); }
  };
  const closeErrorAgent = async () => {
    if (!activeAgent || resumeBusy) return;
    setResumeBusy(true);
    setActionMessage("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(activeAgent.id)}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updatedAt: activeAgent.updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSnapshot(current => current ? { ...current, agents: current.agents.filter(agent => agent.id !== activeAgent.id) } : current);
      setSelected(null);
      if (!paused) setRefreshKey(key => key + 1);
    } catch (failure) { setActionMessage(failure instanceof Error ? failure.message : "Sesi gagal ditutup."); }
    finally { setResumeBusy(false); }
  };
  const duration = activeAgent ? Math.max(0, Math.floor(((activeAgent.endedAt ? Date.parse(activeAgent.endedAt) : ["done", "error"].includes(activeAgent.status) ? Date.parse(activeAgent.updatedAt) : clock || Date.parse(activeAgent.updatedAt)) - Date.parse(activeAgent.startedAt)) / 1000)) : 0;

  return <div className="little-office">
    <header className="office-header"><a href="/office" className="office-brand"><span className="brand-icon"><Code2 size={22}/></span><span>little office<span className="brand-period">.</span></span><span className="brand-tag">AGENT WORKSPACE</span></a><div className="header-actions"><span className="local-label"><span className="status-dot working"/> Ruang kerja lokal</span><button className="icon-button" aria-label="Ganti mode terang atau gelap" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button><span className="profile-pixel">M</span></div></header>
    <main className="office-main"><div className="heading-row"><div><div className="eyebrow">SEDIKIT PIXEL, BANYAK PROGRES</div><h1>Kantor virtualmu<span> ✦</span></h1><p>Tempat ide dikerjakan. Satu agen, satu meja, satu langkah maju.</p></div><button className="source-button" onClick={() => setSourceOpen(true)}><Terminal size={16}/> Sumber data <ArrowUpRight size={15}/></button></div>
      <div className="stats-row">{(["working", "waiting", "done", "error"] as AgentStatus[]).map(status => <button className={`stat-card ${filter === status ? "active" : ""}`} key={status} onClick={() => setFilter(filter === status ? "all" : status)} aria-pressed={filter === status}><span className={`stat-symbol ${status}`}>{statuses[status].symbol}</span><span><span className="stat-label">{statuses[status].label}</span><strong>{agents.filter(agent => agent.status === status).length.toString().padStart(2, "0")}</strong></span><span className="stat-description">{status === "working" ? "Ide jadi kode" : status === "waiting" ? "Butuh arahan" : status === "done" ? "Siap dirayakan" : "error" === status ? "Perlu perhatian" : ""}</span></button>)}</div>
      {error && <div className="connection-error" role="alert">{error} {snapshot && "Menampilkan status terakhir; data mungkin sudah usang."}<button disabled={paused} onClick={() => setRefreshKey(key => key + 1)}>Coba lagi</button></div>}
      <div className="workspace-layout"><section className="room-panel"><div className="panel-heading"><div><LayoutGrid size={17}/><h2>Lantai kantor</h2><span className="count-tag">{agents.length} agen</span></div><span className={`live-label ${error || paused ? "offline" : ""}`}><span/>{error ? "TERPUTUS" : paused ? "DIJEDA" : !snapshot ? "MEMUAT" : snapshot.demo ? "DEMO" : "LIVE"}</span></div>
          <div className="room-viewport" role="region" aria-label="Kantor virtual, dapat digeser" tabIndex={0}><div className={`office-room ${visible.length <= 3 ? "compact-room" : ""}`} data-agent-count={visible.length}><div className="room-wall"><div className="pixel-window"><i/><i/><i/><i/></div><div className="wall-sign">MAKE GOOD<br/><strong>THINGS.</strong></div><div className="wall-clock"><span/></div><div className="pixel-window second-window"><i/><i/><i/><i/></div></div><div className="room-floor"><div className="floor-caption">THE BUILD ROOM <span> / 01</span></div><div className="desks-grid"><AgentPresence agents={visible}>{(agent, leaving) => <Workstation key={agent.id} leaving={leaving} agent={agent} index={Math.max(0, agents.findIndex(item => item.id === agent.id))} selected={selected === agent.id} onSelect={() => { setSelected(selected === agent.id ? null : agent.id); setActionMessage(""); }}/>}</AgentPresence>{!visible.length && <div className="empty-office">{snapshot ? agents.length ? "Tidak ada agen untuk filter ini." : "Belum ada agen terhubung. Buka Sumber data untuk menghubungkan proses agen." : error ? "Hubungkan file log untuk membuka kantor." : "Membuka kantor…"}</div>}</div><div className="room-bottom"><div className="pixel-plant">♣<span/></div><div className="office-rug">ONE COMMIT AT A TIME</div><div className="coffee-corner"><Coffee size={26}/><span>coffee & code</span></div></div></div></div></div>
          <div className="room-footer"><span><span className="tiny-square"/> Klik karakter untuk melihat tugasnya</span><button onClick={() => setPaused(!paused)}>{paused ? <Play size={15}/> : <Pause size={15}/>} {paused ? "Lanjutkan pembaruan" : "Jeda pembaruan"}</button></div>
        </section>
        <section className="task-panel"><div className="panel-heading"><div><FileText size={17}/><h2>Daftar tugas</h2></div><span className="count-tag">{visible.length}</span></div><label className="task-search"><Search size={16}/><input placeholder="Cari agen atau tugas…" value={query} onChange={event => setQuery(event.target.value)}/><span>/</span></label><div className="task-tabs"><button onClick={() => setFilter("all")} className={filter === "all" ? "active" : ""}>Semua tugas</button><button onClick={() => setFilter("working")} className={filter === "working" ? "active" : ""}>Aktif</button><button onClick={() => setFilter("error")} className={filter === "error" ? "active" : ""}>Perlu perhatian</button></div><div className="task-list"><AgentPresence agents={visible}>{(agent, leaving) => <button key={agent.id} data-agent-id={agent.id} data-status={agent.status} disabled={leaving} aria-hidden={leaving} className={`task-item ${selected === agent.id ? "selected" : ""} ${leaving ? "leaving" : ""}`} onClick={() => { setSelected(selected === agent.id ? null : agent.id); setActionMessage(""); }}><span className="mini-avatar" style={{ background: colors[Math.max(0, agents.findIndex(item => item.id === agent.id)) % colors.length] }}>{agent.name.slice(0, 1)}</span><span className="task-copy"><span className="task-name">{agent.name}<span className={`task-status ${agent.status}`}>{statuses[agent.status].label}</span></span><strong>{agent.task}</strong><span className="task-time">{new Date(agent.updatedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span><ChevronRight size={14}/></button>}</AgentPresence>{!snapshot && <p className="empty-tasks" role="status">{error ? "Status tidak tersedia." : "Memuat tugas agen…"}</p>}{snapshot && !visible.length && <p className="empty-tasks">{agents.length ? "Tidak ada tugas yang cocok." : "Belum ada tugas dari agen."}</p>}</div><div className="task-bottom"><span className="small-spark">✦</span><p>Kerja besar dimulai dari<br/><strong>langkah-langkah kecil.</strong></p></div></section></div>
      {activeAgent && <section className="agent-detail" aria-live="polite"><span className={`stat-symbol ${activeAgent.status}`}>{statuses[activeAgent.status].symbol}</span><div><h3>{activeAgent.name} · {activeAgent.task}</h3><p>{activeAgent.message}</p><p>Durasi: {Math.floor(duration / 3600)}j {Math.floor(duration % 3600 / 60)}m {duration % 60}dtk · Pembaruan terakhir: {new Date(activeAgent.updatedAt).toLocaleString("id-ID")}</p>
        {activeAgent.status === "waiting" && <button className="source-button resume-button" disabled={!activeAgent.canResume || activeAgent.resumePending || resumeBusy} onClick={resumeAgent}>{activeAgent.resumePending ? "Menunggu konfirmasi agen…" : resumeBusy ? "Mengirim…" : "Setujui / Lanjutkan"}</button>}
        {activeAgent.status === "waiting" && !activeAgent.canResume && <p>Agen ini belum mendukung perintah lanjut.</p>}
        {activeAgent.status === "error" && <button className="source-button close-session-button" disabled={resumeBusy} onClick={closeErrorAgent}>{resumeBusy ? "Menutup…" : "Tutup"}</button>}
        {actionMessage && <p role="status">{actionMessage}</p>}</div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Tutup detail"><X size={18}/></button></section>}
      <footer className="office-footer"><span><span className={`status-dot ${error ? "error" : "working"}`}/>{snapshot?.demo ? "Data contoh" : "Sumber lokal"} <span className="footer-divider">/</span> {snapshot?.source || ".agent-office/*.json"}</span><button disabled={paused} onClick={() => setRefreshKey(key => key + 1)}><RefreshCw size={13}/> {paused ? "Pembaruan dijeda" : "Diperbarui setiap 3 detik"}</button><span>Dibuat untuk pikiran yang terus membangun <span className="footer-flower">✳</span></span></footer>
    </main>
    {sourceOpen && <div className="source-overlay" onClick={() => setSourceOpen(false)}><section className="source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setSourceOpen(false); }}><button autoFocus className="icon-button dialog-close" onClick={() => setSourceOpen(false)} aria-label="Tutup sumber data"><X size={20}/></button><Terminal size={24}/><h2 id="source-title">Sumber data agen</h2><dl className="source-connection"><div><dt>Sumber yang dipakai</dt><dd>{snapshot?.source || ".agent-office/*.json"}</dd></div><div><dt>Sinkron terakhir</dt><dd>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("id-ID") : "Belum tersinkron"}</dd></div><div><dt>Status koneksi</dt><dd className={error ? "disconnected" : "connected"}>{error ? "Terputus" : snapshot ? "Terhubung" : "Menghubungkan…"}{paused ? " · Pembaruan dijeda" : ""}</dd></div></dl><p>Status nyata dibaca dari <code>.agent-office/&lt;id&gt;.json</code> yang ditulis tiap agen di server. Tidak ada fallback data contoh.</p><p>Jalankan proses agen melalui wrapper berikut. Event proses dan exit code menjadi status otomatis. Isi prompt dan output mentah tidak disimpan; log hanya menampilkan nama event status. Agen yang membutuhkan persetujuan mencetak OFFICE_WAITING: diikuti alasan, lalu menunggu input continue melalui stdin.</p><pre>{'node scripts/office-agent.mjs atlas Atlas Developer "Membangun fitur" -- <perintah-agen> [argumen]'}</pre>
        <p>Atau tulis file status secara atomik dengan format berikut. File baru otomatis menambahkan meja. Sesi Selesai ditampilkan selama 5 menit setelah berakhir. Sesi Error tetap terlihat sampai ditutup manual melalui tombol Tutup. File status tetap disimpan dengan metadata singkat tanpa output mentah.</p>
        <pre>{JSON.stringify({ id: "atlas", name: "Atlas", role: "Developer", task: "Membangun fitur", status: "working", message: "Agen sedang bekerja.", event: "process.started", startedAt: "2026-10-04T09:00:00Z", updatedAt: "2026-10-04T09:01:00Z", canResume: false }, null, 2)}</pre><p>Status: <code>working</code>, <code>waiting</code>, <code>done</code>, <code>error</code>. Untuk direktori lain, atur <code>AGENT_OFFICE_DIR</code> pada server dan wrapper. Tombol lanjut menulis perintah ke <code>commands/&lt;id&gt;.json</code>; status berubah setelah agen menerima perintah. Integrasi khusus harus membaca dan menghapus perintah ini; set <code>canResume: true</code> hanya jika didukung.</p><div className="source-note"><CircleHelp size={17}/> Tombol lanjut mengirim persetujuan hanya ke proses agen yang terhubung.</div><button className="source-button" onClick={() => setSourceOpen(false)}><Check size={16}/> Mengerti</button></section></div>}
  </div>;
}
