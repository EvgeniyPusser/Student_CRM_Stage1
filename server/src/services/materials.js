import {PDFDocument} from 'pdf-lib';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {pool,rows,transaction} from '../repositories/db.js';
import {audit,id,Problem,requireValue} from './security.js';
import {today} from './calendar.js';
import {uuid} from './validation.js';

export const maxPdfBytes=10*1024*1024;
const fileRoot=process.env.PRIVATE_FILE_DIR
  ? resolve(process.env.PRIVATE_FILE_DIR)
  : fileURLToPath(new URL('../../../.private-files/',import.meta.url));
const content=z.object({
  title:z.string().trim().min(1).max(200),
  body:z.string().max(100000),
  links:z.array(z.string().trim().max(2048).url().refine(value=>/^https?:\/\//i.test(value))).max(20),
  lessonId:uuid.nullable(),
}).strict();
const createInput=content.extend({groupId:uuid});
const editInput=content.partial().extend({
  version:z.number().int().positive(),
  state:z.enum(['published','archived']).optional(),
}).strict();

function scope(user) {
  if(user.roles.includes('admin'))return {sql:'1=1',params:[]};
  return {
    sql:`(EXISTS(SELECT 1 FROM group_teachers gt WHERE gt.group_id=g.id AND gt.teacher_id=?)
     OR (m.state='published' AND EXISTS(SELECT 1 FROM enrollments e
     WHERE e.group_id=g.id AND e.student_id=? AND
     (e.state='studying' OR (e.state IN ('completed','withdrawn') AND e.access_until>=?)))))`,
    params:[user.roles.includes('teacher')?user.id:null,user.roles.includes('student')?user.id:null,today()],
  };
}

async function canManage(db,user,groupId) {
  if(user.roles.includes('admin'))return true;
  if(!user.roles.includes('teacher'))return false;
  const [assigned]=await rows(db,'SELECT 1 FROM group_teachers WHERE group_id=? AND teacher_id=?',[groupId,user.id]);
  return Boolean(assigned);
}

const publicMaterial=`m.id,m.group_id,m.lesson_id,m.title,m.body,m.links,m.state,m.version,g.code AS group_code,
 u.first_name AS author_first_name,u.last_name AS author_last_name`;

async function files(db,materialId) {
  return rows(db,'SELECT id,filename,bytes,file_version FROM material_files WHERE material_id=? ORDER BY file_version DESC',[materialId]);
}

function normalize(material) {
  return {...material,links:typeof material.links==='string'?JSON.parse(material.links):material.links};
}

export async function listMaterials(user) {
  const filter=scope(user);
  const items=await rows(pool,`SELECT m.id,m.group_id,m.title,m.state,g.code AS group_code
   FROM materials m JOIN study_groups g ON g.id=m.group_id WHERE ${filter.sql}
   ORDER BY m.created_at DESC,m.id LIMIT 100`,filter.params);
  const isAdmin=user.roles.includes('admin');
  const managedGroups=isAdmin||user.roles.includes('teacher')
    ? await rows(pool,`SELECT g.id,g.code,g.title FROM study_groups g
      WHERE g.state IN ('preparation','learning') AND ${isAdmin?'1=1':
      'EXISTS(SELECT 1 FROM group_teachers gt WHERE gt.group_id=g.id AND gt.teacher_id=?)'} ORDER BY g.code`,
      isAdmin?[]:[user.id]) : [];
  return {items,managedGroups};
}

export async function materialLessons(user,groupIdInput) {
  const groupId=uuid.parse(groupIdInput);
  requireValue(await canManage(pool,user,groupId),404,'notFound');
  const items=await rows(pool,'SELECT id,title,starts_at FROM lessons WHERE group_id=? ORDER BY starts_at DESC,id LIMIT 100',[groupId]);
  return {items};
}

export async function getMaterial(user,materialIdInput) {
  const materialId=uuid.parse(materialIdInput),filter=scope(user);
  const [material]=await rows(pool,`SELECT ${publicMaterial} FROM materials m
   JOIN study_groups g ON g.id=m.group_id JOIN users u ON u.id=m.author_id
   WHERE m.id=? AND ${filter.sql}`,[materialId,...filter.params]);
  requireValue(material,404,'notFound');
  const canEdit=await canManage(pool,user,material.group_id);
  const attachments=await files(pool,materialId);
  return {...normalize(material),files:canEdit?attachments:attachments.slice(0,1),canEdit};
}

async function validateLesson(db,lessonId,groupId) {
  if(!lessonId)return;
  const [lesson]=await rows(db,'SELECT id FROM lessons WHERE id=? AND group_id=?',[lessonId,groupId]);
  requireValue(lesson,422,'invalidLesson');
}

export async function createMaterial(user,input) {
  const body=createInput.parse(input),materialId=id();
  await transaction(async db=>{
    const [group]=await rows(db,'SELECT state FROM study_groups WHERE id=? FOR UPDATE',[body.groupId]);
    requireValue(group&&await canManage(db,user,body.groupId),404,'notFound');
    requireValue(['preparation','learning'].includes(group.state),409,'groupClosed');
    await validateLesson(db,body.lessonId,body.groupId);
    await rows(db,`INSERT INTO materials(id,group_id,lesson_id,author_id,title,body,links)
     VALUES(?,?,?,?,?,?,?)`,[materialId,body.groupId,body.lessonId,user.id,body.title,body.body,JSON.stringify(body.links)]);
    await audit(db,user.id,'material.create',materialId);
  });
  return getMaterial(user,materialId);
}

async function lockMaterial(db,user,materialId,version) {
  const [material]=await rows(db,`SELECT m.*,g.state AS group_state FROM materials m
   JOIN study_groups g ON g.id=m.group_id WHERE m.id=? FOR UPDATE`,[materialId]);
  requireValue(material&&await canManage(db,user,material.group_id),404,'notFound');
  requireValue(material.version===version,409,'staleMaterial');
  requireValue(material.state!=='archived',409,'materialArchived');
  return normalize(material);
}

export async function editMaterial(user,materialIdInput,input) {
  const materialId=uuid.parse(materialIdInput),body=editInput.parse(input);
  await transaction(async db=>{
    const current=await lockMaterial(db,user,materialId,body.version);
    const links=body.links??current.links,title=body.title??current.title,text=body.body??current.body;
    const lessonId=body.lessonId===undefined?current.lesson_id:body.lessonId;
    const state=body.state??current.state;
    await validateLesson(db,lessonId,current.group_id);
    if(state==='published') {
      requireValue(['preparation','learning'].includes(current.group_state),409,'groupClosed');
      const [attachment]=await rows(db,'SELECT id FROM material_files WHERE material_id=? LIMIT 1',[materialId]);
      requireValue(text.trim()||links.length||attachment,422,'emptyMaterial');
    }
    const publish=state==='published'&&current.state==='draft';
    await rows(db,`UPDATE materials SET title=?,body=?,links=?,lesson_id=?,state=?,version=version+1
     WHERE id=?`,[title,text,JSON.stringify(links),lessonId,state,materialId]);
    if(publish)await rows(db,`INSERT INTO notifications(id,recipient_id,kind,object_id)
     SELECT UUID(),e.student_id,'materialPublished',? FROM enrollments e
     WHERE e.group_id=? AND e.student_id<>? AND e.state='studying'
     ON DUPLICATE KEY UPDATE id=notifications.id`,[materialId,current.group_id,user.id]);
    await audit(db,user.id,publish?'material.publish':state==='archived'?'material.archive':'material.update',materialId);
  });
  return getMaterial(user,materialId);
}

export async function addMaterialFile(user,materialIdInput,versionInput,filenameInput,bytes) {
  const materialId=uuid.parse(materialIdInput);
  const version=z.coerce.number().int().positive().parse(versionInput);
  let filename;
  try { filename=decodeURIComponent(filenameInput||''); }
  catch { throw new Problem(422,'invalidPdf'); }
  requireValue(filename.length<=200&&/^[^\/\\\x00-\x1f]+\.pdf$/i.test(filename)&&
    Buffer.isBuffer(bytes)&&bytes.length<=maxPdfBytes&&bytes.subarray(0,5).toString()==='%PDF-',422,'invalidPdf');
  const material=await getMaterial(user,materialId);
  requireValue(material.canEdit,404,'notFound');
  try {
    const pdf=await PDFDocument.load(bytes);
    requireValue(pdf.getPageCount()>0,422,'invalidPdf');
  } catch { throw new Problem(422,'invalidPdf'); }

  const fileId=id();
  await mkdir(fileRoot,{recursive:true,mode:0o700});
  await transaction(async db=>{
    const current=await lockMaterial(db,user,materialId,version);
    requireValue(['preparation','learning'].includes(current.group_state),409,'groupClosed');
    const [last]=await rows(db,'SELECT MAX(file_version) AS version FROM material_files WHERE material_id=?',[materialId]);
    await writeFile(resolve(fileRoot,fileId),bytes,{flag:'wx',mode:0o600});
    await rows(db,'INSERT INTO material_files(id,material_id,file_version,filename,bytes) VALUES(?,?,?,?,?)',
      [fileId,materialId,(last.version||0)+1,filename,bytes.length]);
    await rows(db,'UPDATE materials SET version=version+1 WHERE id=?',[materialId]);
    await audit(db,user.id,'material.file.upload',materialId,{fileId});
  });
  return getMaterial(user,materialId);
}

export async function materialDownload(user,materialId,fileIdInput) {
  const fileId=uuid.parse(fileIdInput);
  const material=await getMaterial(user,materialId);
  const file=material.files.find(item=>item.id===fileId);
  requireValue(file,404,'notFound');
  return {filename:file.filename,path:resolve(fileRoot,file.id)};
}
