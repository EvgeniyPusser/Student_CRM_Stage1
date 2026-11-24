import React, {useEffect,useState} from 'react';

const statuses = {
  unmarked: ['Не отмечен', 'Unmarked'],
  present: ['Присутствовал', 'Present'],
  late: ['Опоздал', 'Late'],
  absent: ['Отсутствовал', 'Absent'],
  excused: ['Уважительная причина', 'Excused'],
};

export default function Attendance({lesson, api, t, close, onSave, describeError, field: Field}) {
  const endpoint = '/lessons/' + lesson.id + '/attendance';
  const [record,setRecord] = useState(null);
  const [marks,setMarks] = useState([]);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api(endpoint).then(result => {
      if (active) { setRecord(result); setMarks(result.marks); }
    }).catch(problem => {
      if (active) setError(describeError(problem));
    });
    return () => { active = false; };
  }, [endpoint]);

  const update = (studentId,change) => {
    setNotice('');
    setMarks(current => current.map(mark => mark.studentId === studentId ? {...mark,...change} : mark));
  };

  async function save(complete) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {version: record.version, complete,
        marks: marks.map(({studentId,status,comment}) => ({studentId,status,comment}))};
      const result = await api(endpoint,{method:'PUT',body});
      setRecord(result);
      setMarks(result.marks);
      setNotice(complete ? t('Занятие проведено','Class marked as completed') : t('Отметки сохранены','Attendance saved'));
      onSave(result.state);
    } catch (problem) {
      setError(describeError(problem));
    } finally {
      setBusy(false);
    }
  }

  const allMarked = marks.every(mark => mark.status !== 'unmarked');
  const editable = record?.canEdit && !busy;
  return <div className="modal-overlay"><section className="dialog attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-title">
    <header><h2 id="attendance-title">{t('Посещаемость','Attendance')} · {lesson.title}</h2>
      <button className="icon-btn" type="button" onClick={close} disabled={busy} aria-label={t('Закрыть','Close')}>×</button>
    </header>
    <div className="dialog-body attendance-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-note" role="status">{notice}</p>}
      {!record && !error && <p>{t('Загрузка…','Loading…')}</p>}
      {record?.state === 'cancelled' && <p>{t('Занятие отменено.','Class cancelled.')}</p>}
      {record && !record.canEdit && record.state !== 'cancelled' &&
        <p>{t('Отметки доступны после начала занятия.','Attendance can be recorded after the class starts.')}</p>}
      {record?.canEdit && <button type="button" className="button secondary"
        disabled={!editable || allMarked}
        onClick={() => {
          setNotice('');
          setMarks(current => current.map(mark => mark.status === 'unmarked' ? {...mark,status:'present'} : mark));
        }}>{t('Все присутствуют','Mark all present')}</button>}
      {record && !marks.length && <p>{t('В списке нет студентов.','No students on the roster.')}</p>}
      {marks.map(mark => <article className="attendance-mark" key={mark.studentId}>
        <strong>{mark.first_name} {mark.last_name}</strong>
        <Field label={t('Отметка','Status')}>
          <select value={mark.status} disabled={!editable} onChange={e => update(mark.studentId,{status:e.target.value})}>
            {Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{t(...label)}</option>)}
          </select>
        </Field>
        <Field label={t('Комментарий','Comment')}>
          <input value={mark.comment} disabled={!editable} maxLength={500}
            onChange={e => update(mark.studentId,{comment:e.target.value})}/>
        </Field>
      </article>)}
    </div>
    {record?.canEdit && <footer className="attendance-actions">
      {record.canComplete && !allMarked && <small>{t('Чтобы провести занятие, отметьте всех студентов.','Mark every student before completing the class.')}</small>}
      <button type="button" className="button secondary" disabled={busy} onClick={() => save(false)}>{t('Сохранить','Save')}</button>
      {record.canComplete && <button type="button" className="button primary" disabled={busy || !allMarked}
        onClick={() => save(true)}>{t('Провести занятие','Complete class')}</button>}
    </footer>}
  </section></div>;
}
