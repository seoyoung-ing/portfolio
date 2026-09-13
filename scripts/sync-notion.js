/* ===========================================================
   노션 → data.json 변환 스크립트

   GitHub Actions에서 실행됩니다. 필요한 환경변수:
     NOTION_TOKEN   노션 Integration 비밀 키 (ntn_...)
     NOTION_DB_ID   포트폴리오 DB의 32자리 ID

   결과물:
     data.json        사이트가 읽는 데이터 파일
     images/*.png     노션에서 내려받은 이미지
   =========================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.NOTION_TOKEN;
const RAW_ID = process.env.NOTION_DB_ID;
const OUT_DIR = process.cwd();
const IMG_DIR = path.join(OUT_DIR, 'images');

const NOTION_VERSION = '2022-06-28';
const API = 'https://api.notion.com/v1';

/* 단계 이름 매핑 — 노션 제목에 이 단어가 있으면 해당 단계로 인식 */
const STAGES = [
  { key: 'context',    label: '배경', match: ['business context', 'context', '배경'] },
  { key: 'problem',    label: '문제', match: ['problem', '문제'] },
  { key: 'evidence',   label: '근거', match: ['evidence', '근거'] },
  { key: 'goal',       label: '목표', match: ['goal', 'metric', '목표', '지표'] },
  { key: 'hypothesis', label: '가설', match: ['hypothesis', '가설'] },
  { key: 'decision',   label: '결정', match: ['decision', '결정'] },
  { key: 'execution',  label: '실행', match: ['execution', '실행'] },
  { key: 'result',     label: '결과', match: ['result', '결과'] },
  { key: 'learning',   label: '학습', match: ['learning', '학습', '회고'] }
];

const TONES = ['d', 'a', 'b', 'c'];
const PATS  = ['grid', 'rules', 'arcs', 'dots', 'diag'];

/* ---------- 노션 API ---------- */
async function notion(endpoint, options = {}) {
  const res = await fetch(API + endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Notion API ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* 주어진 ID가 DB인지 확인하고, 페이지라면 그 안의 DB를 찾아 들어간다 */
async function resolveDatabaseId(id) {
  try {
    await notion(`/databases/${id}`);
    console.log('  주어진 ID가 데이터베이스입니다.');
    return id;
  } catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
  }

  console.log('  데이터베이스가 아니라 페이지인 것 같습니다. 내부에서 DB를 찾습니다.');
  const children = await notion(`/blocks/${id}/children?page_size=100`);
  const db = children.results.find(b =>
    b.type === 'child_database' || b.type === 'database');
  if (!db) {
    throw new Error(
      '이 ID는 데이터베이스도 아니고, 안에 데이터베이스도 없습니다.\n' +
      '  확인할 것: (1) Integration이 이 페이지에 연결되어 있는지 ' +
      '(2) DB를 전체 화면으로 연 주소에서 ID를 다시 뽑았는지'
    );
  }
  console.log(`  내부 DB를 찾았습니다: ${db.id}`);
  return db.id;
}

async function queryAll(dbId) {
  const rows = [];
  let cursor;
  do {
    const res = await notion(`/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 })
    });
    rows.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return rows;
}

async function blocksOf(blockId) {
  const out = [];
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const res = await notion(`/blocks/${blockId}/children${q}`);
    for (const b of res.results) {
      out.push(b);
      if (b.has_children && b.type !== 'child_database' && b.type !== 'child_page') {
        b._children = await blocksOf(b.id);
      }
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

/* ---------- 텍스트 ---------- */
const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 노션 서식을 HTML로. 굵게와 링크만 살리고 나머지는 평문 처리 */
function rich(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(t => {
    let s = esc(t.plain_text);
    const a = t.annotations || {};
    if (a.code) s = `<code>${s}</code>`;
    if (a.bold) s = `<b>${s}</b>`;
    if (a.italic) s = `<i>${s}</i>`;
    if (t.href) s = `<a href="${esc(t.href)}" target="_blank" rel="noopener">${s}</a>`;
    return s;
  }).join('');
}
const plain = arr => (arr || []).map(t => t.plain_text).join('');

/* ---------- 이미지 ---------- */
async function saveImage(url, hint) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('다운로드 실패 ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());

    const type = res.headers.get('content-type') || '';
    let ext = '.png';
    if (type.includes('jpeg') || type.includes('jpg')) ext = '.jpg';
    else if (type.includes('webp')) ext = '.webp';
    else if (type.includes('gif')) ext = '.gif';
    else if (type.includes('svg')) ext = '.svg';

    const name = hint.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase() +
                 '-' + crypto.createHash('md5').update(buf).digest('hex').slice(0, 8) + ext;

    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMG_DIR, name), buf);
    return 'images/' + name;
  } catch (e) {
    console.warn('  이미지를 가져오지 못했습니다:', e.message);
    return null;
  }
}

/* ---------- 본문 해석 ---------- */
/* 단계 이름 줄인지 판별한다.

   본문 제목에 '가설'이나 '결과' 같은 단어가 들어가는 경우가 많으므로,
   단어가 들어 있다는 것만으로는 단계로 보지 않는다.
   이모지와 기호를 걷어낸 뒤 짧은 줄일 때만 단계 이름으로 인정한다.
   ("🏢 Business Context" → 인정 / "두 가지 가설을 실험으로 검증했다" → 본문 제목)   */
const STAGE_NAME_MAX = 20;

function cleanForStage(title) {
  return String(title)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

function stageOf(title) {
  const cleaned = cleanForStage(title);
  if (!cleaned || cleaned.length > STAGE_NAME_MAX) return null;
  for (const s of STAGES) {
    if (s.match.some(m => cleaned.includes(cleanForStage(m)))) return s;
  }
  return null;
}

/* 상단 메타 줄: "기간   2026.02 ~ 2026.07" 형태에서 라벨과 값을 분리 */
function metaLine(text) {
  const m = text.match(/^\s*(기간|역할|협업|팀|담당\s*범위|태그)\s*[:：]?\s*(.+)$/);
  if (!m) return null;
  return { key: m[1].replace(/\s/g, ''), value: m[2].trim() };
}

/* "태그: 0→1 기획, 사용자 인터뷰" → ['0→1 기획', '사용자 인터뷰'] */
function parseTags(value) {
  return value.split(/[,·/]/).map(t => t.trim()).filter(Boolean).slice(0, 8);
}

async function parsePage(page, pageBlocks, order) {
  const props = page.properties || {};
  const pick = (...names) => {
    for (const n of names) {
      const p = props[n];
      if (!p) continue;
      if (p.type === 'title') return plain(p.title);
      if (p.type === 'rich_text') return plain(p.rich_text);
      if (p.type === 'select') return p.select ? p.select.name : '';
      if (p.type === 'date') return p.date ? p.date.start : '';
    }
    return '';
  };

  const project = {
    id: page.id.replace(/-/g, '').slice(0, 12),
    title: pick('제목', '이름', 'Name', 'Title'),
    period: pick('기간', 'Period'),
    role: pick('역할', 'Role'),
    team: pick('협업', 'Team'),
    thumb: null,
    tags: [],
    chapters: []
  };

  let current = null;         // 현재 단계
  let pendingHeading = null;  // 단계 이름 다음에 올 한 문장 제목
  let sub = null;             // 현재 소단락
  let seenFirstHeading = false;
  const intro = [];

  const push = item => {
    if (sub) sub.blocks.push(item);
    else if (current) current.blocks.push(item);
    else intro.push(item);
  };

  const openSub = title => {
    sub = { h: title, blocks: [] };
    if (current) current.blocks.push({ t: 'sub', sub });
    return sub;
  };

  /* 블록 목록을 순회한다. 토글·단 나누기 등 하위 블록도 함께 본다. */
  async function walk(list) {
    for (const b of (list || [])) {
      const type = b.type;
      const kids = b._children;

      /* --- 제목 --- */
      if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
        const text = plain(b[type].rich_text).trim();

        if (text) {
          const stage = (type !== 'heading_3') ? stageOf(text) : null;

          /* 본문 첫 제목이 단계 이름이 아니라면 프로젝트 제목으로 본다.
             (문서가 곧바로 Business Context 로 시작하는 경우도 있으므로
              단계 이름일 때는 제목으로 가져가지 않는다) */
          if (!seenFirstHeading && type !== 'heading_3' && !stage) {
            seenFirstHeading = true;
            if (!project.title) project.title = text;
            if (kids) await walk(kids);
            continue;
          }
          if (!seenFirstHeading && stage) seenFirstHeading = true;

          /* 단계 이름 바로 뒤에 오는 제목은 그 단계의 제목으로 본다.
             단계 이름처럼 짧지 않은 이상 새 단계로 열지 않는다. */
          if (pendingHeading && !pendingHeading.h && type !== 'heading_3' && !stage) {
            pendingHeading.h = text;
            pendingHeading = null;
            if (kids) await walk(kids);
            continue;
          }

          if (stage) {
            current = { n: '', label: stage.label, h: '', blocks: [] };
            project.chapters.push(current);
            pendingHeading = current;
            sub = null;
            if (kids) await walk(kids);
            continue;
          }

          if (current) openSub(text);
        }
        if (kids) await walk(kids);
        continue;
      }

      /* --- 토글: 제목을 소단락으로 삼고 안쪽을 펼친다 --- */
      if (type === 'toggle') {
        const text = plain(b.toggle.rich_text).trim();
        if (text && current) openSub(text);
        else if (text) push({ t: 'p', v: rich(b.toggle.rich_text) });
        if (kids) await walk(kids);
        continue;
      }

      /* --- 단 나누기·동기화 블록 등은 껍데기만 벗기고 통과 --- */
      if (type === 'column_list' || type === 'column' ||
          type === 'synced_block' || type === 'template') {
        if (kids) await walk(kids);
        continue;
      }

      /* --- 문단 --- */
      if (type === 'paragraph') {
        const raw = plain(b.paragraph.rich_text).trim();
        if (raw) {
          if (!current) {
            const meta = metaLine(raw);
            if (meta) {
              if (meta.key === '기간' && !project.period) project.period = meta.value;
              else if (meta.key === '역할' || meta.key === '담당범위') project.role = meta.value;
              else if (meta.key === '협업' || meta.key === '팀') project.team = meta.value;
              else if (meta.key === '태그') project.tags = parseTags(meta.value);
              if (kids) await walk(kids);
              continue;
            }
          }
          const tagLine = raw.match(/^\s*태그\s*[:：]\s*(.+)$/);
          if (tagLine) { project.tags = parseTags(tagLine[1]); if (kids) await walk(kids); continue; }

          push({ t: 'p', v: rich(b.paragraph.rich_text) });
        }
        if (kids) await walk(kids);
        continue;
      }

      /* --- 인용 · 콜아웃 --- */
      if (type === 'quote' || type === 'callout') {
        const v = rich(b[type].rich_text);
        if (v) push({ t: 'quote', v });
        if (kids) await walk(kids);
        continue;
      }

      /* --- 목록 --- */
      if (type === 'bulleted_list_item' || type === 'numbered_list_item' ||
          type === 'to_do') {
        const v = rich(b[type].rich_text);
        if (v) push({ t: 'li', v });
        if (kids) await walk(kids);
        continue;
      }

      /* --- 이미지 --- */
      if (type === 'image') {
        const src = b.image.type === 'external' ? b.image.external.url : b.image.file.url;
        const caption = plain(b.image.caption).trim();
        const saved = await saveImage(src, project.title || 'image');
        if (saved) {
          if (!project.thumb) project.thumb = saved;
          push({ t: 'img', v: saved, cap: caption });
        }
        continue;
      }

      /* --- 코드·인용문 등 나머지 텍스트 블록 --- */
      if (b[type] && b[type].rich_text) {
        const v = rich(b[type].rich_text);
        if (v) push({ t: 'p', v });
      }
      if (kids) await walk(kids);
    }
  }

  await walk(pageBlocks);

  /* 내용이 없는 단계는 버린다 */
  project.chapters = project.chapters.filter(c => c.blocks.length || c.h);
  project.chapters.forEach((c, i) => { c.n = String(i + 1).padStart(2, '0'); });

  project.intro = intro;
  const firstQuote = findFirstQuote(project.chapters);
  project.summary = firstQuote || stripTags(firstParagraph(project.chapters) || '');
  project.metric = project.chapters.find(c => c.label === '문제')?.h || '';
  project.year = (project.period.match(/(20\d{2})/) || [])[1] || '';
  project.badge = spanOf(project.period);
  project.thumbTitle = splitTitle(project.title);
  project.tone = TONES[order % TONES.length];
  project.pat  = PATS[order % PATS.length];

  /* 본문이 거의 비었으면 로그로 알린다 */
  let blockCount = 0;
  walkBlocks(project.chapters, () => blockCount++);
  project._empty = blockCount === 0;

  return project;
}

const stripTags = s => String(s || '').replace(/<[^>]+>/g, '');

function walkBlocks(chapters, fn) {
  for (const c of chapters) {
    for (const b of c.blocks) {
      if (b.t === 'sub') { for (const sb of b.sub.blocks) fn(sb); }
      else fn(b);
    }
  }
}
function findFirstQuote(chapters) {
  let found = null;
  walkBlocks(chapters, b => { if (!found && b.t === 'quote') found = stripTags(b.v); });
  return found;
}
function firstParagraph(chapters) {
  let found = null;
  walkBlocks(chapters, b => { if (!found && b.t === 'p') found = b.v; });
  return found;
}

/* "2026.02 ~ 2026.07" → "6개월" */
function spanOf(period) {
  const m = String(period).match(/(\d{4})[.\-/\s]*(\d{1,2}).*?[~\-–]\s*(\d{4})[.\-/\s]*(\d{1,2})/);
  if (!m) return '';
  const months = (Number(m[3]) - Number(m[1])) * 12 + (Number(m[4]) - Number(m[2])) + 1;
  if (months <= 0) return '';
  return months >= 12 && months % 12 === 0
    ? `${months / 12}년`
    : `${months}개월`;
}

/* 제목을 썸네일용 두 줄로 */
function splitTitle(title) {
  const t = String(title).replace(/\s+/g, ' ').trim();
  if (t.length <= 12) return t;
  const words = t.split(' ');
  let a = '', i = 0;
  const half = t.length / 2;
  while (i < words.length && (a.length + words[i].length) <= half) {
    a += (a ? ' ' : '') + words[i]; i++;
  }
  const b = words.slice(i).join(' ');
  return b ? a + '\n' + b : a;
}

/* ---------- 실행 ---------- */
(async () => {
  if (!TOKEN)  throw new Error('NOTION_TOKEN 이 설정되지 않았습니다. GitHub Secrets를 확인하세요.');
  if (!RAW_ID) throw new Error('NOTION_DB_ID 가 설정되지 않았습니다. GitHub Secrets를 확인하세요.');

  const id = RAW_ID.replace(/-/g, '').trim();
  console.log('노션에 연결합니다...');

  const dbId = await resolveDatabaseId(id);
  const rows = await queryAll(dbId);
  console.log(`${rows.length}개의 항목을 찾았습니다.`);

  const projects = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const titleProp = Object.values(row.properties).find(p => p.type === 'title');
    const name = titleProp ? plain(titleProp.title) : '(제목 없음)';
    console.log(`[${i + 1}/${rows.length}] ${name}`);
    try {
      const blocks = await blocksOf(row.id);
      const project = await parsePage(row, blocks, i);
      if (!project.title) { console.warn('  제목이 없어 건너뜁니다.'); continue; }
      if (!project.chapters.length) console.warn('  본문 단계를 찾지 못했습니다. 제목 규칙을 확인하세요.');
      else if (project._empty) console.warn('  단계는 찾았지만 본문 내용이 비어 있습니다. 노션 페이지가 템플릿 상태인지 확인하세요.');
      delete project._empty;
      projects.push(project);
    } catch (e) {
      console.error('  변환 실패:', e.message);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    projects
  };
  fs.writeFileSync(path.join(OUT_DIR, 'data.json'), JSON.stringify(out, null, 2));
  console.log(`\ndata.json 을 만들었습니다. 프로젝트 ${projects.length}개.`);
})().catch(e => {
  console.error('\n실패했습니다:\n' + e.message);
  process.exit(1);
});
