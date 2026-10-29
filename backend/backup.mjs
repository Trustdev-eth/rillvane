import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
process.umask(0o077);
const source=resolve(process.env.DATABASE_PATH||'rillvane.sqlite'),target=resolve(process.argv[2]||'backups/rillvane-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
if(source===target)throw new Error('Backup destination must differ from the source.');
const db=new DatabaseSync(source,{readOnly:true});
try{await mkdir(dirname(target),{recursive:true,mode:0o700});await backup(db,target);await chmod(target,0o600);const restored=new DatabaseSync(target,{readOnly:true});try{if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed.');}finally{restored.close();}process.stdout.write(JSON.stringify({event:'backup.verified',path:target})+'\n');}finally{db.close();}
