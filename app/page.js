'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';

const STORAGE_KEY = 'escarlate-finder-v1';

const FIELD_DEFS = [
  { key: 'name', label: 'Nome / Empresa', icon: '🏷️' },
  { key: 'phone', label: 'Telefone / WhatsApp', icon: '📞' },
  { key: 'instagram', label: 'Instagram', icon: '📷' },
  { key: 'website', label: 'Site', icon: '🌐' },
  { key: 'email', label: 'E-mail', icon: '✉️' },
  { key: 'category', label: 'Categoria', icon: '📂' },
  { key: 'address', label: 'Endereço / Cidade', icon: '📍' },
];

const EMPTY_VALUES = new Set([
  '', '-', '--', '---', 'n/a', 'na', 'nao', 'não', 'sem site',
  'sem', 'null', 'undefined', 'none',
]);

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'no-site', label: 'Sem site' },
  { key: 'with-site', label: 'Com site' },
  { key: 'pending', label: 'Não contatados' },
  { key: 'contacted', label: 'Contatados' },
];

/* ---------------- helpers ---------------- */

function hasValue(value) {
  if (value === null || value === undefined) return false;
  return !EMPTY_VALUES.has(String(value).trim().toLowerCase());
}

function normalizeHeader(header) {
  return String(header)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function detectMapping(headers) {
  const find = (keys) =>
    headers.find((header) => {
      const n = normalizeHeader(header);
      return keys.some((key) => n === key || n.includes(key));
    }) || '';

  return {
    name: find(['nome', 'name', 'empresa', 'cliente', 'negocio', 'business', 'titulo']),
    phone: find(['whatsapp', 'telefone', 'phone', 'celular', 'fone', 'tel', 'contato']),
    instagram: find(['instagram', 'insta', 'ig']),
    website: find(['website', 'site', 'url', 'dominio', 'homepage', 'web']),
    email: find(['email', 'e-mail']),
    category: find(['categoria', 'segmento', 'nicho', 'ramo', 'tipo', 'category']),
    address: find(['endereco', 'address', 'cidade', 'bairro', 'local', 'city']),
  };
}

function buildWhatsApp(phone, message) {
  if (!hasValue(phone)) return null;
  let digits = String(phone).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  if (!digits.startsWith('55') || digits.length < 12) digits = '55' + digits;
  const base = `https://wa.me/${digits}`;
  const text = (message || '').trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function buildInstagram(value) {
  if (!hasValue(value)) return null;
  const raw = String(value).trim();
  if (/instagram\.com/i.test(raw)) {
    return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  }
  const handle = raw.replace(/^@+/, '').replace(/\s+/g, '');
  if (!handle) return null;
  return 'https://instagram.com/' + handle;
}

function instagramHandle(value) {
  if (!hasValue(value)) return null;
  let s = String(value).trim().replace(/\/+$/, '');
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
  s = s.replace(/^@+/, '');
  return s || null;
}

function buildSite(value) {
  if (!hasValue(value)) return null;
  const s = String(value).trim();
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

function downloadFile(filename, content) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- componente ---------------- */

export default function Page() {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({});
  const [waMessage, setWaMessage] = useState('');
  const [showMapping, setShowMapping] = useState(false);
  const [openNote, setOpenNote] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const storageLoaded = useRef(false);

  /* ---- persistência ---- */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.status) setStatus(parsed.status);
        if (typeof parsed.waMessage === 'string') setWaMessage(parsed.waMessage);
      }
    } catch {
      /* ignora */
    }
    storageLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!storageLoaded.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ status, waMessage }));
    } catch {
      /* ignora */
    }
  }, [status, waMessage]);

  /* ---- leitura do CSV ---- */
  const handleFile = useCallback((file) => {
    if (!file) return;
    setError('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => String(h).trim(),
      complete: (result) => {
        const fields = (result.meta.fields || []).filter(Boolean);
        if (!fields.length) {
          setError('Não consegui identificar colunas nesse arquivo. Verifique se é um CSV válido.');
          return;
        }
        setHeaders(fields);
        setRows(result.data);
        setMapping(detectMapping(fields));
        setFileName(file.name);
        setFilter('all');
        setSearch('');
        setShowMapping(false);
      },
      error: (err) => setError('Erro ao ler o CSV: ' + err.message),
    });
  }, []);

  /* ---- leads processados ---- */
  const leads = useMemo(() => {
    return rows.map((row, index) => {
      const pick = (key) => (mapping[key] ? String(row[mapping[key]] ?? '').trim() : '');

      const name = pick('name');
      const phone = pick('phone');
      const instagram = pick('instagram');
      const website = pick('website');
      const email = pick('email');
      const category = pick('category');
      const address = pick('address');

      const id =
        name || phone
          ? `${name}|${phone}`.toLowerCase().replace(/\s+/g, '')
          : `linha-${index}`;

      return {
        id,
        name: name || phone || `Lead ${index + 1}`,
        phone,
        email,
        category,
        address,
        instagram,
        website,
        hasWebsite: hasValue(website),
        whatsapp: buildWhatsApp(phone, waMessage),
        instagramUrl: buildInstagram(instagram),
        handle: instagramHandle(instagram),
        siteUrl: buildSite(website),
      };
    });
  }, [rows, mapping, waMessage]);

  /* ---- filtros ---- */
  const counts = useMemo(() => {
    const contacted = leads.filter((l) => status[l.id]?.contacted).length;
    const noSite = leads.filter((l) => !l.hasWebsite).length;
    return {
      all: leads.length,
      'no-site': noSite,
      'with-site': leads.length - noSite,
      contacted,
      pending: leads.length - contacted,
    };
  }, [leads, status]);

  const filtered = useMemo(() => {
    let list = leads;

    if (filter === 'no-site') list = list.filter((l) => !l.hasWebsite);
    if (filter === 'with-site') list = list.filter((l) => l.hasWebsite);
    if (filter === 'contacted') list = list.filter((l) => status[l.id]?.contacted);
    if (filter === 'pending') list = list.filter((l) => !status[l.id]?.contacted);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((l) =>
        [l.name, l.phone, l.email, l.category, l.address, l.instagram, l.handle]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }

    return list;
  }, [leads, filter, search, status]);

  /* ---- ações ---- */
  const toggleContacted = useCallback((id) => {
    setStatus((prev) => ({
      ...prev,
      [id]: { ...prev[id], contacted: !prev[id]?.contacted },
    }));
  }, []);

  const setNote = useCallback((id, note) => {
    setStatus((prev) => ({ ...prev, [id]: { ...prev[id], note } }));
  }, []);

  const clearAll = useCallback(() => {
    if (!window.confirm('Isso vai remover o CSV carregado e todos os status/anotações. Continuar?')) return;
    setRows([]);
    setHeaders([]);
    setMapping({});
    setFileName('');
    setStatus({});
    setOpenNote(null);
    setError('');
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignora */
    }
  }, []);

  const exportCsv = useCallback(() => {
    const data = filtered.map((l) => ({
      Nome: l.name,
      Telefone: l.phone,
      WhatsApp: l.whatsapp || '',
      Instagram: l.instagramUrl || '',
      Site: l.website,
      TemSite: l.hasWebsite ? 'Sim' : 'Não',
      Email: l.email,
      Categoria: l.category,
      Endereco: l.address,
      Contatado: status[l.id]?.contacted ? 'Sim' : 'Não',
      Observacao: status[l.id]?.note || '',
    }));

    const csv = Papa.unparse(data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`escarlate-leads-${stamp}.csv`, csv);
  }, [filtered, status]);

  /* ---- render ---- */
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">EF</div>
          <div className="brand-text">
            <h1>Escarlate Finder</h1>
            <span>Prospecção de leads para venda de sites</span>
          </div>
        </div>

        <div className="topbar-actions">
          {leads.length > 0 && (
            <>
              <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
                Trocar CSV
              </button>
              <button className="btn-ghost" onClick={exportCsv}>
                Exportar CSV
              </button>
              <button className="btn-ghost danger" onClick={clearAll}>
                Limpar
              </button>
            </>
          )}
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {leads.length === 0 ? (
        <section className="empty">
          <div
            className={`dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">📄</div>
            <h2>Arraste seu arquivo CSV aqui</h2>
            <p>ou clique para selecionar do seu computador</p>
            <span className="dropzone-hint">
              Funciona com exportações do Google Maps, planilhas, scraping de Instagram e etc.
            </span>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <>
          <section className="stats">
            <div className="stat">
              <div className="stat-label">Total de leads</div>
              <div className="stat-value">{counts.all}</div>
            </div>
            <div className="stat alert">
              <div className="stat-label">Sem site</div>
              <div className="stat-value">{counts['no-site']}</div>
            </div>
            <div className="stat ok">
              <div className="stat-label">Com site</div>
              <div className="stat-value">{counts['with-site']}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Contatados</div>
              <div className="stat-value">{counts.contacted}</div>
            </div>
          </section>

          <section className="toolbar">
            <div className="toolbar-row">
              <input
                className="search"
                placeholder="Buscar por nome, telefone, cidade, @..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="pills">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`pill ${filter === f.key ? 'active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                    <span className="pill-count">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-row">
              <label className="field-inline">
                <span>Mensagem inicial do WhatsApp</span>
                <input
                  value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)}
                  placeholder="Ex: Olá! Vi que seu negócio ainda não tem site. Posso te mostrar uma proposta rápida?"
                />
              </label>
              <button className="btn-ghost" onClick={() => setShowMapping((v) => !v)}>
                {showMapping ? 'Fechar colunas' : 'Mapear colunas'}
              </button>
            </div>
          </section>

          {showMapping && (
            <section className="mapping">
              <p className="mapping-hint">
                Arquivo: <strong>{fileName}</strong> — diga qual coluna do CSV corresponde a cada informação.
              </p>
              <div className="mapping-grid">
                {FIELD_DEFS.map((f) => (
                  <label key={f.key} className="mapping-item">
                    <span>
                      {f.icon} {f.label}
                    </span>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— nenhuma —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="grid">
            {filtered.length === 0 && (
              <div className="empty-list">Nenhum lead encontrado com esses filtros.</div>
            )}

            {filtered.map((lead) => {
              const st = status[lead.id] || {};
              return (
                <article key={lead.id} className={`card ${lead.hasWebsite ? '' : 'no-site'}`}>
                  <div className="card-top">
                    <h3 className="card-title">{lead.name}</h3>
                    <span className={`badge ${lead.hasWebsite ? 'badge-ok' : 'badge-alert'}`}>
                      {lead.hasWebsite ? 'Com site' : 'Sem site'}
                    </span>
                  </div>

                  {lead.category && <span className="chip">{lead.category}</span>}

                  <ul className="card-meta">
                    {lead.phone && (
                      <li>
                        <span className="meta-icon">📞</span>
                        <span>{lead.phone}</span>
                      </li>
                    )}
                    {lead.handle && (
                      <li>
                        <span className="meta-icon">📷</span>
                        <span>@{lead.handle}</span>
                      </li>
                    )}
                    {lead.email && (
                      <li>
                        <span className="meta-icon">✉️</span>
                        <span className="truncate">{lead.email}</span>
                      </li>
                    )}
                    {lead.address && (
                      <li>
                        <span className="meta-icon">📍</span>
                        <span className="truncate">{lead.address}</span>
                      </li>
                    )}
                    {lead.website && (
                      <li>
                        <span className="meta-icon">🌐</span>
                        <span className="truncate">{lead.website}</span>
                      </li>
                    )}
                  </ul>

                  <div className="card-actions">
                    {lead.whatsapp ? (
                      <a className="btn btn-wa" href={lead.whatsapp} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                    ) : (
                      <span className="btn btn-disabled">Sem telefone</span>
                    )}

                    {lead.instagramUrl && (
                      <a className="btn btn-ig" href={lead.instagramUrl} target="_blank" rel="noreferrer">
                        Instagram
                      </a>
                    )}

                    {lead.siteUrl && (
                      <a className="btn btn-site" href={lead.siteUrl} target="_blank" rel="noreferrer">
                        Ver site
                      </a>
                    )}

                    {lead.email && (
                      <a className="btn" href={`mailto:${lead.email}`}>
                        E-mail
                      </a>
                    )}
                  </div>

                  <div className="card-foot">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={!!st.contacted}
                        onChange={() => toggleContacted(lead.id)}
                      />
                      <span>{st.contacted ? 'Contatado' : 'Marcar contatado'}</span>
                    </label>

                    <button
                      className="btn-note"
                      onClick={() => setOpenNote(openNote === lead.id ? null : lead.id)}
                    >
                      {st.note ? '📝 Nota' : '＋ Nota'}
                    </button>
                  </div>

                  {openNote === lead.id && (
                    <textarea
                      className="note-area"
                      autoFocus
                      placeholder="Ex: falei no dia 12/03, pediu para chamar depois das 18h..."
                      value={st.note || ''}
                      onChange={(e) => setNote(lead.id, e.target.value)}
                    />
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
