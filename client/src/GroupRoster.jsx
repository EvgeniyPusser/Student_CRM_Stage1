import React,{useState} from 'react';

const enrollmentStates = {
  planned: ['Запланирован','Planned'],
  studying: ['Учится','Studying'],
  completed: ['Завершил','Completed'],
  withdrawn: ['Выбыл','Withdrawn'],
};

export default function GroupRoster({group,t,fmt,field:Field,openStudent}) {
  const [search,setSearch]=useState('');
  const [state,setState]=useState('');
  const query=search.trim().toLowerCase();
  const students=group.students.filter(student =>
    (!state || student.state===state) && (!query ||
      [student.id,[student.last_name,student.first_name].join(' '),
        [student.first_name,student.last_name].join(' '),student.email,student.phone]
        .some(value=>value?.toLowerCase().includes(query))));
  return <section className="panel">
    <div className="toolbar roster-toolbar">
      <Field label={t('Поиск по составу','Search roster')}>
        <input type="search" value={search} onChange={event=>setSearch(event.target.value)}/>
      </Field>
      <Field label={t('Статус','Status')}>
        <select value={state} onChange={event=>setState(event.target.value)}>
          <option value="">{t('Все статусы','All statuses')}</option>
          {Object.entries(enrollmentStates).map(([value,label])=><option key={value} value={value}>{t(...label)}</option>)}
        </select>
      </Field>
      <a className="button secondary" href={'/api/v1/groups/'+group.id+'/roster.csv'}>{t('Скачать состав CSV','Download roster CSV')}</a>
    </div>
    {students.length ? <div className="table-scroll"><table>
      <thead><tr>{['ID',t('Студент','Student'),'Email',t('Телефон','Telephone'),
        t('Статус','Status'),t('Периоды обучения','Study periods')].map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{students.map(student=><tr key={student.id}>
        <td className="mono">{student.id}</td>
        <td><button type="button" className="text-button" onClick={()=>openStudent(student.id)}>{student.last_name} {student.first_name}</button></td>
        <td>{student.email}</td>
        <td>{student.phone||t('Не указан','Not specified')}</td>
        <td>{t(...enrollmentStates[student.state])}</td>
        <td>{student.periods.length ? student.periods.map((period)=>
          <div key={period.start_date+'-'+period.end_date}>{fmt(period.start_date)} — {period.end_date?fmt(period.end_date):t('по настоящее время','present')}</div>)
          : student.state==='planned'?fmt(student.start_date):'—'}</td>
      </tr>)}</tbody>
    </table></div> : <p className="padded">{t('Студенты не найдены.','No students found.')}</p>}
  </section>;
}
