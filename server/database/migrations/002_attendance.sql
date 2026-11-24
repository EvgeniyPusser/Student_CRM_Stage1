CREATE TABLE IF NOT EXISTS attendance_snapshots (
 lesson_id CHAR(36) PRIMARY KEY,
 frozen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (lesson_id) REFERENCES lessons(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_marks (
 lesson_id CHAR(36) NOT NULL,
 student_id CHAR(36) NOT NULL,
 status ENUM('unmarked','present','late','absent','excused') NOT NULL DEFAULT 'unmarked',
 comment VARCHAR(500) NOT NULL DEFAULT '',
 PRIMARY KEY (lesson_id,student_id),
 FOREIGN KEY (lesson_id) REFERENCES attendance_snapshots(lesson_id),
 FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB;
