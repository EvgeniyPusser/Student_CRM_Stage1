import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {DateTime} from 'luxon';
import {createApp} from '../src/app.js';
import {pool,rows} from '../src/repositories/db.js';
import {migrate} from '../scripts/migrate.js';
import {seed} from '../scripts/seed.js';
import {weekRange,zone,today} from '../src/services/calendar.js';
import {config} from '../src/config.js';
if(!process.env.DB_NAME?.endsWith('_test'))throw new Error('Integration tests require a dedicated *_test database.');
const pass=process.env.DEMO_PASSWORD;
test('Stage 1 with real MySQL',async t=>{
 await migrate();await migrate();await seed();
 const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 function client(){let cookie='',csrf='';return {get cookie(){return cookie},async request(route,method='GET',body,extra={}){const r=await fetch(base+'/api/v1'+route,{method,headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:cookie,...(method!=='GET'?{'X-CSRF-Token':csrf}:{}),...extra},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const json=await r.json();if(json.csrfToken)csrf=json.csrfToken;return {status:r.status,body:json,headers:r.headers};},async login(email){await this.request('/auth/csrf');const result=await this.request('/auth/login','POST',{email,password:pass});assert.equal(result.status,200,JSON.stringify(result.body));return result;}}}
 const admin=client(),student=client(),teacher=client(),teacher2=client(),guest=client();
 try{
 await t.test('Anonymous requests and CSRF/origin checks',async()=>{
 assert.equal((await guest.request('/groups')).status,401);
 await guest.request('/auth/csrf');assert.equal((await guest.request('/auth/login','POST',{email:'admin@crm.example',password:pass},{'X-CSRF-Token':''})).status,403);
 assert.equal((await guest.request('/auth/login','POST',{email:'admin@crm.example',password:pass},{Origin:'https://evil.example'})).status,403);
 assert.equal((await guest.request('/auth/login','POST',{email:'admin@crm.example',password:'wrong'})).status,401);
 });
 await t.test('Password login, cookie flags, separate accounts',async()=>{
 const result=await admin.login('admin@crm.example');assert.match(result.headers.get('set-cookie'),/HttpOnly/i);assert.match(result.headers.get('set-cookie'),/SameSite=Lax/i);assert.equal(result.body.user.roles[0],'admin');
 const [stored]=await rows(pool,'SELECT token_hash FROM sessions WHERE user_id=?',[result.body.user.id]);assert.notEqual(stored.token_hash,admin.cookie.split('=')[1]);
 await student.login('student@crm.example');await teacher.login('teacher@crm.example');await teacher2.login('teacher2@crm.example');
 });
 let studentGroup,otherGroup,teacherId,studentId,courseId;
 await t.test('Object access and contacts are restricted on the server',async()=>{
 const gs=(await student.request('/groups')).body.items;assert.equal(gs.length,1);studentGroup=gs[0];
 otherGroup=(await teacher2.request('/groups')).body.items[0];
 assert.equal((await student.request('/groups/'+otherGroup.id)).status,404);assert.equal((await teacher.request('/groups/'+otherGroup.id)).status,404);
 const detail=(await student.request('/groups/'+studentGroup.id)).body;assert.ok(detail.enrollment);assert.equal(detail.students,undefined);
 const roster=(await teacher.request('/groups/'+studentGroup.id)).body.students;assert.ok(roster[0].email);assert.ok('phone' in roster[0]);assert.ok(roster[0].periods[0].start_date);
 assert.equal((await student.request('/groups/'+studentGroup.id+'/roster.csv')).status,404);
 const all=(await admin.request('/users')).body.items;teacherId=all.find(u=>u.email==='teacher@crm.example').id;studentId=all.find(u=>u.email==='student@crm.example').id;courseId=studentGroup.course_id;
 assert.equal((await student.request('/users/'+teacherId)).status,404);assert.equal((await teacher.request('/users')).status,403);
 assert.equal((await teacher.request('/courses','POST',{title:'Forbidden'})).status,403);
 });
 await t.test('Actual Israel week is Sunday to Saturday with civil-date boundaries',async()=>{
 const schedule=(await student.request('/lessons?weekOf='+today())).body;assert.equal(schedule.weekDays.length,7);assert.equal(DateTime.fromISO(schedule.weekStart).weekday,7);assert.equal(DateTime.fromISO(schedule.weekEnd).weekday,6);
 for(const anchor of ['2026-03-27','2026-10-25','2027-01-01']){const range=weekRange(anchor);assert.equal(new Set(range.weekDays).size,7);assert.equal(DateTime.fromISO(range.weekStart).weekday,7);}
 assert.equal((await student.request('/lessons?weekOf=2026-02-31')).status,422);
 });
 let invited;
 await t.test('Student creation normalizes contacts; invitations are single-use',async()=>{
 const suffix=Date.now();const result=await admin.request('/users','POST',{email:`Learner${suffix}@example.com`,firstName:'Новый',lastName:'Студент',phone:'+972 (50) 234-56-78',language:'ru'});assert.equal(result.status,201,JSON.stringify(result.body));invited=result.body.user;assert.equal(invited.phone,'+972502345678');assert.equal(invited.email,invited.email.toLowerCase());
 assert.equal((await admin.request('/users','POST',{email:invited.email,firstName:'А',lastName:'Б'})).status,409);
 const invitation=client();await invitation.request('/auth/csrf');assert.equal((await invitation.request('/auth/accept-invitation','POST',{token:result.body.localInvitationToken,password:pass})).status,200);assert.equal((await invitation.request('/auth/accept-invitation','POST',{token:result.body.localInvitationToken,password:pass})).status,422);await invitation.login(invited.email);
 });
 let newGroup;
 await t.test('Group creation and concurrent enrollment respect capacity',async()=>{
 const result=await admin.request('/groups','POST',{courseId,code:'TEST-'+Date.now(),title:'Concurrency',startDate:today(),endDate:DateTime.now().plus({months:1}).toISODate(),capacity:1,teacherIds:[teacherId]});assert.equal(result.status,201,JSON.stringify(result.body));newGroup=result.body.id;
 const results=await Promise.all([studentId,invited.id].map(studentId=>admin.request('/groups/'+newGroup+'/enrollments','POST',{studentId,startDate:today()})));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const [{n}]=await rows(pool,'SELECT COUNT(*) n FROM enrollments WHERE group_id=?',[newGroup]);assert.equal(n,1);
 });
 await t.test('Overlapping classes cannot be booked by two simultaneous requests',async()=>{
 const start=DateTime.now().setZone(zone).plus({days:15}).set({hour:18,minute:0,second:0,millisecond:0});
 const body={groupId:newGroup,teacherId,title:'Concurrent lesson',startsAt:start.toISO(),endsAt:start.plus({hours:3}).toISO(),format:'online',location:'https://example.com/demo'};
 const results=await Promise.all([admin.request('/lessons','POST',body),admin.request('/lessons','POST',{...body,groupId:studentGroup.id})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409],JSON.stringify(results));
 const [{n}]=await rows(pool,"SELECT COUNT(*) n FROM lessons WHERE title='Concurrent lesson' AND starts_at=?",[start.toUTC().toSQL({includeOffset:false})]);assert.equal(n,1);
 });
 await t.test('Invalid dates, Israel offsets and data values fail validation',async()=>{
 assert.equal((await admin.request('/groups','POST',{courseId,code:'bad',title:'Bad',startDate:'2026-02-31',endDate:today(),teacherIds:[teacherId]})).status,422);
 assert.equal((await admin.request('/lessons','POST',{groupId:newGroup,teacherId,title:'Bad',startsAt:'2026-11-20T18:00:00+03:00',endsAt:'2026-11-20T21:00:00+03:00',format:'online',location:'https://example.com'})).status,422);
 });
 await t.test('Language is persisted; blocking revokes an existing session',async()=>{
 assert.equal((await student.request('/users/me','PATCH',{language:'en'})).body.user.language,'en');await rows(pool,"UPDATE users SET state='blocked' WHERE id=?",[studentId]);assert.equal((await student.request('/groups')).status,401);await rows(pool,"UPDATE users SET state='active' WHERE id=?",[studentId]);
 });
 await t.test('Logout invalidates sessions; audit contains no password or session tokens',async()=>{
 assert.equal((await admin.request('/auth/logout','POST',{})).status,200);assert.equal((await admin.request('/groups')).status,401);const events=await rows(pool,'SELECT action,details FROM audit_events');assert.ok(events.length>0);assert.ok(!JSON.stringify(events).includes(pass));
 });
 }finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
});
