import React,{useEffect,useState} from 'react';

const states={draft:['Черновик','Draft'],published:['Опубликован','Published'],archived:['Архив','Archived']};
const empty={title:'',body:'',links:[],group_id:''};

export default function Materials({api,t,describeError,selection,open,field:Field}){
  const [list,setList]=useState(null);
  const [material,setMaterial]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);
  const [groupId,setGroupId]=useState('');
  const [lessons,setLessons]=useState([]);
  const refresh=()=>api('/materials').then(setList);
  function explain(problem){
    const translations={
      invalidPdf:['Выберите действительный PDF без пароля, до 10 МиБ.','Choose a valid PDF without a password, up to 10 MiB.'],
      emptyMaterial:['Добавьте текст, ссылку или PDF перед публикацией.','Add text, a link or a PDF before publishing.'],
      staleMaterial:['Материал уже изменён. Откройте его снова.','This material changed. Reopen it.'],
      materialArchived:['Материал уже в архиве.','This material is already archived.'],
    };
    return translations[problem.code]?t(...translations[problem.code]):describeError(problem);
  }

  useEffect(()=>{
    let active=true;
    api('/materials').then(data=>{if(active)setList(data);}).catch(problem=>{if(active)setError(explain(problem));});
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    setMaterial(null);
    setEditing(false);
    setError('');
    if(selection)api('/materials/'+selection).then(data=>{if(active)setMaterial(data);})
      .catch(problem=>{if(active)setError(explain(problem));});
    return ()=>{active=false;};
  },[selection]);

  const lessonGroup=material?.group_id||groupId;
  useEffect(()=>{
    if(!editing||!lessonGroup)return;
    let active=true;
    setLessons([]);
    api('/groups/'+lessonGroup+'/material-lessons').then(data=>{if(active)setLessons(data.items);})
      .catch(problem=>{if(active)setError(explain(problem));});
    return ()=>{active=false;};
  },[editing,lessonGroup]);

  async function change(work,reload=true){
    setBusy(true);
    setError('');
    try{
      const result=await work();
      if(result)setMaterial(result);
      if(reload)await refresh();
      return result;
    }catch(problem){
      setError(explain(problem));
    }finally{setBusy(false);}
  }

  async function submit(event){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const body={title:data.get('title'),body:data.get('body'),
      links:data.get('links').split(/\r?\n/).map(link=>link.trim()).filter(Boolean),
      lessonId:data.get('lessonId')||null};
    const saved=await change(()=>material
      ?api('/materials/'+material.id,{method:'PATCH',body:{...body,version:material.version}})
      :api('/materials',{method:'POST',body:{...body,groupId:data.get('groupId')}}));
    if(saved){setEditing(false);if(!selection)open(saved.id);}
  }

  function setState(state){
    if(state==='archived'&&!window.confirm(t('Архивировать материал?','Archive this material?')))return;
    return change(()=>api('/materials/'+material.id,{method:'PATCH',body:{state,version:material.version}}));
  }

  function upload(event){
    const file=event.target.files[0];
    event.target.value='';
    if(!file)return;
    if(file.size>10*1024*1024){setError(explain({code:'invalidPdf'}));return;}
    return change(()=>api('/materials/'+material.id+'/files?version='+material.version,{
      method:'POST',headers:{'Content-Type':'application/pdf','X-Filename':encodeURIComponent(file.name)},rawBody:file,
    }),false);
  }

  const item=material||empty;
  const editable=material?.canEdit&&material.state!=='archived';
  return <>
    <div className="page-heading">
      <h1>{t('Материалы','Materials')}</h1>
      <div className="toolbar">
        {selection&&<button type="button" className="button secondary" onClick={()=>open(null)} disabled={busy}>{t('К списку','Back to list')}</button>}
        {!selection&&Boolean(list?.managedGroups.length)&&!editing&&
          <button type="button" className="button primary" onClick={()=>{setGroupId(list.managedGroups[0].id);setEditing(true);setError('');}}>
            {t('Создать материал','Create material')}
          </button>}
      </div>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {editing ? <form className="panel padded material-form" onSubmit={submit} key={material?.id||'new'}>
      {!material&&<Field label={t('Группа','Group')}><select name="groupId" value={groupId}
        onChange={event=>setGroupId(event.target.value)} required>
        {list.managedGroups.map(group=><option key={group.id} value={group.id}>{group.code} · {group.title}</option>)}
      </select></Field>}
      <Field label={t('Занятие','Class')}><select name="lessonId" key={lessonGroup}
        defaultValue={material?.lesson_id||''}>
        <option value="">{t('Без занятия','No class')}</option>
        {material?.lesson_id&&!lessons.some(lesson=>lesson.id===material.lesson_id)&&
          <option value={material.lesson_id}>{t('Текущее занятие','Current class')}</option>}
        {lessons.map(lesson=><option value={lesson.id} key={lesson.id}>{lesson.title}</option>)}
      </select></Field>
      <Field label={t('Заголовок','Title')}><input name="title" defaultValue={item.title} maxLength={200} required/></Field>
      <Field label={t('Текст','Text')}><textarea name="body" rows={7} maxLength={100000} defaultValue={item.body}/></Field>
      <Field label={t('Ссылки, по одной на строку','Links, one per line')}><textarea name="links" rows={3} defaultValue={item.links.join('\n')}/></Field>
      <div className="toolbar">
        <button className="button primary" type="submit" disabled={busy}>{t('Сохранить','Save')}</button>
        <button className="button secondary" type="button" disabled={busy} onClick={()=>setEditing(false)}>{t('Отмена','Cancel')}</button>
      </div>
    </form> : material ? <article className="panel padded material-detail">
      <div className="page-heading"><div>
        <p>{material.group_code} · {t(...states[material.state])}</p>
        <h2>{material.title}</h2>
        <p>{material.author_first_name} {material.author_last_name}</p>
      </div>{editable&&<button className="button secondary" disabled={busy} onClick={()=>setEditing(true)}>{t('Изменить','Edit')}</button>}</div>
      {material.body&&<p className="material-text">{material.body}</p>}
      {material.links.length>0&&<ul>{material.links.map((link,index)=><li key={index}>
        <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
      </li>)}</ul>}
      {material.files.length>0&&<ul>{material.files.map((file,index)=><li key={file.id}>
        <a href={'/api/v1/materials/'+material.id+'/files/'+file.id}>{file.filename}</a>
        {index>0&&<small> · {t('Версия','Version')} {file.file_version}</small>}
      </li>)}</ul>}
      {editable&&<>
        <Field label={material.files.length?t('Загрузить новую версию PDF','Upload a new PDF version'):t('Загрузить PDF','Upload PDF')}>
          <input type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy}/>
        </Field>
        <div className="toolbar">
          {material.state==='draft'&&<button type="button" className="button primary" disabled={busy}
            onClick={()=>setState('published')}>{t('Опубликовать','Publish')}</button>}
          <button type="button" className="button secondary" disabled={busy}
            onClick={()=>setState('archived')}>{t('Архивировать','Archive')}</button>
        </div>
      </>}
    </article> : !selection&&list ? (list.items.length ? <div className="group-cards">
      {list.items.map(row=><article key={row.id} className="panel padded">
        <p>{row.group_code} · {t(...states[row.state])}</p>
        <h2><button type="button" className="text-button" onClick={()=>open(row.id)}>{row.title}</button></h2>
      </article>)}
    </div> : <p>{t('Материалов пока нет.','No materials yet.')}</p>) : !error&&<p>{t('Загрузка…','Loading…')}</p>}
  </>;
}
