'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import './prospeccao.css';

const stages = [
  ['new', 'Novo'], ['contacted', 'Contatado'], ['interested', 'Interessado'],
  ['proposal', 'Proposta'], ['won', 'Fechado'], ['lost', 'Perdido'],
];
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0));
const digits = (value) => String(value || '').replace(/\D/g, '');
async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) throw new Error(`O servidor retornou uma resposta vazia (HTTP ${response.status}). Tente novamente.`);
  try { return JSON.parse(text); }
  catch { throw new Error(`O servidor retornou uma resposta inválida (HTTP ${response.status}). Tente novamente.`); }
}
const whatsapp = (phone) => {
  let value = digits(phone);
  if (value.length < 10) return null;
  if (!value.startsWith('55')) value = '55' + value;
  return 'https://wa.me/' + value;
};

export default function ProspeccaoPage() {
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(20);
  const [leads, setLeads] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState({});
  const lastLoadedFoundCount = useRef(0);

  const loadLeads = useCallback(async () => {
    try {
      const response = await fetch('/api/leads', { cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar CRM.');
      setLeads(data.leads || []);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    if (!job?.id || ['completed', 'failed', 'cancelled'].includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/jobs/' + encodeURIComponent(job.id), { cache: 'no-store' });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.detail || data.error || 'Falha ao consultar pesquisa.');
        setError('');
        setJob(data);
        const currentFoundCount = Number(data.found_count || 0);
        if (currentFoundCount > lastLoadedFoundCount.current) {
          lastLoadedFoundCount.current = currentFoundCount;
          await loadLeads();
        }
        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          clearInterval(timer);
          setLoading(false);
          await loadLeads();
        }
      } catch (err) {
        // Uma falha temporária de consulta não interrompe o acompanhamento da pesquisa.
        setError(err.message);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, loadLeads]);

  async function startSearch(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setJob(null);
    lastLoadedFoundCount.current = 0;
    try {
      const response = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, category, limit: Number(limit) }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Não foi possível iniciar a captura.');
      setJob({ ...data, status: data.status || 'queued' });
    } catch (err) { setError(err.message); setLoading(false); }
  }


  async function cancelSearch() {
    if (!job?.id || !loading) return;
    setError('');
    setJob((current) => current ? { ...current, status: 'cancelling', message: 'Solicitando interrupção segura…' } : current);
    try {
      const response = await fetch('/api/jobs/' + encodeURIComponent(job.id) + '/cancel', { method: 'POST' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Não foi possível parar a pesquisa.');
      setJob(data);
      if (data.status === 'cancelled') {
        setLoading(false);
        await loadLeads();
      }
    } catch (err) { setError(err.message); }
  }

  async function updateLead(id, values) {
    setSaving((old) => ({ ...old, [id]: true }));
    try {
      const response = await fetch('/api/leads/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Falha ao atualizar lead.');
      setLeads((old) => old.map((lead) => lead.id === id ? data.lead : lead));
    } catch (err) { setError(err.message); }
    finally { setSaving((old) => ({ ...old, [id]: false })); }
  }

  async function deleteLead(lead) {
    const confirmed = window.confirm(`Tem certeza que deseja excluir "${lead.name}"? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;
    setSaving((old) => ({ ...old, [lead.id]: true }));
    try {
      const response = await fetch('/api/leads/' + lead.id, { method: 'DELETE' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Falha ao excluir lead.');
      setLeads((old) => old.filter((item) => item.id !== lead.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving((old) => ({ ...old, [lead.id]: false }));
    }
  }

  const noSite = useMemo(() => leads.filter((lead) => !String(lead.website || '').trim()), [leads]);
  const stats = useMemo(() => ({
    noSite: noSite.length,
    contacted: noSite.filter((lead) => ['contacted','interested','proposal','won'].includes(lead.status)).length,
    proposals: noSite.filter((lead) => lead.status === 'proposal').length,
    won: leads.filter((lead) => lead.status === 'won').length,
    revenue: leads.filter((lead) => lead.status === 'won').reduce((sum, lead) => sum + Number(lead.deal_value || 0), 0),
    pipeline: leads.filter((lead) => ['interested','proposal'].includes(lead.status)).reduce((sum, lead) => sum + Number(lead.deal_value || 0), 0),
  }), [leads, noSite]);

  const jobProgress = (() => {
    if (!job?.message) return null;
    try {
      const parsed = JSON.parse(job.message);
      return parsed?.version === 1 ? parsed : null;
    } catch { return null; }
  })();

  const visible = noSite.filter((lead) => {
    const matchesFilter = filter === 'all' || (filter === 'pending' ? lead.status === 'new' : lead.status === filter);
    const text = [lead.name, lead.phone, lead.city, lead.address, lead.category].filter(Boolean).join(' ').toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });

  return (
    <main className="crm-shell">
      <aside className="crm-sidebar">
        <Link href="/" className="crm-brand"><span className="crm-brand-mark">E</span><span>ESCARLATE<small>CRM COMERCIAL</small></span></Link>
        <div className="nav-caption">ESPAÇO DE TRABALHO</div>
        <a className="nav-item active" href="#dashboard">▦ <span>Visão geral</span></a>
        <a className="nav-item" href="#leads">◉ <span>Leads</span><b>{noSite.length}</b></a>
        <a className="nav-item" href="#captura">⌕ <span>Prospecção</span></a>
        <div className="sidebar-bottom"><span className="status-dot" /> CRM conectado</div>
      </aside>

      <section className="crm-main">
        <header className="crm-topbar"><div><span className="eyebrow">SEU NEGÓCIO, EM UM SÓ LUGAR</span><h1>Visão geral</h1><p>Acompanhe oportunidades, contatos e resultados.</p></div><button className="refresh-button" onClick={loadLeads}>↻ Atualizar dados</button></header>

        {error && <div className="prospect-error">{error}</div>}

        <section id="dashboard" className="finance-section">
          <div className="section-title"><div><span className="eyebrow">RESUMO FINANCEIRO</span><h2>Como estão seus resultados</h2></div><span className="live-label"><i /> Dados do CRM</span></div>
          <div className="finance-grid">
            <article className="finance-card revenue-card"><span>Faturamento fechado</span><strong>{money(stats.revenue)}</strong><small>{stats.won} negócio(s) marcado(s) como fechado(s)</small><div className="finance-symbol">↗</div></article>
            <article className="finance-card"><span>Em negociação</span><strong>{money(stats.pipeline)}</strong><small>Valor informado em interessados e propostas</small><div className="finance-symbol">◎</div></article>
            <article className="finance-card"><span>Propostas enviadas</span><strong>{stats.proposals}</strong><small>Oportunidades aguardando retorno</small><div className="finance-symbol">▤</div></article>
            <article className="finance-card"><span>Leads sem site</span><strong>{stats.noSite}</strong><small>{stats.contacted} já trabalhados no funil</small><div className="finance-symbol">◉</div></article>
          </div>
          <p className="finance-note">O faturamento considera apenas leads com etapa “Fechado” e valor preenchido. Registre o valor em cada oportunidade para manter o painel atualizado.</p>
        </section>

        <section id="captura" className="capture-panel">
          <div className="capture-heading"><div><span className="eyebrow">PROSPECÇÃO AUTOMÁTICA</span><h2>Encontrar novos clientes</h2><p>Busque empresas locais que ainda não possuem site.</p></div><span className="capture-icon">⌕</span></div>
          <form onSubmit={startSearch} className="prospect-form">
            <label>Segmento<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: clínicas odontológicas" minLength={2} required /></label>
            <label>Cidade<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Frutal, MG" minLength={2} required /></label>
            <label className="limit-field">Meta de leads<select value={limit} onChange={(e) => setLimit(e.target.value)}>{[20,50,100,200].map((n) => <option key={n} value={n}>{n} leads</option>)}</select></label>
            <div className="prospect-actions"><button className="prospect-submit" disabled={loading}>{loading ? 'Pesquisando…' : '⌕ Buscar sem site'}</button>{loading && <button type="button" className="prospect-cancel" disabled={job?.status === 'cancelling'} onClick={cancelSearch}>{job?.status === 'cancelling' ? 'Parando…' : '■ Parar busca'}</button>}</div>
          </form>
          {job && <div className="job-status">
            <strong>{job.status === 'completed' ? 'Pesquisa concluída' : job.status === 'failed' ? 'Pesquisa não concluída' : job.status === 'cancelled' ? 'Pesquisa interrompida' : job.status === 'cancelling' ? 'Interrompendo pesquisa…' : 'Pesquisa em andamento'}</strong>
            {jobProgress ? <>
              <span>{jobProgress.detail}</span>
              {jobProgress.total_batches > 0 && <span>Lote {jobProgress.batch || 0} de {jobProgress.total_batches} · análise em grupos de até 20 empresas</span>}
              <div className="job-progress-stats">
                <span><b>{jobProgress.scanned || 0}</b> analisadas de <b>{jobProgress.candidates || 0}</b> encontradas</span>
                <span><b>{jobProgress.saved || 0}</b> leads salvos</span>
                <span><b>{jobProgress.with_website || 0}</b> descartadas por já terem site</span>
                <span><b>{jobProgress.duplicates || 0}</b> duplicadas</span>
                <span><b>{jobProgress.errors || 0}</b> com erro</span>
              </div>
            </> : <span>{job.message || job.error || 'Coletando empresas e verificando sites…'}</span>}
            {job.found_count !== undefined && !jobProgress && <span>{job.found_count} novos leads salvos</span>}
          </div>}
          <p className="prospect-hint">A captura utiliza informações públicas do Google Maps. Empresas com site identificado são descartadas.</p>
        </section>

        <section id="leads" className="leads-section">
          <div className="leads-heading"><div><span className="eyebrow">SEU FUNIL COMERCIAL</span><h2>Leads sem site</h2><p>Empresas que podem precisar de um site profissional.</p></div><span className="lead-total">{visible.length} exibidos</span></div>
          <div className="lead-toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕  Buscar por empresa, telefone ou cidade..." /><div className="lead-filters">
            {[['all','Todos'],['pending','Novos'],['contacted','Contatados'],['interested','Interessados'],['proposal','Propostas'],['won','Fechados'],['lost','Perdidos']].map(([value,label]) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
          </div></div>
          <div className="lead-list">
            {visible.length === 0 ? <div className="empty-crm">{noSite.length ? 'Nenhum lead corresponde a esse filtro.' : 'Ainda não há leads sem site. Faça uma pesquisa acima para encontrar oportunidades.'}</div> :
              visible.map((lead) => {
                const wa = whatsapp(lead.phone);
                return <article className="prospect-lead" key={lead.id}>
                  <div className="lead-main"><div className="lead-name-row"><h3>{lead.name}</h3><span className={'stage-badge stage-' + lead.status}>{stages.find(([value]) => value === lead.status)?.[1] || 'Novo'}</span></div><p>{[lead.category, lead.city || lead.address].filter(Boolean).join(' · ') || 'Categoria não informada'}</p><div className="lead-links">{lead.phone && <span>☎ {lead.phone}</span>}{lead.email && <span>✉ {lead.email}</span>}{lead.google_maps_url && <a href={lead.google_maps_url} target="_blank" rel="noreferrer">Ver no Maps ↗</a>}</div><div className="lead-actions">{wa ? <a className="whatsapp-action" href={wa} target="_blank" rel="noreferrer">◉ Abrir WhatsApp</a> : <span className="no-phone">Telefone não encontrado</span>}<button type="button" className="delete-lead-action" disabled={!!saving[lead.id]} onClick={() => deleteLead(lead)}>{saving[lead.id] ? 'Aguarde…' : 'Excluir lead'}</button></div></div>
                  <div className="lead-controls"><label>Etapa comercial<select value={lead.status || 'new'} onChange={(e) => updateLead(lead.id, { status: e.target.value })}>{stages.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Valor do negócio (R$)<input key={lead.id + '-value-' + (lead.deal_value || 0)} type="number" min="0" step="0.01" defaultValue={lead.deal_value || ''} placeholder="Ex.: 2500" onBlur={(e) => { const value = e.target.value === '' ? 0 : Number(e.target.value); if (value !== Number(lead.deal_value || 0)) updateLead(lead.id, { deal_value: value }); }} /></label><label>Observações<textarea key={lead.id + '-notes-' + (lead.notes || '')} defaultValue={lead.notes || ''} placeholder="Histórico, retorno combinado, detalhes..." onBlur={(e) => { if (e.target.value !== (lead.notes || '')) updateLead(lead.id, { notes: e.target.value }); }} /></label><small className="save-state">{saving[lead.id] ? 'Salvando…' : 'Alterações salvas ao sair do campo'}</small></div>
                </article>;
              })
            }
          </div>
        </section>
        <footer className="crm-footer">ESCARLATE CRM <span>•</span> Feito para transformar oportunidades em clientes.</footer>
      </section>
    </main>
  );
}
