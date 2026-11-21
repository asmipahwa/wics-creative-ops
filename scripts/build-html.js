// Converts the wiki + meeting-notes markdown into HTML files that Apps Script uploads as Google Docs.
// Run: npm run build:html   (then npx clasp push)
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const style =
  '<style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}code{font-family:"Roboto Mono",monospace}</style>';
[
  ['docs/wiki/wiki.md', 'src/wiki.html'],
  ['templates/meeting-notes.md', 'src/meeting_notes.html'],
].forEach(([from, to]) => {
  const md = fs.readFileSync(path.join(root, from), 'utf8');
  // marked URL-encodes {{X}} inside links; turn it back so Apps Script can fill in the real link.
  fs.writeFileSync(
    path.join(root, to),
    '<html><head><meta charset="utf-8">' +
      style +
      '</head><body>' +
      marked.parse(md).replace(/%7B%7B([A-Z_]+)%7D%7D/g, '{{$1}}') +
      '</body></html>\n',
  );
  console.log(from + ' → ' + to);
});
