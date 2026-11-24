import {DateTime} from 'luxon';
import {fileURLToPath} from 'node:url';
import {pool,rows,transaction} from '../src/repositories/db.js';
import {hashPassword,id} from '../src/services/security.js';
import {zone,utc} from '../src/services/calendar.js';
export async function seed(){if(!['demo','development'].includes(process.env.APP_ENV||'development'))throw new Error('Demo seed is disabled');const pass=process.env.DEMO_PASSWORD;if(!pass||pass.length<12)throw new Error('Set DEMO_PASSWORD (12+ characters)');const hash=await hashPassword(pass);const now=DateTime.now().setZone(zone),start=now.minus({days:30}).toISODate(),end=now.plus({days:120}).toISODate();
 await transaction(async db=>{
  const accounts=[['admin@crm.example','Илья','Администратор','admin'],['admin2@crm.example','Елена','Администратор','admin'],['teacher@crm.example','Алексей','Миронов','teacher'],['teacher2@crm.example','Ирина','Рейз','teacher'],['student@crm.example','Мария','Волкова','student'],['student2@crm.example','Даниил','Левин','student']];
  const users=[];for(const [email,first,last,role] of accounts){let [u]=await rows(db,'SELECT id FROM users WHERE email=?',[email]);if(!u){u={id:id()};await rows(db,'INSERT INTO users(id,email,first_name,last_name,state,password_hash) VALUES(?,?,?,?,\'active\',?)',[u.id,email,first,last,hash]);await rows(db,'INSERT INTO user_roles(user_id,role) VALUES(?,?)',[u.id,role]);}users.push(u.id);}
  if((await rows(db,'SELECT id FROM study_groups LIMIT 1')).length)return;
  const course=id();await rows(db,'INSERT INTO courses(id,title,description) VALUES(?,?,?)',[course,'Fullstack Development','React · Express · MySQL']);
  for(let i=0;i<2;i++){const g=id(),en=id(),teacher=users[2+i],student=users[4+i];await rows(db,'INSERT INTO study_groups(id,course_id,code,title,start_date,end_date,capacity) VALUES(?,?,?,?,?,?,?)',[g,course,i===0?'FS-66':'WEB-04',i===0?'Fullstack Development':'Frontend Essentials',start,end,16]);await rows(db,'INSERT INTO group_teachers(group_id,teacher_id) VALUES(?,?)',[g,teacher]);await rows(db,'INSERT INTO enrollments(id,student_id,group_id,start_date,state) VALUES(?,?,?,?,\'studying\')',[en,student,g,start]);await rows(db,'INSERT INTO enrollment_periods(id,enrollment_id,start_date) VALUES(?,?,?)',[id(),en,start]);const lessonStart=now.plus({days:1+i}).set({hour:18,minute:0,second:0,millisecond:0}),lessonEnd=lessonStart.plus({hours:3});await rows(db,'INSERT INTO lessons(id,group_id,teacher_id,title,starts_at,ends_at,format,location) VALUES(?,?,?,?,?,?,?,?)',[id(),g,teacher,i===0?'React: компоненты и состояние':'HTML и CSS',utc(lessonStart.toISO()),utc(lessonEnd.toISO()),'online','https://example.com/demo-lesson']);}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{await seed();console.log('Fictional demo records ready; existing passwords were not changed.');}finally{await pool.end();}}
