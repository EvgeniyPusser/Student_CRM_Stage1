import React,{useEffect,useState} from 'react';

const states = {
  active:['Активен','Active'], invited:['Приглашён','Invited'], blocked:['Заблокирован','Blocked'],
  planned:['Запланировано','Planned'], studying:['Учится','Studying'],
  completed:['Завершил','Completed'], withdrawn:['Выбыл','Withdrawn'],
};

export default function StudentCard({id,api,t,fmt,describeError,close}) {
  const [card,setCard]=useState(null);
  const [error,setError]=useState('');
  const [note,setNote]=useState('');
  const [noteMessage,setNoteMessage]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let active=true;
    api('/students/'+id+'/card').then(result=>{
      if(active){setCard(result);setNote(result.staffNote?.note||'');}
    }).catch(problem=>{
      if(active)setError(describeError(problem));
    });
    return ()=>{active=false};
  },[id]);
  const {student,enrollments,attendance,staffNote}=card||{};
  async function saveNote(event){
    event.preventDefault();
    setSaving(true);
    setError('');
    setNoteMessage('');
    try{
      const saved=await api('/students/'+id+'/note',{method:'PATCH',body:{note,version:staffNote.version}});
      setCard(current=>({...current,staffNote:saved}));
      setNoteMessage(t('Заметка сохранена.','Note saved.'));
    }catch(problem){
      setError(problem.code==='staleStaffNote'
        ?t('Заметку уже изменили. Откройте карточку заново.','The note was changed. Reopen the profile.')
        :describeError(problem));
    }finally{setSaving(false);}
  }
  return <div className="modal-overlay">
    <section className="dialog attendance-dialog" role="dialog" aria-modal="true" aria-labelledby="student-card-title">
      <header>
        <h2 id="student-card-title">{student?student.last_name+' '+student.first_name:t('Карточка студента','Student profile')}</h2>
        <button className="icon-btn" type="button" onClick={close} aria-label={t('Закрыть','Close')}>×</button>
      </header>
      <div className="dialog-body attendance-body">
        {error&&<p className="form-error" role="alert">{error}</p>}
        {!card&&!error&&<p>{t('Загрузка…','Loading…')}</p>}
        {student&&<>
          <h3>{t('Профиль','Profile')}</h3>
          <dl className="student-card-details">
            <dt>ID</dt><dd>{student.id}</dd>
            <dt>Email</dt><dd>{student.email}</dd>
            <dt>{t('Телефон','Telephone')}</dt><dd>{student.phone||t('Не указан','Not specified')}</dd>
            <dt>{t('Язык','Language')}</dt><dd>{student.language==='en'?'English':'Русский'}</dd>
            <dt>{t('Состояние','Status')}</dt><dd>{t(...states[student.state])}</dd>
          </dl>
          <h3>{t('Зачисления','Enrollments')}</h3>
          {enrollments.length===0&&<p>{t('Зачислений пока нет.','No enrollments yet.')}</p>}
          {enrollments.map(enrollment=><article className="padded" key={enrollment.id}>
            <strong>{enrollment.code} · {enrollment.title}</strong>
            <p>{t(...states[enrollment.state])} · {fmt(enrollment.start_date)}</p>
            {enrollment.periods.length>0&&<ul>
              {enrollment.periods.map((period,index)=><li key={index}>{fmt(period.start_date)} — {period.end_date?fmt(period.end_date):t('по настоящее время','present')}</li>)}
            </ul>}
          </article>)}
          {attendance&&<><h3>{t('Посещаемость','Attendance')}</h3>
          {attendance.missing>0
            ?<p>{t('Занятий без полных отметок: ','Classes with missing marks: ')}{attendance.missing}</p>
            :<p>{attendance.percent===null?t('Нет данных','No data'):
              new Intl.NumberFormat(t('ru','en'),{style:'percent',maximumFractionDigits:1}).format(attendance.percent/100)}</p>}
          {attendance.completed>0&&<dl className="student-card-details">
            <dt>{t('Проведено занятий','Completed classes')}</dt><dd>{attendance.completed}</dd>
            <dt>{t('Присутствовал','Present')}</dt><dd>{attendance.present}</dd>
            <dt>{t('Опоздал','Late')}</dt><dd>{attendance.late}</dd>
            <dt>{t('Отсутствовал','Absent')}</dt><dd>{attendance.absent}</dd>
            <dt>{t('Уважительная причина','Excused')}</dt><dd>{attendance.excused}</dd>
          </dl>}</>}
          {staffNote&&<form onSubmit={saveNote}>
            <label className="field">
              <span>{t('Служебная заметка','Staff note')}</span>
              <textarea value={note} rows={4} maxLength={5000} disabled={saving}
                onChange={event=>{setNote(event.target.value);setNoteMessage('');}}/>
            </label>
            {noteMessage&&<p role="status">{noteMessage}</p>}
            <button className="button primary" type="submit" disabled={saving||note===staffNote.note}>
              {t('Сохранить заметку','Save note')}
            </button>
          </form>}
        </>}
      </div>
    </section>
  </div>;
}
