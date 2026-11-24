import {randomBytes,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import {rows} from '../repositories/db.js';
export const id=()=>randomUUID();
export const token=()=>randomBytes(32).toString('hex');
export const digest=s=>createHash('sha256').update(String(s)).digest('hex');
export const hashPassword=password=>argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
export const verifyPassword=(hash,password)=>argon2.verify(hash,password);
export function equal(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export class Problem extends Error{constructor(status,code,fields={}){super(code);this.status=status;this.code=code;this.fields=fields;}}
export const requireValue=(condition,status,code)=>{if(!condition)throw new Problem(status,code)};
export const audit=(db,actor,action,object,details={})=>rows(db,'INSERT INTO audit_events(id,actor_id,action,object_id,details) VALUES(?,?,?,?,?)',[id(),actor,action,object,JSON.stringify(details)]);
export async function profile(db,userId){const [u]=await rows(db,'SELECT id,email,first_name,last_name,phone,language,state FROM users WHERE id=?',[userId]);if(!u)return null;u.roles=(await rows(db,'SELECT role FROM user_roles WHERE user_id=?',[userId])).map(x=>x.role);return u;}
