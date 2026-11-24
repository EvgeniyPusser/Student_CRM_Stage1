import React,{useEffect,useState} from 'react';

export default function Notifications({api,t,describeError,readDate,openMaterial}){
  const [items,setItems]=useState(null);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(null);
  useEffect(()=>{
    let active=true;
    api('/notifications').then(result=>{if(active)setItems(result.items);})
      .catch(problem=>{if(active)setError(describeError(problem));});
    return ()=>{active=false;};
  },[]);

  async function read(item){
    setSaving(item.id);
    setError('');
    try{
      await api('/notifications/'+item.id,{method:'PATCH'});
      setItems(current=>current.map(row=>row.id===item.id?{...row,read_at:row.read_at||new Date().toISOString()}:row));
    }catch(problem){setError(describeError(problem));}
    finally{setSaving(null);}
  }

  return <>
    <h1>{t('Уведомления','Notifications')}</h1>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!items&&!error&&<p>{t('Загрузка…','Loading…')}</p>}
    {items?.length===0&&<p>{t('Уведомлений пока нет.','No notifications yet.')}</p>}
    {items?.map(item=><article className="panel padded" key={item.id}>
      <h2>{t('Опубликован учебный материал','Learning material published')}</h2>
      <p><time dateTime={item.created_at}>{readDate(item.created_at)}</time> · {item.read_at?t('Прочитано','Read'):t('Не прочитано','Unread')}</p>
      <div className="toolbar">
        <button type="button" className="button secondary" onClick={()=>openMaterial(item.object_id)}>{t('Открыть материал','Open material')}</button>
        {!item.read_at&&<button type="button" className="text-button" disabled={saving!==null} onClick={()=>read(item)}>
          {t('Отметить прочитанным','Mark as read')}
        </button>}
      </div>
    </article>)}
  </>;
}
