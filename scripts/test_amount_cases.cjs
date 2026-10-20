function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function salesAmount(text) {
  let value = normalizeText(text);
  const isQuestion = /[?]/.test(String(text || '')) || /\b(?:e\s+se|sera\s+que|fazem|faz|consegue|conseguem|tem\s+como|possivel|da\s+pra)\b/i.test(value);
  if (!isQuestion && (
    /^(?:sem\s+entrada|zero\s+(?:de\s+)?entrada|nenhuma\s+entrada|nada\s+(?:de\s+)?entrada|nao\s+tenho\s+(?:nada\s+(?:de\s+)?)?entrada|0|zero)$/i.test(value.replace(/[.!?]+$/, '').trim())
    || /\b(?:seria\s+sem\s+entrada|quero\s+sem\s+entrada|vou\s+fazer\s+sem\s+entrada|vai\s+ser\s+sem\s+entrada|dar\s+zero\s+de\s+entrada|entrada\s+zero)\b/i.test(value)
  )) return 0;

  // Convert word-boundary 'k' to 'mil': e.g. 15k -> 15 mil
  value = value.replace(/\b(\d+)\s*k(?:zin|zinho|zinha)?\b/gi, (m, g1) => g1 + ' mil');

  const units = { um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cento:100,cem:100 };
  const written = value.match(/\b(?:(?:tenho|vou\s+dar|dou|daria|posso\s+dar|entrada\s+de)\s+)?([a-z]+)(?:\s+e\s+([a-z]+))?\s+mil\b/);
  if (written && units[written[1]] && (!written[2] || (units[written[1]] >= 20 && units[written[2]] < 10))) {
    value = value.replace(written[0], String(units[written[1]] + (written[2] ? units[written[2]] : 0)) + ' mil');
  }

  const match = value.match(/(?:r\$\s*|(?:de\s+)?entrada(?:\s+de)?\s*|tenho\s+|dar\s+|dou\s+|daria\s+|posso\s+dar\s+|vou\s+dar\s+|consigo\s+(?:dar\s+)?|seria\s+|colo(?:co|car)\s+)(\d[\d.,]*)\s*(mil)?\b/i)
    || value.match(/\b(\d[\d.,]*)\s*(mil)?\s*(?:de\s+entrada|de\s+sinal|no\s+sinal)\b/i)
    || value.match(/\b(\d[\d.,]*)\s*(mil)\s*(?:e\s+(?:o\s+)?(?:resto|restante|saldo)|e\s+parcela|e\s+financia|,\s*e\s+o\s+resto|,\s*(?:quanto|como)\s+fica)\b/i)
    || value.match(/^(\d[\d.,]*)\s*(mil)?\b(?=.*(?:parcela|financia|resto|restante))/i)
    || value.match(/^(\d[\d.,]*)\s*(mil)?(?:\s+(?:de\s+entrada|reais))?[.!?]?$/i);

  if (!match) return null;
  if (value.includes('%')) return null;

  const numberStr = match[1];
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(numberStr)) return null;

  const rawNum = Number(numberStr.replace(/\./g, '').replace(',', '.'));
  const hasMil = Boolean(match[2]);

  // If user says 'dou 15 de entrada' (number < 100 without decimals in vehicle context), treat as thousands
  const isShorthandThousands = !hasMil && rawNum > 0 && rawNum < 100 && !numberStr.includes(',') && !numberStr.includes('.')
    && /\b(?:entrada|sinal|dou|daria|tenho)\b/i.test(value);

  const multiplier = (hasMil || isShorthandThousands) ? 100000 : 100;
  const cents = Math.round(rawNum * multiplier);

  if (/-\s*\d|nao (?:tenho|posso|vou)|sem entrada|talvez|\bou\s+\d/.test(value)) return null;
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

const tests = [
  '15 mil e o resto parcela em quantas vezes ?',
  'dou 15 de entrada',
  '15k e o resto financia?',
  '15 mil',
  '15k',
  'tenho 20 de entrada',
  '15 mil de entrada',
  'R$ 15.000,00',
  'consigo dar 15 mil',
  'sem entrada',
  'tem como fazer sem entrada?'
];
tests.forEach(t => console.log(JSON.stringify(t), '->', salesAmount(t)));
