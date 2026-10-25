/**
 * Small spreadsheet helper: builds and reads a single-sheet .xlsx,
 * and reads CSV that Excel exports. No third-party library.
 */

const NS_PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';
function nsTag(name) { return NS_PREFIX + name; }

const SHEETS = {
  items: {
    headers: ['كود الصنف', 'اسم الصنف', 'التصنيف', 'الوحدة', 'الترتيب', 'نشط'],
    example: ['EXAMPLE', 'مثال - احذف هذا السطر', 'مشروبات', 'علبة', '1', 'نعم'],
    fields: {
      item_code: ['كود الصنف', 'كود', 'item_code', 'code'],
      item_name: ['اسم الصنف', 'الصنف', 'item_name', 'name'],
      category: ['التصنيف', 'الفئة', 'category'],
      unit: ['الوحدة', 'unit'],
      sort_order: ['الترتيب', 'sort_order', 'sort'],
      active: ['نشط', 'الحالة', 'active', 'status']
    },
    required: ['item_name', 'item_code']
  },
  branches: {
    headers: ['كود الفرع', 'اسم الفرع', 'الموقع', 'الحالة'],
    example: ['EXAMPLE', 'مثال - احذف هذا السطر', 'القاهرة', 'نشط'],
    fields: {
      branch_code: ['كود الفرع', 'كود', 'branch_code', 'code'],
      branch_name: ['اسم الفرع', 'الفرع', 'branch_name', 'name'],
      location: ['الموقع', 'location'],
      status: ['الحالة', 'نشط', 'status']
    },
    required: ['branch_name', 'branch_code']
  },
  users: {
    headers: ['الاسم الكامل', 'اسم المستخدم', 'البريد', 'كلمة المرور', 'الدور', 'الفرع', 'الحالة'],
    example: ['مثال - احذف هذا السطر', 'EXAMPLE', '', 'Pass@123', 'مستخدم فرع', 'CAIRO-1', 'نشط'],
    fields: {
      full_name: ['الاسم الكامل', 'الاسم', 'full_name', 'name'],
      username: ['اسم المستخدم', 'المستخدم', 'username', 'user'],
      email: ['البريد', 'البريد الإلكتروني', 'email'],
      password: ['كلمة المرور', 'كلمة السر', 'password'],
      role: ['الدور', 'role'],
      branch: ['الفرع', 'branch'],
      status: ['الحالة', 'status']
    },
    required: ['username']
  }
};

export function itemsTemplate() { return templateFor('items'); }
export function branchesTemplate() { return templateFor('branches'); }
export function usersTemplate() { return templateFor('users'); }

export function rowsToItems(matrix) { return mapSheet(matrix, 'items'); }
export function rowsToBranches(matrix) { return mapSheet(matrix, 'branches'); }
export function rowsToUsers(matrix) { return mapSheet(matrix, 'users'); }

function templateFor(kind) {
  const spec = SHEETS[kind];
  return buildXlsx([spec.headers, spec.example]);
}

function mapSheet(matrix, kind) {
  const spec = SHEETS[kind];
  if (!matrix || !matrix.length) return null;
  const header = matrix[0].map((h) => String(h || '').trim().toLowerCase());
  const index = {};
  Object.keys(spec.fields).forEach((field) => {
    const names = spec.fields[field].map((n) => n.toLowerCase());
    const at = header.findIndex((h) => names.indexOf(h) !== -1);
    if (at >= 0) index[field] = at;
  });
  if (!spec.required.some((field) => index[field] !== undefined)) return null;
  const out = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    if (line.every((c) => !String(c || '').trim())) continue;
    const row = { row: r + 1 };
    Object.keys(spec.fields).forEach((field) => {
      row[field] = index[field] === undefined ? '' : String(line[index[field]] == null ? '' : line[index[field]]).trim();
    });
    out.push(row);
  }
  return out;
}

export function tableFromCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = src.split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const comma = (lines[0].match(/,/g) || []).length;
  const semi = (lines[0].match(/;/g) || []).length;
  const sep = semi > comma ? ';' : ',';
  return lines.map((line) => splitCsvLine(line, sep));
}

export async function readTable(buffer) {
  const files = await unzip(new Uint8Array(buffer));
  const names = Object.keys(files);
  const sheetName = names.filter((n) => /xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort()[0]
    || names.find((n) => /xl\/worksheets\/.+\.xml$/i.test(n));
  if (!sheetName) throw new Error('no sheet');
  const sharedName = names.find((n) => /xl\/sharedStrings\.xml$/i.test(n));
  const shared = sharedName ? sharedStrings(files[sharedName]) : [];
  return sheetRows(files[sheetName], shared);
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function xmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const letters = String(ref || '').replace(/[0-9]/g, '');
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, n - 1);
}

function sharedStrings(xml) {
  const out = [];
  const blocks = String(xml).split(new RegExp('<' + nsTag('si') + '[\\s>]')).slice(1);
  const textRe = new RegExp('<' + nsTag('t') + '\\b[^>]*>([\\s\\S]*?)<\\/' + nsTag('t') + '>', 'g');
  blocks.forEach((block) => {
    const texts = [];
    let m;
    textRe.lastIndex = 0;
    while ((m = textRe.exec(block))) texts.push(decodeXml(m[1]));
    out.push(texts.join(''));
  });
  return out;
}

function sheetRows(xml, shared) {
  const src = String(xml);
  const rows = [];
  const rowRe = new RegExp('<' + nsTag('row') + '\\b[^>]*>([\\s\\S]*?)<\\/' + nsTag('row') + '>', 'g');
  const cellOpenRe = new RegExp('<' + nsTag('c') + '\\b([^>]*?)(\\/?)>', 'g');
  const cellCloseRe = new RegExp('<\\/' + nsTag('c') + '>', 'g');
  const valueRe = new RegExp('<' + nsTag('v') + '\\b[^>]*>([\\s\\S]*?)<\\/' + nsTag('v') + '>');
  const textRe = new RegExp('<' + nsTag('t') + '\\b[^>]*>([\\s\\S]*?)<\\/' + nsTag('t') + '>', 'g');
  let rm;
  while ((rm = rowRe.exec(src))) {
    const inner = rm[1];
    const cells = [];
    cellOpenRe.lastIndex = 0;
    let cm;
    while ((cm = cellOpenRe.exec(inner))) {
      const attrs = cm[1] || '';
      const selfClosing = cm[2] === '/';
      let body = '';
      if (!selfClosing) {
        cellCloseRe.lastIndex = cellOpenRe.lastIndex;
        const close = cellCloseRe.exec(inner);
        if (!close) break;
        body = inner.slice(cellOpenRe.lastIndex, close.index);
        cellOpenRe.lastIndex = cellCloseRe.lastIndex;
      }
      const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || '';
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      let value = '';
      if (type === 'inlineStr') {
        const texts = [];
        let tm;
        textRe.lastIndex = 0;
        while ((tm = textRe.exec(body))) texts.push(decodeXml(tm[1]));
        value = texts.join('');
      } else {
        const v = (body.match(valueRe) || [])[1];
        value = v == null ? '' : decodeXml(v);
        if (type === 's') value = shared[parseInt(value, 10)] || '';
      }
      cells[colIndex(ref)] = value;
    }
    const width = cells.length;
    const line = [];
    for (let i = 0; i < width; i++) line.push(cells[i] == null ? '' : cells[i]);
    rows.push(line);
  }
  return rows;
}

function buildXlsx(matrix) {
  const sheet = sheetXml(matrix);
  const files = {
    '[Content_Types].xml': contentTypes(),
    '_rels/.rels': rootRels(),
    'xl/workbook.xml': workbookXml(),
    'xl/_rels/workbook.xml.rels': workbookRels(),
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': stylesXml()
  };
  return zipStore(files);
}

function sheetXml(matrix) {
  const rows = matrix.map((line, r) => {
    const cells = line.map((value, c) => {
      const ref = colLetter(c) + (r + 1);
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + xmlText(value) + '</t></is></c>';
    }).join('');
    return '<row r="' + (r + 1) + '">' + cells + '</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + rows + '</sheetData></worksheet>';
}

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function contentTypes() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
}

function rootRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
}

function workbookXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Items" sheetId="1" r:id="rId1"/></sheets></workbook>';
}

function workbookRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '</styleSheet>';
}

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.keys(files).forEach((name) => {
    const data = encoder.encode(files[name]);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes, data
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const centralDir = concat(centrals);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(centrals.length), u16(centrals.length),
    u32(centralDir.length), u32(offset), u16(0)
  ]);
  return concat(locals.concat([centralDir, eocd]));
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts) {
  let len = 0;
  parts.forEach((p) => { len += p.length; });
  const out = new Uint8Array(len);
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}

async function unzip(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = findEocd(u8);
  if (eocd < 0) throw new Error('not a spreadsheet');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad spreadsheet');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    files[name] = method === 0 ? new TextDecoder().decode(comp) : new TextDecoder().decode(await inflateRaw(comp));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function findEocd(u8) {
  const min = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= min; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
