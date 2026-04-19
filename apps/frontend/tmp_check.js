
const fs = require('fs');
let babelParser;
try {
  babelParser = require('@babel/parser');
} catch(e) {
  console.log('No babel');
  process.exit(1);
}
const code = fs.readFileSync('app/sessions/[key]/telemetry/page.tsx', 'utf-8');
try {
  babelParser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log('Success');
} catch (err) {
  console.log(err.message);
  console.log('Error at Line:', err.loc.line, 'Col:', err.loc.column);
}
