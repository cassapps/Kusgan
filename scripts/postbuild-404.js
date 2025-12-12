import fs from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');
const indexPath = path.join(distDir, 'index.html');
const notFoundPath = path.join(distDir, '404.html');

async function main() {
  const html = await fs.readFile(indexPath, 'utf8');
  await fs.writeFile(notFoundPath, html, 'utf8');
}

main().catch((err) => {
  console.error('[postbuild-404] failed:', err);
  process.exitCode = 1;
});
