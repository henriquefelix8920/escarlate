'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';\nimport './prospeccao.css';

const stages = [
  ['new', 'Novo'], ['contacted', 'Contatado'], ['interested', 'Interessado'],
  ['proposal', 'Proposta'], ['won', 'Fechado'], ['lost', 'Perdido'],
];

export default function ProspeccaoPage() {
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(10);
  const [leads, setLeads] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const loadLeads = useCallback(async () => {
    try {
      const response = await fetch('/api/leads', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar CRM.');
      setLeads(data.leads || []);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    if (!job?.id || ['completed', 'failed'].includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/jobs/' + encodeURIComponent(job.id), { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha ao consultar pesquisa.');
        setJob(data);
        if (['completed', 'failed'].includes(data.status)) {
          clearInterval(timer);
          setLoading(false);
          if (data.status === 'completed') loadLeads();
        }
      } catch (err) {
        setError(err.message);
        clearInterval(timer);
        setLoading(false);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, loadLeads]);

  async function startSearch(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setJob(null);
    try {
      const response = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, category, limit: Number(limit) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Não foi possível iniciar a captura.');
      setJob({ ...data, status: data.status || 'queued' });
    } catch (err) { setError(err.message); setLoading(false); }
  }

  async function updateLead(id, values) {
    try {
      const response = await fetch('/api/leads/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao atualizar lead.');
      setLeads((old) => old.map((lead) => lead.id === id ? data.lead : lead));
    } catch (err) { setError(err.message); }
  }

  const visible = leads.filter((lead) =>
    [lead.name, lead.phone, lead.city, lead.address, lead.category].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <main className="prospect-page">
      <header className="prospect-header">
        <div><Link href="/" className="back-link">← Voltar ao Escarlate</Link><h1>Prospecção automática</h1><p>Pesquise empresas e acompanhe os contatos no CRM.</p></div>
        <div className="prospect-logo">EF</div>
      </header>

      <section className="prospect-search panel">
        <div className="section-kicker">CAPTURA DE LEADS</div>
        <h2>Encontrar empresas no Google Maps</h2>
        <form onSubmit={startSearch} className="prospect-form">
          <label>O que você procura<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: clínicas odontológicas" minLength={2} required /></label>
          <label>Em qual cidade?<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Frutal, MG" minLength={2} required /></label>
          <label className="limit-field">Quantidade<select value={limit} onChange={(e) => setLimit(e.target.value)}>{[5,10,15].map((n) => <option key={n} value={n}>{n} empresas</option>)}</select></label>
          <button className="prospect-submit" disabled={loading}>{loading ? 'Pesquisando…' : '⌕ Iniciar pesquisa'}</button>
        </form>
        <p className="prospect-hint">A captura depende dos resultados públicos do Google Maps e pode falhar se houver CAPTCHA, bloqueio temporário ou limites do serviço.</p>
        {job && <div className="job-status"><strong>{job.status === 'completed' ? 'Pesquisa concluída' : job.status === 'failed' ? 'Pesquisa não concluída' : 'Pesquisa em andamento'}</strong><span>{job.message || job.error || 'Coletando resultados…'}</span>{job.found_count !== undefined && <span>{job.found_count} novos leads salvos</span>}</div>}
      </section>

      {error && <div className="prospect-error">{error}</div>}

      <section className="prospect-crm">
        <div className="crm-heading"><div><div className="section-kicker">BASE PERMANENTE</div><h2>Seus leads</h2><p>{leads.length} registros salvos no banco de dados</p></div><button className="refresh-button" onClick={loadLeads}>↻ Atualizar</button></div>
        <div className="crm-tools"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar empresa, telefone ou cidade…" /><a href="/api/leads" target="_blank" rel="noreferrer">Ver API</a></div>
        <div className="lead-list">
          {visible.length === 0 ? <div className="empty-crm">{leads.length ? 'Nenhum lead corresponde à busca.' : 'Seus leads capturados aparecerão aqui. Faça uma pesquisa para começar.'}</div> :
            visible.map((lead) => <article className="prospect-lead" key={lead.id}>
              <div className="lead-main"><h3>{lead.name}</h3><p>{[lead.category, lead.city || lead.address].filter(Boolean).join(' · ')}</p><div className="lead-links">{lead.phone && <a href={'https://wa.me/' + String(lead.phone).replace(/\\D/g, '')} target="_blank" rel="noreferrer">{lead.phone}</a>}{lead.website && <a href={lead.website} target="_blank" rel="noreferrer">Site ↗</a>}{lead.google_maps_url && <a href={lead.google_maps_url} target="_blank" rel="noreferrer">Google Maps ↗</a>}</div></div>
              <div className="lead-controls"><select value={lead.status} onChange={(e) => updateLead(lead.id, { status: e.target.value })}>{stages.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><textarea defaultValue={lead.notes || ''} placeholder="Observações…" onBlur={(e) => { if (e.target.value !== (lead.notes || '')) updateLead(lead.id, { notes: e.target.value }); }} /></div>
            </article>)
          }
        </div>
      </section>
    </main>
  );
}
