'use client';

import { useMemo, useState } from 'react';
import { WHATSAPP_MESSAGE_BUTTONS } from './whatsapp-message-buttons';

const categories = [...new Set(WHATSAPP_MESSAGE_BUTTONS.map((item) => item.category))];

function contactValues(lead) {
  const raw = String(lead?.name || '').trim();
  const cleaned = raw.replace(/^(dra?\.?|nutricionista|clínica|consultório)\s+/i, '').split(/[|–—,]/)[0].trim();
  return {
    nome: cleaned || raw,
    primeiro_nome: (cleaned || raw).split(/\s+/)[0] || '',
    tratamento: '',
    cidade: lead?.city || '',
    categoria: lead?.category || '',
    saudacao: 'Olá',
  };
}

function renderMessage(template, values) {
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (_, key) => values[key] ?? '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export default function InstagramAssistant({ lead, profileUrl }) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState(categories[0] || '');
  const [feedback, setFeedback] = useState('');
  const values = useMemo(() => contactValues(lead), [lead]);
  const messages = WHATSAPP_MESSAGE_BUTTONS.filter((item) => item.category === category);

  async function prepareMessage(item) {
    const text = renderMessage(item.message, values);
    const profileWindow = window.open(profileUrl, '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('Mensagem copiada! O perfil foi aberto em outra aba. Entre no Direct, cole, revise e envie manualmente.');
    } catch {
      setFeedback('O perfil foi aberto. Não consegui copiar automaticamente; copie o texto manualmente.');
    }
    if (!profileWindow) setFeedback((current) => current + ' O navegador bloqueou a nova aba; permita pop-ups.');
  }

  return (
    <>
      <button type="button" className="instagram-assistant-action" onClick={() => { setIsOpen(true); setFeedback(''); }}>
        <span className="instagram-assistant-icon" aria-hidden="true">◎</span>
        <span className="instagram-assistant-copy"><strong>Assistente Instagram</strong><small>Preparar mensagem para Direct</small></span>
      </button>
      {isOpen && (
        <div className="instagram-assistant-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
          <section className="instagram-assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="instagram-assistant-title">
            <button type="button" className="instagram-assistant-close" onClick={() => setIsOpen(false)}>Fechar</button>
            <span className="eyebrow">ASSISTENTE DE ABORDAGEM</span>
            <h2 id="instagram-assistant-title">Instagram Direct</h2>
            <p>Lead: <strong>{lead.name}</strong></p>
            <p className="instagram-assistant-note">Escolha uma mensagem. O Escarlate abrirá o perfil e copiará o texto. Depois, você inicia o Direct, cola, revisa e envia manualmente. O perfil pode limitar mensagens de pessoas que ainda não seguem a conta.</p>
            <label className="wa-sequence-toolbar">Categoria de mensagens
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className="instagram-message-list">
              {messages.map((item) => (
                <article className="instagram-message-item" key={item.id}>
                  <div><strong>{item.id} · {item.title}</strong><p>{item.description}</p></div>
                  <button type="button" onClick={() => prepareMessage(item)}>Abrir perfil + copiar</button>
                </article>
              ))}
            </div>
            {feedback && <div className="instagram-assistant-feedback" role="status">{feedback}</div>}
          </section>
        </div>
      )}
    </>
  );
}
