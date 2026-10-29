import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../dist/vendor/',import.meta.url),{recursive:true});
await build({
  stdin:{contents:"export {Transaction,VersionedTransaction} from '@solana/web3.js';",resolveDir:process.cwd()},
  bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof',
  outfile:'dist/vendor/solana-wallet.js'
});
await copyFile('node_modules/@solana/web3.js/LICENSE','dist/vendor/solana-wallet.LICENSE');
console.log('Built the local Solana transaction decoder.');
