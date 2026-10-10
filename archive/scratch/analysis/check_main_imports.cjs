const fs = require('fs');

['app/src/app/App.jsx', 'app/src/app/AppErrorBoundary.jsx', 'app/src/app/appStorage.js'].forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const hasImportFromMain = /from\s+['"].*main/i.test(content);
  console.log(f + ' imports from main.jsx:', hasImportFromMain);
});
