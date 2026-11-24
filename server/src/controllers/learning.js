import {createGroup,enrollStudent,createLesson} from '../services/learning.js';
export async function createGroupController(req,res){res.status(201).json(await createGroup(req.user.id,req.body));}
export async function enrollStudentController(req,res){res.status(201).json(await enrollStudent(req.user.id,req.body,req.params.id));}
export async function createLessonController(req,res){res.status(201).json(await createLesson(req.user.id,req.body));}
