import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../.env',import.meta.url));
try{await writeFile(path,`APP_ENV=demo\nAPP_ORIGIN=http://localhost:8080\nCOOKIE_SECURE=false\nLOCAL_INVITES=true\nDB_NAME=student_crm\nDB_USER=crm\nDB_PASSWORD=${randomBytes(24).toString('hex')}\nMYSQL_ROOT_PASSWORD=${randomBytes(24).toString('hex')}\nDEMO_PASSWORD=${randomBytes(18).toString('base64url')}\n`,{flag:'wx',mode:0o600});console.log('Created .env. Demo login password is in DEMO_PASSWORD. Keep this file private.');}catch(e){if(e.code==='EEXIST')console.log('.env already exists; unchanged.');else throw e;}
