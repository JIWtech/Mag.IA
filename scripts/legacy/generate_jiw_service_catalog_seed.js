const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const xlsxPath = path.resolve('magia/clients/jiw/planilha_custos_servicos_ti.xlsx');
const outputPath = path.resolve('magia/supabase/seeds/jiw_service_catalog_seed.sql');
const sourceUrl = 'https://docs.google.com/spreadsheets/d/1zRCmrFVhX8es_XNuvxbvMyeLuvFnbjhL-1WRsu5UoPc/edit?usp=sharing';

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value) {
  return decodeXml(String(value || '').replace(/<[^>]+>/g, ''));
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (value === null || value === undefined || value === '') return 'null';
  const normalized = String(value).replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? String(number) : 'null';
}

function parseAttributes(tag) {
  const attrs = {};
  const attrRegex = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tag))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function columnFromCellRef(ref) {
  return String(ref || '').replace(/[0-9]/g, '');
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRegex = /<si[\s\S]*?<\/si>/g;
  const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(xml))) {
    const si = siMatch[0];
    let text = '';
    let tMatch;
    while ((tMatch = tRegex.exec(si))) {
      text += decodeXml(tMatch[1]);
    }
    if (!text) text = stripTags(si);
    strings.push(text);
  }
  return strings;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml))) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const row = { number: Number(rowAttrs.r), cells: {} };
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
      const attrs = parseAttributes(cellMatch[1]);
      const column = columnFromCellRef(attrs.r);
      const valueMatch = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/);
      const rawValue = valueMatch ? decodeXml(valueMatch[1]) : '';
      row.cells[column] = attrs.t === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
    }
    rows.push(row);
  }
  return rows;
}

function main() {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Arquivo nao encontrado: ${xlsxPath}`);
  }

  const tmpDir = path.join(os.tmpdir(), `magia-jiw-xlsx-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  childProcess.execFileSync('tar', ['-xf', xlsxPath, '-C', tmpDir], { stdio: 'ignore' });

  const sharedStrings = parseSharedStrings(fs.readFileSync(path.join(tmpDir, 'xl/sharedStrings.xml'), 'utf8'));
  const sheetXml = fs.readFileSync(path.join(tmpDir, 'xl/worksheets/sheet1.xml'), 'utf8');
  const rows = parseSheet(sheetXml, sharedStrings);

  const services = rows
    .filter((row) => row.number >= 5 && row.cells.A)
    .map((row) => ({
      external_id: row.cells.A,
      category: row.cells.B,
      name: row.cells.C,
      description: row.cells.D,
      billing_unit: row.cells.E,
      price: row.cells.F,
      estimated_hours: row.cells.G,
      notes: row.cells.H,
    }))
    .filter((service) => service.name);

  const values = services.map((service) => `(
    'google_sheet_jiw_costs',
    ${sqlString(service.external_id)},
    ${sqlString(service.category)},
    ${sqlString(service.name)},
    ${sqlString(service.description)},
    ${sqlString(service.billing_unit)},
    ${sqlNumber(service.price)},
    ${sqlNumber(service.estimated_hours)},
    ${sqlString(service.notes)},
    jsonb_build_object('source_url', ${sqlString(sourceUrl)}, 'local_file', 'magia/clients/jiw/planilha_custos_servicos_ti.xlsx')
  )`).join(',\n');

  const sql = `-- Seed gerado automaticamente a partir da planilha da JIW.
-- Fonte local: magia/clients/jiw/planilha_custos_servicos_ti.xlsx
-- Fonte remota: ${sourceUrl}
-- Total de servicos: ${services.length}

insert into tenant_service_catalog (
  tenant_id,
  external_source,
  external_id,
  category,
  name,
  description,
  billing_unit,
  price,
  estimated_hours,
  notes,
  metadata
)
select
  t.id,
  services.external_source,
  services.external_id,
  services.category,
  services.name,
  services.description,
  services.billing_unit,
  services.price,
  services.estimated_hours,
  services.notes,
  services.metadata
from tenants t
cross join (
  values
${values}
) as services (
  external_source,
  external_id,
  category,
  name,
  description,
  billing_unit,
  price,
  estimated_hours,
  notes,
  metadata
)
where t.slug = 'jiw'
on conflict (tenant_id, external_source, external_id) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description,
    billing_unit = excluded.billing_unit,
    price = excluded.price,
    estimated_hours = excluded.estimated_hours,
    notes = excluded.notes,
    metadata = excluded.metadata,
    active = true,
    updated_at = now();

select
  'jiw_service_catalog_seed_ok' as status,
  count(*) as service_count
from tenant_service_catalog c
join tenants t on t.id = c.tenant_id
where t.slug = 'jiw'
  and c.external_source = 'google_sheet_jiw_costs';
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, sql, 'utf8');
  console.log(`Seed gerado: ${outputPath}`);
  console.log(`Servicos: ${services.length}`);
}

main();
