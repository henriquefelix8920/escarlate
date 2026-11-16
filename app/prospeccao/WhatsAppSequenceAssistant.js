'use client';

import { useEffect, useMemo, useState } from 'react';

const SEQUENCES_KEY = 'escarlate:whatsapp-sequences:v1';
const PROGRESS_KEY = 'escarlate:whatsapp-sequence-progress:v1';

const DEFAULT_SEQUENCE = {
  id: 'nutricionistas-primeira-abordagem',
  name: 'Nutricionistas — primeira abordagem',
  messages: [
    '{saudacao}, {tratamento} {nome}!\nEspero que esteja tudo bem com você 🙏',
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


function getGreeting() {
  const hourPart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).find((part) => part.type === 'hour');
  const hour = Number(hourPart?.value ?? 12);
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim();
}

const FEMALE_FIRST_NAMES = new Set(
  'adriana aline alessandra amanda ana andressa andrea beatriz bia bianca bruna camila carla carolina celia cecilia clara cintia cristina daniela debora eduarda elaine eliana ester esther fabiana fernanda flavia helena heloisa isabel isabela isabella iris jessica joice julia juliana lais laura larissa leticia livia luana luiza luzia maira manuela marcela marcia maria mariana marisa michele monica monique natalia nathalia nicole noemi pamela paula patricia priscila rebeca rebecca rafaela raquel renata rosa sabrina sandra sara sarah silvia simone sonia sofia sophia sueli tais tania teresa valeria valentina vanessa vera viviane yasmin yasmim'.split(' ')
);
const MALE_FIRST_NAMES = new Set(
  'abel adriano afonso alan alberto alessandro allan alvaro alexandre almir anderson andre antonio arthur augusto bernardo breno bruno caio carlos cassio caua cesar cicero claudio cleber daniel danilo davi denis diego diogo eduardo elias emanuel emerson enzo erick estevao fabio fabricio felipe fernando francisco gabriel geraldo gilberto gustavo heitor henrique hugo igor italo ivan joao joaquim jorge jose julio kevin leandro leonardo lucas luan luciano luiz marcelo marco marcos mario mateus matheus mauro mauricio miguel moises murilo natan nathan nelson nicolas otavio pablo paulo patrick pedro rafael raul renato ricardo roberto rodrigo romulo ronaldo samuel sandro saulo sergio sidney thiago tiago tomas valdir vinicius vitor victor wagner wesley william yuri'.split(' ')
);
const AMBIGUOUS_FIRST_NAMES = new Set('alex andrea ariel cris dani duda elia luca noa nicola sasha'.split(' '));

function inferTreatment(value) {
  const original = String(value || '').trim();
  const title = original.match(/^(dra?\.?|doutora?|sra?\.?)\s+/i);
  if (title) {
    return /^(dra|doutora|sra)/i.test(title[1]) ? 'Dra.' : 'Dr.';
  }

  const firstName = normalizeName(original).split(/\s+/)[0] || '';
  if (FEMALE_FIRST_NAMES.has(firstName)) return 'Dra.';
  if (MALE_FIRST_NAMES.has(firstName)) return 'Dr.';
  if (AMBIGUOUS_FIRST_NAMES.has(firstName)) return '';
  return '';
}

function stripHonorific(value) {
  return String(value || '').replace(/^\s*(?:dra?\.?|doutora?|sra?\.?)\s+/i, '').trim();
}

function migrateDefaultSequence(sequence) {
  if (sequence.id !== DEFAULT_SEQUENCE.id || !sequence.messages?.length) return sequence;
  const messages = [...sequence.messages];
  messages[0] = String(messages[0] || '').replace(/^Boa tarde(?=,?\s)/i, '{saudacao}');
  return { ...sequence, messages };
}

export default function WhatsAppSequenceAssistant({ lead, whatsappUrl }) {
  const [sequences, setSequences] = useState([DEFAULT_SEQUENCE]);
  const [progress, setProgress] = useState({});
  const [storageReady, setStorageReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState('flow');
  const [selectedSequenceId, setSelectedSequenceId] = useState(DEFAULT_SEQUENCE.id);
  const [contactName, setContactName] = useState(stripHonorific(lead.name || ''));
  const [contactTreatment, setContactTreatment] = useState(inferTreatment(lead.name || ''));
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    try {
      const savedSequences = window.localStorage.getItem(SEQUENCES_KEY);
      if (savedSequences) {
        const parsed = JSON.parse(savedSequences);
        const valid = Array.isArray(parsed)
          ? parsed.filter((item) => item && item.id && item.name && Array.isArray(item.messages) && item.messages.length).map(migrateDefaultSequence)
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
    saudacao: getGreeting(),
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
          ? parsed.filter((item) => item && item.id && item.name && Array.isArray(item.messages) && item.messages.length).map(migrateDefaultSequence)
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

    const defaultName = stripHonorific(lead.name || '');
    const defaultTreatment = inferTreatment(lead.name || '');
    const defaultText = renderMessage(sequence.messages[step] || sequence.messages[0], {
      nome: defaultName,
      primeiro_nome: defaultName.split(/\s+/)[0] || '',
      tratamento: defaultTreatment,
      saudacao: getGreeting(),
      cidade: lead.city || lead.address || '',
      categoria: lead.category || '',
    });

    setSequences(latestSequences);
    setProgress(latestProgress);
    setSelectedSequenceId(sequence.id);
    setContactName(defaultName);
    setContactTreatment(defaultTreatment);
    setFeedback('');
    setScreen('flow');
    setIsOpen(true);
    if (whatsappUrl && defaultText) {
      window.open(withMessage(whatsappUrl, defaultText), '_blank', 'noopener,noreferrer');
    }
  }

  function openCurrentMessageInWhatsApp() {
    const message = renderMessage(activeSequence.messages[currentStep], { ...values, saudacao: getGreeting() });
    if (!whatsappUrl || !message) return;
    window.open(withMessage(whatsappUrl, message), '_blank', 'noopener,noreferrer');
  }

  async function copyCurrentMessage() {
    const message = renderMessage(activeSequence.messages[currentStep], { ...values, saudacao: getGreeting() });
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setFeedback('Mensagem copiada. Cole na conversa e envie pelo WhatsApp.');
    } catch {
      setFeedback('Não foi possível copiar automaticamente. Selecione o texto da mensagem e copie manualmente.');
    }
  }

  function markCurrentAsSent() {
    if (currentStep >= activeSequence.messages.length) return;

    const nextStep = currentStep + 1;
    const updatedProgress = { ...progress, [progressKey]: nextStep };
    setProgress(updatedProgress);
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(updatedProgress));
    } catch {
      // O progresso continua atualizado na tela mesmo se o armazenamento falhar.
    }

    if (nextStep >= activeSequence.messages.length) {
      setFeedback('Última mensagem confirmada. Sequência concluída.');
      return;
    }

    const nextMessage = renderMessage(activeSequence.messages[nextStep], { ...values, saudacao: getGreeting() });
    if (whatsappUrl && nextMessage) {
      window.open(withMessage(whatsappUrl, nextMessage), '_blank', 'noopener,noreferrer');
      setFeedback(`Mensagem ${nextStep + 1} de ${activeSequence.messages.length} aberta no WhatsApp. Confira o texto e toque em Enviar.`);
      return;
    }

    setFeedback('Etapa marcada. A próxima mensagem está pronta para copiar ou abrir manualmente.');
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
      <button type="button" className="whatsapp-action whatsapp-assistant-action" onClick={startConversation}>
        <span className="whatsapp-assistant-icon" aria-hidden="true">◉</span>
        <span className="whatsapp-assistant-copy">
          <strong>Assistente WhatsApp</strong>
          <small>Sequência de mensagens</small>
        </span>
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
                  <label>Tratamento (sugestão automática)
                    <input value={contactTreatment} onChange={(event) => setContactTreatment(event.target.value)} placeholder="Detectado pelo nome; ajuste se necessário" />
                  </label>
                  <p>Campos disponíveis nos textos: <code>{'{nome}'}</code>, <code>{'{primeiro_nome}'}</code>, <code>{'{tratamento}'}</code>, <code>{'{cidade}'}</code>, <code>{'{categoria}'}</code> e <code>{'{saudacao}'}</code>.</p>
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
                            <button type="button" className="wa-sequence-primary" onClick={markCurrentAsSent}>{currentStep + 1 < activeSequence.messages.length ? 'Já enviei — abrir próxima no WhatsApp' : 'Já enviei — concluir sequência'}</button>
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
                  <p>Depois de enviar uma mensagem, clique em “Já enviei — abrir próxima no WhatsApp”. A próxima conversa será aberta com o texto preenchido; confira e toque em Enviar. O Escarlate nunca dispara mensagens sozinho.</p>
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
