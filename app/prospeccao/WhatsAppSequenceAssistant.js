'use client';

import { useEffect, useMemo, useState } from 'react';

const SEQUENCES_KEY = 'escarlate:whatsapp-sequences:v1';
const PROGRESS_KEY = 'escarlate:whatsapp-sequence-progress:v1';

const DEFAULT_SEQUENCE = {
  id: 'nutricionistas-primeira-abordagem',
  name: 'Nutricionistas — primeira abordagem',
  messages: [
    'Boa tarde, {tratamento} {nome}!\nEspero que esteja tudo bem com você 🙏',
    'Meu nome é Henrique, sou desenvolvedor web e trabalho com criação de sites profissionais para empresas e profissionais que desejam fortalecer sua presença digital.',
    'Estava pesquisando profissionais da sua região no Google e encontrei seu perfil.\nPercebi que você ainda não possui um site próprio.\nHoje, muitas pessoas pesquisam no Google antes de escolher um profissional.',
    'Ter um site pode ajudar a apresentar seus serviços, transmitir mais confiança e facilitar o contato de novos pacientes.\nEu tenho um site de demonstração para nutricionistas.\nPosso te mostrar?',
  ],
};

function createId() {
  return `roteiro-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function renderMessage(message, values) {
  return String(message || '')
    .replace(/\{([a-z_]+)\}/gi, (_, key) => String(values[key.toLowerCase()] || ''))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function withMessage(url, message) {
  return `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`;
}

export default function WhatsAppSequenceAssistant({ lead, whatsappUrl }) {
  const [sequences, setSequences] = useState([DEFAULT_SEQUENCE]);
  const [progress, setProgress] = useState({});
  const [storageReady, setStorageReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState('flow');
  const [selectedSequenceId, setSelectedSequenceId] = useState(DEFAULT_SEQUENCE.id);
  const [contactName, setContactName] = useState(lead.name || '');
  const [contactTreatment, setContactTreatment] = useState('');
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    try {
      const savedSequences = window.localStorage.getItem(SEQUENCES_KEY);
      if (savedSequences) {
        const parsed = JSON.parse(savedSequences);
        const valid = Array.isArray(parsed)
          ? parsed.filter((item) => item && item.id && item.name && Array.isArray(item.messages) && item.messages.length)
          : [];
        if (valid.length) setSequences(valid);
      }
      const savedProgress = window.localStorage.getItem(PROGRESS_KEY);
      if (savedProgress) {
        const parsedProgress = JSON.parse(savedProgress);
        if (parsedProgress && typeof parsedProgress === 'object' && !Array.isArray(parsedProgress)) {
          setProgress(parsedProgress);
        }
      }
    } catch {
      // A tela continua utilizável mesmo se o armazenamento local estiver indisponível.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(SEQUENCES_KEY, JSON.stringify(sequences));
    } catch {
      setFeedback('Não foi possível salvar os roteiros neste navegador.');
    }
  }, [sequences, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // O avanço permanece na memória até a página ser fechada.
    }
  }, [progress, storageReady]);

  const activeSequence = useMemo(
    () => sequences.find((sequence) => sequence.id === selectedSequenceId) || sequences[0] || DEFAULT_SEQUENCE,
    [sequences, selectedSequenceId],
  );

  const progressKey = `${lead.id}:${activeSequence.id}`;
  const currentStep = Math.min(
    Math.max(0, Number(progress[progressKey] || 0)),
    activeSequence.messages.length,
  );

  const values = {
    nome: contactName,
    primeiro_nome: contactName.trim().split(/\s+/)[0] || '',
    tratamento: contactTreatment,
    cidade: lead.city || lead.address || '',
    categoria: lead.category || '',
  };

  const renderedMessages = activeSequence.messages.map((message) => renderMessage(message, values));
  const currentMessage = renderedMessages[currentStep] || '';

  function startConversation() {
    let latestSequences = sequences;
    let latestProgress = progress;
    try {
      const savedSequences = window.localStorage.getItem(SEQUENCES_KEY);
      if (savedSequences) {
        const parsed = JSON.parse(savedSequences);
        const valid = Array.isArray(parsed)
          ? parsed.filter((item) => item && item.id && item.name && Array.isArray(item.messages) && item.messages.length)
          : [];
        if (valid.length) latestSequences = valid;
      }
      const savedProgress = window.localStorage.getItem(PROGRESS_KEY);
      if (savedProgress) {
        const parsed = JSON.parse(savedProgress);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) latestProgress = parsed;
      }
    } catch {
      // Usa os dados já carregados se o armazenamento local não puder ser lido.
    }

    const sequence = latestSequences.find((item) => item.id === selectedSequenceId) || latestSequences[0] || DEFAULT_SEQUENCE;
    const key = String(lead.id) + ':' + sequence.id;
    const savedStep = Math.min(Math.max(0, Number(latestProgress[key] || 0)), sequence.messages.length);
    const step = savedStep >= sequence.messages.length ? 0 : savedStep;
    if (step !== savedStep) latestProgress = { ...latestProgress, [key]: 0 };

    const defaultTreatment = /nutri/i.test(String(lead.category || '')) ? 'Dra.' : '';
    const defaultText = renderMessage(sequence.messages[step] || sequence.messages[0], {
      nome: lead.name || '',
      primeiro_nome: String(lead.name || '').trim().split(/\s+/)[0] || '',
      tratamento: defaultTreatment,
      cidade: lead.city || lead.address || '',
      categoria: lead.category || '',
    });

    setSequences(latestSequences);
    setProgress(latestProgress);
    setSelectedSequenceId(sequence.id);
    setContactName(lead.name || '');
    setContactTreatment(defaultTreatment);
    setFeedback('');
    setScreen('flow');
    setIsOpen(true);
    if (whatsappUrl && defaultText) {
      window.open(withMessage(whatsappUrl, defaultText), '_blank', 'noopener,noreferrer');
    }
  }

  function openCurrentMessageInWhatsApp() {
    if (!whatsappUrl || !currentMessage) return;
    window.open(withMessage(whatsappUrl, currentMessage), '_blank', 'noopener,noreferrer');
  }

  async function copyCurrentMessage() {
    if (!currentMessage) return;
    try {
      await navigator.clipboard.writeText(currentMessage);
      setFeedback('Mensagem copiada. Cole na conversa e envie pelo WhatsApp.');
    } catch {
      setFeedback('Não foi possível copiar automaticamente. Selecione o texto da mensagem e copie manualmente.');
    }
  }

  function markCurrentAsSent() {
    if (currentStep >= activeSequence.messages.length) return;
    setProgress((old) => ({ ...old, [progressKey]: currentStep + 1 }));
    setFeedback(currentStep + 1 === activeSequence.messages.length
      ? 'Sequência concluída. Você confirmou o envio de todas as mensagens.'
      : 'Etapa marcada. A próxima mensagem está pronta.');
  }

  function resetProgress() {
    if (!window.confirm('Reiniciar esta sequência para este lead? O progresso atual será zerado.')) return;
    setProgress((old) => ({ ...old, [progressKey]: 0 }));
    setFeedback('Sequência reiniciada para este lead.');
  }

  function beginNewSequence() {
    setDraft({ id: createId(), name: 'Novo roteiro', messages: [''] });
    setScreen('editor');
  }

  function editSequence(sequence) {
    setDraft({ ...sequence, messages: [...sequence.messages] });
    setScreen('editor');
  }

  function saveDraft() {
    const name = String(draft?.name || '').trim();
    const messages = (draft?.messages || []).map((message) => String(message || '').trim()).filter(Boolean);
    if (!name || !messages.length) {
      setFeedback('Informe um nome para o roteiro e pelo menos uma mensagem.');
      return;
    }
    const saved = { ...draft, name, messages };
    setSequences((old) => {
      const exists = old.some((sequence) => sequence.id === saved.id);
      return exists
        ? old.map((sequence) => sequence.id === saved.id ? saved : sequence)
        : [...old, saved];
    });
    setSelectedSequenceId(saved.id);
    setDraft(null);
    setFeedback('Roteiro salvo neste navegador.');
    setScreen('flow');
  }

  function deleteSequence(sequence) {
    if (sequences.length <= 1) {
      setFeedback('Mantenha pelo menos um roteiro cadastrado.');
      return;
    }
    if (!window.confirm(`Excluir o roteiro "${sequence.name}"? Essa ação não pode ser desfeita.`)) return;
    setSequences((old) => old.filter((item) => item.id !== sequence.id));
    if (selectedSequenceId === sequence.id) {
      const next = sequences.find((item) => item.id !== sequence.id);
      if (next) setSelectedSequenceId(next.id);
    }
  }

  return (
    <>
      <button type="button" className="whatsapp-action" onClick={startConversation}>
        ◉ Abrir WhatsApp
      </button>

      {isOpen && (
        <div className="wa-sequence-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsOpen(false);
        }}>
          <section className="wa-sequence-dialog" role="dialog" aria-modal="true" aria-labelledby="wa-sequence-title">
            <header className="wa-sequence-header">
              <div>
                <span className="eyebrow">ASSISTENTE DE ABORDAGEM</span>
                <h2 id="wa-sequence-title">Sequência de WhatsApp</h2>
                <p>Contato: <strong>{lead.name}</strong></p>
              </div>
              <button type="button" className="wa-sequence-close" onClick={() => setIsOpen(false)} aria-label="Fechar">×</button>
            </header>

            {screen === 'flow' && (
              <>
                <div className="wa-sequence-toolbar">
                  <label>Roteiro
                    <select value={activeSequence.id} onChange={(event) => { setSelectedSequenceId(event.target.value); setFeedback(''); }}>
                      {sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="wa-sequence-secondary" onClick={() => setScreen('library')}>Gerenciar roteiros</button>
                </div>

                <div className="wa-sequence-contact">
                  <label>Nome para a mensagem
                    <input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome do contato" />
                  </label>
                  <label>Tratamento (opcional)
                    <input value={contactTreatment} onChange={(event) => setContactTreatment(event.target.value)} placeholder="Ex.: Dra., Dr., Sr." />
                  </label>
                  <p>Campos disponíveis nos textos: <code>{'{nome}'}</code>, <code>{'{primeiro_nome}'}</code>, <code>{'{tratamento}'}</code>, <code>{'{cidade}'}</code> e <code>{'{categoria}'}</code>.</p>
                </div>

                <div className="wa-sequence-progress">
                  <div className="wa-sequence-progress-label">
                    <strong>{currentStep >= activeSequence.messages.length ? 'Sequência concluída' : `Mensagem ${currentStep + 1} de ${activeSequence.messages.length}`}</strong>
                    <span>{currentStep} de {activeSequence.messages.length} confirmadas</span>
                  </div>
                  <div className="wa-sequence-progress-track"><span style={{ width: `${(currentStep / activeSequence.messages.length) * 100}%` }} /></div>
                </div>

                <div className="wa-sequence-messages">
                  {renderedMessages.map((message, index) => {
                    const isSent = index < currentStep;
                    const isCurrent = index === currentStep && currentStep < activeSequence.messages.length;
                    return (
                      <article className={`wa-sequence-message ${isSent ? 'is-sent' : isCurrent ? 'is-current' : 'is-pending'}`} key={`${activeSequence.id}-${index}`}>
                        <div className="wa-sequence-message-heading">
                          <strong>Mensagem {index + 1}</strong>
                          <span>{isSent ? '✓ Marcada como enviada' : isCurrent ? 'Próxima mensagem' : 'Aguardando'}</span>
                        </div>
                        <p>{message || 'Preencha o texto deste roteiro no gerenciador.'}</p>
                        {isCurrent && (
                          <div className="wa-sequence-message-actions">
                            <button type="button" className="wa-sequence-secondary" onClick={copyCurrentMessage}>Copiar mensagem</button>
                            <button type="button" className="wa-sequence-primary" onClick={markCurrentAsSent}>Já enviei — próxima</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <footer className="wa-sequence-footer">
                  {currentStep < activeSequence.messages.length
                    ? <button type="button" className="wa-sequence-open" onClick={openCurrentMessageInWhatsApp}>Abrir WhatsApp com a mensagem atual</button>
                    : <button type="button" className="wa-sequence-secondary" onClick={resetProgress}>Reiniciar sequência para este lead</button>}
                  <p>O Escarlate não envia mensagens. Copie, confira a conversa e toque em Enviar no WhatsApp. Avance somente depois do envio.</p>
                </footer>
              </>
            )}

            {screen === 'library' && (
              <div className="wa-sequence-library">
                <div className="wa-sequence-library-heading">
                  <div><h3>Seus roteiros</h3><p>Crie e reutilize sequências para diferentes segmentos.</p></div>
                  <button type="button" className="wa-sequence-primary" onClick={beginNewSequence}>+ Novo roteiro</button>
                </div>
                {sequences.map((sequence) => (
                  <article className="wa-sequence-library-item" key={sequence.id}>
                    <div><strong>{sequence.name}</strong><span>{sequence.messages.length} mensagem(ns)</span></div>
                    <div className="wa-sequence-library-actions">
                      <button type="button" className="wa-sequence-secondary" onClick={() => { setSelectedSequenceId(sequence.id); setScreen('flow'); }}>Usar</button>
                      <button type="button" className="wa-sequence-secondary" onClick={() => editSequence(sequence)}>Editar</button>
                      <button type="button" className="wa-sequence-danger" onClick={() => deleteSequence(sequence)}>Excluir</button>
                    </div>
                  </article>
                ))}
                <button type="button" className="wa-sequence-back" onClick={() => setScreen('flow')}>Voltar para a sequência</button>
              </div>
            )}

            {screen === 'editor' && draft && (
              <div className="wa-sequence-editor">
                <label>Nome do roteiro
                  <input value={draft.name} onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} placeholder="Ex.: Dentistas — primeira abordagem" />
                </label>
                <div className="wa-sequence-editor-messages">
                  {draft.messages.map((message, index) => (
                    <label key={index}>Mensagem {index + 1}
                      <textarea rows={4} value={message} onChange={(event) => setDraft((old) => ({
                        ...old,
                        messages: old.messages.map((item, itemIndex) => itemIndex === index ? event.target.value : item),
                      }))} placeholder="Digite o texto que será preparado para envio manual..." />
                      {draft.messages.length > 1 && <button type="button" className="wa-sequence-danger wa-sequence-remove" onClick={() => setDraft((old) => ({ ...old, messages: old.messages.filter((_, itemIndex) => itemIndex !== index) }))}>Remover mensagem</button>}
                    </label>
                  ))}
                </div>
                <p>Você pode usar <code>{'{nome}'}</code>, <code>{'{primeiro_nome}'}</code>, <code>{'{tratamento}'}</code>, <code>{'{cidade}'}</code> e <code>{'{categoria}'}</code> para personalizar cada contato.</p>
                <div className="wa-sequence-editor-actions">
                  <button type="button" className="wa-sequence-secondary" onClick={() => { setDraft(null); setScreen('library'); }}>Cancelar</button>
                  <button type="button" className="wa-sequence-secondary" onClick={() => setDraft((old) => ({ ...old, messages: [...old.messages, ''] }))}>+ Adicionar mensagem</button>
                  <button type="button" className="wa-sequence-primary" onClick={saveDraft}>Salvar roteiro</button>
                </div>
              </div>
            )}

            {feedback && <div className="wa-sequence-feedback" role="status">{feedback}</div>}
            <div className="wa-sequence-storage-note">Roteiros e progresso ficam salvos neste navegador. O envio é sempre manual e individual.</div>
          </section>
        </div>
      )}
    </>
  );
}
