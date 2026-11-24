import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pool,rows} from '../src/repositories/db.js';
export async function migrate(){const db=await pool.getConnection();try{
 const lock=await rows(db,"SELECT GET_LOCK('student_crm_migrations',30) AS acquired");if(lock[0].acquired!==1)throw new Error('Migration lock unavailable');
 await rows(db,'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
 const dir=fileURLToPath(new URL('../database/migrations/',import.meta.url));
 for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){
  const sql=await readFile(dir+name,'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
  const done=await rows(db,'SELECT checksum FROM schema_migrations WHERE name=?',[name]);
  if(done.length){if(done[0].checksum!==checksum)throw new Error('Applied migration changed: '+name);continue;}
  // MySQL DDL is not transactional. Failed migrations stop startup; do not stamp partial results.
  for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await rows(db,statement);
  await rows(db,'INSERT INTO schema_migrations(name,checksum) VALUES(?,?)',[name,checksum]);
 }
}finally{await rows(db,"SELECT RELEASE_LOCK('student_crm_migrations')");db.release();}}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{await migrate();console.log('Migrations applied');}finally{await pool.end();}}
