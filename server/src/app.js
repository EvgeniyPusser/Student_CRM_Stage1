import {createGroupController,enrollStudentController,createLessonController} from './controllers/learning.js';
import {readAttendance,saveAttendance,studentAttendance} from './services/attendance.js';
import {addMaterialFile,createMaterial,editMaterial,getMaterial,listMaterials,materialDownload,materialLessons,maxPdfBytes} from './services/materials.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {z,ZodError} from 'zod';
import {DateTime} from 'luxon';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from './config.js';
import {pool,rows,transaction,connectionLost} from './repositories/db.js';
import {groupScope,canReadGroup,canReadRoster,groupRoster} from './repositories/learning.js';
import {Problem,requireValue,id,token,digest,equal,hashPassword,verifyPassword,audit,profile} from './services/security.js';
import {zone,today,weekRange,utc,iso} from './services/calendar.js';
import {text,uuid,date,password,userInput,groupInput,enrollmentInput,lessonInput} from './services/validation.js';
const cookieName='crm_session';
const cookieOptions={httpOnly:true,secure:config.secure,sameSite:'lax',path:'/',maxAge:12*60*60*1000};
function csvCell(value) {
 const text=String(value??'');
 const safe=/^(?:[\t\r\n]|\s*[=+@-])/.test(text)?"'"+text:text;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function createApp(){
 const app=express();app.disable('x-powered-by');app.set('trust proxy',false);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],upgradeInsecureRequests:config.secure?[]:null}}}));
 app.use('/api',(req,res,next)=>{req.requestId=id();res.set('Cache-Control','no-store');res.set('X-Request-ID',req.requestId);next()});
 const standardJson=express.json({limit:'32kb'});
 const attendanceJson=express.json({limit:'3mb'});
 const materialJson=express.json({limit:'1mb'});
 app.use((req,res,next)=>{
  if(req.method==='PUT'&&/^\/api\/v1\/lessons\/[^/]+\/attendance\/?$/i.test(req.path))return attendanceJson(req,res,next);
  if(['POST','PATCH'].includes(req.method)&&/^\/api\/v1\/materials(?:\/[^/]+)?\/?$/i.test(req.path))return materialJson(req,res,next);
  return standardJson(req,res,next);
 });
 app.use(cookieParser());
 app.get('/api/v1/health',async(req,res)=>{await rows(pool,'SELECT 1');res.json({status:'ok',stage:1,database:'mysql'})});
 app.use('/api',async(req,res,next)=>{const raw=req.cookies[cookieName];req.session=null;req.user=null;if(typeof raw==='string'&&/^[a-f0-9]{64}$/.test(raw)){
  const [s]=await rows(pool,'SELECT * FROM sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3) AND last_seen>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR)',[digest(raw)]);
  if(s){if(s.user_id){const u=await profile(pool,s.user_id);if(u?.state==='active')req.user=u;else{await rows(pool,'DELETE FROM sessions WHERE token_hash=?',[s.token_hash]);return next();}}req.session=s;await rows(pool,'UPDATE sessions SET last_seen=UTC_TIMESTAMP(3) WHERE token_hash=?',[s.token_hash]);}
 }next()});
 const csrf=(req,res,next)=>{requireValue(req.get('origin')===config.origin,403,'invalidOrigin');requireValue(req.session&&equal(req.get('x-csrf-token'),req.session.csrf_token),403,'csrf');next()};
 app.get('/api/v1/auth/csrf',async(req,res)=>{if(!req.session){const raw=token(),csrf=token();await rows(pool,'INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,last_seen,expires_at) VALUES(?,NULL,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 12 HOUR))',[digest(raw),csrf]);res.cookie(cookieName,raw,cookieOptions);return res.json({csrfToken:csrf});}res.json({csrfToken:req.session.csrf_token})});
 const limitResponse=(req,res)=>res.status(429).json({code:'rateLimit',messageKey:'errors.rateLimit',requestId:req.requestId});
 const ipLimit=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:'draft-7',legacyHeaders:false,handler:limitResponse});
 const identityLimit=rateLimit({windowMs:15*60*1000,limit:10,keyGenerator:req=>digest(String(req.body?.email||'').trim().toLowerCase()),handler:limitResponse});
 const dummyHash=hashPassword('not-a-real-login-password');
 app.post('/api/v1/auth/login',ipLimit,identityLimit,csrf,async(req,res)=>{const {email,password:plain}=z.object({email:z.string().trim().email().max(254),password:z.string().min(1).max(256)}).parse(req.body);
  const [user]=await rows(pool,'SELECT id,password_hash,state FROM users WHERE email=?',[email.toLowerCase()]);
  const valid=await verifyPassword(user?.password_hash||await dummyHash,plain);
  requireValue(user&&valid&&user.state==='active',401,'invalidCredentials');
  const raw=token(),csrfToken=token();await transaction(async db=>{
   const [locked]=await rows(db,'SELECT state,password_hash FROM users WHERE id=? FOR UPDATE',[user.id]);requireValue(locked.state==='active'&&locked.password_hash===user.password_hash,401,'invalidCredentials');
   await rows(db,'DELETE FROM sessions WHERE token_hash=?',[req.session.token_hash]);
   await rows(db,'INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,last_seen,expires_at) VALUES(?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 12 HOUR))',[digest(raw),user.id,csrfToken]);
   await audit(db,user.id,'auth.login',user.id);
  });res.cookie(cookieName,raw,cookieOptions);res.json({user:await profile(pool,user.id),csrfToken,today:today(),timeZone:zone});
 });
 app.post('/api/v1/auth/accept-invitation',ipLimit,csrf,async(req,res)=>{
  const body=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password}).parse(req.body),hash=await hashPassword(body.password);
  await transaction(async db=>{const [invite]=await rows(db,'SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[digest(body.token)]);requireValue(invite,422,'invalidInvitation');const [u]=await rows(db,'SELECT state FROM users WHERE id=? FOR UPDATE',[invite.user_id]);requireValue(u.state==='invited',409,'conflict');await rows(db,'UPDATE users SET state=\'active\',password_hash=? WHERE id=?',[hash,invite.user_id]);await rows(db,'UPDATE invitations SET used_at=UTC_TIMESTAMP(3) WHERE user_id=? AND used_at IS NULL',[invite.user_id]);await audit(db,invite.user_id,'invitation.accept',invite.user_id);});res.json({ok:true});
 });
 app.use('/api/v1',(req,res,next)=>{requireValue(req.user,401,'unauthenticated');next()});
 app.use('/api/v1',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method))return csrf(req,res,next);next()});
 const admin=(req,res,next)=>{requireValue(req.user.roles.includes('admin'),403,'forbidden');next()};
 app.get('/api/v1/auth/me',(req,res)=>res.json({user:req.user,today:today(),timeZone:zone}));
 app.post('/api/v1/auth/logout',async(req,res)=>{await rows(pool,'DELETE FROM sessions WHERE token_hash=?',[req.session.token_hash]);res.clearCookie(cookieName,{...cookieOptions,maxAge:undefined});res.json({ok:true})});
 app.patch('/api/v1/users/me',async(req,res)=>{const {language}=z.object({language:z.enum(['ru','en'])}).strict().parse(req.body);await rows(pool,'UPDATE users SET language=? WHERE id=?',[language,req.user.id]);res.json({user:await profile(pool,req.user.id)})});
 app.get('/api/v1/users',admin,async(req,res)=>{const limit=50,page=Math.max(1,Math.min(10000,Number(req.query.page)||1));const users=await rows(pool,`SELECT id,email,first_name,last_name,phone,language,state FROM users ORDER BY created_at,id LIMIT ${limit} OFFSET ${(page-1)*limit}`);for(const u of users)u.roles=(await rows(pool,'SELECT role FROM user_roles WHERE user_id=?',[u.id])).map(r=>r.role);res.json({items:users,page,limit})});
 app.get('/api/v1/users/:id',async(req,res)=>{uuid.parse(req.params.id);requireValue(req.user.id===req.params.id||req.user.roles.includes('admin'),404,'notFound');const u=await profile(pool,req.params.id);requireValue(u,404,'notFound');res.json(u)});
 app.get('/api/v1/students/:id/card',async(req,res)=>{
  const studentId=uuid.parse(req.params.id),roles=req.user.roles;
  const isAdmin=roles.includes('admin');
  requireValue(isAdmin||roles.includes('teacher'),404,'notFound');
  const scope=isAdmin?'':' AND EXISTS (SELECT 1 FROM group_teachers gt WHERE gt.group_id=e.group_id AND gt.teacher_id=?)';
  const params=isAdmin?[studentId]:[studentId,req.user.id];
  const enrollments=await rows(pool,`SELECT e.id,e.group_id,e.state,e.start_date,g.code,g.title
   FROM enrollments e JOIN study_groups g ON g.id=e.group_id
   WHERE e.student_id=?${scope} ORDER BY e.start_date DESC,e.id`,params);
  requireValue(isAdmin||enrollments.length,404,'notFound');
  const student=await profile(pool,studentId);
  requireValue(student?.roles.includes('student'),404,'notFound');
  if(enrollments.length){
   const placeholders=enrollments.map(()=>'?').join(',');
   const periods=await rows(pool,`SELECT enrollment_id,start_date,end_date FROM enrollment_periods
    WHERE enrollment_id IN (${placeholders}) ORDER BY start_date,id`,enrollments.map(e=>e.id));
   const byEnrollment=new Map(enrollments.map(e=>[e.id,[]]));
   for(const {enrollment_id,start_date,end_date} of periods) byEnrollment.get(enrollment_id).push({start_date,end_date});
   for(const enrollment of enrollments) enrollment.periods=byEnrollment.get(enrollment.id);
  }
  const result={student,enrollments,attendance:await studentAttendance(pool,studentId,enrollments)};
  if(isAdmin){
   const [record]=await rows(pool,'SELECT note,version FROM student_notes WHERE student_id=?',[studentId]);
   result.staffNote=record||{note:'',version:0};
  }
  res.json(result);
 });
 app.patch('/api/v1/students/:id/note',admin,async(req,res)=>{
  const studentId=uuid.parse(req.params.id);
  const {note,version}=z.object({note:z.string().max(5000),version:z.number().int().nonnegative()}).strict().parse(req.body);
  const result=await transaction(async db=>{
   const [student]=await rows(db,`SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id AND r.role='student'
    WHERE u.id=? FOR UPDATE`,[studentId]);
   requireValue(student,404,'notFound');
   const [current]=await rows(db,'SELECT note,version FROM student_notes WHERE student_id=?',[studentId]);
   requireValue((current?.version||0)===version,409,'staleStaffNote');
   if((current?.note||'')===note)return {note,version};
   if(current)await rows(db,'UPDATE student_notes SET note=?,version=version+1 WHERE student_id=?',[note,studentId]);
   else await rows(db,'INSERT INTO student_notes(student_id,note) VALUES(?,?)',[studentId,note]);
   await audit(db,req.user.id,'student.note.update',studentId);
   return {note,version:version+1};
  });
  res.json(result);
 });
 app.post('/api/v1/users',admin,async(req,res)=>{let body;try{body=userInput.parse(req.body)}catch(e){if(e.message==='invalidPhone')throw new Problem(422,'invalidPhone');throw e;}
  requireValue(config.localInvites,409,'invitationDeliveryNotConfigured');
  const userId=id(),raw=token();await transaction(async db=>{await rows(db,'INSERT INTO users(id,email,first_name,last_name,phone,language) VALUES(?,?,?,?,?,?)',[userId,body.email,body.firstName,body.lastName,body.phone,body.language]);await rows(db,'INSERT INTO user_roles(user_id,role) VALUES(?,\'student\')',[userId]);await rows(db,'INSERT INTO invitations(id,user_id,token_hash,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR))',[id(),userId,digest(raw)]);await audit(db,req.user.id,'user.invite',userId);});
  // Temporary local delivery, enabled explicitly only in development/demo.
  res.status(201).json({user:await profile(pool,userId),localInvitationToken:raw});
 });
 app.get('/api/v1/courses', async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true' && req.user.roles.includes('admin');
  const sql = includeArchived
   ? 'SELECT id,title,description,state FROM courses ORDER BY title LIMIT 100'
   : "SELECT id,title,description,state FROM courses WHERE state='active' ORDER BY title LIMIT 100";
  res.json({items: await rows(pool, sql)});
 });
 app.post('/api/v1/courses',admin,async(req,res)=>{const {title,description}=z.object({title:text.min(2),description:z.string().max(10000).default('')}).strict().parse(req.body),courseId=id();await transaction(async db=>{await rows(db,'INSERT INTO courses(id,title,description) VALUES(?,?,?)',[courseId,title,description]);await audit(db,req.user.id,'course.create',courseId)});res.status(201).json({id:courseId,title,description})});
 app.patch('/api/v1/courses/:id', admin, async (req, res) => {
  const courseId = uuid.parse(req.params.id);
  const changes = z.object({
   title: text.min(2).optional(),
   description: z.string().max(10000).optional(),
   state: z.literal('archived').optional(),
  }).strict().refine(value => Object.keys(value).length > 0).parse(req.body);
  await transaction(async db => {
   const [course] = await rows(db, 'SELECT title,description,state FROM courses WHERE id=? FOR UPDATE', [courseId]);
   requireValue(course, 404, 'notFound');
   const updated = {...course, ...changes};
   if (updated.title === course.title && updated.description === course.description && updated.state === course.state) return;
   await rows(db, 'UPDATE courses SET title=?,description=?,state=? WHERE id=?',
    [updated.title, updated.description, updated.state, courseId]);
   await audit(db, req.user.id, updated.state !== course.state ? 'course.archive' : 'course.update', courseId);
  });
  res.json({ok: true});
 });
 app.get('/api/v1/groups',async(req,res)=>{const scope=groupScope(req.user);const groups=await rows(pool,`SELECT g.*,c.title AS course_title FROM study_groups g JOIN courses c ON c.id=g.course_id WHERE ${scope.sql} ORDER BY g.code LIMIT 100`,scope.params);res.json({items:groups})});
 app.get('/api/v1/groups/:id',async(req,res)=>{uuid.parse(req.params.id);const group=await canReadGroup(pool,req.user,req.params.id);const teachers=await rows(pool,'SELECT u.id,u.first_name,u.last_name FROM users u JOIN group_teachers gt ON gt.teacher_id=u.id WHERE gt.group_id=?',[group.id]);const result={...group,teachers};
  if(await canReadRoster(pool,req.user,group.id))result.students=await groupRoster(pool,group.id);
  else result.enrollment=(await rows(pool,'SELECT id,start_date,state,access_until FROM enrollments WHERE group_id=? AND student_id=?',[group.id,req.user.id]))[0];res.json(result);
 });
 app.get('/api/v1/groups/:id/roster.csv',async(req,res)=>{
  const groupId=uuid.parse(req.params.id);
  requireValue(await canReadRoster(pool,req.user,groupId),404,'notFound');
  const group=await canReadGroup(pool,req.user,groupId);
  const students=await groupRoster(pool,group.id);
  const records=[['ID','Last name','First name','Email','Telephone','Status','Study periods'],
   ...students.map(student=>[student.id,student.last_name,student.first_name,student.email,student.phone,
    student.state,student.periods.map(period=>period.start_date+' – '+(period.end_date||'')).join(' | ')])];
  await audit(pool,req.user.id,'group.rosterExport',group.id);
  res.type('text/csv').attachment('roster-'+group.id+'.csv').send('\ufeff'+records.map(row=>row.map(csvCell).join(',')).join('\r\n'));
 });
 app.post('/api/v1/groups',admin,createGroupController);
 app.post('/api/v1/groups/:id/enrollments',admin,enrollStudentController);
 app.get('/api/v1/lessons', async (req,res) => {
  const {from,until,...range}=weekRange(String(req.query.weekOf||today()));
  const scope=groupScope(req.user);
  const teacherId=req.query.teacherId===undefined ? null : uuid.parse(req.query.teacherId);
  const teacherFilter=teacherId ? ' AND l.teacher_id=?' : '';
  const items=await rows(pool,`SELECT l.*,g.code AS group_code,u.first_name AS teacher_first_name,u.last_name AS teacher_last_name
   FROM lessons l JOIN study_groups g ON g.id=l.group_id JOIN users u ON u.id=l.teacher_id
   WHERE ${scope.sql} AND l.starts_at>=? AND l.starts_at<?${teacherFilter} ORDER BY l.starts_at,l.id`,
   [...scope.params,from,until,...(teacherId?[teacherId]:[])]);
  res.json({...range,items:items.map(row=>({...row,starts_at:iso(row.starts_at),ends_at:iso(row.ends_at)}))});
 });
 app.post('/api/v1/lessons',admin,createLessonController);
 app.get('/api/v1/lessons/:id/attendance',async(req,res)=>res.json(await readAttendance(req.user,req.params.id)));
 app.put('/api/v1/lessons/:id/attendance',async(req,res)=>res.json(await saveAttendance(req.user,req.params.id,req.body)));
 app.get('/api/v1/materials',async(req,res)=>res.json(await listMaterials(req.user)));
 app.get('/api/v1/groups/:id/material-lessons',async(req,res)=>res.json(await materialLessons(req.user,req.params.id)));
 app.get('/api/v1/materials/:id',async(req,res)=>res.json(await getMaterial(req.user,req.params.id)));
 app.post('/api/v1/materials',async(req,res)=>res.status(201).json(await createMaterial(req.user,req.body)));
 app.patch('/api/v1/materials/:id',async(req,res)=>res.json(await editMaterial(req.user,req.params.id,req.body)));
 app.post('/api/v1/materials/:id/files',express.raw({type:'application/pdf',limit:maxPdfBytes}),async(req,res)=>{
  res.status(201).json(await addMaterialFile(req.user,req.params.id,req.query.version,req.get('x-filename'),req.body));
 });
 app.get('/api/v1/materials/:id/files/:fileId',async(req,res,next)=>{
  const file=await materialDownload(req.user,req.params.id,req.params.fileId);
  res.type('application/pdf').download(file.path,file.filename,error=>{if(error)next(error);});
 });
 app.get('/api/v1/notifications',async(req,res)=>{
  const items=await rows(pool,`SELECT n.id,n.kind,n.object_id,n.created_at,n.read_at
   FROM notifications n
   WHERE n.recipient_id=? ORDER BY n.created_at DESC,n.id LIMIT 100`,[req.user.id]);
  res.json({items:items.map(item=>({...item,created_at:iso(item.created_at),read_at:item.read_at?iso(item.read_at):null}))});
 });
 app.patch('/api/v1/notifications/:id',async(req,res)=>{
  const notificationId=uuid.parse(req.params.id);
  const result=await rows(pool,'UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE id=? AND recipient_id=?',
   [notificationId,req.user.id]);
  requireValue(result.affectedRows===1,404,'notFound');
  res.json({ok:true});
 });
 app.use('/api',(req,res)=>res.status(404).json({code:'notFound',messageKey:'errors.notFound',requestId:req.requestId}));
 const client=fileURLToPath(new URL('../../client/dist/',import.meta.url));app.use(express.static(client));app.get('/{*splat}',(req,res)=>res.sendFile(path.join(client,'index.html')));
 app.use((err,req,res,next)=>{let status=err.status||500,code=err.code||'internal';if(err.type==='entity.parse.failed'){status=400;code='invalidJson';}if(err instanceof ZodError){status=422;code='validation';}if(err.code==='ER_DUP_ENTRY'){status=409;code='duplicate';}if(err.code==='ER_LOCK_DEADLOCK'||err.code==='ER_LOCK_WAIT_TIMEOUT'){status=409;code='retryConflict';}if(err.code==='ER_NO_REFERENCED_ROW_2'){status=422;code='invalidReference';}if(connectionLost(err)){status=503;code='databaseUnavailable';}if(status>=500){if(status!==503)code='internal';console.error('Request failed',req.requestId,err.code||err.name);}res.status(status).json({code,messageKey:'errors.'+code,fieldErrors:err instanceof ZodError?err.flatten().fieldErrors:{},requestId:req.requestId||id()})});
 return app;
}
