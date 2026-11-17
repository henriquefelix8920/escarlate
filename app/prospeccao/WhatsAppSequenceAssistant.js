'use client';

import { useEffect, useMemo, useState } from 'react';
import { WHATSAPP_MESSAGE_BUTTONS, WHATSAPP_MESSAGE_CATEGORIES } from './whatsapp-message-buttons';

const SEQUENCES_KEY = 'escarlate:whatsapp-sequences:v1';
const PROGRESS_KEY = 'escarlate:whatsapp-sequence-progress:v1';
const SAMPLE_WEBSITE_URL = 'https://nutricionista-fawn.vercel.app/';

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
  'adriana agatha alana alessandra alessia alicia aline amanda ana andressa andrea angelica antonella ariane barbara beatriz bia bianca bruna camila carla carolina carol caroline candyce catarina celia cecilia clara cintia cristina daniela dayane debora eduarda elaine eliana ellen erika ester esther fabiana fernanda flavia giovana giulia helena heloisa isabel isabela isabella iris itala jackeline jessica joceli joice julia juliana karla lais laura larissa leticia livia luana luara luciana luisa luiza luanna luzia maira malu manuela marcela marcia maria mariana marisa michele monica monique natalia nathalia nicole nicoli noemi pamela paula patricia priscila rebeca rebecca rafaela raquel rayane renata rosa rubia sabrina sandra sara sarah silvia simone sonia sofia sophia sueli tais tania taynara teresa thays valeria valentina vanessa vera viviane yasmin yasmim'.split(' ')
);
const MALE_FIRST_NAMES = new Set(
  'abel adriano afonso alan alberto alessandro allan alvaro alexandre almir anderson andre antonio arthur augusto bernardo breno bruno caio carlos cassio caua cesar cicero claudio cleber daniel danilo davi denis diego diogo eduardo elias emanuel emerson enzo erick estevao fabio fabricio felipe fernando francisco gabriel geraldo gilberto gustavo heitor henrique hugo igor italo ivan jean joao joaquim jorge jose julio kevin leandro leonardo lucas luan luciano luiz marcelo marco marcos mario mateus matheus mauro mauricio miguel moises murilo natan nathan nelson nicolas otavio pablo paulo patrick pedro rafael raul renato ricardo roberto rhuan rodrigo romulo ronaldo samuel sandro saulo sergio sidney thiago tiago tomas valdir vinicius vitor victor wagner wellington wesley william yuri'.split(' ')
);
const AMBIGUOUS_FIRST_NAMES = new Set('alex andrea ariel cris dani duda elia luca noa nicola sasha'.split(' '));
const NON_NAME_WORDS = new Set(
  'nutricionista nutricionistas nutri nutricao clinica consultorio espaco cozinha terapeutica atendimento profissional profissionais especialista esportivo esportiva materno infantil emagrecimento saudavel de da do dos das e'.split(' ')
);
const LOCATION_PREPOSITIONS = new Set('em no na nos nas'.split(' '));
const HONORIFIC_PATTERN = /(?:^|[\s|,;:–—-])(dra?\.?|doutora?|doutor|sra?\.?|senhora|sr\.?|senhor)\s*/i;

function inferTreatment(value) {
  const original = String(value || '').trim();
  const title = original.match(HONORIFIC_PATTERN);
  if (title) {
    const normalizedTitle = title[1].replace(/\./g, '').toLowerCase();
    return ['dra', 'doutora', 'sra', 'senhora'].includes(normalizedTitle) ? 'Dra.' : 'Dr.';
  }

  // O Google Maps frequentemente coloca "Nutricionista" ou "Consultório de Nutrição"
  // antes do nome. Procura nomes reconhecidos em cada trecho, sem ler "em Recife"
  // ou "em São Paulo" como se fossem o nome da pessoa.
  const segments = original.split(/[|,;:–—-]+|\s+I\s+/i);
  for (const segment of segments) {
    const tokens = normalizeName(segment).split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (LOCATION_PREPOSITIONS.has(token)) break;
      if (NON_NAME_WORDS.has(token)) continue;
      if (AMBIGUOUS_FIRST_NAMES.has(token)) return '';
      if (FEMALE_FIRST_NAMES.has(token)) return 'Dra.';
      if (MALE_FIRST_NAMES.has(token)) return 'Dr.';
    }
  }
  return '';
}

function stripHonorific(value, stripDescriptors = false) {
  let result = String(value || '').replace(
    /(^|[\s|,;:–—-])(?:dra?\.?|doutora?|doutor|sra?\.?|senhora|sr\.?|senhor)\s*/gi,
    '$1',
  ).trim();

  if (stripDescriptors) {
    const leadingDescriptors = new Set([...NON_NAME_WORDS, 'em', 'no', 'na', 'nos', 'nas']);
    const words = result.split(/\s+/);
    while (words.length) {
      const token = normalizeName(words[0]);
      if (!token || /^[|,;:–—-]+$/.test(words[0])) {
        words.shift();
        continue;
      }
      if (!leadingDescriptors.has(token)) break;
      words.shift();
    }
    result = words.join(' ').replace(/^[|,;:–—-]+\s*/, '').trim();
  }

  return result.replace(/\s{2,}/g, ' ').trim();
}

function resolveContact(value) {
  const treatment = inferTreatment(value);
  const segments = String(value || '').split(/[|,;:–—-]+|\s+I\s+/i);
  const personSegment = treatment
    ? segments.find((segment) => inferTreatment(segment) === treatment)
    : null;
  const nameSource = personSegment || value;
  return {
    treatment,
    name: stripHonorific(nameSource, Boolean(treatment)),
  };
}

function migrateDefaultSequence(sequence) {
  if (sequence.id !== DEFAULT_SEQUENCE.id || !sequence.messages?.length) return sequence;
  const messages = [...sequence.messages];
  let firstMessage = String(messages[0] || '')
    .replace(/^(?:Bom dia|Boa tarde|Boa noite)(?=,?\s)/i, '{saudacao}');

  // Migra o roteiro padrão antigo salvo no navegador, que podia não ter
  // o marcador {tratamento} mesmo depois da atualização do código.
  if (!/\{tratamento\}/i.test(firstMessage) && /\{nome\}/i.test(firstMessage)) {
    firstMessage = firstMessage.replace(
      /^(\s*)(?:dra?\.?|doutora?|doutor|sra?\.?|senhora|sr\.?|senhor)\s*(?=\{nome\})/i,
      '$1{tratamento} ',
    );
    if (!/\{tratamento\}/i.test(firstMessage)) {
      firstMessage = firstMessage.replace(/\{nome\}/i, '{tratamento} {nome}');
    }
  }
  messages[0] = firstMessage.replace(/\{tratamento\}(?:\s+\{tratamento\})+/gi, '{tratamento}');
  return { ...sequence, messages };
}

export default function WhatsAppSequenceAssistant({ lead, whatsappUrl, onContactConfirmed, onWhatsAppActivity }) {
  const [sequences, setSequences] = useState([DEFAULT_SEQUENCE]);
  const [progress, setProgress] = useState({});
  const [storageReady, setStorageReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState('flow');
  const initialContact = resolveContact(lead.name || '');
  const [selectedSequenceId, setSelectedSequenceId] = useState(DEFAULT_SEQUENCE.id);
  const [contactName, setContactName] = useState(initialContact.name);
  const [contactTreatment, setContactTreatment] = useState(initialContact.treatment);
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [followUpAwaitingConfirmation, setFollowUpAwaitingConfirmation] = useState(false);
  const [followUpFeedback, setFollowUpFeedback] = useState('');
  const [selectedButtonCategory, setSelectedButtonCategory] = useState(WHATSAPP_MESSAGE_CATEGORIES[0]);
  const [pendingButton, setPendingButton] = useState(null);

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
    const defaultContact = resolveContact(lead.name || '');
    setSequences(latestSequences);
    setProgress(latestProgress);
    setSelectedSequenceId(sequence.id);
    setContactName(defaultContact.name);
    setContactTreatment(defaultContact.treatment);
    setFeedback('');
    setPendingButton(null);
    setScreen('buttons');
    setIsOpen(true);
  }

  function openMessageButton(template) {
    if (!whatsappUrl) {
      setFeedback('Este lead não possui um número de WhatsApp válido para abrir a conversa.');
      return;
    }
    const message = renderMessage(template.message, { ...values, saudacao: getGreeting() });
    if (!message) return;
    const whatsappWindow = window.open(withMessage(whatsappUrl, message), '_blank', 'noopener,noreferrer');
    if (!whatsappWindow) {
      setFeedback('O navegador bloqueou a abertura do WhatsApp. Permita pop-ups e tente novamente.');
      return;
    }

    setPendingButton(template);
    setFeedback('Mensagem preparada no WhatsApp. Confira o texto e toque em Enviar; depois volte aqui e confirme o envio.');
    if (onWhatsAppActivity) {
      onWhatsAppActivity(lead.id, {
        whatsapp_tracking_status: 'active',
        whatsapp_started_at: lead.whatsapp_started_at || new Date().toISOString(),
        whatsapp_total_messages: WHATSAPP_MESSAGE_BUTTONS.length,
        whatsapp_last_message: `${template.id} — ${template.title} (preparada)`,
        whatsapp_last_message_at: new Date().toISOString(),
      }).catch((error) => setFeedback(`WhatsApp aberto, mas não consegui salvar o acompanhamento: ${error.message}`));
    }
  }

  async function confirmMessageButtonSent() {
    if (!pendingButton) return;
    try {
      const sentCount = Number(lead.whatsapp_messages_sent || 0) + 1;
      if (onWhatsAppActivity) {
        await onWhatsAppActivity(lead.id, {
          whatsapp_tracking_status: 'active',
          whatsapp_messages_sent: sentCount,
          whatsapp_total_messages: WHATSAPP_MESSAGE_BUTTONS.length,
          whatsapp_last_message: `${pendingButton.id} — ${pendingButton.title} (envio confirmado)`,
          whatsapp_last_message_at: new Date().toISOString(),
        });
      }
      if (onContactConfirmed) await onContactConfirmed(lead.id, 'whatsapp');
      setPendingButton(null);
      setFeedback('Envio confirmado e progresso atualizado no painel de conversas em andamento.');
    } catch (error) {
      setFeedback(`Não consegui confirmar o envio no CRM: ${error.message}. Tente novamente.`);
    }
  }

  function openCurrentMessageInWhatsApp() {
    const message = renderMessage(activeSequence.messages[currentStep], { ...values, saudacao: getGreeting() });
    if (!whatsappUrl || !message) return;
    const whatsappWindow = window.open(withMessage(whatsappUrl, message), '_blank', 'noopener,noreferrer');
    if (whatsappWindow && onWhatsAppActivity) {
      onWhatsAppActivity(lead.id, {
        whatsapp_tracking_status: 'active',
        whatsapp_total_messages: activeSequence.messages.length,
        whatsapp_last_message: `Mensagem ${currentStep + 1} preparada`,
        whatsapp_last_message_at: new Date().toISOString(),
      }).catch((error) => setFeedback(`Mensagem aberta, mas não consegui atualizar o painel: ${error.message}`));
    }
  }

  async function openSampleWebsiteInWhatsApp() {
    if (!whatsappUrl) {
      setFeedback('Este lead não possui um número de WhatsApp válido para abrir a conversa.');
      return;
    }

    const greetingName = [contactTreatment.trim(), contactName.trim()].filter(Boolean).join(' ');
    const greeting = greetingName ? `Perfeito, ${greetingName}! 😊` : 'Perfeito! 😊';
    const message = `${greeting}

Separei uma demonstração para você visualizar como poderia ficar o seu site profissional:

${SAMPLE_WEBSITE_URL}

Esse link é uma referência visual. O seu site seria desenvolvido sob medida para você, com uma identidade visual alinhada ao seu estilo: paleta de cores, suas informações, especialidades e serviços, fotos, apresentação profissional e formas práticas para novos pacientes entrarem em contato ou agendarem.

A ideia é criar um site com a sua identidade, que valorize o seu trabalho e transmita confiança desde o primeiro acesso. Dê uma olhadinha e me conte o que achou! 😊`;

    // Abre uma aba vazia de forma síncrona para evitar o bloqueio de pop-ups
    // enquanto o CRM salva a etapa comercial e registra o contato no banco.
    const whatsappWindow = window.open('about:blank', '_blank');

    try {
      if (onContactConfirmed) {
        await onContactConfirmed(lead.id, 'whatsapp', 'interested');
      }
      if (onWhatsAppActivity) {
        await onWhatsAppActivity(lead.id, {
          whatsapp_tracking_status: 'active',
          whatsapp_last_message: 'Demonstração do site preparada',
          whatsapp_last_message_at: new Date().toISOString(),
        });
      }
      if (!whatsappWindow) {
        setFeedback('Lead atualizado para Interessado, mas o navegador bloqueou a aba do WhatsApp. Permita pop-ups para abrir a mensagem.');
        return;
      }
      if (whatsappWindow.closed) {
        setFeedback('Lead atualizado para Interessado, mas a aba do WhatsApp foi fechada antes de abrir a mensagem.');
        return;
      }
      whatsappWindow.location.href = withMessage(whatsappUrl, message);
      whatsappWindow.opener = null;
      setFeedback('Lead atualizado para Interessado. Mensagem com o site de demonstração aberta no WhatsApp; confira e toque em Enviar.');
    } catch (error) {
      if (whatsappWindow && !whatsappWindow.closed) whatsappWindow.close();
      setFeedback(`Não consegui concluir a atualização do lead e registrar o contato: ${error.message} Tente novamente.`);
    }
  }

  function openFollowUpInWhatsApp() {
    if (!whatsappUrl) {
      setFollowUpFeedback('Este lead não possui um número de WhatsApp válido.');
      return;
    }

    const contact = resolveContact(lead.name || '');
    const displayName = [contact.treatment, contact.name].filter(Boolean).join(' ') || lead.name;
    const greeting = displayName ? `Olá, ${displayName}! Tudo bem? 😊` : 'Olá! Tudo bem? 😊';
    const message = `${greeting}

Estou retomando nossa conversa porque acredito que um site profissional pode valorizar a forma como você apresenta seu trabalho, transmitir confiança logo no primeiro contato e facilitar que novos clientes encontrem seus serviços e falem diretamente com você.

A ideia é criar algo com a sua identidade, reunindo suas informações, serviços e formas de contato em um só lugar — de um jeito simples e pensado para o seu negócio.

Faz sentido eu te mostrar um exemplo visual de como isso poderia ficar para você? É sem compromisso e levo só um instante para te apresentar. 😊`;

    const whatsappWindow = window.open('about:blank', '_blank');
    if (!whatsappWindow) {
      setFollowUpFeedback('O navegador bloqueou a abertura do WhatsApp. Permita pop-ups e tente novamente.');
      return;
    }

    whatsappWindow.location.href = withMessage(whatsappUrl, message);
    whatsappWindow.opener = null;
    if (onWhatsAppActivity) {
      onWhatsAppActivity(lead.id, {
        whatsapp_tracking_status: 'active',
        whatsapp_last_message: 'Follow-up preparado',
        whatsapp_last_message_at: new Date().toISOString(),
      }).catch((error) => setFollowUpFeedback(`Mensagem aberta, mas não consegui atualizar o painel: ${error.message}`));
    }
    setFollowUpAwaitingConfirmation(true);
    setFollowUpFeedback('Mensagem preparada no WhatsApp. Confira o texto e toque em Enviar; depois confirme aqui no CRM.');
  }

  async function confirmFollowUpSent() {
    try {
      if (onContactConfirmed) await onContactConfirmed(lead.id, 'whatsapp');
      setFollowUpAwaitingConfirmation(false);
      setFollowUpFeedback('Follow-up registrado. O contato de hoje foi contabilizado no CRM.');
    } catch (error) {
      setFollowUpFeedback(`Não consegui registrar o follow-up: ${error.message}. Tente novamente.`);
    }
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

  async function markCurrentAsSent() {
    if (currentStep >= activeSequence.messages.length) return;

    const nextStep = currentStep + 1;
    const isFinalStep = nextStep >= activeSequence.messages.length;

    try {
      if (onContactConfirmed) {
        await onContactConfirmed(lead.id, 'whatsapp', isFinalStep ? 'contacted' : null);
      }
    } catch (error) {
      setFeedback(`Não consegui registrar o contato e atualizar a etapa do lead: ${error.message} Tente confirmar novamente.`);
      return;
    }

    if (onWhatsAppActivity) {
      try {
        await onWhatsAppActivity(lead.id, {
          whatsapp_tracking_status: isFinalStep ? 'completed' : 'active',
          whatsapp_messages_sent: nextStep,
          whatsapp_total_messages: activeSequence.messages.length,
          whatsapp_last_message: `Mensagem ${currentStep + 1} confirmada como enviada`,
          whatsapp_last_message_at: new Date().toISOString(),
        });
      } catch (error) {
        setFeedback(`Contato registrado, mas não consegui atualizar o painel de acompanhamento: ${error.message}`);
      }
    }

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

      {lead.status === 'follow_up' && (
        <div className="whatsapp-followup">
          <button type="button" className="whatsapp-action whatsapp-followup-action" onClick={openFollowUpInWhatsApp}>
            <span aria-hidden="true">↻</span>
            <span className="whatsapp-assistant-copy">
              <strong>Preparar follow-up</strong>
              <small>Retomar conversa · 24h sem resposta</small>
            </span>
          </button>
          {followUpAwaitingConfirmation && (
            <button type="button" className="followup-confirm-action" onClick={confirmFollowUpSent}>
              Já enviei — registrar contato
            </button>
          )}
          {followUpFeedback && <small className="followup-feedback" role="status">{followUpFeedback}</small>}
        </div>
      )}

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

            {screen === 'buttons' && (
              <div className="wa-message-buttons-screen">
                <div className="wa-sequence-toolbar">
                  <label>Categoria de mensagens
                    <select value={selectedButtonCategory} onChange={(event) => setSelectedButtonCategory(event.target.value)}>
                      {WHATSAPP_MESSAGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  <button type="button" className="wa-sequence-secondary" onClick={() => setScreen('flow')}>Roteiros personalizados</button>
                </div>

                <div className="wa-message-button-list">
                  {WHATSAPP_MESSAGE_BUTTONS.filter((item) => item.category === selectedButtonCategory).map((item) => (
                    <article className="wa-message-button-card" key={item.id}>
                      <div className="wa-message-button-copy">
                        <span className="wa-message-button-number">BOTÃO {item.id}</span>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                      </div>
                      <button type="button" className="wa-sequence-primary" onClick={() => openMessageButton(item)}>Abrir no WhatsApp ↗</button>
                    </article>
                  ))}
                </div>

                {pendingButton && (
                  <div className="wa-message-pending-confirm">
                    <div><strong>{pendingButton.id} — {pendingButton.title}</strong><p>Depois de tocar em Enviar no WhatsApp, volte e confirme para atualizar o histórico da lead.</p></div>
                    <button type="button" className="wa-sequence-primary" onClick={confirmMessageButtonSent}>Já enviei — registrar</button>
                  </div>
                )}

                <div className="wa-sequence-footer">
                  <p>Cada botão prepara a mensagem no WhatsApp para você revisar e enviar manualmente. O Escarlate não envia mensagens sozinho. A lead entra no painel de conversas em andamento quando você prepara a primeira mensagem.</p>
                </div>
              </div>
            )}

            {screen === 'flow' && (
              <>
                <div className="wa-sequence-toolbar">
                  <button type="button" className="wa-sequence-secondary" onClick={() => setScreen('buttons')}>← Voltar aos botões</button>
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
                    : (
                      <div className="wa-sequence-message-actions">
                        <button type="button" className="wa-sequence-primary" onClick={openSampleWebsiteInWhatsApp}>Lead aceitou — enviar site de demonstração</button>
                        <button type="button" className="wa-sequence-secondary" onClick={resetProgress}>Reiniciar sequência para este lead</button>
                      </div>
                    )}
                  <p>Depois de enviar cada mensagem, confirme a etapa para avançar. Quando a sequência terminar, use “Lead aceitou — enviar site de demonstração” somente se a pessoa quiser ver o exemplo. Confira o texto no WhatsApp e toque em Enviar. O Escarlate nunca dispara mensagens sozinho.</p>
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
