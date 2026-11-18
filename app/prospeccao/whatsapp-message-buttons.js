export const WHATSAPP_MESSAGE_BUTTONS = [
  {
    id: '01',
    category: 'Mensagens principais',
    title: 'Primeiro contato',
    description: 'Mensagem inicial para uma nova profissional.',
    message: 'Oi, {tratamento} {primeiro_nome}! Tudo bem?\n\nSou o Henrique e trabalho com desenvolvimento de sites para profissionais da saúde.\n\nMe conta uma coisa: você acha que ter um site profissional, onde seus pacientes possam conhecer melhor seu trabalho, consultar suas especialidades e encontrar facilmente suas informações de contato, poderia ajudar a fortalecer sua presença na internet?\n\nPosso te mostrar um exemplo?',
  },
  {
    id: '02',
    category: 'Mensagens principais',
    title: 'Apresentar a amostra',
    description: 'Quando ela aceitar ver um exemplo de site.',
    message: 'Que bom, {tratamento} {primeiro_nome}! 😊\n\nSeparei uma demonstração para você visualizar como poderia ficar o seu site profissional:\n\nhttps://nutricionista-fawn.vercel.app/\n\nEsse é apenas um modelo de referência. O seu site será personalizado com sua identidade, suas especialidades, seus atendimentos, suas fotos e suas formas de contato.\n\nO que achou da proposta?',
  },
  {
    id: '03',
    category: 'Mensagens principais',
    title: 'Apresentar o orçamento',
    description: 'Quando ela perguntar o valor ou estiver pronta para avaliar a proposta.',
    message: 'Claro, {tratamento} {primeiro_nome}! Vou te explicar direitinho. 😊\n\nO investimento para desenvolver sua estrutura digital é de R$ 1.000,00.\n\nEsse valor contempla a criação do seu site profissional personalizado e o trabalho de configuração e otimização da sua presença no Google Maps.\n\nDepois, a manutenção do site e o suporte para pequenas atualizações ficam em R$ 50,00 por mês.\n\nA compra do domínio será feita depois da sua aprovação e do pagamento. Antes de concluirmos, explico todos os detalhes dessa etapa.\n\nA ideia é entregar uma estrutura profissional para valorizar seu trabalho e facilitar que novos pacientes conheçam seus serviços e encontrem você.\n\nO que acha da proposta?',
  },
  {
    id: '04',
    category: 'Mensagens principais',
    title: 'Como funciona',
    description: 'Explica o briefing, as fotos e a criação inicial sem compromisso.',
    message: 'Funciona assim, {tratamento} {primeiro_nome}! 😊\n\nPrimeiro, vou te enviar um briefing bem simples para conhecer melhor seu trabalho, suas especialidades, seus atendimentos e o estilo que você gostaria para seu site.\n\nTambém vou precisar que você me envie umas 2 fotos para usar na criação.\n\nCom essas informações, vou desenvolver uma primeira versão do seu site sem compromisso e sem pagamento antecipado.\n\nVocê poderá olhar tudo com calma. Se gostar, fazemos os ajustes necessários para deixar o site do jeito que você deseja.\n\nDepois da sua aprovação, você realiza o pagamento e eu faço a compra e a configuração do domínio para colocar seu site no ar.\n\nAssim, você consegue visualizar o resultado antes de assumir qualquer compromisso. 😊',
  },
];

export const WHATSAPP_MESSAGE_CATEGORIES = [...new Set(WHATSAPP_MESSAGE_BUTTONS.map((item) => item.category))];
