const path = require('node:path');

function getPGlite() {
  try {
    return require('@electric-sql/pglite').PGlite;
  } catch (_) {}
  try {
    const appPath = path.resolve(__dirname, '../../app/node_modules/@electric-sql/pglite');
    return require(appPath).PGlite;
  } catch (_) {}
  if (process.env.MAGIA_TEST_MODULES) {
    try {
      return require(path.join(process.env.MAGIA_TEST_MODULES, '@electric-sql/pglite')).PGlite;
    } catch (_) {}
  }
  throw new Error(
    'Não foi possível carregar @electric-sql/pglite. Execute "npm install --prefix app" para instalar as dependências de desenvolvimento do repositório.'
  );
}

module.exports = {
  getPGlite,
  get PGlite() {
    return getPGlite();
  },
};
