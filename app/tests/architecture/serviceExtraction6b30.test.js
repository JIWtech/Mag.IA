import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '../../src/app');
const navPath = path.join(appDir, 'AppNavigation.jsx');
const appPath = path.join(appDir, 'App.jsx');

test('6B.30 extrai AppNavigation preservando sidebar desktop, drawer mobile e acessibilidade', () => {
  assert.ok(fs.existsSync(navPath), 'AppNavigation.jsx deve existir');
  const navCode = fs.readFileSync(navPath, 'utf8');
  const appCode = fs.readFileSync(appPath, 'utf8');

  assert.match(navCode, /export function AppNavigation\(/);
  assert.match(navCode, /className="sidebar"/);
  assert.match(navCode, /className="nav-list"/);
  assert.match(navCode, /className="mobile-nav-drawer"/);
  assert.match(navCode, /className="mobile-nav-backdrop"/);
  assert.match(navCode, /role="dialog"/);
  assert.match(navCode, /aria-modal="true"/);
  assert.match(navCode, /aria-label="Navegação principal"/);
  assert.match(appCode, /import\s*\{\s*AppNavigation\s*\}\s*from\s*['"]\.\/AppNavigation(?:\.jsx)?['"]/);
  assert.match(appCode, /<AppNavigation[\s\S]*active=\{active\}[\s\S]*menu=\{menu\}/);
  assert.doesNotMatch(appCode, /<aside className="sidebar">/);
  assert.doesNotMatch(appCode, /<aside id="mobile-nav-drawer"/);
});

test('6B.30 AppNavigation não possui variáveis livres nem ciclos com App', () => {
  assert.ok(fs.existsSync(navPath), 'AppNavigation.jsx deve existir');
  const navCode = fs.readFileSync(navPath, 'utf8');
  const ast = parser.parse(navCode, { sourceType: 'module', plugins: ['jsx'] });
  const free = new Set();
  const globals = new Set(['String', 'Array', 'Boolean', 'undefined']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], []);
  assert.doesNotMatch(navCode, /from ['"]\.\/App(?:\.jsx)?['"]/);
});

test('6B.30 contratos funcionais de navegação: seleção de abas, drawer mobile, fechamento e tenant', () => {
  assert.ok(fs.existsSync(navPath), 'AppNavigation.jsx deve existir');
  const esbuild = createRequire(import.meta.url)('esbuild');
  const baseRequire = createRequire(navPath);
  const customRequire = (specifier) => {
    if (specifier.endsWith('.png')) return '/mock/noria_logo.png';
    return baseRequire(specifier);
  };

  const code = fs.readFileSync(navPath, 'utf8');
  const compiled = esbuild.transformSync(code, { loader: 'jsx', format: 'cjs' });

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', compiled.code);
  fn(customRequire, mod, mod.exports);

  const { AppNavigation } = mod.exports;

  const mockMenu = [
    { id: 'dashboard', label: 'Dashboard', icon: () => null },
    { id: 'conversas', label: 'Conversas', icon: () => null },
    { id: 'kanban', label: 'Kanban', icon: () => null },
  ];

  const findElements = (node, predicate, acc = []) => {
    if (!node) return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node)) {
      for (const child of node) findElements(child, predicate, acc);
    } else if (node.props?.children) {
      findElements(node.props.children, predicate, acc);
    }
    return acc;
  };

  // 1. Desktop: renderiza itens e destaca ativo
  let selectedPage = '';
  const vnodeDesktop = AppNavigation({
    active: 'conversas',
    menu: mockMenu,
    mobileNavOpen: false,
    onSelectPage: (id) => { selectedPage = id; },
    selectedTenant: { name: 'Genesis Automóveis' },
  });

  const navItems = findElements(vnodeDesktop, n => typeof n.props?.className === 'string' && n.props.className.includes('nav-item'));
  assert.equal(navItems.length, 3, 'Deve renderizar 3 itens de navegação desktop');
  assert.ok(navItems[1].props.className.includes('active'), 'O item ativo deve conter a classe active');
  assert.ok(!navItems[0].props.className.includes('active'), 'Item inativo não deve ter classe active');

  // Clique em item desktop
  navItems[0].props.onClick();
  assert.equal(selectedPage, 'dashboard', 'Clique em item desktop deve chamar onSelectPage com o id correto');

  // Drawer mobile fechado não deve renderizar backdrop nem drawer
  const drawersClosed = findElements(vnodeDesktop, n => n.props?.className === 'mobile-nav-drawer');
  assert.equal(drawersClosed.length, 0, 'Drawer mobile não deve estar presente quando mobileNavOpen=false');

  // 2. Mobile: renderiza drawer aberto e aciona callbacks
  let closeFired = false;
  selectedPage = '';
  const vnodeMobile = AppNavigation({
    active: 'dashboard',
    menu: mockMenu,
    mobileNavOpen: true,
    onCloseMobileNav: () => { closeFired = true; },
    onSelectPage: (id) => { selectedPage = id; },
    selectedTenant: { name: 'Genesis Automóveis' },
  });

  const drawersOpen = findElements(vnodeMobile, n => n.props?.className === 'mobile-nav-drawer');
  assert.equal(drawersOpen.length, 1, 'Drawer mobile deve estar presente quando mobileNavOpen=true');

  const backdrops = findElements(vnodeMobile, n => n.props?.className === 'mobile-nav-backdrop');
  assert.equal(backdrops.length, 1, 'Backdrop mobile deve estar presente quando mobileNavOpen=true');

  // Clique no backdrop fecha drawer
  backdrops[0].props.onClick();
  assert.equal(closeFired, true, 'Clique no backdrop deve disparar onCloseMobileNav');

  // Clique no botão de fechar drawer
  closeFired = false;
  const closeBtn = findElements(vnodeMobile, n => n.props?.className?.includes('close-drawer-btn'))[0];
  closeBtn.props.onClick();
  assert.equal(closeFired, true, 'Clique no botão X deve disparar onCloseMobileNav');

  // Clique em item mobile seleciona página e fecha drawer
  closeFired = false;
  selectedPage = '';
  const mobileNavItems = findElements(vnodeMobile, n => typeof n.props?.className === 'string' && n.props.className.includes('mobile-nav-item'));
  assert.equal(mobileNavItems.length, 3, 'Deve renderizar 3 itens de navegação mobile');
  mobileNavItems[2].props.onClick();
  assert.equal(selectedPage, 'kanban', 'Clique em item mobile deve chamar onSelectPage');
  assert.equal(closeFired, true, 'Clique em item mobile deve chamar onCloseMobileNav');

  // Informação do tenant no rodapé do drawer
  const tenantInfo = findElements(vnodeMobile, n => n.props?.className === 'mobile-tenant-info')[0];
  assert.ok(tenantInfo, 'Rodapé mobile deve conter informações do tenant');
});
