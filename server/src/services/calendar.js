import {DateTime} from 'luxon';
import {Problem} from './security.js';
export const zone='Asia/Jerusalem';
export const today=()=>DateTime.now().setZone(zone).toISODate();
export function weekRange(localDate){const date=DateTime.fromISO(localDate,{zone});if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate)||!date.isValid)throw new Problem(422,'invalidDate');const start=date.startOf('day').minus({days:date.weekday%7}),end=start.plus({days:7});return {weekStart:start.toISODate(),weekEnd:end.minus({days:1}).toISODate(),weekDays:Array.from({length:7},(_,i)=>start.plus({days:i}).toISODate()),timeZone:zone,from:start.toUTC().toSQL({includeOffset:false}),until:end.toUTC().toSQL({includeOffset:false})};}
export function utc(value){const d=DateTime.fromISO(value,{setZone:true});if(!d.isValid||!/(Z|[+-]\d\d:\d\d)$/.test(value))throw new Problem(422,'offsetRequired');if(d.setZone(zone).offset!==d.offset)throw new Problem(422,'israelOffsetMismatch');return d.toUTC().toSQL({includeOffset:false});}
export const iso=value=>value.replace(' ','T')+'Z';
