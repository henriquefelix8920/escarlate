'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import './radar-instagram.css';

const stages = [['new','Novo perfil'],['reviewed','Analisado'],['message_prepared','Mensagem pronta'],['contacted','Contato feito'],['replied','Respondeu'],['qualified','Qualificado'],['handed_off','Assumir conversa'],['not_interested','Sem interesse']];
async function readJson(response) { const raw = await response.text(); try { return JSON.parse(raw); } catch { throw new Error('Resposta inválida do servidor.'); } }
function makeOpeningMessage(p) {
  const firstName = (p.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  const bio = String(p.bio || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 95);
  const context = bio ? 'Vi que você compartilha conteúdos sobre ' + bio + ' e achei interessante conhecer melhor seu trabalho.' : 'Estava conhecendo seu perfil profissional e achei interessante conhecer melhor seu trabalho.';
  return 'Oi, ' + firstName + '! Tudo bem? 😊\n\n' + context + '\n\nFiquei com uma curiosidade: hoje você utiliza algum site ou página própria para apresentar seus atendimentos e facilitar o contato de novos pacientes?\n\nPergunto porque trabalho com criação de sites para profissionais e pensei em algumas possibilidades para valorizar sua presença online. Sem compromisso!';
}

export default function RadarInstagramPage() {
  const [prospects,setProspects]=useState([]), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false);
  const [error,setError]=useState(''), [feedback,setFeedback]=useState(''), [search,setSearch]=useState(''), [stageFilter,setStageFilter]=useState('all');
  const [activeId,setActiveId]=useState(null), [message,setMessage]=useState('');
  const [searchCity,setSearchCity]=useState('');
  const [searchLimit,setSearchLimit]=useState('20');
  const [searching,setSearching]=useState(false), [job,setJob]=useState(null);
  const [searchError,setSearchError]=useState('');
  const [form,setForm]=useState({name:'',instagram_url:'',city:'',bio:'',website:'',maps_website:'',opportunity_reason:'',notes:''});
  const load=useCallback(async()=>{setLoading(true);try{const r=await fetch('/api/instagram-prospects',{cache:'no-store'});const d=await readJson(r);if(!r.ok)throw new Error(d.error||'Falha ao carregar oportunidades.');setProspects(d.prospects||[]);setError('');}catch(e){setError(e.message);}finally{setLoading(false);}},[]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    if(!job?.id || ['completed','failed','cancelled'].includes(job.status)) return;
    const timer=setInterval(async()=>{
      try {
        const r=await fetch('/api/jobs/'+encodeURIComponent(job.id),{cache:'no-store'});
        const d=await readJson(r);
        if(!r.ok) throw new Error(d.error||'Falha ao consultar o progresso.');
        setJob(d);
        if(['completed','failed','cancelled'].includes(d.status)) {
          setSearching(false);
          if(d.status==='completed') { await load(); setFeedback('Busca concluída! Os perfis encontrados foram adicionados ao Radar. Confira a bio e os links antes de abordar.'); }
          else if(d.status==='failed') setSearchError(d.error||'A busca automática falhou.');
        }
      } catch(e) { setSearchError(e.message); }
    },2500);
    return ()=>clearInterval(timer);
  },[job?.id,job?.status,load]);
  async function startAutomaticSearch(e){
    e.preventDefault(); setSearching(true); setSearchError(''); setFeedback(''); setJob(null);
    try {
      const r=await fetch('/api/instagram-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:searchCity.trim(),category:'nutricionista',limit:Number(searchLimit)})});
      const d=await readJson(r);
      if(!r.ok) throw new Error(d.detail||d.error||'Não foi possível iniciar a busca.');
      setJob({id:d.id,status:d.status,message:'Busca na fila…'});
    } catch(e) { setSearching(false); setSearchError(e.message); }
  }
  const counts=useMemo(()=>({total:prospects.length,waiting:prospects.filter(p=>['new','reviewed','message_prepared'].includes(p.status)).length,replies:prospects.filter(p=>['replied','qualified','handed_off'].includes(p.status)).length}),[prospects]);
  const visible=useMemo(()=>{const t=search.trim().toLocaleLowerCase('pt-BR');return prospects.filter(p=>(stageFilter==='all'||p.status===stageFilter)&&[p.name,p.username,p.city,p.bio,p.opportunity_reason].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(t));},[prospects,search,stageFilter]);
  async function addProspect(e){e.preventDefault();setSaving(true);setError('');setFeedback('');try{const r=await fetch('/api/instagram-prospects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const d=await readJson(r);if(!r.ok)throw new Error(d.error||'Não foi possível cadastrar o perfil.');setProspects(old=>[d.prospect,...old]);setForm({name:'',instagram_url:'',city:'',bio:'',website:'',maps_website:'',opportunity_reason:'',notes:''});setActiveId(d.prospect.id);setMessage(makeOpeningMessage(d.prospect));setFeedback('Perfil adicionado. Revise os dados e personalize a mensagem antes de qualquer envio.');}catch(e){setError(e.message);}finally{setSaving(false);}}
  async function updateProspect(id,patch){const r=await fetch('/api/instagram-prospects/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});const d=await readJson(r);if(!r.ok)throw new Error(d.error||'Falha ao salvar alteração.');setProspects(old=>old.map(p=>p.id===id?d.prospect:p));return d.prospect;}
  async function prepareMessage(p){const draft=p.initial_message||makeOpeningMessage(p);setActiveId(p.id);setMessage(draft);setFeedback('Mensagem preparada. Confira as informações e personalize o texto para essa profissional.');try{await updateProspect(p.id,{status:'message_prepared',initial_message:draft});}catch(e){setError(e.message);}}
  async function copyMessage(){try{await navigator.clipboard.writeText(message);setFeedback('Mensagem copiada. Abra o Direct, revise e envie manualmente se o contato for apropriado.');}catch{setFeedback('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');}}
  async function markContacted(p){try{await updateProspect(p.id,{status:'contacted',initial_message:message});setFeedback('Contato marcado como realizado por você.');}catch(e){setError(e.message);}}
  async function deleteProspect(p){if(!window.confirm('Excluir '+p.name+' do Radar Instagram?'))return;try{const r=await fetch('/api/instagram-prospects/'+encodeURIComponent(p.id),{method:'DELETE'});const d=await readJson(r);if(!r.ok)throw new Error(d.error||'Falha ao excluir perfil.');setProspects(old=>old.filter(x=>x.id!==p.id));if(activeId===p.id){setActiveId(null);setMessage('');}}catch(e){setError(e.message);}}
  const active=prospects.find(p=>p.id===activeId);
  return <main className="radar-shell">
    <aside className="radar-sidebar">
      <Link href="/" className="radar-brand"><span className="radar-brand-mark">E</span><span>ESCARLATE<small>CRM COMERCIAL</small></span></Link>
      <div className="radar-nav-caption">ESPAÇO DE TRABALHO</div>
      <Link className="radar-nav-item" href="/">▦ <span>Visão geral</span></Link>
      <Link className="radar-nav-item" href="/#captura">⌕ <span>Prospecção antiga</span></Link>
      <Link className="radar-nav-item active" href="/radar-instagram">◎ <span>Radar Instagram</span></Link>
      <div className="radar-sidebar-bottom"><i/> Novo módulo · independente</div>
    </aside>
    <section className="radar-main">
      <header className="radar-header">
        <div><span className="radar-eyebrow">NOVA FRENTE DE PROSPECÇÃO</span><h1>Radar Instagram</h1><p>Encontre nutricionistas com potencial para um site profissional e prepare abordagens individuais.</p></div>
        <a className="radar-search-instagram" href="https://www.instagram.com/explore/search/keyword/?q=nutricionista" target="_blank" rel="noreferrer">◎ Abrir busca no Instagram</a>
      </header>
      <div className="radar-stats"><article><span>Perfis no Radar</span><strong>{counts.total}</strong></article><article><span>Aguardando abordagem</span><strong>{counts.waiting}</strong></article><article><span>Respostas e oportunidades</span><strong>{counts.replies}</strong></article></div>
      <section className="radar-panel radar-auto-search">
        <div className="radar-section-heading"><div><span className="radar-eyebrow">DESCOBERTA AUTOMÁTICA</span><h2>Encontrar nutricionistas para o Radar</h2><p>O Escarlate pesquisa no Google Maps e importa os estabelecimentos que divulgam o Instagram como site.</p></div></div>
        <form className="radar-auto-form" onSubmit={startAutomaticSearch}>
          <label>Localização<input required minLength={2} maxLength={100} value={searchCity} onChange={e=>setSearchCity(e.target.value)} placeholder="Ex.: Frutal, MG ou São Paulo, SP"/></label>
          <label>Quantidade máxima<select value={searchLimit} onChange={e=>setSearchLimit(e.target.value)}><option value="10">10 perfis</option><option value="20">20 perfis</option><option value="30">30 perfis</option><option value="50">50 perfis</option></select></label>
          <button disabled={searching}>{searching?'Pesquisando…':'Buscar e importar perfis'}</button>
        </form>
        <p className="radar-auto-note">A busca é automática. Os perfis encontrados entram direto na lista abaixo, sem preencher cadastro. Ela prioriza nutricionistas cujo Google Maps aponta para Instagram em vez de um site próprio.</p>
        {searching&&<div className="radar-job-progress"><span className="radar-spinner"/><div><strong>{job?.status==='queued'?'Busca na fila':job?.status==='running'?'Busca em andamento':'Iniciando busca'}</strong><p>{(()=>{try{return JSON.parse(job?.message||'{}').detail||'Preparando a pesquisa…'}catch{return job?.message||'Preparando a pesquisa…'}})()}</p></div></div>}
        {job?.status==='completed'&&<div className="radar-job-result">Busca concluída: {job.found_count||0} perfis novos adicionados ao Radar.</div>}
        {searchError&&<div className="radar-error">{searchError}</div>}
      </section>
      <section className="radar-panel">
        <div className="radar-section-heading"><div><span className="radar-eyebrow">CADASTRO MANUAL OPCIONAL</span><h2>Adicionar perfil manualmente</h2><p>Use somente se quiser cadastrar um perfil que a busca automática não encontrou.</p></div></div>
        <form className="radar-form" onSubmit={addProspect}>
          <label>Nome da profissional<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ex.: Ana Souza"/></label>
          <label>Link do perfil no Instagram<input required type="url" value={form.instagram_url} onChange={e=>setForm({...form,instagram_url:e.target.value})} placeholder="https://www.instagram.com/usuario/"/></label>
          <label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} placeholder="Cidade / UF"/></label>
          <label>Bio / especialidade<textarea value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})} rows={2} placeholder="Resumo público do perfil e especialidade"/></label>
          <label>Link na bio<input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="Site, WhatsApp, Linktree etc."/></label>
          <label>Site cadastrado no Google Maps<input value={form.maps_website} onChange={e=>setForm({...form,maps_website:e.target.value})} placeholder="Site próprio, Instagram ou nenhum"/></label>
          <label className="radar-wide">Por que parece uma oportunidade?<textarea value={form.opportunity_reason} onChange={e=>setForm({...form,opportunity_reason:e.target.value})} rows={2} placeholder="Ex.: perfil ativo, sem site próprio, link da bio direciona ao WhatsApp..."/></label>
          <label className="radar-wide">Observações internas<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows={2} placeholder="Detalhes para personalizar a abordagem"/></label>
          <div className="radar-form-actions"><button disabled={saving}>{saving?'Salvando…':'Adicionar ao Radar'}</button><span>O cadastro não envia mensagens nem interage com o Instagram.</span></div>
        </form>
      </section>
      {error&&<div className="radar-error">{error}</div>}{feedback&&<div className="radar-feedback" role="status">{feedback}</div>}
      <section className="radar-panel">
        <div className="radar-section-heading"><div><span className="radar-eyebrow">PIPELINE DE INSTAGRAM</span><h2>Oportunidades cadastradas</h2></div><span className="radar-count">{visible.length} de {prospects.length}</span></div>
        <div className="radar-toolbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, @usuário ou cidade…"/><select value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option value="all">Todas as etapas</option>{stages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><button type="button" onClick={load}>Atualizar</button></div>
        {loading?<div className="radar-empty">Carregando oportunidades…</div>:visible.length===0?<div className="radar-empty">Nenhum perfil cadastrado ainda. Abra a busca do Instagram e adicione a primeira nutricionista encontrada.</div>:<div className="radar-list">{visible.map(p=><article className="radar-lead" key={p.id}>
          <div className="radar-lead-main"><div className="radar-lead-title"><h3>{p.name}</h3><span>@{p.username}</span><em>{stages.find(([v])=>v===p.status)?.[1]||p.status}</em></div><p>{[p.city,p.opportunity_reason].filter(Boolean).join(' · ')||'Sem observações de oportunidade.'}</p><div className="radar-links"><a href={p.instagram_url} target="_blank" rel="noreferrer">Abrir perfil</a>{p.website&&<a href={/^https?:\/\//i.test(p.website)?p.website:'https://'+p.website} target="_blank" rel="noreferrer">Link da bio</a>}</div></div>
          <div className="radar-lead-actions"><button type="button" onClick={()=>prepareMessage(p)}>Preparar abordagem</button><select aria-label={'Etapa de '+p.name} value={p.status} onChange={e=>updateProspect(p.id,{status:e.target.value}).catch(err=>setError(err.message))}>{stages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><button type="button" className="radar-delete" onClick={()=>deleteProspect(p)}>Excluir</button></div>
        </article>)}</div>}
      </section>
      {active&&<section className="radar-panel radar-composer">
        <div className="radar-section-heading"><div><span className="radar-eyebrow">ABORDAGEM PERSONALIZADA</span><h2>Primeira conversa com {active.name}</h2><p>Mensagem inicial leve, sem tentar fechar a venda no primeiro contato.</p></div><button type="button" className="radar-close" onClick={()=>{setActiveId(null);setMessage('');}}>Fechar</button></div>
        <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={8} placeholder="A mensagem personalizada aparecerá aqui…"/>
        <div className="radar-composer-actions"><button type="button" onClick={copyMessage}>Copiar mensagem</button><a href={active.instagram_url} target="_blank" rel="noreferrer">Abrir Instagram</a><button type="button" className="radar-confirm" onClick={()=>markContacted(active)}>Marcar como enviado por mim</button></div>
        <small>O Escarlate não envia Direct automaticamente. Revise a mensagem e confirme manualmente somente depois de enviar.</small>
      </section>}
    </section>
  </main>;
}