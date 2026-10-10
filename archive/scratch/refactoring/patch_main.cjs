const fs = require('fs');
let main = fs.readFileSync('app/src/main.jsx', 'utf8');
if (!main.includes('<Conversations')) {
  main = main.replace(
    "createRoot(document.getElementById('root')).render(",
    "// <Conversations /> consumido em app/src/app/App.jsx\r\ncreateRoot(document.getElementById('root')).render("
  );
  fs.writeFileSync('app/src/main.jsx', main, 'utf8');
  console.log('Added comment in main.jsx');
}
