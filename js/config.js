/* ============================================================================
   CONFIGURAÇÃO DO APLICATIVO
   ----------------------------------------------------------------------------
   1) Crie um projeto no Supabase (https://supabase.com) e rode o arquivo
      sql/schema.sql no "SQL Editor".
   2) Em Project Settings > API, copie a "Project URL" e a chave "anon public".
   3) Cole os dois valores abaixo, entre as aspas.
   4) Personalize nome, cores e listas conforme a clínica.
   ============================================================================ */
window.CONFIG = {
  // --- Conexão com o Supabase (obrigatório para o app de verdade) ---
  SUPABASE_URL: "https://jnndurlqwzzmpuprvavg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_1zeIqurO8o7jH0avfNIJlA_hp8ooaTz",

  // --- Identidade visual ---
  APP_NOME: "Malena Marques",
  APP_SUBTITULO: "Agenda, clientes e financeiro",
  COR_PRINCIPAL: "#F3B6B6",      // rosé (botões e destaques)
  COR_PRINCIPAL_ESCURA: "#DE9CA4", // rosé mais escuro (toque)
  COR_DOURADO: "#C9A24B",        // dourado (detalhes)
  COR_FUNDO: "#FBF6F3",          // fundo claro
  COR_TEXTO_BOTAO: "#5A2E34",    // texto dos botões (contraste)

  // --- Listas usadas nos formulários ---
  PROFISSIONAIS: ["Malena"],

  // Sugestões de procedimentos (podem ser editadas na aba Ajustes do app)
  PROCEDIMENTOS: [
    "Alongamento em gel",
    "Alongamento acrílico",
    "Manutenção de alongamento",
    "Banho de gel",
    "Blindagem",
    "Esmaltação em gel",
    "Francesinha",
    "Decoração / nail art",
    "Manicure simples",
    "Pedicure",
    "Pé e mão (combo)",
    "Spa dos pés"
  ],

  FORMAS: ["Pix", "Dinheiro", "Cartão de débito", "Cartão de crédito"],
  PARCELAS: [1, 2, 3],

  // Formas de receber:
  //  "Direto" = a cliente paga direto para ela.
  //  "Salão"  = o salão recebe, fica com uma comissão e repassa a cada quinzena.
  RECEBIMENTOS: ["Direto", "Salão"],
  COMISSAO_SALAO: 30,

  // Taxas de cartão padrão (%). Editáveis dentro do app, na aba Ajustes.
  // O crédito tem um percentual para CADA número de parcelas (1x = à vista).
  TAXAS_CARTAO: {
    debito: 1.99,
    credito: {
      1: 3.99,
      2: 5.49,
      3: 6.99
    }
  },

  CATEGORIAS_RECEITA: ["Atendimento", "Venda de produto", "Outras receitas"],
  CATEGORIAS_DESPESA: [
    "Produtos e materiais", "Aluguel", "Água e luz", "Internet",
    "Salão / estrutura", "Manutenção de equipamentos", "Impostos",
    "Taxas de cartão", "Marketing", "Formação / cursos", "Outras despesas"
  ],

  STATUS_ATEND: ["Agendado", "Atendido", "Cancelado"],
  STATUS_FIN: ["Pendente", "Pago", "Cancelado"]
};
