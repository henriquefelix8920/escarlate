'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';

const STORAGE_KEY = 'escarlate-finder-v2';
const STORAGE_KEY_PHONES = 'escarlate-finder-phones-v1';

const FIELD_DEFS = [
  { key: 'name', label: 'Nome / Empresa', icon: '🏷️' },
  { key: 'phone', label: 'Telefone / WhatsApp', icon: '📞' },
  { key: 'instagram', label: 'Instagram', icon: '📷' },
  { key: 'website', label: 'Site', icon: '🌐' },
  { key: 'profile', label: 'Perfil (link)', icon: '🔗' },
  { key: 'email', label: 'E-mail', icon: '✉️' },
  { key: 'category', label: 'Categoria', icon: '📂' },
  { key: 'address', label: 'Endereço / Cidade', icon: '📍' },
];

const EMPTY_VALUES = new Set([
  '', '-', '--', '---', 'n/a', 'na', 'nao', 'não', 'sem site',
  'sem', 'null', 'undefined', 'none', '|', '·',
]);

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'no-site', label: 'Sem site' },
  { key: 'with-site', label: 'Com site' },
  { key: 'pending', label: 'Não contatados' },
  { key: 'contacted', label: 'Contatados' },
];

/* -------- regex -------- */
const WA_URL_RE = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i;
const IG_URL_RE = /instagram\.com\//i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const IMG_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const IMG_HOST_RE = /wsrv\.nl|imgur\.|cloudinary\.|cloudfront\.|convex\.cloud\/api\/storage|images\.|img\./i;

/* -------- helpers -------- */

function hasValue(value) {
  if (value === null || value === undefined) return false;
  return !EMPTY_VALUES.has(String(value).trim().toLowerCase());
}

function normalizeHeader(header) {
  return String(header)
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractPhoneDigits(raw) {
  if (!hasValue(raw)) return '';
  const s = String(raw).trim();
  const m = s.match(/wa\.me\/(\d+)/i) || s.match(/[?&]phone=(\d+)/i);
  if (m) return m[1];
  return s.replace(/\D/g, '');
}

// Normaliza para comparação (chave canônica): só dígitos com DDI 55
function normalizePhone(raw) {
  if (!raw) return '';
  const digits = extractPhoneDigits(raw).replace(/^0+/, '');
  if (digits.length < 10) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return '55' + digits;
}

function buildWhatsApp(rawPhone) {
  const digits = normalizePhone(rawPhone);
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

function formatPhone(raw) {
  const digits = extractPhoneDigits(raw);
  if (!digits) return '';
  let d = digits.replace(/^0+/, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

function buildInstagram(value) {
  if (!hasValue(value)) return null;
  const raw = String(value).trim();
  if (IG_URL_RE.test(raw)) return URL_RE.test(raw) ? raw : 'https://' + raw;
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

function buildUrl(value) {
  if (!hasValue(value)) return null;
  const s = String(value).trim();
  return URL_RE.test(s) ? s : 'https://' + s;
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

/* -------- detecção automática -------- */

function detectMapping(headers, rows) {
  const sample = rows.slice(0, 20);
  const valuesOf = (h) => sample.map((r) => String(r[h] ?? '').trim()).filter(Boolean);

  const byName = (...keys) => {
    const norm = headers.map((h) => ({ h, n: normalizeHeader(h) }));
    for (const { h, n } of norm) if (keys.some((k) => n === k)) return h;
    for (const { h, n } of norm) if (keys.some((k) => n.includes(k))) return h;
    return '';
  };

  const byContent = (test, minRatio = 0.6) => {
    for (const h of headers) {
      const vals = valuesOf(h);
      if (vals.length < 2) continue;
      const matches = vals.filter(test).length;
      if (matches / vals.length >= minRatio) return h;
    }
    return '';
  };

  let phone = byName(
    'whatsapp', 'whats', 'telefone', 'phone', 'celular', 'fone', 'tel', 'contato', 'numero', 'mobile'
  );
  if (!phone) phone = byContent((v) => WA_URL_RE.test(v));

  let instagram = byName('instagram', 'insta', 'ig');
  if (!instagram) {
    instagram = byContent((v) => IG_URL_RE.test(v) || /^@[a-zA-Z0-9._]{2,}$/.test(v));
  }

  let email = byName('email', 'e mail', 'mail');
  if (!email) email = byContent((v) => EMAIL_RE.test(v));

  let website = byName('website', 'site', 'dominio', 'homepage');
  if (!website) {
    const cand = byName('url', 'link');
    if (cand) {
      const vals = valuesOf(cand);
      if (vals.length && vals.every((v) => URL_RE.test(v))) website = cand;
    }
  }

  let profile = byContent(
    (v) =>
      URL_RE.test(v) &&
      !WA_URL_RE.test(v) &&
      !IG_URL_RE.test(v) &&
      !IMG_EXT_RE.test(v) &&
      !IMG_HOST_RE.test(v)
  );

  let name = byName(
    'nome', 'name', 'empresa', 'cliente', 'negocio', 'business',
    'titulo', 'title', 'razao social', 'estabelecimento', 'fantasia'
  );
  if (!name) {
    name = byContent((v) => {
      if (v.length < 2 || v.length > 60) return false;
      if (URL_RE.test(v)) return false;
      if (v.includes('@')) return false;
      if (/^\d+$/.test(v)) return false;
      if (!/[a-zA-ZÀ-ÿ]/.test(v)) return false;
      if (/\d/.test(v)) return false;
      const words = v.split(/\s+/).filter(Boolean);
      if (words.length > 6) return false;
      if (words.every((w) => w.length <= 1)) return false;
      return true;
    }, 0.7);
  }

  let category = byName(
    'categoria', 'segmento', 'nicho', 'ramo', 'tipo', 'category', 'industry', 'servico', 'serviço'
  );

  let address = byName(
    'endereco', 'address', 'cidade', 'bairro', 'local', 'city', 'location', 'regiao'
  );

  return { name, phone, instagram, website, email, category, address, profile };
}

/* -------- componente -------- */

export default function Page() {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({});
  const [showMapping, setShowMapping] = useState(false);
  const [openNote, setOpenNote] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [seenPhones, setSeenPhones] = useState({});
  const [importNotice, setImportNotice] = useState('');

  const fileInputRef = useRef(null);
  const storageLoaded = useRef(false);

  /* ---- persistência ---- */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.status) setStatus(parsed.status);
      }
      const rawPhones = window.localStorage.getItem(STORAGE_KEY_PHONES);
      if (rawPhones) {
        const parsed = JSON.parse(rawPhones);
        if (parsed && typeof parsed === 'object') setSeenPhones(parsed);
      }
    } catch {}
    storageLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!storageLoaded.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ status }));
    } catch {}
  }, [status]);

  useEffect(() => {
    if (!storageLoaded.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_PHONES, JSON.stringify(seenPhones));
    } catch {}
  }, [seenPhones]);

  /* ---- leitura do CSV ---- */
  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      setError('');
      setImportNotice('');

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

          const detected = detectMapping(fields, result.data);
          const phoneCol = detected.phone;

          // Filtra repetidos com base no histórico de telefones
          const kept = [];
          const newPhones = {};
          let removed = 0;

          for (const row of result.data) {
            const rawPhone = phoneCol ? String(row[phoneCol] ?? '').trim() : '';
            const key = normalizePhone(rawPhone);

            if (key && seenPhones[key]) {
              removed++;
              continue;
            }
            if (key) newPhones[key] = Date.now();
            kept.push(row);
          }

          setHeaders(fields);
          setRows(kept);
          setMapping(detected);
          setFileName(file.name);
          setFilter('all');
          setSearch('');
          setShowMapping(!detected.name || !detected.phone);
          setSeenPhones((prev) => ({ ...prev, ...newPhones }));

          if (removed > 0) {
            setImportNotice(
              `${removed} lead(s) repetido(s) já no histórico foram removidos automaticamente.`
            );
          }
        },
        error: (err) => setError('Erro ao ler o CSV: ' + err.message),
      });
    },
    [seenPhones]
  );

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
      const profile = pick('profile');

      const id =
        name || phone
          ? `${name}|${phone}`.toLowerCase().replace(/\s+/g, '')
          : `linha-${index}`;

      return {
        id,
        name: name || formatPhone(phone) || `Lead ${index + 1}`,
        phone,
        phoneDisplay: formatPhone(phone),
        phoneKey: normalizePhone(phone),
        email,
        category,
        address,
        instagram,
        website,
        profile,
        hasWebsite: hasValue(website),
        whatsapp: buildWhatsApp(phone),
        instagramUrl: buildInstagram(instagram),
        handle: instagramHandle(instagram),
        siteUrl: buildUrl(website),
        profileUrl: buildUrl(profile),
      };
    });
  }, [rows, mapping]);

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
        [l.name, l.phone, l.phoneDisplay, l.email, l.category, l.address, l.instagram, l.handle, l.website]
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

  const clearCurrent = useCallback(() => {
    if (!window.confirm('Isso vai remover o CSV carregado e todos os status/anotações desta sessão. O histórico de telefones será mantido. Continuar?')) return;
    setRows([]);
    setHeaders([]);
    setMapping({});
    setFileName('');
    setStatus({});
    setOpenNote(null);
    setError('');
    setImportNotice('');
  }, []);

  const clearHistory = useCallback(() => {
    const n = Object.keys(seenPhones).length;
    if (n === 0) {
      window.alert('O histórico de telefones já está vazio.');
      return;
    }
    if (
      !window.confirm(
        `Isso vai apagar o histórico de ${n} telefone(s) já vistos. Depois disso, leads repetidos em novos CSVs NÃO serão removidos automaticamente. Continuar?`
      )
    )
      return;
    setSeenPhones({});
    try {
      window.localStorage.removeItem(STORAGE_KEY_PHONES);
    } catch {}
  }, [seenPhones]);

  const exportCsv = useCallback(() => {
    const data = filtered.map((l) => ({
      Nome: l.name,
      Telefone: l.phoneDisplay || l.phone,
      WhatsApp: l.whatsapp || '',
      Instagram: l.instagramUrl || '',
      Site: l.website,
      TemSite: l.hasWebsite ? 'Sim' : 'Não',
      Perfil: l.profile,
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

  const historyCount = Object.keys(seenPhones).length;

  /* ---- render ---- */
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">EF</div>
          <div className="brand-text">
            <h1>Escarlate Finder</h1>
            <span>{fileName ? `Arquivo: ${fileName}` : 'Prospecção de leads para venda de sites'}</span>
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
              <button className="btn-ghost danger" onClick={clearCurrent}>
                Limpar
              </button>
            </>
          )}
          <button
            className="btn-ghost"
            onClick={clearHistory}
            title="Telefones já vistos em CSVs anteriores. Clique para zerar."
          >
            Histórico ({historyCount})
          </button>
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

      {importNotice && (
        <div className="notice">
          <span>♻️ {importNotice}</span>
          <button className="notice-close" onClick={() => setImportNotice('')} aria-label="Fechar">
            ×
          </button>
        </div>
      )}

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
              Detecta automaticamente nome, WhatsApp, Instagram, site e e-mail — e já descarta leads com telefone repetido.
            </span>
          </div>
          {error && <p className="error">{error}</p>}
          {historyCount > 0 && (
            <p className="dropzone-hint" style={{ marginTop: 18 }}>
              📇 Você tem <strong>{historyCount}</strong> telefone(s) no histórico.
            </p>
          )}
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
              <button className="btn-ghost" onClick={() => setShowMapping((v) => !v)}>
                {showMapping ? 'Fechar colunas' : 'Mapear colunas'}
              </button>
            </div>
          </section>

          {showMapping && (
            <section className="mapping">
              <p className="mapping-hint">
                Dica: se algum campo estiver errado, escolha a coluna correta aqui. A ferramenta já tentou adivinhar
                pelo cabeçalho e pelo conteúdo.
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
              const contacted = !!st.contacted;
              return (
                <article
                  key={lead.id}
                  className={`card ${lead.hasWebsite ? '' : 'no-site'} ${contacted ? 'contacted' : ''}`}
                >
                  <div className="card-top">
                    <h3 className="card-title">{lead.name}</h3>
                    <div className="card-badges">
                      {contacted && <span className="badge badge-contacted">✓ Contatado</span>}
                      <span className={`badge ${lead.hasWebsite ? 'badge-ok' : 'badge-alert'}`}>
                        {lead.hasWebsite ? 'Com site' : 'Sem site'}
                      </span>
                    </div>
                  </div>

                  {lead.category && <span className="chip">{lead.category}</span>}

                  <ul className="card-meta">
                    {lead.phoneDisplay && (
                      <li>
                        <span className="meta-icon">📞</span>
                        <span>{lead.phoneDisplay}</span>
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

                    {lead.profileUrl && (
                      <a className="btn" href={lead.profileUrl} target="_blank" rel="noreferrer">
                        🔗 Perfil
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
                        checked={contacted}
                        onChange={() => toggleContacted(lead.id)}
                      />
                      <span>{contacted ? 'Contatado' : 'Marcar contatado'}</span>
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
