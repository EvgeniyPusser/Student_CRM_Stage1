import {DateTime} from 'luxon';
import {z} from 'zod';
import {rows, transaction} from '../repositories/db.js';
import {zone, iso} from './calendar.js';
import {audit, requireValue} from './security.js';
import {uuid} from './validation.js';

export async function studentAttendance(db, studentId, enrollments) {
  const summary={completed:0,present:0,late:0,absent:0,excused:0,missing:0,percent:null};
  if (!enrollments.length) return summary;
  const groups=new Map(enrollments.map(enrollment=>[enrollment.group_id,enrollment.periods]));
  const placeholders=enrollments.map(()=>'?').join(',');
  const lessons=await rows(db,`SELECT l.group_id,l.starts_at,a.status,s.lesson_id AS snapshot_id
   FROM lessons l LEFT JOIN attendance_snapshots s ON s.lesson_id=l.id
   LEFT JOIN attendance_marks a ON a.lesson_id=l.id AND a.student_id=?
   WHERE l.state='completed' AND l.group_id IN (${placeholders})
   AND (a.student_id IS NOT NULL OR s.lesson_id IS NULL)`,[studentId,...groups.keys()]);
  for (const lesson of lessons) {
    if (lesson.snapshot_id) {
      summary.completed++;
      if (lesson.status==='unmarked') summary.missing++;
      else summary[lesson.status]++;
      continue;
    }
    const date=DateTime.fromISO(iso(lesson.starts_at)).setZone(zone).toISODate();
    if (groups.get(lesson.group_id).some(period=>period.start_date<=date && (!period.end_date||period.end_date>=date))) {
      summary.completed++;
      summary.missing++;
    }
  }
  if (summary.completed && !summary.missing) summary.percent=(summary.present+summary.late)*100/summary.completed;
  return summary;
}

const markInput = z.object({
  studentId: uuid,
  status: z.enum(['unmarked', 'present', 'late', 'absent', 'excused']),
  comment: z.string().max(500),
}).strict();
const attendanceInput = z.object({
  version: z.number().int().positive(),
  marks: z.array(markInput).max(1000),
  complete: z.boolean().default(false),
}).strict();

async function loadLesson(db, actor, lessonId, lock = false) {
  const [lesson] = await rows(db, 'SELECT id,group_id,teacher_id,state,starts_at,ends_at,version FROM lessons WHERE id=?' +
    (lock ? ' FOR UPDATE' : ''), [lessonId]);
  requireValue(lesson && (actor.roles.includes('admin') ||
    (actor.roles.includes('teacher') && actor.id === lesson.teacher_id)), 404, 'notFound');
  return lesson;
}

async function preview(db, lesson) {
  const date = DateTime.fromISO(iso(lesson.starts_at)).setZone(zone).toISODate();
  return rows(db, `SELECT DISTINCT u.id AS studentId,u.first_name,u.last_name,
   'unmarked' AS status,'' AS comment
   FROM enrollments e JOIN enrollment_periods p ON p.enrollment_id=e.id
   JOIN users u ON u.id=e.student_id
   WHERE e.group_id=? AND p.start_date<=? AND (p.end_date IS NULL OR p.end_date>=?)
   ORDER BY u.last_name,u.first_name,u.id`, [lesson.group_id, date, date]);
}

const savedMarks = (db, lessonId) => rows(db, `SELECT a.student_id AS studentId,u.first_name,u.last_name,a.status,a.comment
 FROM attendance_marks a JOIN users u ON u.id=a.student_id
 WHERE a.lesson_id=? ORDER BY u.last_name,u.first_name,u.id`, [lessonId]);

async function snapshot(db, lesson) {
  const [existing] = await rows(db, 'SELECT lesson_id FROM attendance_snapshots WHERE lesson_id=? FOR UPDATE', [lesson.id]);
  if (existing) return savedMarks(db, lesson.id);
  await rows(db, 'SELECT id FROM study_groups WHERE id=? FOR UPDATE', [lesson.group_id]);
  const roster = await preview(db, lesson);
  await rows(db, 'INSERT INTO attendance_snapshots(lesson_id) VALUES(?)', [lesson.id]);
  if (roster.length) {
    const values = roster.map(() => '(?,?)').join(',');
    await rows(db, 'INSERT INTO attendance_marks(lesson_id,student_id) VALUES '+values,
      roster.flatMap(student => [lesson.id, student.studentId]));
  }
  return roster;
}

function response(lesson, marks, now) {
  const starts = new Date(iso(lesson.starts_at)).getTime();
  const ends = new Date(iso(lesson.ends_at)).getTime();
  const canEdit = lesson.state !== 'cancelled' && now >= starts;
  return {marks, version: lesson.version, state: lesson.state, canEdit,
    canComplete: canEdit && lesson.state === 'planned' && now >= ends};
}

export async function readAttendance(actor, lessonIdInput) {
  const lessonId = uuid.parse(lessonIdInput);
  return transaction(async db => {
    const lesson = await loadLesson(db, actor, lessonId, true);
    const now = Date.now();
    if (lesson.state === 'cancelled') {
      const [existing] = await rows(db, 'SELECT lesson_id FROM attendance_snapshots WHERE lesson_id=?', [lessonId]);
      return response(lesson, existing ? await savedMarks(db, lessonId) : [], now);
    }
    const marks = now < new Date(iso(lesson.starts_at)).getTime()
      ? await preview(db, lesson) : await snapshot(db, lesson);
    return response(lesson, marks, now);
  });
}

export async function saveAttendance(actor, lessonIdInput, input) {
  const lessonId = uuid.parse(lessonIdInput);
  const body = attendanceInput.parse(input);
  return transaction(async db => {
    const lesson = await loadLesson(db, actor, lessonId, true);
    const now = Date.now();
    const roster = await snapshotIfEditable(db, lesson, now);
    requireValue(body.version === lesson.version, 409, 'staleAttendance');
    const allowed = new Set(roster.map(mark => mark.studentId));
    requireValue(body.marks.length === allowed.size &&
      new Set(body.marks.map(mark => mark.studentId)).size === allowed.size &&
      body.marks.every(mark => allowed.has(mark.studentId)), 409, 'staleAttendance');
    const completes = body.complete && lesson.state === 'planned';
    if (completes) requireValue(response(lesson, roster, now).canComplete, 409, 'lessonNotEnded');
    if (completes || lesson.state === 'completed') {
      requireValue(body.marks.every(mark => mark.status !== 'unmarked'), 422, 'attendanceIncomplete');
    }
    const previous = new Map(roster.map(mark => [mark.studentId, mark]));
    const changed = body.marks.filter(mark => {
      const existing = previous.get(mark.studentId);
      return mark.status !== existing.status || mark.comment !== existing.comment;
    });
    if (!changed.length && !completes) return response(lesson, roster, now);
    for (const mark of changed) {
      await rows(db, 'UPDATE attendance_marks SET status=?,comment=? WHERE lesson_id=? AND student_id=?',
        [mark.status, mark.comment, lessonId, mark.studentId]);
    }
    const state = completes ? 'completed' : lesson.state;
    await rows(db, 'UPDATE lessons SET state=?,version=version+1 WHERE id=?', [state, lessonId]);
    await audit(db, actor.id, completes ? 'attendance.complete' : 'attendance.save', lessonId, {
      changes: changed.map(mark => ({studentId: mark.studentId, from: previous.get(mark.studentId).status, to: mark.status})),
    });
    return response({...lesson, state, version: lesson.version+1}, await savedMarks(db, lessonId), now);
  });
}

async function snapshotIfEditable(db, lesson, now) {
  requireValue(lesson.state !== 'cancelled', 409, 'lessonCancelled');
  requireValue(now >= new Date(iso(lesson.starts_at)).getTime(), 409, 'lessonNotStarted');
  return snapshot(db, lesson);
}
