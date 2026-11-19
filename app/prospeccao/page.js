'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import './prospeccao.css';
import WhatsAppSequenceAssistant from './WhatsAppSequenceAssistant';
import { getMillisecondsUntilNextSaoPauloMidnight } from '@/lib/sao-paulo-date';

const stages = [
  ['new', 'Novo'], ['contacted', 'Contatado'], ['follow_up', 'Follow-up'], ['interested', 'Interessado'],
  ['proposal', 'Proposta'], ['won', 'Fechado'], ['lost', 'Perdido'],
];
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0));
const digits = (value) => String(value || '').replace(/\D/g, '');
const capitalizeCity = (value) => String(value || '')
  .trim()
  .split(',')
  .map((part, index) => {
    const text = part.trim();
    if (index > 0 && /^[a-z]{2}$/i.test(text)) return text.toUpperCase();
    return text.toLocaleLowerCase('pt-BR').replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));
  })
  .join(', ');

const SOCIAL_PROFILE_LABELS = [
  ['instagram.com', 'Instagram'], ['facebook.com', 'Facebook'], ['fb.com', 'Facebook'],
  ['tiktok.com', 'TikTok'], ['linkedin.com', 'LinkedIn'], ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'], ['x.com', 'X'], ['twitter.com', 'X'],
  ['threads.net', 'Threads'], ['twitch.tv', 'Twitch'], ['discord.com', 'Discord'], ['discord.gg', 'Discord'],
  ['reddit.com', 'Reddit'], ['tumblr.com', 'Tumblr'], ['medium.com', 'Medium'], ['bsky.app', 'Bluesky'],
  ['mastodon.social', 'Mastodon'], ['vimeo.com', 'Vimeo'], ['soundcloud.com', 'SoundCloud'],
  ['t.me', 'Telegram'], ['telegram.org', 'Telegram'], ['pinterest.com', 'Pinterest'], ['snapchat.com', 'Snapchat'],
  ['kwai.com', 'Kwai'], ['whatsapp.com', 'WhatsApp'], ['wa.me', 'WhatsApp'],
  ['linktr.ee', 'Link na bio'], ['beacons.ai', 'Link na bio'], ['bio.site', 'Link na bio'],
  ['solo.to', 'Link na bio'], ['msha.ke', 'Link na bio'], ['campsite.bio', 'Link na bio'],
];

const socialLabelForUrl = (value) => {
  const url = String(value || '').trim();
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url.startsWith('http') ? url : 'https://' + url)
      .hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  return SOCIAL_PROFILE_LABELS.find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1] || null;
};

const isSocialWebsite = (value) => Boolean(socialLabelForUrl(value));
async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) throw new Error(`O servidor retornou uma resposta vazia (HTTP ${response.status}). Tente novamente.`);
  try { return JSON.parse(text); }
  catch { throw new Error(`O servidor retornou uma resposta inválida (HTTP ${response.status}). Tente novamente.`); }
}
const exportMobileNumber = (phone, verificationStatus) => {
  if (verificationStatus === 'not_whatsapp') return null;
  let value = digits(phone);
  if (value.startsWith('55') && value.length === 13) value = value.slice(2);
  // Mantém apenas celulares brasileiros no formato DDD + 9 dígitos.
  if (value.length !== 11 || value[2] !== '9') return null;
  return '55' + value;
};

const whatsapp = (phone, verificationStatus) => {
  const value = exportMobileNumber(phone, verificationStatus);
  return value ? 'https://wa.me/' + value : null;
};

export default function ProspeccaoPage() {
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('médicas');
  const [limit] = useState(20);
  const [leads, setLeads] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationsExpanded, setConversationsExpanded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState({});
  const [contactedToday, setContactedToday] = useState(0);
  const [phoneSearchCity, setPhoneSearchCity] = useState('');
  const [phoneSearchCategory, setPhoneSearchCategory] = useState('médicas');
  const [phoneSearchLoading, setPhoneSearchLoading] = useState(false);
  const [phoneSearchStatus, setPhoneSearchStatus] = useState('');
  const [phoneNumbersText, setPhoneNumbersText] = useState('');
  const [phoneNumberCount, setPhoneNumberCount] = useState(0);
  const [phoneCopyFeedback, setPhoneCopyFeedback] = useState('');
  const phoneSearchSession = useRef(null);
  const lastLoadedFoundCount = useRef(0);
  const lastObservedJobId = useRef("");

  const loadLeads = useCallback(async () => {
    try {
      const response = await fetch('/api/leads', { cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar CRM.');
      const nextLeads = data.leads || [];
      setLeads(nextLeads);
      setError('');
      return nextLeads;
    } catch (err) { setError(err.message); return null; }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadLeads();
    };
    const timer = window.setInterval(refreshWhenVisible, 60000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadLeads]);

  const loadContactedToday = useCallback(async () => {
    const response = await fetch('/api/contacts/today', { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || 'Falha ao consultar contatos de hoje.');
    setContactedToday(Number(data.count || 0));
    return data;
  }, []);

  useEffect(() => {
    let timer = null;
    let disposed = false;

    const scheduleMidnightRefresh = () => {
      timer = window.setTimeout(async () => {
        if (disposed) return;
        try { await loadContactedToday(); }
        catch (err) { setError(err.message); }
        if (!disposed) scheduleMidnightRefresh();
      }, getMillisecondsUntilNextSaoPauloMidnight());
    };

    loadContactedToday().catch((err) => setError(err.message));
    scheduleMidnightRefresh();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadContactedToday().catch((err) => setError(err.message));
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadContactedToday]);

  const lastLoadedTerminalJob = useRef("");

  const refreshJob = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs/active', { cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Falha ao consultar pesquisa.');
      setError('');
      const currentJob = data?.id ? data : null;
      if ((currentJob?.id || "") !== lastObservedJobId.current) {
        lastObservedJobId.current = currentJob?.id || "";
        lastLoadedFoundCount.current = 0;
        lastLoadedTerminalJob.current = "";
      }
      setJob(currentJob);
      const active = currentJob && ['queued', 'running', 'retry_wait', 'cancelling'].includes(currentJob.status);
      setLoading(Boolean(active));
      const currentFoundCount = Number(currentJob?.found_count || 0);
      if (currentFoundCount > lastLoadedFoundCount.current) {
        lastLoadedFoundCount.current = currentFoundCount;
        await loadLeads();
      }
      if (currentJob && ['completed', 'failed', 'cancelled'].includes(currentJob.status) && lastLoadedTerminalJob.current !== currentJob.id) {
        lastLoadedTerminalJob.current = currentJob.id;
        const refreshedLeads = await loadLeads();
        const exportSession = phoneSearchSession.current;
        if (exportSession?.jobId === currentJob.id) {
          const candidates = (refreshedLeads || []).filter((lead) =>
            !exportSession.initialLeadIds.has(lead.id)
            && (!String(lead.website || '').trim() || isSocialWebsite(lead.website))
          );
          const numbers = [...new Set(candidates.map((lead) => exportMobileNumber(lead.phone, lead.whatsapp_number_status)).filter(Boolean))];
          setPhoneNumbersText(numbers.join(', '));
          setPhoneNumberCount(numbers.length);
          setPhoneCopyFeedback('');
          setPhoneSearchStatus(
            currentJob.status === 'completed'
              ? `Busca concluída: ${numbers.length} número(s) encontrado(s) nesta execução.`
              : `Busca ${currentJob.status === 'cancelled' ? 'interrompida' : 'finalizada com falha'}: ${numbers.length} número(s) recuperado(s) dos leads salvos.`,
          );
          phoneSearchSession.current = null;
          setPhoneSearchLoading(false);
        }
      }
    } catch (err) {
      // Uma falha temporária de consulta não interrompe o acompanhamento da pesquisa.
      setError(err.message);
    }
  }, [loadLeads]);

  useEffect(() => {
    refreshJob();
    const timer = setInterval(refreshJob, 3000);
    return () => clearInterval(timer);
  }, [refreshJob]);

  async function startSearch(event) {
    event.preventDefault();
    phoneSearchSession.current = null;
    setPhoneSearchLoading(false);
    setError('');
    setLoading(true);
    setJob(null);
    lastLoadedFoundCount.current = 0;
    try {
      const response = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: capitalizeCity(city), category: category.trim(), limit: Number(limit), channel: 'whatsapp' }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Não foi possível iniciar a captura.');
      setJob({ ...data, status: data.status || 'queued' });
    } catch (err) { setError(err.message); setLoading(false); }
  }


  async function startPhoneSearch(event) {
    event.preventDefault();
    if (loading || phoneSearchLoading) return;
    setError('');
    setLoading(true);
    setPhoneSearchLoading(true);
    setJob(null);
    lastLoadedFoundCount.current = 0;
    lastObservedJobId.current = '';
    phoneSearchSession.current = null;
    setPhoneSearchStatus('Preparando o buscador de números...');
    setPhoneNumbersText('');
    setPhoneNumberCount(0);
    setPhoneCopyFeedback('');

    try {
      const existingResponse = await fetch('/api/leads', { cache: 'no-store' });
      const existingData = await readJson(existingResponse);
      if (!existingResponse.ok) throw new Error(existingData.error || 'Não foi possível preparar a lista atual de leads.');
      const initialLeads = existingData.leads || [];
      setLeads(initialLeads);
      const initialLeadIds = new Set(initialLeads.map((lead) => lead.id));

      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: capitalizeCity(phoneSearchCity),
          category: phoneSearchCategory.trim(),
          limit: Number(limit),
          channel: 'whatsapp',
        }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.detail || data.error || 'Não foi possível iniciar a busca de números.');
      if (!data?.id) throw new Error('A pesquisa foi iniciada, mas o servidor não retornou o identificador da tarefa.');

      phoneSearchSession.current = { jobId: data.id, initialLeadIds };
      setPhoneSearchStatus('Busca em andamento. Os números aparecerão aqui quando a pesquisa terminar.');
      setJob({ ...data, status: data.status || 'queued' });
    } catch (err) {
      setPhoneSearchStatus(`Não foi possível concluir a busca: ${err.message}`);
      setError(err.message);
      setLoading(false);
      setPhoneSearchLoading(false);
    }
  }

  async function copyPhoneNumbers() {
    if (!phoneNumbersText) return;
    try {
      await navigator.clipboard.writeText(phoneNumbersText);
      setPhoneCopyFeedback(`${phoneNumberCount} número(s) copiado(s).`);
    } catch {
      setPhoneCopyFeedback('Não foi possível copiar automaticamente. Selecione o conteúdo do campo e copie manualmente.');
    }
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

  const registerWhatsAppActivity = useCallback(async (leadId, activity) => {
    const response = await fetch('/api/leads/' + encodeURIComponent(leadId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity),
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar o acompanhamento do WhatsApp.');
    setLeads((old) => old.map((lead) => lead.id === leadId ? data.lead : lead));
    return data.lead;
  }, []);

  const registerLeadContact = useCallback(async (leadId, channel = 'whatsapp', nextStatus = null) => {
    if (nextStatus) {
      const stageResponse = await fetch('/api/leads/' + encodeURIComponent(leadId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const stageData = await readJson(stageResponse);
      if (!stageResponse.ok) {
        throw new Error(stageData.error || 'Não foi possível atualizar a etapa comercial do lead.');
      }
      setLeads((old) => old.map((lead) => lead.id === leadId ? stageData.lead : lead));
    }

    const response = await fetch('/api/contacts/today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, channel }),
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || 'Não foi possível registrar o contato.');
    setContactedToday(Number(data.count || 0));
    return data;
  }, []);

  async function updateLead(id, values) {
    setSaving((old) => ({ ...old, [id]: true }));
    try {
      const response = await fetch('/api/leads/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Falha ao atualizar lead.');
      setLeads((old) => old.map((lead) => lead.id === id ? data.lead : lead));
      if (['contacted', 'interested', 'proposal', 'won'].includes(values.status)) {
        try {
          await registerLeadContact(id, 'manual');
        } catch (contactError) {
          setError(`Etapa salva, mas não consegui registrar o contato de hoje: ${contactError.message}`);
        }
      }
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

  const noSite = useMemo(() => leads.filter((lead) => !String(lead.website || '').trim() || isSocialWebsite(lead.website)), [leads]);
  const stats = useMemo(() => ({
    noSite: noSite.length,
    notContacted: noSite.filter((lead) => lead.status === 'new').length,
    contacted: noSite.filter((lead) => ['contacted','follow_up','interested','proposal','won'].includes(lead.status)).length,
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

  const heartbeatAgeSeconds = job?.last_heartbeat_at
    ? Math.max(0, Math.floor((Date.now() - new Date(job.last_heartbeat_at).getTime()) / 1000))
    : null;
  const jobLooksStalled = job?.status === 'running' && heartbeatAgeSeconds !== null && heartbeatAgeSeconds > 90;

  const activeConversations = useMemo(() => leads.filter((lead) => whatsapp(lead.phone, lead.whatsapp_number_status) && lead.whatsapp_tracking_status === 'active' && !['won', 'lost'].includes(lead.status)), [leads]);
  const visibleConversations = useMemo(() => {
    const term = conversationQuery.trim().toLocaleLowerCase('pt-BR');
    if (!term) return activeConversations;
    return activeConversations.filter((lead) => [lead.name, lead.phone, lead.city, lead.address, lead.category, lead.whatsapp_last_message, lead.notes].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term));
  }, [activeConversations, conversationQuery]);

  const whatsappUncontacted = noSite.filter((lead) => lead.status === 'new' && whatsapp(lead.phone, lead.whatsapp_number_status));

  const visible = noSite.filter((lead) => {
    const matchesFilter = filter === 'all'
      || (filter === 'pending' ? lead.status === 'new' : filter === 'whatsapp_uncontacted'
        ? lead.status === 'new' && Boolean(whatsapp(lead.phone, lead.whatsapp_number_status))
        : lead.status === filter);
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
        <a className="nav-item nav-item-conversations" href="#whatsapp-pipeline">◷ <span>Conversas em andamento</span><b>{activeConversations.length}</b></a>
        <a className="nav-item" href="#captura">⌕ <span>Prospecção</span></a>
        <a className="nav-item" href="#extrair-telefones">☎ <span>Extrair telefones</span></a>
        <div className="sidebar-bottom"><span className="status-dot" /> CRM conectado</div>
      </aside>

      <section className="crm-main">
        <header className="crm-topbar"><div><span className="eyebrow">SEU NEGÓCIO, EM UM SÓ LUGAR</span><h1>Visão geral</h1><p>Acompanhe oportunidades, contatos e resultados.</p></div><button className="refresh-button" onClick={loadLeads}>↻ Atualizar dados</button></header>

        {error && <div className="prospect-error">{error}</div>}

        <section id="dashboard" className="finance-section">
          <div className="section-title"><div><span className="eyebrow">RESUMO FINANCEIRO</span><h2>Como estão seus resultados</h2></div><span className="live-label"><i /> Dados do CRM</span></div>
          <div className="finance-grid">
            <article className="finance-card daily-contact-card"><span>Leads contatados hoje</span><strong>{contactedToday}</strong><small>Leads únicos · zera à meia-noite (Brasília)</small><div className="finance-symbol">◷</div></article>
            <article className="finance-card revenue-card"><span>Faturamento fechado</span><strong>{money(stats.revenue)}</strong><small>{stats.won} negócio(s) marcado(s) como fechado(s)</small><div className="finance-symbol">↗</div></article>
            <article className="finance-card"><span>Em negociação</span><strong>{money(stats.pipeline)}</strong><small>Valor informado em interessados e propostas</small><div className="finance-symbol">◎</div></article>
            <article className="finance-card"><span>Propostas enviadas</span><strong>{stats.proposals}</strong><small>Oportunidades aguardando retorno</small><div className="finance-symbol">▤</div></article>
            <article className="finance-card uncontacted-card"><span>Ainda não contatados</span><strong>{stats.notContacted}</strong><small>Na etapa Novo · aguardando primeira abordagem</small><div className="finance-symbol">◌</div></article>
            <article className="finance-card"><span>Leads sem site</span><strong>{stats.noSite}</strong><small>{stats.notContacted} ainda não contatados · {stats.contacted} já trabalhados</small><div className="finance-symbol">◉</div></article>
          </div>
          <p className="finance-note">O faturamento considera apenas leads com etapa “Fechado” e valor preenchido. Registre o valor em cada oportunidade para manter o painel atualizado.</p>
        </section>

        <section id="whatsapp-pipeline" className="whatsapp-pipeline-section">
          <div className="conversation-tab-heading">
            <div className="leads-heading">
              <div><span className="eyebrow">ACOMPANHAMENTO DE CONTATOS</span><h2>Conversas em andamento</h2><p>Leads com uma abordagem preparada no WhatsApp para você retomar depois.</p></div>
              <span className="lead-total">{activeConversations.length} em andamento</span>
            </div>
            <button
              type="button"
              className="conversation-tab-toggle"
              aria-expanded={conversationsExpanded}
              aria-controls="whatsapp-pipeline-content"
              onClick={() => setConversationsExpanded((expanded) => !expanded)}
            >
              <span>{conversationsExpanded ? 'Recolher conversas' : 'Abrir conversas'}</span>
              <span className={'conversation-tab-chevron' + (conversationsExpanded ? ' is-expanded' : '')} aria-hidden="true">⌄</span>
            </button>
          </div>
          {conversationsExpanded && <div id="whatsapp-pipeline-content" className="conversation-tab-content">
          <div className="conversation-toolbar"><label className="conversation-search"><span>⌕</span><input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder="Buscar conversa por nome, telefone ou empresa..." aria-label="Buscar conversas em andamento" /></label><span className="conversation-results">{visibleConversations.length} de {activeConversations.length}</span></div>
          <div className="whatsapp-pipeline-list">
            {activeConversations.length === 0
              ? <div className="empty-crm">Nenhuma conversa iniciada ainda. Ao abrir uma mensagem pelo Assistente WhatsApp, o lead aparecerá aqui.</div>
              : visibleConversations.length === 0
                ? <div className="empty-crm">Nenhuma conversa em andamento corresponde a “{conversationQuery}”.</div>
                : visibleConversations.map((lead) => {
                const sent = Number(lead.whatsapp_messages_sent || 0);
                const total = Math.max(1, Number(lead.whatsapp_total_messages || 4));
                const percent = Math.min(100, Math.round((sent / total) * 100));
                return <article className="whatsapp-pipeline-card" key={lead.id}>
                  <div className="whatsapp-pipeline-card-main">
                    <div className="lead-name-row"><h3>{lead.name}</h3><span className="stage-badge stage-contacted">Em andamento</span></div>
                    <p>{[lead.category, lead.city || lead.address].filter(Boolean).join(' · ') || 'Categoria não informada'}</p>
                    <div className="whatsapp-pipeline-progress-label"><span>{`${sent} de ${total} mensagens abertas no WhatsApp`}</span><strong>{percent}%</strong></div>
                    <div className="whatsapp-pipeline-progress"><span style={{ width: percent + '%' }} /></div>
                    <small>{lead.whatsapp_last_message || 'Primeira abordagem preparada'}{lead.whatsapp_last_message_at ? ' · ' + new Date(lead.whatsapp_last_message_at).toLocaleString('pt-BR') : ''}</small>
                  </div>
                  <div className="whatsapp-pipeline-actions">
                    <WhatsAppSequenceAssistant
                      lead={lead}
                      whatsappUrl={whatsapp(lead.phone, lead.whatsapp_number_status)}
                      onWhatsAppActivity={registerWhatsAppActivity}
                      triggerLabel="Abrir assistente"
                      triggerClassName="whatsapp-pipeline-resume"
                    />
                    <button type="button" className="whatsapp-pipeline-archive" onClick={() => {
                      registerWhatsAppActivity(lead.id, {
                        whatsapp_tracking_status: 'archived',
                        whatsapp_last_message: 'Acompanhamento arquivado',
                        whatsapp_last_message_at: new Date().toISOString(),
                      }).catch((err) => setError(err.message));
                    }}>Arquivar</button>
                  </div>
                </article>;
              })}
          </div></div>}
        </section>

        <section id="captura" className="capture-panel">
          <div className="capture-heading"><div><span className="eyebrow">PROSPECÇÃO AUTOMÁTICA</span><h2>Encontrar novos clientes</h2><p>Encontre profissionais sem site próprio e com celular público para verificar o WhatsApp antes da abordagem.</p></div><span className="capture-icon">⌕</span></div>
          <form onSubmit={startSearch} className="prospect-form">
            <label>Segmento<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: médicas, nutricionistas" minLength={2} required /></label>
            <label>Região / cidade<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Minas Gerais ou Frutal, MG" minLength={2} required /></label>
            <div className="prospect-actions"><button className="prospect-submit" disabled={loading || phoneSearchLoading}>{loading && !phoneSearchLoading ? 'Pesquisando…' : '◎ Buscar leads com WhatsApp'}</button>{loading && !phoneSearchLoading && <button type="button" className="prospect-cancel" disabled={job?.status === 'cancelling'} onClick={cancelSearch}>{job?.status === 'cancelling' ? 'Parando…' : '■ Parar busca'}</button>}</div>
          </form>
          <div className="shared-job-heading"><strong>ACOMPANHAMENTO DA PESQUISA</strong><span>Sincronizado automaticamente entre seus aparelhos</span></div>
          {!job && <div className="job-status job-idle"><strong>Nenhuma pesquisa registrada</strong><span>Quando uma pesquisa for iniciada em qualquer aparelho, o andamento aparecerá aqui.</span></div>}
          {job && <div className={"job-status" + (jobLooksStalled ? " job-stale" : "")}>
            <strong>{jobLooksStalled ? 'Sem atualização recente — possível pausa' : job.status === 'completed' ? 'Pesquisa concluída' : job.status === 'failed' ? 'Pesquisa não concluída' : job.status === 'cancelled' ? 'Pesquisa interrompida' : job.status === 'cancelling' ? 'Interrompendo pesquisa…' : job.status === 'retry_wait' ? 'Preparando retomada automática…' : job.status === 'queued' ? 'Pesquisa aguardando início' : 'Pesquisa em andamento'}</strong>
            {jobProgress ? <>
              <span>{jobProgress.detail}</span>
              {job.last_heartbeat_at && <span>Última atividade: {heartbeatAgeSeconds < 60 ? "há menos de 1 min" : "há " + Math.floor(heartbeatAgeSeconds / 60) + " min"} ({new Date(job.last_heartbeat_at).toLocaleString("pt-BR")})</span>}
              {jobProgress.total_batches > 0 && <span>Lote {jobProgress.batch || 0} de {jobProgress.total_batches} · análise em grupos de até 20 empresas</span>}
              <div className="job-progress-stats">
                <span><b>{jobProgress.scanned || 0}</b> analisadas de <b>{jobProgress.candidates || 0}</b> encontradas</span>
                <span><b>{jobProgress.saved || 0}</b> leads salvos</span>
                <span><b>{jobProgress.with_website || 0}</b> descartadas por já terem site</span>
                <span><b>{jobProgress.with_mobile || 0}</b> com celular móvel (WhatsApp não verificado)</span>
                <span><b>{jobProgress.without_mobile || 0}</b> sem celular móvel válido</span>
                <span><b>{jobProgress.duplicates || 0}</b> duplicadas</span>
                <span><b>{jobProgress.errors || 0}</b> com erro</span>
              </div>
            </> : <span>{job.message || job.error || 'Coletando empresas e verificando sites…'}</span>}
            {job.found_count !== undefined && !jobProgress && <span>{job.found_count} novos leads salvos</span>}
          </div>}
          <p className="prospect-hint">A busca começa pelo Google Maps e descarta negócios com site institucional. Só salva profissionais com celular brasileiro em formato móvel (DDD + 9 dígitos). Isso não confirma que o número tenha WhatsApp: a confirmação é manual, após abrir a conversa e verificar a conta. Os resultados ficam em Leads sem site para você conferir e abordar manualmente.</p>
        </section>

        <section id="extrair-telefones" className="phone-export-panel">
          <div className="capture-heading">
            <div><span className="eyebrow">BUSCADOR DE NÚMEROS</span><h2>Extrair telefones dos novos leads</h2><p>Uma busca independente, usando os mesmos critérios do buscador principal.</p></div>
            <span className="phone-export-icon" aria-hidden="true">☎</span>
          </div>
          <form onSubmit={startPhoneSearch} className="prospect-form phone-export-form">
            <label>Segmento<input value={phoneSearchCategory} onChange={(event) => setPhoneSearchCategory(event.target.value)} placeholder="Ex.: médicas, nutricionistas" minLength={2} required /></label>
            <label>Região / cidade<input value={phoneSearchCity} onChange={(event) => setPhoneSearchCity(event.target.value)} placeholder="Ex.: Minas Gerais ou Frutal, MG" minLength={2} required /></label>
            <div className="prospect-actions">
              <button className="prospect-submit phone-export-submit" disabled={loading || phoneSearchLoading}>{phoneSearchLoading ? 'Buscando números…' : '⌕ Buscar e extrair números'}</button>
              {phoneSearchLoading && <button type="button" className="prospect-cancel" disabled={job?.status === 'cancelling'} onClick={cancelSearch}>{job?.status === 'cancelling' ? 'Parando…' : '■ Parar busca'}</button>}
            </div>
          </form>
          <p className="prospect-hint">A busca usa a mesma captura do Google Maps e os mesmos filtros do buscador principal. O resultado inclui somente leads novos salvos nesta execução, com celular brasileiro em formato móvel. O formato do número não confirma que exista uma conta WhatsApp ativa.</p>
          {phoneSearchStatus && <div className="phone-export-status" role="status">{phoneSearchStatus}</div>}
          <div className="phone-export-result">
            <div className="phone-export-result-heading"><div><strong>Números encontrados</strong><span>{phoneNumberCount} número(s) · formato internacional sem símbolos</span></div><button type="button" className="phone-export-copy" onClick={copyPhoneNumbers} disabled={!phoneNumbersText}>Copiar números</button></div>
            <textarea aria-label="Números encontrados separados por vírgula" readOnly value={phoneNumbersText} placeholder="Os números encontrados nesta busca aparecerão aqui, separados por vírgula." rows={4} />
            {phoneCopyFeedback && <span className="phone-export-feedback" role="status">{phoneCopyFeedback}</span>}
          </div>
        </section>

        <section id="leads" className="leads-section">
          <div className="leads-heading"><div><span className="eyebrow">SEU FUNIL COMERCIAL</span><h2>Leads sem site</h2><p>Empresas que podem precisar de um site profissional.</p></div><span className="lead-total">{visible.length} exibidos</span></div>
          <div className="lead-toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="⌕  Buscar por empresa, telefone ou cidade..." /><div className="lead-filters">
            {[['all','Todos'],['pending','Novos'],['whatsapp_uncontacted',`WhatsApp sem contato (${whatsappUncontacted.length})`],['contacted','Contatados'],['follow_up','Follow-up'],['interested','Interessados'],['proposal','Propostas'],['won','Fechados'],['lost','Perdidos']].map(([value,label]) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
          </div></div>
          <div className="lead-list">
            {visible.length === 0 ? <div className="empty-crm">{noSite.length ? 'Nenhum lead corresponde a esse filtro.' : 'Ainda não há leads sem site. Faça uma pesquisa acima para encontrar oportunidades.'}</div> :
              visible.map((lead) => {
                const wa = whatsapp(lead.phone, lead.whatsapp_number_status);
                return <article id={'lead-' + lead.id} className="prospect-lead" key={lead.id}>
                  <div className="lead-main"><div className="lead-name-row"><h3>{lead.name}</h3><span className={'stage-badge stage-' + lead.status}>{stages.find(([value]) => value === lead.status)?.[1] || 'Novo'}</span><span className={'site-presence-badge ' + (wa ? 'has-social' : 'no-social')}>{lead.whatsapp_number_status === 'not_whatsapp' ? 'Celular · não é WhatsApp' : wa ? (lead.whatsapp_number_status === 'confirmed' ? 'WhatsApp confirmado' : 'Celular · WhatsApp não verificado') : 'Sem site · sem celular válido'}</span></div><p>{[lead.category, lead.city || lead.address].filter(Boolean).join(' · ') || 'Categoria não informada'}</p><div className="lead-links">{lead.phone && <span>☎ {lead.phone}</span>}{lead.email && <span>✉ {lead.email}</span>}{lead.google_maps_url && <a href={lead.google_maps_url} target="_blank" rel="noreferrer">Ver no Maps ↗</a>}</div><div className="lead-actions">{wa && <WhatsAppSequenceAssistant lead={lead} whatsappUrl={wa} onWhatsAppActivity={registerWhatsAppActivity} triggerLabel={lead.whatsapp_number_status === 'confirmed' ? 'Assistente WhatsApp' : 'Abrir WhatsApp para conferir'} />}
                    {wa && lead.whatsapp_number_status !== 'confirmed' && <><button type="button" className="whatsapp-verify-action" disabled={!!saving[lead.id]} onClick={() => updateLead(lead.id, { whatsapp_number_status: 'confirmed' })}>Confirmar WhatsApp</button><button type="button" className="whatsapp-invalid-action" disabled={!!saving[lead.id]} onClick={() => updateLead(lead.id, { whatsapp_number_status: 'not_whatsapp' })}>Não é WhatsApp</button></>}
                    {wa && lead.whatsapp_number_status === 'confirmed' && <button type="button" className="whatsapp-invalid-action" disabled={!!saving[lead.id]} onClick={() => updateLead(lead.id, { whatsapp_number_status: 'not_whatsapp' })}>Marcar como inválido</button>}
                    {!wa && <span className="no-phone">Sem celular brasileiro válido para abrir no WhatsApp.</span>}<button type="button" className="delete-lead-action" disabled={!!saving[lead.id]} onClick={() => deleteLead(lead)}>{saving[lead.id] ? 'Aguarde…' : 'Excluir lead'}</button></div></div>
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
