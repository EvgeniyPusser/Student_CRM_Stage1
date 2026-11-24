import {rows} from './db.js';
import {Problem} from '../services/security.js';
export function groupScope(user,alias='g'){if(user.roles.includes('admin'))return {sql:'1=1',params:[]};return {sql:`(EXISTS(SELECT 1 FROM group_teachers gt WHERE gt.group_id=${alias}.id AND gt.teacher_id=?) OR EXISTS(SELECT 1 FROM enrollments e WHERE e.group_id=${alias}.id AND e.student_id=?))`,params:[user.id,user.id]};}
export async function canReadGroup(db,user,groupId){const scope=groupScope(user);const [group]=await rows(db,`SELECT g.* FROM study_groups g WHERE g.id=? AND ${scope.sql}`,[groupId,...scope.params]);if(!group)throw new Problem(404,'notFound');return group;}
export async function canReadRoster(db,user,groupId){if(user.roles.includes('admin'))return true;const list=await rows(db,'SELECT 1 FROM group_teachers WHERE group_id=? AND teacher_id=?',[groupId,user.id]);return user.roles.includes('teacher')&&list.length>0;}

export async function groupRoster(db, groupId) {
 const students = await rows(db, `SELECT u.id,u.email,u.first_name,u.last_name,u.phone,
  e.id AS enrollment_id,e.state,e.start_date
  FROM users u JOIN enrollments e ON e.student_id=u.id
  WHERE e.group_id=? ORDER BY u.last_name,u.first_name,u.id`, [groupId]);
 const periods = await rows(db, `SELECT p.enrollment_id,p.start_date,p.end_date
  FROM enrollment_periods p JOIN enrollments e ON e.id=p.enrollment_id
  WHERE e.group_id=? ORDER BY p.start_date,p.id`, [groupId]);
 const byEnrollment = new Map(students.map(student => [student.enrollment_id, []]));
 for (const {enrollment_id,start_date,end_date} of periods) {
  byEnrollment.get(enrollment_id)?.push({start_date,end_date});
 }
 return students.map(student => ({...student, periods: byEnrollment.get(student.enrollment_id)}));
}
