'use client';

import { useMemo, useRef, useState } from 'react';
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

async function copyText(text, textareaRef) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Usa a alternativa compatível com navegadores que bloqueiam a Clipboard API.
  }

  const textarea = textareaRef.current;
  if (!textarea) return false;
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  }
}

export default function InstagramAssistant({ lead, profileUrl }) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState(categories[0] || '');
  const [feedback, setFeedback] = useState('');
  const [preparedMessage, setPreparedMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const textareaRef = useRef(null);
  const values = useMemo(() => contactValues(lead), [lead]);
  const messages = WHATSAPP_MESSAGE_BUTTONS.filter((item) => item.category === category);

  async function prepareMessage(item) {
    const text = renderMessage(item.message, values);
    setPreparedMessage(text);
    setFeedback('Mensagem preparada. Se a cópia automática não funcionar, use o botão Copiar mensagem abaixo.');
    // Inicia a cópia enquanto o clique ainda tem permissão do navegador.
    const copyPromise = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(text).then(() => true).catch(() => false)
      : Promise.resolve(false);
    const profileWindow = window.open(profileUrl, '_blank', 'noopener,noreferrer');
    setCopying(true);
    const copied = await copyPromise;
    setCopying(false);
    if (copied) setFeedback('Mensagem copiada! O perfil foi aberto em outra aba. Entre no Direct, cole, revise e envie manualmente.');
    else setFeedback('O perfil foi aberto. O navegador bloqueou a cópia automática; volte a esta aba e clique em Copiar mensagem.');
    if (!profileWindow) setFeedback((current) => current + ' Se o perfil não abriu, permita pop-ups ou use Abrir perfil.');
  }

  async function copyPreparedMessage() {
    if (!preparedMessage) return;
    setCopying(true);
    const copied = await copyText(preparedMessage, textareaRef);
    setCopying(false);
    setFeedback(copied
      ? 'Mensagem copiada! Volte ao Instagram, abra o Direct e cole a mensagem.'
      : 'Não consegui copiar automaticamente. O texto está selecionado abaixo: use Ctrl+C (ou toque em Copiar no seu dispositivo).');
  }

  return (
    <>
      <button type="button" className="instagram-assistant-action" onClick={() => { setIsOpen(true); setFeedback(''); setPreparedMessage(''); }}>
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
            <p className="instagram-assistant-note">Escolha uma mensagem. O Escarlate tentará copiá-la e abrirá o perfil em outra aba. Se a cópia automática for bloqueada, use o botão Copiar mensagem. Depois, entre no Direct, cole, revise e envie manualmente.</p>
            <label className="wa-sequence-toolbar">Categoria de mensagens
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className="instagram-message-list">
              {messages.map((item) => (
                <article className="instagram-message-item" key={item.id}>
                  <div><strong>{item.id} · {item.title}</strong><p>{item.description}</p></div>
                  <button type="button" onClick={() => prepareMessage(item)}>Abrir perfil + preparar mensagem</button>
                </article>
              ))}
            </div>
            {preparedMessage && (
              <div className="instagram-prepared-message">
                <label htmlFor="instagram-prepared-text">Mensagem pronta para enviar</label>
                <textarea id="instagram-prepared-text" ref={(element) => { textareaRef.current = element; }} value={preparedMessage} readOnly rows={6} onFocus={(event) => event.target.select()} />
                <div className="instagram-prepared-actions">
                  <button type="button" onClick={copyPreparedMessage} disabled={copying}>{copying ? 'Copiando…' : 'Copiar mensagem'}</button>
                  <button type="button" className="instagram-open-profile" onClick={() => window.open(profileUrl, '_blank', 'noopener,noreferrer')}>Abrir perfil</button>
                </div>
              </div>
            )}
            {feedback && <div className="instagram-assistant-feedback" role="status">{feedback}</div>}
          </section>
        </div>
      )}
    </>
  );
}
