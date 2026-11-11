/* ============================================================================
   Aplicativo Malena Marques — PWA + Supabase
   Estratégia: os dados moram no Supabase (nuvem). O navegador só é a janela.
   - Agenda: marca a cliente, o valor e o pagamento (com taxa do cartão).
   - Financeiro: relatório por período + despesas.
   - Ajustes: taxas do cartão e procedimentos.
   Sem internet: modo somente leitura (não deixa salvar e avisa).
   ============================================================================ */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var SNAP_KEY = 'clinica_snapshot_v2';
  var sb = null;
  var usuario = null;

  var state = {
    clientes: [],
    agendamentos: [],
    lancamentos: [],
    procedimentos: [],
    ajustes: null,
    filtroMes: '',
    online: navigator.onLine,
    pronto: false
  };

  // ------------------------------ utilidades ------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function brl(centavos) {
    var neg = centavos < 0, v = Math.abs(Math.round(centavos || 0));
    var reais = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var cents = String(v % 100).padStart(2, '0');
    return (neg ? '-R$ ' : 'R$ ') + reais + ',' + cents;
  }
  function parseMoeda(txt) {
    var s = String(txt || '').replace(/[^\d,.-]/g, '').trim();
    if (!s) return 0;
    var neg = s.charAt(0) === '-';
    s = s.replace('-', '').replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return Math.round((neg ? -n : n) * 100);
  }
  function parseNum(txt) {
    var s = String(txt == null ? '' : txt).replace(/[^\d,.-]/g, '').trim();
    if (!s) return 0;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function numFmt(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    return String(n).replace('.', ',');
  }
  function moedaInput(centavos) {
    if (!centavos) return '';
    return (centavos / 100).toFixed(2).replace('.', ',');
  }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function brData(iso) {
    if (!iso) return '';
    var p = String(iso).substring(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }
  function brMes(ym) {
    if (!ym) return '';
    var p = String(ym).substring(0, 7).split('-');
    return p.length >= 2 ? p[1] + '/' + p[0] : ym;
  }
  function durFmt(m) {
    m = parseInt(m, 10) || 0;
    if (!m) return '';
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return m + ' min';
    return h + 'h' + (r ? String(r).padStart(2, '0') : '');
  }
  function mesDe(d) { return String(d || '').substring(0, 7); }
  function rotulo(ym) {
    var nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    var p = String(ym).split('-');
    var m = parseInt(p[1], 10) - 1;
    return (nomes[m] || p[1]) + '/' + p[0];
  }

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('oculto');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.add('oculto'); }, ms || 2600);
  }

  function confirmar(msg, onOk) {
    $('modal-msg').textContent = msg;
    $('modal').classList.remove('oculto');
    $('modal-ok').onclick = function () { $('modal').classList.add('oculto'); onOk(); };
    $('modal-nao').onclick = function () { $('modal').classList.add('oculto'); };
  }

  function mostrarTela(id) {
    ['tela-config', 'tela-login', 'tela-app'].forEach(function (t) {
      $(t).classList.toggle('oculto', t !== id);
    });
  }

  function aplicarTema() {
    var r = document.documentElement.style;
    r.setProperty('--cor', CFG.COR_PRINCIPAL || '#F3B6B6');
    r.setProperty('--cor-escura', CFG.COR_PRINCIPAL_ESCURA || '#DE9CA4');
    r.setProperty('--dourado', CFG.COR_DOURADO || '#C9A24B');
    r.setProperty('--cor-texto', CFG.COR_TEXTO_BOTAO || '#5A2E34');
    r.setProperty('--fundo', CFG.COR_FUNDO || '#FBF6F3');
    var nome = CFG.APP_NOME || 'Minha Clínica';
    var sub = CFG.APP_SUBTITULO || 'Agenda, clientes e financeiro';
    var inicial = nome.trim().charAt(0).toUpperCase() || 'C';
    document.title = nome;
    var metaTheme = document.querySelector('meta[name=theme-color]');
    if (metaTheme) metaTheme.setAttribute('content', CFG.COR_PRINCIPAL || '#F3B6B6');
    $('app-nome').textContent = nome;
    $('app-sub').textContent = sub;
    $('app-inicial').textContent = inicial;
    $('login-nome').textContent = nome;
    $('login-sub').textContent = sub;
    $('login-inicial').textContent = inicial;
  }

  // ------------------------- taxas do cartão ------------------------------
  // Aceita tanto o formato novo { debito, credito: { 1:.., 2:.. } }
  // quanto o antigo { debito, credito_vista, credito_parcela }.
  function taxasCartao() {
    var base = CFG.TAXAS_CARTAO || {};
    var t = (state.ajustes && state.ajustes.taxas_cartao) || {};
    var baseCred = (base.credito && typeof base.credito === 'object') ? base.credito : {};
    var tCred = (t.credito && typeof t.credito === 'object') ? t.credito : null;
    var credito = {};
    (CFG.PARCELAS || [1]).forEach(function (n) {
      var padrao = numero(baseCred[n],
        numero(base.credito_vista, 0) + (n - 1) * numero(base.credito_parcela, 0));
      var v;
      if (tCred) v = numero(tCred[n], padrao);
      else if (t.credito_vista != null || t.credito_parcela != null)
        v = numero(t.credito_vista, padrao) + (n - 1) * numero(t.credito_parcela, 0);
      else v = padrao;
      credito[n] = v;
    });
    return {
      debito: numero(t.debito, numero(base.debito, 0)),
      credito: credito
    };
  }
  function numero(v, def) {
    var n = (typeof v === 'number') ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : (isFinite(def) ? def : 0);
  }
  function ehDebito(f) { return /d[ée]bito/i.test(f || ''); }
  function ehCredito(f) { return /cr[ée]dito/i.test(f || ''); }
  function ehCartao(f) { return ehDebito(f) || ehCredito(f); }

  function pctTaxa(forma, parcelas) {
    var t = taxasCartao();
    if (ehDebito(forma)) return t.debito;
    if (ehCredito(forma)) {
      var n = parcelas || 1;
      var pct = t.credito[n];
      if (pct == null) pct = t.credito[1];
      return numero(pct, 0);
    }
    return 0;
  }
  function calcularTaxa(forma, parcelas, valorCentavos) {
    var pct = pctTaxa(forma, parcelas);
    var taxa = Math.round((valorCentavos || 0) * pct / 100);
    return { pct: pct, taxa: taxa, liquido: (valorCentavos || 0) - taxa };
  }

  // ---------------------- recebimento (direto x salão) --------------------
  function ehSalao(rec) { return /sal[ãa]o/i.test(rec || ''); }
  function comissaoSalao() {
    var t = (state.ajustes && state.ajustes.comissao_salao);
    return numero(t, numero(CFG.COMISSAO_SALAO, 30));
  }

  // ------------------------------ quinzena --------------------------------
  // 1ª quinzena: dias 1 a 15. 2ª quinzena: dias 16 ao fim do mês.
  function quinzenaDe(data) {
    if (!data) return '';
    var dia = parseInt(String(data).substring(8, 10), 10);
    return String(data).substring(0, 7) + '-' + (dia <= 15 ? '1' : '2');
  }
  function rotuloQuinzena(q) {
    if (!q) return '';
    var p = q.split('-');
    return (p[2] === '1' ? '1ª quinzena' : '2ª quinzena') + ' de ' + brMes(p[0] + '-' + p[1]);
  }

  // --------------------------- selects / opções ---------------------------
  function op(value, texto) { var o = document.createElement('option'); o.value = value; o.textContent = texto; return o; }

  function preencherSelects() {
    var forma = $('agenda-forma');
    forma.innerHTML = '';
    (CFG.FORMAS || []).forEach(function (f) { forma.appendChild(op(f, f)); });

    var par = $('agenda-parcelas');
    par.innerHTML = '';
    (CFG.PARCELAS || [1]).forEach(function (n) { par.appendChild(op(String(n), n + 'x')); });

    var rec = $('agenda-recebimento');
    rec.innerHTML = '';
    rec.appendChild(op('Direto', 'Direto (a cliente paga pra mim)'));
    rec.appendChild(op('Salão', 'Pelo salão (repassa na quinzena)'));

    var sit = $('agenda-situacao');
    sit.innerHTML = '';
    (CFG.STATUS_ATEND || ['Agendado', 'Atendido', 'Cancelado']).forEach(function (s) { sit.appendChild(op(s, s)); });

    var prof = $('fin-profissional');
    prof.innerHTML = '';
    prof.appendChild(op('', '—'));
    (CFG.PROFISSIONAIS || []).forEach(function (p) { prof.appendChild(op(p, p)); });

    var f2 = $('fin-forma');
    f2.innerHTML = '';
    f2.appendChild(op('', '—'));
    (CFG.FORMAS || []).forEach(function (f) { f2.appendChild(op(f, f)); });

    var st = $('fin-status');
    st.innerHTML = '';
    (CFG.STATUS_FIN || ['Pendente', 'Pago', 'Cancelado']).forEach(function (s) { st.appendChild(op(s, s)); });

    atualizarCategoriasFin();
  }

  function atualizarCategoriasFin() {
    var lista = ($('fin-tipo').value === 'Receita') ? (CFG.CATEGORIAS_RECEITA || []) : (CFG.CATEGORIAS_DESPESA || []);
    var sel = $('fin-categoria');
    sel.innerHTML = '';
    lista.forEach(function (c) { sel.appendChild(op(c, c)); });
  }

  function clientePorId(id) { return state.clientes.find(function (c) { return c.id === id; }); }

  function filtrarClientes(f) {
    f = (f || '').trim().toLowerCase();
    var lista = state.clientes.slice().sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
    if (f) {
      lista = lista.filter(function (c) {
        return (c.nome || '').toLowerCase().indexOf(f) >= 0 ||
          (c.telefone || '').toLowerCase().indexOf(f) >= 0 ||
          (c.instagram || '').toLowerCase().indexOf(f) >= 0;
      });
    }
    return lista.slice(0, 50);
  }

  function mostrarListaClientes() {
    var box = $('agenda-cliente-lista');
    var lista = filtrarClientes($('agenda-cliente-busca').value);
    if (!lista.length) box.innerHTML = '<div class="vazio">Nenhuma cliente encontrada.</div>';
    else {
      box.innerHTML = lista.map(function (c) {
        var sub = [c.telefone, c.instagram].filter(Boolean).join('  •  ');
        return '<div class="opcao" data-cliente="' + c.id + '">' + esc(c.nome) +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>';
      }).join('');
    }
    box.classList.remove('oculto');
  }

  function selecionarCliente(id) {
    var c = clientePorId(id); if (!c) return;
    $('agenda-cliente').value = c.id;
    $('agenda-cliente-busca').value = c.nome || '';
    $('agenda-cliente-lista').classList.add('oculto');
  }

  function limparClienteBusca() {
    $('agenda-cliente').value = '';
    $('agenda-cliente-busca').value = '';
    $('agenda-cliente-lista').classList.add('oculto');
  }

  // Mantém o nome exibido em dia (ex.: após renomear a cliente).
  function sincronizarClienteCombo() {
    var id = $('agenda-cliente').value;
    if (!id) return;
    var c = clientePorId(id);
    if (c) $('agenda-cliente-busca').value = c.nome || '';
    else $('agenda-cliente').value = '';
  }

  function ligarComboboxCliente() {
    var busca = $('agenda-cliente-busca');
    busca.onfocus = mostrarListaClientes;
    busca.oninput = function () {
      var nome = this.value.trim().toLowerCase();
      var exato = state.clientes.find(function (c) { return (c.nome || '').toLowerCase() === nome; });
      $('agenda-cliente').value = exato ? exato.id : '';
      mostrarListaClientes();
    };
    busca.onkeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var lista = filtrarClientes(this.value);
        if (lista.length) selecionarCliente(lista[0].id);
      } else if (e.key === 'Escape') {
        $('agenda-cliente-lista').classList.add('oculto');
      }
    };
    busca.onblur = function () {
      var box = $('agenda-cliente-lista');
      setTimeout(function () { box.classList.add('oculto'); }, 180);
    };
  }

  function procedimentoPor(nome) {
    return state.procedimentos.find(function (p) { return p.nome === nome; });
  }
  function procedimentoDur(nome) { var p = procedimentoPor(nome); return p ? durFmt(p.duracao_min) : ''; }

  function filtrarProcedimentos(f) {
    f = (f || '').trim().toLowerCase();
    var lista = state.procedimentos.slice().sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
    if (f) lista = lista.filter(function (p) { return (p.nome || '').toLowerCase().indexOf(f) >= 0; });
    return lista.slice(0, 50);
  }

  function mostrarListaProcedimentos() {
    var box = $('agenda-procedimento-lista');
    var lista = filtrarProcedimentos($('agenda-procedimento-busca').value);
    if (!lista.length) box.innerHTML = '<div class="vazio">Nenhum procedimento encontrado.</div>';
    else {
      box.innerHTML = lista.map(function (p) {
        var det = [p.duracao_min ? durFmt(p.duracao_min) : '', p.valor_centavos ? brl(p.valor_centavos) : ''].filter(Boolean).join('  •  ');
        return '<div class="opcao" data-procedimento="' + esc(p.nome) + '">' + esc(p.nome) +
          (det ? '<span class="sub">' + det + '</span>' : '') + '</div>';
      }).join('');
    }
    box.classList.remove('oculto');
  }

  function selecionarProcedimento(nome) {
    var p = procedimentoPor(nome);
    $('agenda-procedimento').value = nome;
    $('agenda-procedimento-busca').value = nome;
    $('agenda-procedimento-lista').classList.add('oculto');
    if (p && p.valor_centavos) $('agenda-valor').value = moedaInput(p.valor_centavos);
    atualizarTaxaInfo();
  }

  function limparProcedimentoBusca() {
    $('agenda-procedimento').value = '';
    $('agenda-procedimento-busca').value = '';
    $('agenda-procedimento-lista').classList.add('oculto');
  }

  // Mantém o nome exibido em dia (ex.: após renomear o procedimento).
  function sincronizarProcedimentoCombo() {
    var nome = $('agenda-procedimento').value;
    if (!nome) return;
    var p = procedimentoPor(nome);
    if (p) $('agenda-procedimento-busca').value = p.nome || '';
  }

  function ligarComboboxProcedimento() {
    var busca = $('agenda-procedimento-busca');
    busca.onfocus = mostrarListaProcedimentos;
    busca.oninput = function () {
      var nome = this.value.trim().toLowerCase();
      var exato = state.procedimentos.find(function (p) { return (p.nome || '').toLowerCase() === nome; });
      $('agenda-procedimento').value = exato ? exato.nome : '';
      mostrarListaProcedimentos();
    };
    busca.onkeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var lista = filtrarProcedimentos(this.value);
        if (lista.length) selecionarProcedimento(lista[0].nome);
      } else if (e.key === 'Escape') {
        $('agenda-procedimento-lista').classList.add('oculto');
      }
    };
    busca.onblur = function () {
      var box = $('agenda-procedimento-lista');
      setTimeout(function () { box.classList.add('oculto'); }, 180);
    };
  }

  function renderListaProcedimentos() {
    var lista = state.procedimentos.slice().sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
    var el = $('lista-procedimentos');
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum procedimento cadastrado.</div>'; return; }
    el.innerHTML = lista.map(function (p) {
      var detalhes = [p.valor_centavos ? brl(p.valor_centavos) : 'sem valor', p.duracao_min ? durFmt(p.duracao_min) : 'sem tempo'];
      return '<div class="item"><div class="info">' +
        '<div class="nome">' + esc(p.nome) + '</div>' +
        '<div class="meta">' + detalhes.join('  •  ') + '</div>' +
        '</div><div class="acoes">' +
        '<button class="btn-mini verde" data-editar-procedimento="' + p.id + '">Editar</button>' +
        '<button class="btn-mini vermelho" data-excluir-procedimento="' + p.id + '">Excluir</button>' +
        '</div></div>';
    }).join('');
  }

  // ------------------------------ render ----------------------------------
  function renderClientes() {
    var busca = ($('cliente-busca').value || '').toLowerCase();
    var lista = state.clientes.filter(function (c) {
      return (c.nome || '').toLowerCase().indexOf(busca) >= 0 ||
        (c.telefone || '').toLowerCase().indexOf(busca) >= 0 ||
        (c.instagram || '').toLowerCase().indexOf(busca) >= 0;
    }).sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });

    var el = $('lista-clientes');
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhuma cliente cadastrada.</div>'; return; }
    el.innerHTML = lista.map(function (c) {
      var extra = [c.telefone, c.instagram].filter(Boolean).join('  •  ');
      return '<div class="item"><div class="info">' +
        '<div class="nome">' + esc(c.nome) + '</div>' +
        (extra ? '<div class="meta">' + esc(extra) + '</div>' : '') +
        (c.obs ? '<div class="obs">' + esc(c.obs) + '</div>' : '') +
        '</div><div class="acoes">' +
        '<button class="btn-mini verde" data-editar-cliente="' + c.id + '">Editar</button>' +
        '<button class="btn-mini vermelho" data-excluir-cliente="' + c.id + '">Excluir</button>' +
        '</div></div>';
    }).join('');
  }

  function valorTxt(a) {
    if (a.desconto_centavos > 0) {
      return '<s>' + brl(a.valor_bruto_centavos || 0) + '</s> ' + brl(a.valor_centavos || 0) +
        ' <span class="obs">(−' + numFmt(a.desconto_pct) + '%)</span>';
    }
    return brl(a.valor_centavos || 0);
  }

  function infoPagamento(a) {
    var partes = [];
    if (ehSalao(a.recebimento)) partes.push('Pelo salão');
    if (a.forma_pagamento) partes.push(esc(a.forma_pagamento) + (ehCredito(a.forma_pagamento) && (a.parcelas || 1) > 1 ? ' ' + a.parcelas + 'x' : ''));
    if (a.status === 'Cancelado') return '<div class="pagamento">' + partes.join(' &bull; ') + '</div>';
    var pre = partes.length ? partes.join(' &bull; ') + ' &bull; ' : '';
    var taxa = a.taxa_centavos || 0, com = a.comissao_centavos || 0;
    var liq = (a.valor_liquido != null ? a.valor_liquido : (a.valor_centavos || 0) - taxa - com);
    var abate = '';
    if (com > 0) abate = ' &bull; salão fica ' + brl(com);
    else if (taxa > 0) abate = ' &bull; taxa ' + brl(taxa);
    if (a.pago) {
      return '<div class="pagamento">' + pre + valorTxt(a) + abate + ' &rarr; <span class="liquido">recebe ' + brl(liq) + '</span></div>';
    }
    return '<div class="pagamento">' + pre + valorTxt(a) + abate + ' &bull; <span class="liquido">recebe ' + brl(liq) + '</span> <b>(a receber)</b></div>';
  }

  function renderAgenda() {
    var busca = ($('agenda-busca').value || '').toLowerCase();
    var lista = state.agendamentos.filter(function (a) {
      return (a.cliente_nome || '').toLowerCase().indexOf(busca) >= 0 ||
        (a.procedimento || '').toLowerCase().indexOf(busca) >= 0;
    }).sort(function (a, b) { return (a.data + (a.horario || '')).localeCompare(b.data + (b.horario || '')); });

    var el = $('lista-agenda');
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhum agendamento.</div>'; return; }
    el.innerHTML = lista.map(function (a) {
      var cls = 'et-' + String(a.status || 'agendado').toLowerCase();
      return '<div class="item"><div class="info">' +
        '<div class="nome">' + esc(a.cliente_nome || '(sem cliente)') + '</div>' +
        '<div class="meta">' + esc(a.procedimento || '') + (procedimentoDur(a.procedimento) ? ' (' + procedimentoDur(a.procedimento) + ')' : '') + '  •  ' + brData(a.data) + ' às ' + esc((a.horario || '').substring(0, 5)) + '</div>' +
        infoPagamento(a) +
        (a.obs ? '<div class="obs">' + esc(a.obs) + '</div>' : '') +
        '</div><span class="etiqueta ' + cls + '">' + esc(a.status || 'Agendado') + '</span>' +
        '<div class="acoes">' +
        (a.pago ? '' : '<button class="btn-mini verde" data-pagar-agenda="' + a.id + '">Receber</button>') +
        '<button class="btn-mini verde" data-editar-agenda="' + a.id + '">Editar</button>' +
        '<button class="btn-mini vermelho" data-excluir-agenda="' + a.id + '">Excluir</button>' +
        '</div></div>';
    }).join('');
  }

  function linhasRanking(obj, vazio) {
    var chaves = Object.keys(obj);
    if (!chaves.length) return '<div class="vazio">' + (vazio || 'Sem dados.') + '</div>';
    chaves.sort(function (a, b) { return obj[b] - obj[a]; });
    return chaves.slice(0, 15).map(function (k) {
      return '<div class="linha-detalhe"><span>' + esc(k) + '</span><b>' + brl(obj[k]) + '</b></div>';
    }).join('');
  }

  function renderFinanceiro() {
    var meses = {};
    state.agendamentos.forEach(function (a) { if (a.data) meses[mesDe(a.data)] = 1; });
    state.lancamentos.forEach(function (l) { if (l.data) meses[mesDe(l.data)] = 1; });
    var listaMeses = Object.keys(meses).sort().reverse();

    var sel = $('fin-mes');
    sel.innerHTML = '';
    sel.appendChild(op('', 'Todos os meses'));
    listaMeses.forEach(function (m) { sel.appendChild(op(m, rotulo(m))); });
    sel.value = listaMeses.indexOf(state.filtroMes) >= 0 ? state.filtroMes : (state.filtroMes = '');

    var f = state.filtroMes;
    function noPeriodo(d) { return !f || mesDe(d) === f; }

    var bruto = 0, taxas = 0, comissoes = 0, liquido = 0, aReceber = 0, despesas = 0;
    var descTotal = 0, descQtd = 0;
    var porForma = {}, porCliente = {}, porProc = {};
    var receb = [], desp = [];

    function soma(dest, chave, v) { dest[chave] = (dest[chave] || 0) + v; }

    state.agendamentos.forEach(function (a) {
      if (a.status === 'Cancelado' || !noPeriodo(a.data)) return;
      var val = a.valor_centavos || 0;
      var com = a.comissao_centavos || 0, tax = a.taxa_centavos || 0;
      if (a.desconto_centavos > 0) { descTotal += a.desconto_centavos; descQtd++; }
      if (a.pago) {
        var liq = (a.valor_liquido != null ? a.valor_liquido : val - tax - com);
        bruto += val; taxas += tax; comissoes += com; liquido += liq;
        soma(porForma, a.forma_pagamento || 'Não informado', val);
        soma(porCliente, a.cliente_nome || '(sem cliente)', val);
        soma(porProc, a.procedimento || '(sem procedimento)', val);
      } else {
        aReceber += (a.valor_liquido != null && a.valor_liquido > 0) ? a.valor_liquido : val;
      }
      receb.push({ tipo: 'atendimento', obj: a });
    });

    state.lancamentos.forEach(function (l) {
      if (l.status === 'Cancelado' || !noPeriodo(l.data)) return;
      if (l.tipo === 'Receita') {
        if (l.status === 'Pago') {
          var v = l.valor_realizado || l.valor_previsto || 0;
          bruto += v; liquido += v;
          soma(porForma, l.forma_pagamento || 'Não informado', v);
          soma(porCliente, 'Avulsa — ' + (l.descricao || ''), v);
        } else { aReceber += (l.valor_previsto || 0); }
        receb.push({ tipo: 'receita', obj: l });
      } else {
        desp.push(l);
        if (l.status === 'Pago') despesas += (l.valor_realizado || l.valor_previsto || 0);
      }
    });

    var lucro = liquido - despesas;
    $('fin-bruto').textContent = brl(bruto);
    $('fin-taxas').textContent = brl(taxas);
    $('fin-comissao').textContent = brl(comissoes);
    $('fin-liquido').textContent = brl(liquido);
    $('fin-areceber').textContent = brl(aReceber);
    $('fin-despesas').textContent = brl(despesas);
    $('fin-lucro').textContent = brl(lucro);
    $('fin-lucro').style.color = lucro < 0 ? 'var(--vermelho)' : 'var(--verde)';

    $('fin-por-forma').innerHTML = linhasRanking(porForma, 'Nada recebido no período.');
    $('fin-por-cliente').innerHTML = linhasRanking(porCliente, 'Nada recebido no período.');
    $('fin-por-procedimento').innerHTML = linhasRanking(porProc, 'Nada recebido no período.');
    $('fin-descontos').innerHTML = descQtd
      ? '<div class="linha-detalhe"><span>' + descQtd + ' atendimento' + (descQtd > 1 ? 's' : '') + '</span><b>' + brl(descTotal) + '</b></div>'
      : '<div class="vazio">Nenhum desconto no período.</div>';

    renderQuinzenas();

    // recebimentos (atendimentos + receitas avulsas)
    receb.sort(function (a, b) { return String(b.obj.data).localeCompare(String(a.obj.data)); });
    var elR = $('lista-recebimentos');
    if (!receb.length) { elR.innerHTML = '<div class="vazio">Nada no período.</div>'; }
    else {
      elR.innerHTML = receb.map(function (r) {
        var o = r.obj;
        if (r.tipo === 'atendimento') {
          var cls = 'et-' + String(o.status || 'agendado').toLowerCase();
          return '<div class="item"><div class="info">' +
            '<div class="nome">' + esc(o.cliente_nome || '(sem cliente)') + '</div>' +
            '<div class="meta">' + brData(o.data) + '  •  ' + esc(o.procedimento || '') + '</div>' +
            infoPagamento(o) +
            '</div><span class="etiqueta ' + cls + '">' + esc(o.status || 'Agendado') + '</span>' +
            '<div class="acoes">' + (o.pago ? '' : '<button class="btn-mini verde" data-pagar-agenda="' + o.id + '">Receber</button>') + '</div></div>';
        }
        var cls2 = 'et-' + String(o.status || 'pendente').toLowerCase();
        var val = o.valor_realizado || o.valor_previsto || 0;
        return '<div class="item"><div class="info">' +
          '<div class="nome">' + esc(o.descricao || 'Receita') + '</div>' +
          '<div class="meta">' + brData(o.data) + '  •  Receita avulsa' + (o.forma_pagamento ? '  •  ' + esc(o.forma_pagamento) : '') + '</div>' +
          '<div class="meta valor receita">' + brl(val) + (o.status !== 'Pago' ? ' (a receber)' : '') + '</div>' +
          '</div><span class="etiqueta ' + cls2 + '">' + esc(o.status || 'Pendente') + '</span>' +
          '<div class="acoes">' + (o.status !== 'Pago' ? '<button class="btn-mini verde" data-pagar-fin="' + o.id + '">Pago</button>' : '') + '</div></div>';
      }).join('');
    }

    // despesas
    desp.sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
    var elD = $('lista-fin');
    if (!desp.length) { elD.innerHTML = '<div class="vazio">Nenhuma despesa no período.</div>'; }
    else {
      elD.innerHTML = desp.map(function (l) {
        var cls = 'et-' + String(l.status || 'pendente').toLowerCase();
        var val = l.valor_realizado || l.valor_previsto || 0;
        return '<div class="item"><div class="info">' +
          '<div class="nome">' + esc(l.descricao || '') + '</div>' +
          '<div class="meta">' + brData(l.data) + '  •  ' + esc(l.categoria || '') + (l.forma_pagamento ? '  •  ' + esc(l.forma_pagamento) : '') + '</div>' +
          '<div class="meta valor despesa">' + brl(val) + (l.status !== 'Pago' ? ' (a pagar)' : '') + '</div>' +
          '</div><span class="etiqueta ' + cls + '">' + esc(l.status || 'Pendente') + '</span>' +
          '<div class="acoes">' +
          (l.status !== 'Pago' ? '<button class="btn-mini verde" data-pagar-fin="' + l.id + '">Pago</button>' : '') +
          '<button class="btn-mini verde" data-editar-fin="' + l.id + '">Editar</button>' +
          '<button class="btn-mini vermelho" data-excluir-fin="' + l.id + '">Excluir</button>' +
          '</div></div>';
      }).join('');
    }
  }

  function renderQuinzenas() {
    var f = state.filtroMes;
    function noPeriodo(d) { return !f || mesDe(d) === f; }
    var grupos = {};
    state.agendamentos.forEach(function (a) {
      if (!ehSalao(a.recebimento) || a.pago || a.status === 'Cancelado' || !noPeriodo(a.data)) return;
      var q = quinzenaDe(a.data);
      if (!q) return;
      var g = grupos[q] || (grupos[q] = { total: 0, qtd: 0, ids: [] });
      g.total += (a.valor_liquido != null && a.valor_liquido > 0) ? a.valor_liquido : (a.valor_centavos || 0);
      g.qtd++; g.ids.push(a.id);
    });
    var chaves = Object.keys(grupos).sort().reverse();
    var el = $('lista-quinzenas');
    if (!chaves.length) { el.innerHTML = '<div class="vazio">Nada a receber do salão.</div>'; return; }
    el.innerHTML = chaves.map(function (q) {
      var g = grupos[q];
      return '<div class="item"><div class="info">' +
        '<div class="nome">' + rotuloQuinzena(q) + '</div>' +
        '<div class="meta">' + g.qtd + ' atendimento' + (g.qtd > 1 ? 's' : '') + '  •  a receber <b>' + brl(g.total) + '</b></div>' +
        '</div><div class="acoes"><button class="btn-mini verde" data-receber-quinzena="' + q + '">Receber</button></div></div>';
    }).join('');
  }

  function montarGradeCredito() {
    var g = $('aj-credito-grid');
    if (!g) return;
    g.innerHTML = '';
    (CFG.PARCELAS || [1]).forEach(function (n) {
      var div = document.createElement('div');
      var lab = document.createElement('label');
      lab.setAttribute('for', 'aj-credito-' + n);
      lab.textContent = n === 1 ? '1x (à vista)' : n + 'x';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'aj-credito-' + n;
      inp.inputMode = 'decimal';
      inp.placeholder = '0,00';
      div.appendChild(lab);
      div.appendChild(inp);
      g.appendChild(div);
    });
  }

  function renderAjustes() {
    var t = taxasCartao();
    $('aj-debito').value = numFmt(t.debito);
    $('aj-comissao').value = numFmt(comissaoSalao());
    (CFG.PARCELAS || [1]).forEach(function (n) {
      var el = $('aj-credito-' + n);
      if (el) el.value = numFmt(t.credito[n]);
    });
  }

  function renderTudo() {
    sincronizarClienteCombo();
    sincronizarProcedimentoCombo();
    renderListaProcedimentos();
    renderClientes();
    renderAgenda();
    renderFinanceiro();
    $('backup-resumo').innerHTML =
      '<div class="meta">Clientes: <b>' + state.clientes.length + '</b></div>' +
      '<div class="meta">Procedimentos: <b>' + state.procedimentos.length + '</b></div>' +
      '<div class="meta">Atendimentos: <b>' + state.agendamentos.length + '</b></div>' +
      '<div class="meta">Despesas/receitas avulsas: <b>' + state.lancamentos.length + '</b></div>';
  }

  // --------------------------- modo somente leitura ------------------------
  function aplicarModoOffline() {
    var off = !state.online;
    $('aviso-offline').classList.toggle('oculto', !off);
    ['agenda-salvar', 'cliente-salvar', 'proc-salvar', 'fin-salvar', 'aj-salvar', 'btn-exportar', 'btn-exportar-csv'].forEach(function (id) {
      if ($(id)) $(id).disabled = off;
    });
    $('importar-arquivo').disabled = off;
  }

  // --------------------------- snapshot local -----------------------------
  function salvarSnapshot() {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({
        clientes: state.clientes, agendamentos: state.agendamentos,
        lancamentos: state.lancamentos, procedimentos: state.procedimentos, ajustes: state.ajustes
      }));
    } catch (e) { /* ignora cota */ }
  }
  function carregarSnapshot() {
    try {
      var d = JSON.parse(localStorage.getItem(SNAP_KEY) || '{}');
      state.clientes = d.clientes || [];
      state.agendamentos = d.agendamentos || [];
      state.lancamentos = d.lancamentos || [];
      state.procedimentos = d.procedimentos || [];
      if (d.ajustes) state.ajustes = d.ajustes;
    } catch (e) { /* ignora */ }
  }

  // ------------------------------- dados ---------------------------------
  async function carregarTudo() {
    var res = await Promise.all([
      sb.from('clientes').select('*').order('nome', { ascending: true }),
      sb.from('agendamentos').select('*').order('data', { ascending: true }).order('horario', { ascending: true }),
      sb.from('lancamentos').select('*').order('data', { ascending: false }),
      sb.from('procedimentos').select('*').order('nome', { ascending: true })
    ]);
    var erro = res.find(function (r) { return r.error; });
    if (erro) throw erro.error;
    state.clientes = res[0].data || [];
    state.agendamentos = res[1].data || [];
    state.lancamentos = res[2].data || [];
    state.procedimentos = res[3].data || [];
    if (!state.procedimentos.length && state.online) await semearProcedimentos();
    await carregarAjustes();
    salvarSnapshot();
  }

  // Primeira vez: cria os procedimentos sugeridos (sem valor/tempo) para ela editar.
  async function semearProcedimentos() {
    var seeds = (CFG.PROCEDIMENTOS || []).map(function (n) {
      return { nome: n, valor_centavos: 0, duracao_min: 0 };
    });
    if (!seeds.length) return;
    try {
      await sb.from('procedimentos').insert(seeds);
      var r = await sb.from('procedimentos').select('*').order('nome', { ascending: true });
      if (r.data) state.procedimentos = r.data;
      toast('Cadastre valor e tempo dos procedimentos na aba Procedimentos.', 4200);
    } catch (e) { /* ignora */ }
  }

  async function carregarAjustes() {
    var base = { taxas_cartao: Object.assign({}, CFG.TAXAS_CARTAO || {}) };
    try {
      var r = await sb.from('ajustes').select('*');
      if (r.error) throw r.error;
      if (r.data && r.data.length) { state.ajustes = r.data[0]; return; }
      var def = Object.assign({ user_id: usuario && usuario.id }, base);
      var ins = await sb.from('ajustes').insert(def).select();
      state.ajustes = (ins && ins.data && ins.data[0]) || def;
    } catch (e) {
      if (!state.ajustes) state.ajustes = base;
    }
  }

  // ------------------------------ clientes --------------------------------
  function limparFormCliente() {
    $('cliente-id').value = '';
    $('form-cliente').reset();
    $('cliente-form-titulo').textContent = 'Nova cliente';
    $('cliente-salvar').textContent = 'Salvar cliente';
    $('cliente-cancelar').classList.add('oculto');
  }
  async function salvarCliente(ev) {
    ev.preventDefault();
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var id = $('cliente-id').value;
    var dados = {
      nome: $('cliente-nome').value.trim(),
      telefone: $('cliente-telefone').value.trim(),
      instagram: $('cliente-instagram').value.trim(),
      obs: $('cliente-obs').value.trim()
    };
    var r = id ? await sb.from('clientes').update(dados).eq('id', id)
               : await sb.from('clientes').insert(dados);
    if (r.error) return toast('Erro ao salvar: ' + r.error.message);
    limparFormCliente();
    await carregarTudo();
    renderTudo();
    toast(id ? 'Cliente atualizada!' : 'Cliente salva!');
  }

  // ---------------------------- procedimentos ------------------------------
  function limparFormProcedimento() {
    $('proc-id').value = '';
    $('form-procedimento').reset();
    $('proc-form-titulo').textContent = 'Novo procedimento';
    $('proc-salvar').textContent = 'Salvar procedimento';
    $('proc-cancelar').classList.add('oculto');
  }
  async function salvarProcedimento(ev) {
    ev.preventDefault();
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var id = $('proc-id').value;
    var dados = {
      nome: $('proc-nome').value.trim(),
      valor_centavos: parseMoeda($('proc-valor').value),
      duracao_min: parseInt($('proc-duracao').value || '0', 10) || 0
    };
    var r = id ? await sb.from('procedimentos').update(dados).eq('id', id)
               : await sb.from('procedimentos').insert(dados);
    if (r.error) return toast('Erro ao salvar: ' + r.error.message);
    limparFormProcedimento();
    await carregarTudo();
    renderTudo();
    toast(id ? 'Procedimento atualizado!' : 'Procedimento salvo!');
  }

  // --------------------------- agenda / atendimento -----------------------
  function toggleParcelas() {
    var ehC = ehCredito($('agenda-forma').value);
    $('campo-parcelas').classList.toggle('oculto', !ehC);
  }
  function valorComDesconto() {
    var base = parseMoeda($('agenda-valor').value);
    var pct = Math.max(0, Math.min(100, parseNum($('agenda-desconto').value)));
    var desc = Math.round(base * pct / 100);
    return { base: base, pct: pct, desconto: desc, final: base - desc };
  }
  // Junta desconto + taxa do cartão (ou comissão do salão) num só lugar.
  function calcularRepasse() {
    var v = valorComDesconto();
    var para = ehSalao($('agenda-recebimento').value);
    var forma = $('agenda-forma').value;
    var parcelas = ehCredito(forma) ? parseInt($('agenda-parcelas').value || '1', 10) : 1;
    var comissaoPct = para ? comissaoSalao() : 0;
    var comissao = Math.round(v.final * comissaoPct / 100);
    var tx = (!para && ehCartao(forma)) ? calcularTaxa(forma, parcelas, v.final) : { pct: 0, taxa: 0, liquido: v.final };
    return { v: v, para: para, comissaoPct: comissaoPct, comissao: comissao, tx: tx, liquido: v.final - comissao - tx.taxa };
  }
  function atualizarTaxaInfo() {
    var partes = [];
    var p = procedimentoPor($('agenda-procedimento').value);
    if (p) {
      var det = [p.duracao_min ? durFmt(p.duracao_min) : '', p.valor_centavos ? brl(p.valor_centavos) : ''].filter(Boolean);
      partes.push('<b>' + esc(p.nome) + '</b>' + (det.length ? ' &bull; ' + det.join(' &bull; ') : ''));
    }
    var v = valorComDesconto();
    if (v.pct > 0) partes.push('Desconto ' + numFmt(v.pct) + '% = ' + brl(v.desconto) + ' &bull; total <b>' + brl(v.final) + '</b>');
    var r = calcularRepasse();
    if (r.v.final > 0) {
      if (r.para) {
        partes.push('Salão fica ' + numFmt(r.comissaoPct) + '% = ' + brl(r.comissao) + ' &bull; você recebe <b>' + brl(r.liquido) + '</b>');
      } else if (ehCartao($('agenda-forma').value)) {
        partes.push('Taxa ' + numFmt(r.tx.pct) + '% = ' + brl(r.tx.taxa) + ' &bull; você recebe <b>' + brl(r.liquido) + '</b>');
      } else {
        partes.push('Você recebe <b>' + brl(r.liquido) + '</b>');
      }
    }
    var box = $('agenda-taxa');
    if (!partes.length) { box.classList.add('oculto'); box.innerHTML = ''; return; }
    box.classList.remove('oculto');
    box.innerHTML = partes.join('<br>');
  }

  function limparFormAgenda() {
    $('agenda-id').value = '';
    $('form-agenda').reset();
    limparClienteBusca();
    limparProcedimentoBusca();
    $('agenda-situacao').value = 'Agendado';
    $('agenda-forma').value = 'Pix';
    $('agenda-recebimento').value = 'Direto';
    $('agenda-parcelas').value = '1';
    $('agenda-form-titulo').textContent = 'Novo atendimento';
    $('agenda-salvar').textContent = 'Adicionar à agenda';
    $('agenda-cancelar').classList.add('oculto');
    toggleParcelas();
    atualizarTaxaInfo();
  }
  async function salvarAgenda(ev) {
    ev.preventDefault();
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var id = $('agenda-id').value;
    var clienteId = $('agenda-cliente').value;
    var cliente = clienteId ? clientePorId(clienteId) : null;
    var nomeDigitado = $('agenda-cliente-busca').value.trim();
    if (!cliente && !nomeDigitado) return toast('Escolha ou digite a cliente.');
    var proc = ($('agenda-procedimento').value || $('agenda-procedimento-busca').value).trim();
    if (!proc) return toast('Escolha ou digite o procedimento.');
    var rep = calcularRepasse();
    var v = rep.v;
    var forma = $('agenda-forma').value;
    var parcelas = ehCredito(forma) ? parseInt($('agenda-parcelas').value || '1', 10) : 1;
    var dados = {
      cliente_id: cliente ? cliente.id : null,
      cliente_nome: cliente ? cliente.nome : nomeDigitado,
      procedimento: proc,
      data: $('agenda-data').value || null,
      horario: $('agenda-horario').value || '',
      valor_centavos: v.final,
      valor_bruto_centavos: v.base,
      desconto_pct: v.pct,
      desconto_centavos: v.desconto,
      forma_pagamento: forma,
      parcelas: parcelas,
      recebimento: rep.para ? 'Salão' : 'Direto',
      comissao_pct: rep.comissaoPct,
      comissao_centavos: rep.comissao,
      taxa_pct: rep.tx.pct,
      taxa_centavos: rep.tx.taxa,
      valor_liquido: rep.liquido,
      pago: $('agenda-pago').checked,
      status: $('agenda-situacao').value,
      obs: $('agenda-obs').value.trim()
    };
    var r = id ? await sb.from('agendamentos').update(dados).eq('id', id)
               : await sb.from('agendamentos').insert(dados);
    if (r.error) return toast('Erro ao salvar: ' + r.error.message);
    limparFormAgenda();
    await carregarTudo();
    renderTudo();
    toast(id ? 'Atendimento atualizado!' : 'Atendimento salvo!');
  }
  function pagarAgenda(id) {
    if (!state.online) return toast('Sem internet.');
    var a = state.agendamentos.find(function (x) { return x.id === id; }); if (!a) return;
    var dados = { pago: true, status: 'Atendido', recebido_em: hojeISO() };
    if (ehSalao(a.recebimento)) {
      var pct = numero(a.comissao_pct, comissaoSalao());
      dados.comissao_pct = pct;
      dados.comissao_centavos = Math.round((a.valor_centavos || 0) * pct / 100);
      dados.taxa_pct = 0; dados.taxa_centavos = 0;
      dados.valor_liquido = (a.valor_centavos || 0) - dados.comissao_centavos;
    } else {
      var parcelas = ehCredito(a.forma_pagamento) ? (a.parcelas || 1) : 1;
      var tx = calcularTaxa(a.forma_pagamento || 'Pix', parcelas, a.valor_centavos || 0);
      dados.taxa_pct = tx.pct; dados.taxa_centavos = tx.taxa; dados.valor_liquido = tx.liquido;
      dados.comissao_pct = 0; dados.comissao_centavos = 0;
    }
    sb.from('agendamentos').update(dados).eq('id', id).then(async function (r) {
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo();
      toast('Recebido! ' + brl(dados.valor_liquido) + (dados.taxa_centavos > 0 ? ' (taxa ' + brl(dados.taxa_centavos) + ')' : ''));
    });
  }
  function receberQuinzena(q) {
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var ids = state.agendamentos.filter(function (a) {
      return ehSalao(a.recebimento) && !a.pago && a.status !== 'Cancelado' && quinzenaDe(a.data) === q;
    }).map(function (a) { return a.id; });
    if (!ids.length) return;
    confirmar('Confirmar que o salão já pagou a ' + rotuloQuinzena(q) + '?', async function () {
      for (var i = 0; i < ids.length; i++) {
        var r = await sb.from('agendamentos').update({ pago: true, status: 'Atendido', recebido_em: hojeISO() }).eq('id', ids[i]);
        if (r.error) return toast('Erro: ' + r.error.message);
      }
      await carregarTudo(); renderTudo();
      toast('Quinzena recebida!');
    });
  }

  // ---------------------------- despesas ----------------------------------
  function limparFormFin() {
    $('fin-id').value = '';
    $('form-fin').reset();
    $('fin-data').value = hojeISO();
    $('fin-tipo').value = 'Despesa';
    atualizarCategoriasFin();
    $('fin-form-titulo').textContent = 'Nova despesa';
    $('fin-salvar').textContent = 'Salvar';
    $('fin-cancelar').classList.add('oculto');
  }
  async function salvarFin(ev) {
    ev.preventDefault();
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var id = $('fin-id').value;
    var dados = {
      data: $('fin-data').value || null,
      tipo: $('fin-tipo').value,
      categoria: $('fin-categoria').value,
      descricao: $('fin-descricao').value.trim(),
      profissional: $('fin-profissional').value,
      forma_pagamento: $('fin-forma').value,
      valor_previsto: parseMoeda($('fin-previsto').value),
      valor_realizado: parseMoeda($('fin-realizado').value),
      status: $('fin-status').value,
      obs: $('fin-obs').value.trim()
    };
    var r = id ? await sb.from('lancamentos').update(dados).eq('id', id)
               : await sb.from('lancamentos').insert(dados);
    if (r.error) return toast('Erro ao salvar: ' + r.error.message);
    limparFormFin();
    await carregarTudo();
    renderTudo();
    toast(id ? 'Lançamento atualizado!' : 'Lançamento salvo!');
  }
  function pagarFin(id) {
    if (!state.online) return toast('Sem internet.');
    var l = state.lancamentos.find(function (x) { return x.id === id; }); if (!l) return;
    var dados = { status: 'Pago', valor_realizado: l.valor_realizado || l.valor_previsto || 0 };
    sb.from('lancamentos').update(dados).eq('id', id).then(async function (r) {
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo(); toast('Marcado como pago.');
    });
  }

  // ------------------------------ ajustes ----------------------------------
  async function salvarTaxas() {
    if (!state.online) return toast('Sem internet — não foi possível salvar.');
    var credito = {};
    (CFG.PARCELAS || [1]).forEach(function (n) {
      var el = $('aj-credito-' + n);
      credito[n] = el ? parseNum(el.value) : 0;
    });
    var taxas = { debito: parseNum($('aj-debito').value), credito: credito };
    var comissao = parseNum($('aj-comissao').value);
    var r = await sb.from('ajustes').upsert({ user_id: usuario && usuario.id, taxas_cartao: taxas, comissao_salao: comissao });
    if (r.error) return toast('Erro ao salvar: ' + r.error.message);
    state.ajustes = Object.assign({}, state.ajustes, { taxas_cartao: taxas, comissao_salao: comissao });
    renderAjustes(); atualizarTaxaInfo();
    toast('Taxas salvas!');
  }

  // ------------------------------- backup ---------------------------------
  function baixar(nome, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function exportarJSON() {
    var pacote = { app: CFG.APP_NOME || 'Clinica', versao: 3, geradoEm: new Date().toISOString(),
      clientes: state.clientes, procedimentos: state.procedimentos, agendamentos: state.agendamentos, lancamentos: state.lancamentos, ajustes: state.ajustes };
    baixar('backup-malena-' + hojeISO() + '.json', JSON.stringify(pacote, null, 2));
    toast('Backup exportado!');
  }
  function exportarCSV() {
    var linhas = [['origem', 'data', 'cliente', 'descricao', 'categoria', 'forma', 'bruto', 'taxa', 'liquido', 'status']];
    state.agendamentos.forEach(function (a) {
      linhas.push(['Atendimento', a.data || '', a.cliente_nome || '', a.procedimento || '', '', a.forma_pagamento || '',
        ((a.valor_centavos || 0) / 100).toFixed(2).replace('.', ','), ((a.taxa_centavos || 0) / 100).toFixed(2).replace('.', ','),
        ((a.valor_liquido || 0) / 100).toFixed(2).replace('.', ','), a.pago ? 'Pago' : (a.status || '')]);
    });
    state.lancamentos.forEach(function (l) {
      linhas.push([l.tipo || '', l.data || '', '', l.descricao || '', l.categoria || '', l.forma_pagamento || '',
        ((l.valor_previsto || 0) / 100).toFixed(2).replace('.', ','), '', ((l.valor_realizado || 0) / 100).toFixed(2).replace('.', ','), l.status || '']);
    });
    var csv = linhas.map(function (c) { return c.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    baixar('financeiro-malena-' + hojeISO() + '.csv', '\ufeff' + csv, 'text/csv');
    toast('CSV exportado!');
  }
  async function importarJSON(arquivo) {
    if (!state.online) return toast('Sem internet — não foi possível importar.');
    var texto = await arquivo.text();
    var d;
    try { d = JSON.parse(texto); } catch (e) { return toast('Arquivo inválido.'); }
    confirmar('Importar este backup? Os registros serão adicionados/atualizados na nuvem.', async function () {
      try {
        if ((d.clientes || []).length) { var r1 = await sb.from('clientes').upsert(d.clientes); if (r1.error) throw r1.error; }
        if ((d.procedimentos || []).length) { var rp = await sb.from('procedimentos').upsert(d.procedimentos); if (rp.error) throw rp.error; }
        if ((d.agendamentos || []).length) { var r2 = await sb.from('agendamentos').upsert(d.agendamentos); if (r2.error) throw r2.error; }
        if ((d.lancamentos || []).length) { var r3 = await sb.from('lancamentos').upsert(d.lancamentos); if (r3.error) throw r3.error; }
        if (d.ajustes) { var r4 = await sb.from('ajustes').upsert(d.ajustes); if (r4.error) throw r4.error; }
        await carregarTudo(); renderTudo(); renderAjustes();
        toast('Backup importado!');
      } catch (e) { toast('Erro ao importar: ' + e.message); }
    });
  }

  // ------------------------------- eventos --------------------------------
  function abrirAba(nome) {
    var b = document.querySelector('.aba[data-tab="' + nome + '"]');
    if (!b) return;
    document.querySelectorAll('.aba').forEach(function (x) { x.classList.remove('ativa'); });
    b.classList.add('ativa');
    ['agenda', 'clientes', 'procedimentos', 'financeiro', 'ajustes', 'backup'].forEach(function (t) {
      $('tab-' + t).classList.toggle('oculto', t !== nome);
    });
  }

  function ligarEventos() {
    document.querySelectorAll('.aba').forEach(function (b) {
      b.onclick = function () { abrirAba(b.dataset.tab); };
    });

    $('form-cliente').onsubmit = salvarCliente;
    $('cliente-cancelar').onclick = limparFormCliente;
    $('cliente-busca').oninput = renderClientes;

    $('form-procedimento').onsubmit = salvarProcedimento;
    $('proc-cancelar').onclick = limparFormProcedimento;

    $('form-agenda').onsubmit = salvarAgenda;
    $('agenda-cancelar').onclick = limparFormAgenda;
    $('agenda-busca').oninput = renderAgenda;
    $('agenda-forma').onchange = function () { toggleParcelas(); atualizarTaxaInfo(); };
    $('agenda-parcelas').onchange = atualizarTaxaInfo;
    $('agenda-valor').oninput = atualizarTaxaInfo;
    $('agenda-desconto').oninput = atualizarTaxaInfo;
    $('agenda-recebimento').onchange = atualizarTaxaInfo;

    $('form-fin').onsubmit = salvarFin;
    $('fin-cancelar').onclick = limparFormFin;
    $('fin-tipo').onchange = atualizarCategoriasFin;

    $('fin-mes').onchange = function () { state.filtroMes = $('fin-mes').value; renderFinanceiro(); };

    $('aj-salvar').onclick = salvarTaxas;

    $('btn-exportar').onclick = exportarJSON;
    $('btn-exportar-csv').onclick = exportarCSV;
    $('importar-arquivo').onchange = function (e) { if (e.target.files[0]) importarJSON(e.target.files[0]); e.target.value = ''; };

    $('btn-atualizar').onclick = async function () {
      if (!state.online) return toast('Sem internet.');
      try { await carregarTudo(); renderTudo(); renderAjustes(); toast('Dados atualizados!'); }
      catch (e) { toast('Erro ao atualizar: ' + e.message); }
    };
    $('btn-sair').onclick = function () {
      confirmar('Sair da conta?', async function () { await sb.auth.signOut(); });
    };

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      var d;
      if ((d = t.dataset.cliente)) selecionarCliente(d);
      else if ((d = t.dataset.procedimento)) selecionarProcedimento(d);
      else if ((d = t.dataset.editarCliente)) editarCliente(d);
      else if ((d = t.dataset.excluirCliente)) excluirCliente(d);
      else if ((d = t.dataset.editarProcedimento)) editarProcedimento(d);
      else if ((d = t.dataset.excluirProcedimento)) excluirProcedimento(d);
      else if ((d = t.dataset.editarAgenda)) editarAgenda(d);
      else if ((d = t.dataset.excluirAgenda)) excluirAgenda(d);
      else if ((d = t.dataset.pagarAgenda)) pagarAgenda(d);
      else if ((d = t.dataset.receberQuinzena)) receberQuinzena(d);
      else if ((d = t.dataset.editarFin)) editarFin(d);
      else if ((d = t.dataset.excluirFin)) excluirFin(d);
      else if ((d = t.dataset.pagarFin)) pagarFin(d);
    });

    window.addEventListener('online', function () { state.online = true; aplicarModoOffline(); toast('Conectado!'); });
    window.addEventListener('offline', function () { state.online = false; aplicarModoOffline(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.online && state.pronto) {
        carregarTudo().then(function () { renderTudo(); renderAjustes(); }).catch(function () {});
      }
    });
  }

  function editarCliente(id) {
    var c = state.clientes.find(function (x) { return x.id === id; }); if (!c) return;
    $('cliente-id').value = c.id;
    $('cliente-nome').value = c.nome || '';
    $('cliente-telefone').value = c.telefone || '';
    $('cliente-instagram').value = c.instagram || '';
    $('cliente-obs').value = c.obs || '';
    $('cliente-form-titulo').textContent = 'Editar cliente';
    $('cliente-salvar').textContent = 'Atualizar cliente';
    $('cliente-cancelar').classList.remove('oculto');
    abrirAba('clientes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function excluirCliente(id) {
    if (!state.online) return toast('Sem internet.');
    confirmar('Excluir esta cliente?', async function () {
      var r = await sb.from('clientes').delete().eq('id', id);
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo(); toast('Cliente excluída.');
    });
  }
  function editarProcedimento(id) {
    var p = state.procedimentos.find(function (x) { return x.id === id; }); if (!p) return;
    $('proc-id').value = p.id;
    $('proc-nome').value = p.nome || '';
    $('proc-valor').value = moedaInput(p.valor_centavos);
    $('proc-duracao').value = p.duracao_min || '';
    $('proc-form-titulo').textContent = 'Editar procedimento';
    $('proc-salvar').textContent = 'Atualizar procedimento';
    $('proc-cancelar').classList.remove('oculto');
    abrirAba('procedimentos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function excluirProcedimento(id) {
    if (!state.online) return toast('Sem internet.');
    confirmar('Excluir este procedimento?', async function () {
      var r = await sb.from('procedimentos').delete().eq('id', id);
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo(); toast('Procedimento excluído.');
    });
  }
  function editarAgenda(id) {
    var a = state.agendamentos.find(function (x) { return x.id === id; }); if (!a) return;
    $('agenda-id').value = a.id;
    var cli = a.cliente_id ? clientePorId(a.cliente_id) : null;
    $('agenda-cliente').value = cli ? cli.id : '';
    $('agenda-cliente-busca').value = cli ? (cli.nome || '') : (a.cliente_nome || '');
    $('agenda-procedimento').value = a.procedimento || '';
    $('agenda-procedimento-busca').value = a.procedimento || '';
    $('agenda-data').value = (a.data || '').substring(0, 10);
    $('agenda-horario').value = (a.horario || '').substring(0, 5);
    $('agenda-valor').value = moedaInput(a.valor_bruto_centavos || a.valor_centavos);
    $('agenda-desconto').value = a.desconto_pct ? numFmt(a.desconto_pct) : '';
    $('agenda-recebimento').value = ehSalao(a.recebimento) ? 'Salão' : 'Direto';
    $('agenda-forma').value = a.forma_pagamento || 'Pix';
    $('agenda-parcelas').value = String(a.parcelas || 1);
    $('agenda-situacao').value = a.status || 'Agendado';
    $('agenda-pago').checked = !!a.pago;
    $('agenda-obs').value = a.obs || '';
    $('agenda-form-titulo').textContent = 'Editar atendimento';
    $('agenda-salvar').textContent = 'Atualizar atendimento';
    $('agenda-cancelar').classList.remove('oculto');
    toggleParcelas(); atualizarTaxaInfo();
    abrirAba('agenda');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function excluirAgenda(id) {
    if (!state.online) return toast('Sem internet.');
    confirmar('Excluir este atendimento?', async function () {
      var r = await sb.from('agendamentos').delete().eq('id', id);
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo(); toast('Atendimento excluído.');
    });
  }
  function editarFin(id) {
    var l = state.lancamentos.find(function (x) { return x.id === id; }); if (!l) return;
    $('fin-id').value = l.id;
    $('fin-tipo').value = l.tipo || 'Despesa';
    atualizarCategoriasFin();
    $('fin-categoria').value = l.categoria || '';
    $('fin-data').value = (l.data || '').substring(0, 10);
    $('fin-profissional').value = l.profissional || '';
    $('fin-forma').value = l.forma_pagamento || '';
    $('fin-status').value = l.status || 'Pendente';
    $('fin-previsto').value = moedaInput(l.valor_previsto);
    $('fin-realizado').value = moedaInput(l.valor_realizado);
    $('fin-descricao').value = l.descricao || '';
    $('fin-obs').value = l.obs || '';
    $('fin-form-titulo').textContent = 'Editar lançamento';
    $('fin-salvar').textContent = 'Atualizar';
    $('fin-cancelar').classList.remove('oculto');
    abrirAba('financeiro');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function excluirFin(id) {
    if (!state.online) return toast('Sem internet.');
    confirmar('Excluir este lançamento?', async function () {
      var r = await sb.from('lancamentos').delete().eq('id', id);
      if (r.error) return toast('Erro: ' + r.error.message);
      await carregarTudo(); renderTudo(); toast('Lançamento excluído.');
    });
  }

  // -------------------------------- login ---------------------------------
  function ligarLogin() {
    // Lembra o e-mail do último acesso (guardado só no aparelho, nunca no site).
    try { var lembrado = localStorage.getItem('mm_email'); if (lembrado) $('login-email').value = lembrado; } catch (e) {}
    $('form-login').onsubmit = async function (ev) {
      ev.preventDefault();
      var msg = $('login-msg'); msg.classList.add('oculto');
      var email = $('login-email').value.trim();
      var btn = $('login-entrar'); btn.disabled = true; btn.textContent = 'Entrando...';
      var r = await sb.auth.signInWithPassword({ email: email, password: $('login-senha').value });
      btn.disabled = false; btn.textContent = 'Entrar';
      if (r.error) { msg.textContent = 'Não foi possível entrar: ' + r.error.message; msg.classList.remove('oculto'); }
      else { try { localStorage.setItem('mm_email', email); } catch (e) {} }
    };
  }

  async function aoEntrar(sessao) {
    usuario = sessao && sessao.user ? sessao.user : null;
    if (!usuario) { mostrarTela('tela-login'); return; }
    $('app-usuario').textContent = usuario.email || '';
    mostrarTela('tela-app');
    carregarSnapshot(); renderTudo();
    if (state.online) {
      try { await carregarTudo(); renderTudo(); } catch (e) { toast('Erro ao carregar: ' + e.message); }
    }
    renderAjustes();
    limparFormAgenda();
    state.pronto = true;
    aplicarModoOffline();
  }

  // ------------------------------ modo prévia ------------------------------
  // Ativado com ?demo na URL (ou window.FORCAR_DEMO): dados de exemplo, sem nuvem.
  function criarDemo() {
    var ajustes = {
      id: 'aj1', user_id: 'u1',
      taxas_cartao: { debito: 1.99, credito: { 1: 3.99, 2: 5.49, 3: 6.99 } },
      comissao_salao: 30
    };
    var dados = {
      procedimentos: [
        { id: 'p1', nome: 'Alongamento em gel', valor_centavos: 18000, duracao_min: 120 },
        { id: 'p2', nome: 'Alongamento acrílico', valor_centavos: 20000, duracao_min: 150 },
        { id: 'p3', nome: 'Manutenção de alongamento', valor_centavos: 9000, duracao_min: 75 },
        { id: 'p4', nome: 'Banho de gel', valor_centavos: 10000, duracao_min: 60 },
        { id: 'p5', nome: 'Blindagem', valor_centavos: 8000, duracao_min: 60 },
        { id: 'p6', nome: 'Esmaltação em gel', valor_centavos: 6000, duracao_min: 45 },
        { id: 'p7', nome: 'Francesinha', valor_centavos: 5000, duracao_min: 40 },
        { id: 'p8', nome: 'Decoração / nail art', valor_centavos: 3000, duracao_min: 20 },
        { id: 'p9', nome: 'Manicure simples', valor_centavos: 4000, duracao_min: 40 },
        { id: 'p10', nome: 'Pedicure', valor_centavos: 5000, duracao_min: 50 },
        { id: 'p11', nome: 'Pé e mão (combo)', valor_centavos: 8000, duracao_min: 80 },
        { id: 'p12', nome: 'Spa dos pés', valor_centavos: 9000, duracao_min: 60 }
      ],
      clientes: [
        { id: 'c1', nome: 'Maria Souza', telefone: '(85) 99911-2233', instagram: '@maria.souza', obs: '' },
        { id: 'c2', nome: 'Juliana Prado', telefone: '(85) 98822-3344', instagram: '@ju.prado', obs: 'Prefere rosa claro' },
        { id: 'c3', nome: 'Carla Nunes', telefone: '(85) 97733-4455', instagram: '@carlanunes', obs: '' },
        { id: 'c4', nome: 'Ana Beatriz', telefone: '(85) 99944-1122', instagram: '@anabeatriz', obs: '' },
        { id: 'c5', nome: 'Fernanda Lima', telefone: '(85) 98855-2233', instagram: '@fer.lima', obs: '' },
        { id: 'c6', nome: 'Patrícia Gomes', telefone: '(85) 97766-3344', instagram: '@patygomes', obs: '' },
        { id: 'c7', nome: 'Larissa Alves', telefone: '(85) 96677-4455', instagram: '@lari.alves', obs: '' },
        { id: 'c8', nome: 'Renata Dias', telefone: '(85) 95588-5566', instagram: '@renatadias', obs: '' },
        { id: 'c9', nome: 'Sofia Martins', telefone: '(85) 94499-6677', instagram: '@sofia.martins', obs: '' }
      ],
      agendamentos: [
        { id: 'a1', cliente_id: 'c1', cliente_nome: 'Maria Souza', procedimento: 'Alongamento em gel', data: '2026-11-12', horario: '14:00', valor_centavos: 16200, valor_bruto_centavos: 18000, desconto_pct: 10, desconto_centavos: 1800, forma_pagamento: 'Cartão de crédito', parcelas: 3, recebimento: 'Direto', taxa_pct: 6.99, taxa_centavos: 1132, comissao_pct: 0, comissao_centavos: 0, valor_liquido: 15068, pago: true, status: 'Atendido', obs: '' },
        { id: 'a2', cliente_id: 'c2', cliente_nome: 'Juliana Prado', procedimento: 'Manutenção de alongamento', data: '2026-11-13', horario: '10:00', valor_centavos: 9000, forma_pagamento: 'Pix', parcelas: 1, recebimento: 'Direto', taxa_pct: 0, taxa_centavos: 0, comissao_pct: 0, comissao_centavos: 0, valor_liquido: 9000, pago: true, status: 'Atendido', obs: '' },
        { id: 'a3', cliente_id: 'c3', cliente_nome: 'Carla Nunes', procedimento: 'Pé e mão (combo)', data: '2026-11-14', horario: '16:30', valor_centavos: 12000, forma_pagamento: 'Cartão de débito', parcelas: 1, recebimento: 'Direto', taxa_pct: 1.99, taxa_centavos: 239, comissao_pct: 0, comissao_centavos: 0, valor_liquido: 11761, pago: false, status: 'Agendado', obs: '' },
        { id: 'a4', cliente_id: 'c1', cliente_nome: 'Maria Souza', procedimento: 'Banho de gel', data: '2026-11-10', horario: '11:00', valor_centavos: 10000, forma_pagamento: 'Dinheiro', parcelas: 1, recebimento: 'Salão', taxa_pct: 0, taxa_centavos: 0, comissao_pct: 30, comissao_centavos: 3000, valor_liquido: 7000, pago: false, status: 'Agendado', obs: '' },
        { id: 'a5', cliente_id: 'c2', cliente_nome: 'Juliana Prado', procedimento: 'Esmaltação em gel', data: '2026-11-05', horario: '09:30', valor_centavos: 6000, forma_pagamento: 'Pix', parcelas: 1, recebimento: 'Salão', taxa_pct: 0, taxa_centavos: 0, comissao_pct: 30, comissao_centavos: 1800, valor_liquido: 4200, pago: true, status: 'Atendido', obs: '' },
        { id: 'a6', cliente_id: 'c3', cliente_nome: 'Carla Nunes', procedimento: 'Pedicure', data: '2026-11-18', horario: '15:00', valor_centavos: 5000, forma_pagamento: 'Pix', parcelas: 1, recebimento: 'Salão', taxa_pct: 0, taxa_centavos: 0, comissao_pct: 30, comissao_centavos: 1500, valor_liquido: 3500, pago: false, status: 'Agendado', obs: '' }
      ],
      lancamentos: [
        { id: 'l1', data: '2026-11-05', tipo: 'Despesa', categoria: 'Produtos e materiais', descricao: 'Compra de géis e tips', profissional: '', forma_pagamento: 'Pix', valor_previsto: 11500, valor_realizado: 11500, status: 'Pago', obs: '' },
        { id: 'l2', data: '2026-11-10', tipo: 'Despesa', categoria: 'Aluguel', descricao: 'Aluguel do espaço', profissional: '', forma_pagamento: '', valor_previsto: 80000, valor_realizado: 0, status: 'Pendente', obs: '' },
        { id: 'l3', data: '2026-11-14', tipo: 'Receita', categoria: 'Venda de produto', descricao: 'Venda de óleo para cutícula', profissional: 'Malena', forma_pagamento: 'Dinheiro', valor_previsto: 4500, valor_realizado: 4500, status: 'Pago', obs: '' }
      ],
      ajustes: [ajustes]
    };
    // Sincroniza a taxa dos atendimentos com a config atual (evita números "magicos")
    dados.agendamentos.forEach(function (a) {
      if (ehSalao(a.recebimento)) {
        var pct = (a.comissao_pct != null) ? a.comissao_pct : 30;
        a.comissao_pct = pct;
        a.comissao_centavos = Math.round((a.valor_centavos || 0) * pct / 100);
        a.taxa_pct = 0; a.taxa_centavos = 0;
        a.valor_liquido = (a.valor_centavos || 0) - a.comissao_centavos;
      } else {
        var tx = calcularTaxa(a.forma_pagamento, a.parcelas, a.valor_centavos);
        a.taxa_pct = tx.pct; a.taxa_centavos = tx.taxa;
        a.comissao_pct = 0; a.comissao_centavos = 0;
        a.valor_liquido = tx.liquido;
      }
    });

    var seq = 1000;
    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    function from(nome) {
      var pendente = null, resultado = null;
      var api = {};
      api.select = function () { return api; };
      api.order = function () { return api; };
      api.insert = function (obj) {
        var item = Object.assign({ id: 'd' + (seq++) }, obj);
        dados[nome].push(item);
        resultado = { data: [item], error: null };
        return api;
      };
      api.upsert = function (entrada) {
        var lista = Array.isArray(entrada) ? entrada : [entrada];
        lista.forEach(function (o) {
          var i = dados[nome].findIndex(function (x) {
            return (o.id && x.id === o.id) || (o.user_id && x.user_id === o.user_id);
          });
          if (i >= 0) dados[nome][i] = Object.assign({}, dados[nome][i], o);
          else dados[nome].push(o);
        });
        return Promise.resolve({ data: null, error: null });
      };
      api.update = function (obj) { pendente = { tipo: 'u', payload: obj }; return api; };
      api.delete = function () { pendente = { tipo: 'd' }; return api; };
      api.eq = function (col, val) {
        if (pendente && pendente.tipo === 'u') {
          dados[nome].forEach(function (x) { if (x[col] === val) Object.assign(x, pendente.payload); });
        } else if (pendente && pendente.tipo === 'd') {
          dados[nome] = dados[nome].filter(function (x) { return x[col] !== val; });
        }
        return Promise.resolve({ data: null, error: null });
      };
      api.then = function (res) { return Promise.resolve(resultado || { data: clone(dados[nome]), error: null }).then(res); };
      return api;
    }

    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'u1', email: 'prévia' } } } }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
        signOut: function () { location.reload(); return Promise.resolve({}); }
      },
      from: from
    };
  }

  // --------------------------------- init ---------------------------------
  async function init() {
    aplicarTema();
    aplicarModoOffline();
    preencherSelects();
    montarGradeCredito();
    ligarComboboxCliente();
    ligarComboboxProcedimento();
    ligarLogin();
    ligarEventos();

    var abaInicial = new URLSearchParams(location.search).get('aba');
    if (abaInicial) abrirAba(abaInicial);

    var demo = window.FORCAR_DEMO === true || new URLSearchParams(location.search).has('demo');
    if (demo) {
      sb = criarDemo();
      $('aviso-demo').classList.remove('oculto');
      await aoEntrar({ user: { id: 'u1', email: 'prévia' } });
      return;
    }

    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) {
      mostrarTela('tela-config');
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    var s = await sb.auth.getSession();
    await aoEntrar(s.data.session);

    sb.auth.onAuthStateChange(function (_ev, sessao) { aoEntrar(sessao); });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
